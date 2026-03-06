import { lookup as dnsLookup } from 'node:dns/promises';
import { isIP } from 'node:net';
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

export type HostnameResolver = typeof dnsLookup;
export type NotifyLogger = (message: string) => void;
export type NotifyWebhookSender = (
	payload: NotifyWebhookPayload,
) => Promise<NotifyWebhookResult>;

export interface NotifyExecutorOptions {
	log?: NotifyLogger;
	resolveHostname?: HostnameResolver;
	sendWebhook?: NotifyWebhookSender;
}

interface RunSummaryArtifact {
	channel: string;
	message: string;
	run_id: string;
	step_id: string;
	target?: string;
	workflow_id: string;
	workflow_version: number;
}

function sanitizeLoggedMessage(message: string): string {
	return JSON.stringify(message.replaceAll('\u0000', ''));
}

function buildRunSummaryArtifact(
	context: ExecutionContext,
	step: NotifyStepDefinition,
	message: string,
	target?: string,
): RunSummaryArtifact {
	return {
		channel: step.channel,
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
	payload: NotifyWebhookPayload,
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

export class NotifyExecutor implements Executor<NotifyStepDefinition> {
	public readonly kind = 'notify' as const;
	private readonly log: NotifyLogger;
	private readonly resolveHostname: HostnameResolver;
	private readonly sendWebhook: NotifyWebhookSender;

	public constructor(options: NotifyExecutorOptions = {}) {
		this.log = options.log ?? console.log;
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

		switch (step.channel) {
			case 'stdout': {
				const summary = buildRunSummaryArtifact(context, step, payload.message);
				this.log(sanitizeLoggedMessage(formatStableStdoutMessage(summary)));
				return {
					artifacts: [
						{
							name: 'run.summary',
							type: 'json',
							value: summary,
						},
					],
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
					channel: step.channel,
					message: payload.message,
					runId: context.run.runId,
					stepId: step.id,
					target: validatedTarget.toString(),
					workflowId: context.run.workflowId,
				});
				const summary = buildRunSummaryArtifact(
					context,
					step,
					payload.message,
					validatedTarget.toString(),
				);

				return {
					artifacts: [
						{
							name: 'run.summary',
							type: 'json',
							value: summary,
						},
					],
					outputs: {
						...summary,
						status: result.status,
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
