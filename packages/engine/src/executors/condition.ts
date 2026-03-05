import type { ConditionStepDefinition } from '@ergon/shared';
import type { ExecutionContext, Executor, ExecutorResult } from './index.js';

export class ConditionExecutor implements Executor<ConditionStepDefinition> {
	public readonly kind = 'condition' as const;

	public async execute(
		_step: ConditionStepDefinition,
		_context: ExecutionContext,
	): Promise<ExecutorResult> {
		throw new Error('ConditionExecutor is not implemented yet');
	}
}
