import type { ArtifactStepDefinition } from '@ergon/shared';
import type { ExecutionContext, Executor, ExecutorResult } from './index.js';

export class ArtifactExecutor implements Executor<ArtifactStepDefinition> {
	public readonly kind = 'artifact' as const;

	public async execute(
		_step: ArtifactStepDefinition,
		_context: ExecutionContext,
	): Promise<ExecutorResult> {
		throw new Error('ArtifactExecutor is not implemented yet');
	}
}
