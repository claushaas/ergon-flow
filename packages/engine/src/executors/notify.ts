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

		if (step.channel === 'stdout') {
			this.log(payload.message);
			return {
				outputs: {
					channel: step.channel,
					message: payload.message,
				},
				status: 'succeeded',
			};
		}

		if (step.channel === 'webhook') {
			if (!step.target) {
				throw new Error(`Notify step "${step.id}" requires a target`);
			}

			const target = interpolateTemplateString(step.target, {
				artifacts: context.artifacts,
				inputs: context.inputs,
			});
			const result = await this.sendWebhook({
				channel: step.channel,
				message: payload.message,
				runId: context.run.runId,
				stepId: step.id,
				target,
				workflowId: context.run.workflowId,
			});

			return {
				outputs: {
					channel: step.channel,
					message: payload.message,
					status: result.status,
					target,
				},
				status: 'succeeded',
			};
		}

		throw new Error(
			`Notify step "${step.id}" uses unsupported channel "${step.channel}"`,
		);
	}
}
