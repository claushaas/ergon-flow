import type { NotifyStepDefinition } from '@ergon/shared';
import type { ExecutionContext, Executor, ExecutorResult } from './index.js';

export class NotifyExecutor implements Executor<NotifyStepDefinition> {
	public readonly kind = 'notify' as const;

	public async execute(
		_step: NotifyStepDefinition,
		_context: ExecutionContext,
	): Promise<ExecutorResult> {
		throw new Error('NotifyExecutor is not implemented yet');
	}
}
