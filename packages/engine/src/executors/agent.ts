import type { AgentStepDefinition } from '@ergon/shared';
import type { ExecutionContext, Executor, ExecutorResult } from './index.js';

export class AgentExecutor implements Executor<AgentStepDefinition> {
	public readonly kind = 'agent' as const;

	public async execute(
		_step: AgentStepDefinition,
		_context: ExecutionContext,
	): Promise<ExecutorResult> {
		throw new Error('AgentExecutor is not implemented yet');
	}
}
