import { lookup as dnsLookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import type { CliClientOptions, CliSpawn } from '@ergon/clients';
import type { NotifyStepDefinition } from '@ergon/shared';
import {
	interpolateTemplateString,
	renderStepRequestPayload,
} from '../templating/index.js';
import type { ExecutionContext, Executor, ExecutorResult } from './index.js';

export interface NotifyWebhookPayload {
	channel: string;
	message: string;
	runId: string;
	stepId: string;
	target: string;
	workflowId: string;
}

export interface NotifyWebhookResult {
	status?: number;
}

export interface NotifyOpenClawResult {
	status?: number;
}

export type HostnameResolver = typeof dnsLookup;
export type NotifyLogger = (message: string) => void;
export type NotifyWebhookSender = (
	payload: NotifyWebhookPayload & { signal?: AbortSignal },
) => Promise<NotifyWebhookResult>;
export type NotifyOpenClawSender = (payload: {
	message: string;
	signal?: AbortSignal;
	target: string;
}) => Promise<NotifyOpenClawResult>;

export interface NotifyExecutorOptions {
	log?: NotifyLogger;
	openclaw?: CliClientOptions;
	resolveHostname?: HostnameResolver;
	sendOpenClawMessage?: NotifyOpenClawSender;
	sendWebhook?: NotifyWebhookSender;
}

const RUN_SUMMARY_ARTIFACT_NAME = 'run.summary';

interface RunSummaryArtifact {
	channel: string;
	message: string;
	run_id: string;
	step_id: string;
	target?: string;
	workflow_id: string;
	workflow_version: number;
}

const DEFAULT_OPENCLAW_COMMAND = 'openclaw';
const DEFAULT_OPENCLAW_ARGS = ['message', 'send'];

function sanitizeLoggedMessage(message: string): string {
	return JSON.stringify(message.replaceAll('\u0000', ''));
}

function buildRunSummaryArtifact(
	context: ExecutionContext,
	channel: string,
	step: NotifyStepDefinition,
	message: string,
	target?: string,
): RunSummaryArtifact {
	return {
		channel,
		message,
		run_id: context.run.runId,
		step_id: step.id,
		...(target ? { target } : {}),
		workflow_id: context.run.workflowId,
		workflow_version: context.run.workflowVersion,
	};
}

function formatStableStdoutMessage(summary: RunSummaryArtifact): string {
	return [
		`[ergon-flow] workflow=${summary.workflow_id} run=${summary.run_id} step=${summary.step_id} channel=${summary.channel}`,
		summary.message,
	].join('\n');
}

function createRunSummaryArtifact(summary: RunSummaryArtifact) {
	return {
		name: RUN_SUMMARY_ARTIFACT_NAME,
		type: 'json' as const,
		value: summary,
	};
}

function isBlockedIpAddress(address: string): boolean {
	if (address === '::1') {
		return true;
	}
	if (
		address.startsWith('fe80:') ||
		address.startsWith('fc') ||
		address.startsWith('fd')
	) {
		return true;
	}
	const parts = address.split('.').map((part) => Number.parseInt(part, 10));
	if (parts.length !== 4 || parts.some((part) => Number.isNaN(part))) {
		return false;
	}
	const [first, second] = parts;
	if (first === 10 || first === 127 || first === 0) {
		return true;
	}
	if (first === 169 && second === 254) {
		return true;
	}
	if (first === 172 && second !== undefined && second >= 16 && second <= 31) {
		return true;
	}
	if (first === 192 && second === 168) {
		return true;
	}
	return false;
}

async function validateWebhookTarget(
	target: string,
	resolveHostname: HostnameResolver,
): Promise<URL> {
	let parsedUrl: URL;
	try {
		parsedUrl = new URL(target);
	} catch {
		throw new Error('Notify webhook target must be a valid https URL');
	}
	if (parsedUrl.protocol !== 'https:') {
		throw new Error('Notify webhook target must use https');
	}
	const normalizedHostname = parsedUrl.hostname
		.replace(/\.$/, '')
		.toLowerCase();
	if (
		!normalizedHostname ||
		normalizedHostname === 'localhost' ||
		normalizedHostname.endsWith('.localhost')
	) {
		throw new Error('Notify webhook target must use a non-local hostname');
	}
	if (isIP(normalizedHostname) !== 0) {
		throw new Error('Notify webhook target must not use an IP address');
	}
	if (parsedUrl.username || parsedUrl.password) {
		throw new Error('Notify webhook target must not include credentials');
	}
	const resolvedAddresses = await resolveHostname(normalizedHostname, {
		all: true,
		family: 0,
	});
	if (resolvedAddresses.length === 0) {
		throw new Error('Notify webhook target must resolve to a public address');
	}
	if (resolvedAddresses.some((entry) => isBlockedIpAddress(entry.address))) {
		throw new Error('Notify webhook target must resolve to a public address');
	}
	return parsedUrl;
}

export async function defaultSendWebhook(
	payload: NotifyWebhookPayload & { signal?: AbortSignal },
): Promise<NotifyWebhookResult> {
	const response = await fetch(payload.target, {
		body: JSON.stringify({
			channel: payload.channel,
			message: payload.message,
			runId: payload.runId,
			stepId: payload.stepId,
			workflowId: payload.workflowId,
		}),
		headers: {
			'content-type': 'application/json',
		},
		method: 'POST',
		redirect: 'error',
		signal: payload.signal,
	});
	if (!response.ok) {
		throw new Error(
			`Notify webhook request failed with status ${response.status}`,
		);
	}

	return {
		status: response.status,
	};
}

async function defaultSpawn(options: {
	args: string[];
	command: string;
	env?: Record<string, string>;
	input: string;
	signal?: AbortSignal;
	spawn?: CliSpawn;
}): Promise<{ code: number | null; stderr: string; stdout: string }> {
	if (options.spawn) {
		const result = await options.spawn({
			args: options.args,
			command: options.command,
			env: options.env,
			input: options.input,
			signal: options.signal,
		});
		return {
			code: result.code,
			stderr: result.stderr,
			stdout: result.stdout,
		};
	}

	const { spawn } = await import('node:child_process');
	return await new Promise((resolve, reject) => {
		const child = spawn(options.command, options.args, {
			env: options.env ? { ...process.env, ...options.env } : process.env,
			stdio: 'pipe',
		});
		let stdout = '';
		let stderr = '';
		let settled = false;
		let forceKillTimer: NodeJS.Timeout | undefined;

		const cleanupAbort = () => {
			if (options.signal) {
				options.signal.removeEventListener('abort', abortHandler);
			}
			if (forceKillTimer) {
				clearTimeout(forceKillTimer);
				forceKillTimer = undefined;
			}
		};

		const fail = (error: Error) => {
			if (settled) {
				return;
			}
			settled = true;
			cleanupAbort();
			reject(error);
		};

		const abortHandler = () => {
			if (settled) {
				return;
			}
			settled = true;
			child.kill('SIGTERM');
			forceKillTimer = setTimeout(() => {
				if (!child.killed) {
					child.kill('SIGKILL');
				}
			}, 250);
			reject(
				options.signal?.reason instanceof Error
					? options.signal.reason
					: Object.assign(new Error('Notify command aborted'), {
							name: 'AbortError',
						}),
			);
		};

		child.stdout.on('data', (chunk) => {
			stdout += chunk.toString();
		});
		child.stderr.on('data', (chunk) => {
			stderr += chunk.toString();
		});
		child.on('error', fail);
		child.on('close', (code) => {
			if (settled) {
				cleanupAbort();
				return;
			}
			settled = true;
			cleanupAbort();
			resolve({
				code,
				stderr,
				stdout,
			});
		});
		if (options.signal) {
			if (options.signal.aborted) {
				abortHandler();
				return;
			}
			options.signal.addEventListener('abort', abortHandler, { once: true });
		}

		child.stdin.write(options.input);
		child.stdin.end();
	});
}

function createOpenClawSender(
	options: CliClientOptions = {},
): NotifyOpenClawSender {
	const command = options.command ?? DEFAULT_OPENCLAW_COMMAND;
	const args = [...(options.args ?? []), ...DEFAULT_OPENCLAW_ARGS];
	const env = options.env;
	const spawn = options.spawn;

	return async ({ message, signal, target }) => {
		const result = await defaultSpawn({
			args: [...args, target],
			command,
			env,
			input: message,
			signal,
			spawn,
		});
		if (result.code !== 0) {
			const detail = result.stderr.trim() || result.stdout.trim();
			throw new Error(
				detail
					? `OpenClaw notify command failed (${String(result.code)}): ${detail}`
					: `OpenClaw notify command failed (${String(result.code)})`,
			);
		}

		return {
			status: 0,
		};
	};
}

export class NotifyExecutor implements Executor<NotifyStepDefinition> {
	public readonly kind = 'notify' as const;
	private readonly log: NotifyLogger;
	private readonly sendOpenClawMessage: NotifyOpenClawSender;
	private readonly resolveHostname: HostnameResolver;
	private readonly sendWebhook: NotifyWebhookSender;

	public constructor(options: NotifyExecutorOptions = {}) {
		this.log = options.log ?? console.log;
		this.sendOpenClawMessage =
			options.sendOpenClawMessage ?? createOpenClawSender(options.openclaw);
		this.resolveHostname = options.resolveHostname ?? dnsLookup;
		this.sendWebhook = options.sendWebhook ?? defaultSendWebhook;
	}

	public async execute(
		step: NotifyStepDefinition,
		context: ExecutionContext,
	): Promise<ExecutorResult> {
		const payload = renderStepRequestPayload(step, {
			artifacts: context.artifacts,
			inputs: context.inputs,
		});
		if (!payload.message) {
			throw new Error(`Notify step "${step.id}" did not render a message`);
		}
		const channel = interpolateTemplateString(step.channel, {
			artifacts: context.artifacts,
			inputs: context.inputs,
		});

		switch (channel) {
			case 'stdout': {
				const summary = buildRunSummaryArtifact(
					context,
					channel,
					step,
					payload.message,
				);
				this.log(sanitizeLoggedMessage(formatStableStdoutMessage(summary)));
				return {
					artifacts: [createRunSummaryArtifact(summary)],
					outputs: {
						...summary,
					},
					status: 'succeeded',
				};
			}
			case 'webhook': {
				if (!step.target) {
					throw new Error(`Notify step "${step.id}" requires a target`);
				}

				const target = interpolateTemplateString(step.target, {
					artifacts: context.artifacts,
					inputs: context.inputs,
				});
				const validatedTarget = await validateWebhookTarget(
					target,
					this.resolveHostname,
				);
				const result = await this.sendWebhook({
					channel,
					message: payload.message,
					runId: context.run.runId,
					signal: context.signal,
					stepId: step.id,
					target: validatedTarget.toString(),
					workflowId: context.run.workflowId,
				});
				const summary = buildRunSummaryArtifact(
					context,
					channel,
					step,
					payload.message,
					validatedTarget.toString(),
				);

				return {
					artifacts: [createRunSummaryArtifact(summary)],
					outputs: {
						...summary,
						status: result.status,
					},
					status: 'succeeded',
				};
			}
			case 'openclaw': {
				if (!step.target) {
					throw new Error(`Notify step "${step.id}" requires a target`);
				}

				const target = interpolateTemplateString(step.target, {
					artifacts: context.artifacts,
					inputs: context.inputs,
				});
				if (target.startsWith('-')) {
					throw new Error(
						`Notify step "${step.id}" target cannot start with a hyphen`,
					);
				}
				await this.sendOpenClawMessage({
					message: payload.message,
					signal: context.signal,
					target,
				});
				const summary = buildRunSummaryArtifact(
					context,
					channel,
					step,
					payload.message,
					target,
				);

				return {
					artifacts: [createRunSummaryArtifact(summary)],
					outputs: {
						...summary,
						status: 0,
					},
					status: 'succeeded',
				};
			}
			default:
				throw new Error(
					`Notify step "${step.id}" uses unsupported channel "${step.channel}"`,
				);
		}
	}
}
