import type { ExecStepDefinition } from '@ergon/shared';
import type { ExecutionContext, Executor, ExecutorResult } from './index.js';

export class ExecExecutor implements Executor<ExecStepDefinition> {
	public readonly kind = 'exec' as const;

	public async execute(
		_step: ExecStepDefinition,
		_context: ExecutionContext,
	): Promise<ExecutorResult> {
		throw new Error('ExecExecutor is not implemented yet');
	}
}
