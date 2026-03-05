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

export type NotifyLogger = (message: string) => void;
export type NotifyWebhookSender = (
	payload: NotifyWebhookPayload,
) => Promise<NotifyWebhookResult>;

export interface NotifyExecutorOptions {
	log?: NotifyLogger;
	sendWebhook?: NotifyWebhookSender;
}

function sanitizeLoggedMessage(message: string): string {
	return JSON.stringify(message.replaceAll('\u0000', ''));
}

function validateWebhookTarget(target: string): URL {
	let parsedUrl: URL;
	try {
		parsedUrl = new URL(target);
	} catch {
		throw new Error('Notify webhook target must be a valid https URL');
	}
	if (parsedUrl.protocol !== 'https:') {
		throw new Error('Notify webhook target must use https');
	}
	if (!parsedUrl.hostname || parsedUrl.hostname === 'localhost') {
		throw new Error('Notify webhook target must use a non-local hostname');
	}
	if (isIP(parsedUrl.hostname) !== 0) {
		throw new Error('Notify webhook target must not use an IP address');
	}
	if (parsedUrl.username || parsedUrl.password) {
		throw new Error('Notify webhook target must not include credentials');
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
	private readonly sendWebhook: NotifyWebhookSender;

	public constructor(options: NotifyExecutorOptions = {}) {
		this.log = options.log ?? console.log;
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
			case 'stdout':
				this.log(sanitizeLoggedMessage(payload.message));
				return {
					outputs: {
						channel: step.channel,
						message: payload.message,
					},
					status: 'succeeded',
				};
			case 'webhook': {
				if (!step.target) {
					throw new Error(`Notify step "${step.id}" requires a target`);
				}

				const target = interpolateTemplateString(step.target, {
					artifacts: context.artifacts,
					inputs: context.inputs,
				});
				const validatedTarget = validateWebhookTarget(target);
				const result = await this.sendWebhook({
					channel: step.channel,
					message: payload.message,
					runId: context.run.runId,
					stepId: step.id,
					target: validatedTarget.toString(),
					workflowId: context.run.workflowId,
				});

				return {
					outputs: {
						channel: step.channel,
						message: payload.message,
						status: result.status,
						target: validatedTarget.toString(),
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
