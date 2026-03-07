import type {
	ArtifactType,
	EventType,
	StepDefinition,
	StepKind,
	StepRunStatus,
} from '@claushaas/ergon-shared';

export interface ExecutorArtifact {
	name: string;
	type: ArtifactType;
	value: unknown;
}

export interface ExecutorEvent {
	payload?: Record<string, unknown>;
	type: EventType;
}

export interface ExecutionRunMetadata {
	readonly attempt: number;
	readonly runId: string;
	readonly stepIndex: number;
	readonly workflowId: string;
	readonly workflowVersion: number;
	readonly workerId?: string;
}

export interface ExecutionContext {
	readonly artifacts: Readonly<Record<string, unknown>>;
	getArtifact: (name: string) => unknown;
	getRequiredArtifact: (name: string) => unknown;
	hasArtifact: (name: string) => boolean;
	readonly inputs: Readonly<Record<string, unknown>>;
	readonly run: ExecutionRunMetadata;
	readonly signal: AbortSignal;
}

export interface CreateExecutionContextOptions {
	artifacts?: Record<string, unknown>;
	inputs: Record<string, unknown>;
	run: ExecutionRunMetadata;
	signal?: AbortSignal;
}

export interface ExecutorResult {
	artifacts?: ExecutorArtifact[];
	events?: ExecutorEvent[];
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

type RegisteredExecutor = Executor<StepDefinition>;

export function createExecutionContext(
	options: CreateExecutionContextOptions,
): ExecutionContext {
	const artifacts = Object.freeze({ ...(options.artifacts ?? {}) });
	const inputs = Object.freeze({ ...options.inputs });
	const run = Object.freeze({ ...options.run });
	const signal = options.signal ?? new AbortController().signal;

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
		inputs,
		run,
		signal,
	};
}

export class ExecutorRegistry {
	private readonly executors = new Map<StepKind, RegisteredExecutor>();

	public constructor(executors: RegisteredExecutor[] = []) {
		for (const executor of executors) {
			this.register(executor);
		}
	}

	public get(kind: StepKind): RegisteredExecutor {
		const executor = this.executors.get(kind);
		if (!executor) {
			throw new Error(`No executor registered for step kind "${kind}"`);
		}
		return executor;
	}

	public has(kind: StepKind): boolean {
		return this.executors.has(kind);
	}

	public register(executor: RegisteredExecutor): void {
		if (this.executors.has(executor.kind)) {
			throw new Error(
				`Executor already registered for step kind "${executor.kind}"`,
			);
		}
		this.executors.set(executor.kind, executor);
	}
}
