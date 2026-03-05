// ─── Step ────────────────────────────────────────────────────────────────────

export type StepKind =
	| 'agent'
	| 'artifact'
	| 'condition'
	| 'exec'
	| 'manual'
	| 'notify';

// ─── Providers ───────────────────────────────────────────────────────────────

export type ModelProvider = 'anthropic' | 'ollama' | 'openai' | 'openrouter';

export type AgentProvider = 'claude-code' | 'codex' | 'openclaw';

export type Provider = AgentProvider | ModelProvider;

// ─── Artifact ────────────────────────────────────────────────────────────────

export type ArtifactType =
	| 'analysis'
	| 'binary'
	| 'json'
	| 'patch'
	| 'plan'
	| 'text';

// ─── Run status ──────────────────────────────────────────────────────────────

/** Canonical status values for workflow_runs.status (matches DB_SCHEMA.md § 5.1) */
export type WorkflowRunStatus =
	| 'canceled'
	| 'failed'
	| 'queued'
	| 'running'
	| 'succeeded'
	| 'waiting_manual';

// ─── Step-run status ─────────────────────────────────────────────────────────

/** Canonical status values for step_runs.status (matches DB_SCHEMA.md § 5.2) */
export type StepRunStatus =
	| 'failed'
	| 'queued'
	| 'running'
	| 'skipped'
	| 'succeeded'
	| 'waiting_manual';

// ─── Error codes ─────────────────────────────────────────────────────────────

/** Stable error category codes used across the runtime. */
export type ErrorCode =
	| 'artifact_failed'
	| 'condition_failed'
	| 'exec_failed'
	| 'manual_rejected'
	| 'provider_error'
	| 'schema_invalid';

// ─── Event types ─────────────────────────────────────────────────────────────

export type EventType =
	| 'lease_renewed'
	| 'manual_approved'
	| 'manual_rejected'
	| 'manual_waiting'
	| 'step_failed'
	| 'step_retry'
	| 'step_scheduled'
	| 'step_skipped'
	| 'step_started'
	| 'step_succeeded'
	| 'workflow_canceled'
	| 'workflow_failed'
	| 'workflow_scheduled'
	| 'workflow_started'
	| 'workflow_succeeded';
