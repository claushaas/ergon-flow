import type {
	AgentProvider,
	ArtifactType,
	ErrorCode,
	ModelProvider,
	Provider,
	StepKind,
} from './enums.js';

// ─── Retry policy ────────────────────────────────────────────────────────────

export interface RetryPolicy {
	max_attempts: number;
	on?: ErrorCode[];
}

// ─── Execution strategy ──────────────────────────────────────────────────────

export interface StrategyEntry {
	model?: string;
	provider: Provider;
}

export interface StepStrategy {
	ladder?: StrategyEntry[];
}

// ─── Step definitions (discriminated union by `kind`) ────────────────────────

interface BaseStepDefinition {
	depends_on?: string[];
	description?: string;
	id: string;
	kind: StepKind;
	name?: string;
	retry?: RetryPolicy;
}

export interface AgentStepDefinition extends BaseStepDefinition {
	agent?: string;
	kind: 'agent';
	model?: string;
	prompt?: string;
	provider: AgentProvider | ModelProvider;
	strategy?: StepStrategy;
}

export interface ExecStepDefinition extends BaseStepDefinition {
	command: string;
	cwd?: string;
	env?: Record<string, string>;
	kind: 'exec';
}

export interface NotifyStepDefinition extends BaseStepDefinition {
	channel: string;
	kind: 'notify';
	message: string;
}

export interface ManualStepDefinition extends BaseStepDefinition {
	kind: 'manual';
	message?: string;
}

export interface ConditionStepDefinition extends BaseStepDefinition {
	expression: string;
	kind: 'condition';
}

export interface ArtifactStepDefinition extends BaseStepDefinition {
	input: string;
	kind: 'artifact';
	operation: string;
}

export type StepDefinition =
	| AgentStepDefinition
	| ArtifactStepDefinition
	| ConditionStepDefinition
	| ExecStepDefinition
	| ManualStepDefinition
	| NotifyStepDefinition;

// ─── Workflow metadata ───────────────────────────────────────────────────────

export interface WorkflowMetadata {
	author?: string;
	description?: string;
	id: string;
	tags?: string[];
	version: number;
}

// ─── Input types ─────────────────────────────────────────────────────────────

export type InputType = 'array' | 'boolean' | 'number' | 'object' | 'string';

// ─── Artifact declaration (template-level) ───────────────────────────────────

export interface ArtifactDeclaration {
	type: ArtifactType;
}

// ─── Workflow template ───────────────────────────────────────────────────────

/** Parsed and normalized representation of a YAML workflow template. */
export interface WorkflowTemplate {
	artifacts?: Record<string, ArtifactDeclaration>;
	inputs?: Record<string, InputType>;
	outputs?: Record<string, string>;
	steps: StepDefinition[];
	workflow: WorkflowMetadata;
}
