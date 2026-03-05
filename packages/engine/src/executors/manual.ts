import type { ManualStepDefinition } from '@ergon/shared';
import type { ExecutionContext, Executor, ExecutorResult } from './index.js';

export class ManualExecutor implements Executor<ManualStepDefinition> {
	public readonly kind = 'manual' as const;

	public async execute(
		step: ManualStepDefinition,
		context: ExecutionContext,
	): Promise<ExecutorResult> {
		const message = step.message?.trim() || undefined;
		const payload = {
			runId: context.run.runId,
			stepId: step.id,
			...(message ? { message } : {}),
		};

		return {
			events: [
				{
					payload,
					type: 'manual_waiting',
				},
			],
			status: 'waiting_manual',
		};
	}
}
