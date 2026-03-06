// ─── Step ────────────────────────────────────────────────────────────────────

export const STEP_KINDS = [
	'agent',
	'artifact',
	'condition',
	'exec',
	'manual',
	'notify',
] as const;

export type StepKind = (typeof STEP_KINDS)[number];

// ─── Providers ───────────────────────────────────────────────────────────────

export const MODEL_PROVIDERS = ['ollama', 'openrouter'] as const;

export type ModelProvider = (typeof MODEL_PROVIDERS)[number];

export const AGENT_PROVIDERS = ['claude-code', 'codex', 'openclaw'] as const;

export type AgentProvider = (typeof AGENT_PROVIDERS)[number];

export const PROVIDERS = [...AGENT_PROVIDERS, ...MODEL_PROVIDERS] as const;

export type Provider = (typeof PROVIDERS)[number];

// ─── Artifact ────────────────────────────────────────────────────────────────

export const ARTIFACT_TYPES = [
	'analysis',
	'binary',
	'json',
	'patch',
	'plan',
	'text',
] as const;

export type ArtifactType = (typeof ARTIFACT_TYPES)[number];

// ─── Run status ──────────────────────────────────────────────────────────────

/** Canonical status values for workflow_runs.status (matches DB_SCHEMA.md § 5.1) */
export const WORKFLOW_RUN_STATUSES = [
	'canceled',
	'failed',
	'queued',
	'running',
	'succeeded',
	'waiting_manual',
] as const;

export type WorkflowRunStatus = (typeof WORKFLOW_RUN_STATUSES)[number];

// ─── Step-run status ─────────────────────────────────────────────────────────

/** Canonical status values for step_runs.status (matches DB_SCHEMA.md § 5.2) */
export const STEP_RUN_STATUSES = [
	'failed',
	'queued',
	'running',
	'skipped',
	'succeeded',
	'waiting_manual',
] as const;

export type StepRunStatus = (typeof STEP_RUN_STATUSES)[number];

// ─── Error codes ─────────────────────────────────────────────────────────────

/** Stable error category codes used across the runtime. */
export const ERROR_CODES = [
	'artifact_failed',
	'condition_failed',
	'exec_failed',
	'manual_rejected',
	'provider_error',
	'schema_invalid',
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

// ─── Event types ─────────────────────────────────────────────────────────────

export const EVENT_TYPES = [
	'lease_renewed',
	'manual_approved',
	'manual_rejected',
	'manual_waiting',
	'step_failed',
	'step_retry',
	'step_scheduled',
	'step_skipped',
	'step_started',
	'step_succeeded',
	'workflow_canceled',
	'workflow_failed',
	'workflow_scheduled',
	'workflow_started',
	'workflow_succeeded',
] as const;

export type EventType = (typeof EVENT_TYPES)[number];
