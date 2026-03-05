import type {
	ArtifactType,
	StepDefinition,
	StepKind,
	StepRunStatus,
} from '@ergon/shared';

export interface ExecutorArtifact {
	name: string;
	type: ArtifactType;
	value: unknown;
}

export interface ExecutionRunMetadata {
	attempt: number;
	runId: string;
	stepIndex: number;
	workflowId: string;
	workflowVersion: number;
	workerId?: string;
}

export interface ExecutionContext {
	artifacts: Record<string, unknown>;
	getArtifact: (name: string) => unknown;
	getRequiredArtifact: (name: string) => unknown;
	hasArtifact: (name: string) => boolean;
	inputs: Record<string, unknown>;
	run: ExecutionRunMetadata;
}

export interface CreateExecutionContextOptions {
	artifacts?: Record<string, unknown>;
	inputs: Record<string, unknown>;
	run: ExecutionRunMetadata;
}

export interface ExecutorResult {
	artifacts?: ExecutorArtifact[];
	outputs?: Record<string, unknown>;
	status: Extract<
		StepRunStatus,
		'failed' | 'skipped' | 'succeeded' | 'waiting_manual'
	>;
}

export interface Executor<TStep extends StepDefinition = StepDefinition> {
	readonly kind: TStep['kind'];
	execute(step: TStep, context: ExecutionContext): Promise<ExecutorResult>;
}

export function createExecutionContext(
	options: CreateExecutionContextOptions,
): ExecutionContext {
	const artifacts = { ...(options.artifacts ?? {}) };

	return {
		artifacts,
		getArtifact(name: string): unknown {
			return artifacts[name];
		},
		getRequiredArtifact(name: string): unknown {
			if (name in artifacts) {
				return artifacts[name];
			}
			throw new Error(`Artifact "${name}" was not found in execution context`);
		},
		hasArtifact(name: string): boolean {
			return name in artifacts;
		},
		inputs: { ...options.inputs },
		run: { ...options.run },
	};
}

export class ExecutorRegistry {
	private readonly executors = new Map<StepKind, Executor>();

	public constructor(executors: Executor[] = []) {
		for (const executor of executors) {
			this.register(executor);
		}
	}

	public get(kind: StepKind): Executor {
		const executor = this.executors.get(kind);
		if (!executor) {
			throw new Error(`No executor registered for step kind "${kind}"`);
		}
		return executor;
	}

	public has(kind: StepKind): boolean {
		return this.executors.has(kind);
	}

	public register(executor: Executor): void {
		if (this.executors.has(executor.kind)) {
			throw new Error(`Executor already registered for step kind "${executor.kind}"`);
		}
		this.executors.set(executor.kind, executor);
	}
}
