import type { ManualStepDefinition } from '@ergon/shared';
import type { ExecutionContext, Executor, ExecutorResult } from './index.js';

export class ManualExecutor implements Executor<ManualStepDefinition> {
	public readonly kind = 'manual' as const;

	public async execute(
		_step: ManualStepDefinition,
		_context: ExecutionContext,
	): Promise<ExecutorResult> {
		throw new Error('ManualExecutor is not implemented yet');
	}
}
