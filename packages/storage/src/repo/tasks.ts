import { randomUUID } from 'node:crypto';
import type { DatabaseSync, SQLInputValue } from 'node:sqlite';
import { runInTransaction } from '../db.js';
import { assertRow, optionalJson, toJson } from './utils.js';

export type WorkflowRunStatus =
	| 'canceled'
	| 'failed'
	| 'queued'
	| 'running'
	| 'succeeded'
	| 'waiting_manual';

export type StepKind =
	| 'agent'
	| 'artifact'
	| 'condition'
	| 'exec'
	| 'manual'
	| 'notify';

export type StepRunStatus =
	| 'failed'
	| 'queued'
	| 'running'
	| 'skipped'
	| 'succeeded'
	| 'waiting_manual';

export interface WorkflowRunRow {
	attempt: number;
	claimed_by: string | null;
	context_json: string | null;
	created_at: string;
	current_step_id: string | null;
	current_step_index: number;
	error_code: string | null;
	error_detail_json: string | null;
	error_message: string | null;
	finished_at: string | null;
	id: string;
	inputs_json: string;
	lease_until: string | null;
	priority: number;
	result_json: string | null;
	scheduled_at: string;
	started_at: string | null;
	status: WorkflowRunStatus;
	updated_at: string;
	workflow_hash: string;
	workflow_id: string;
	workflow_version: number;
}

export interface StepRunRow {
	attempt: number;
	created_at: string;
	depends_on_json: string | null;
	error_code: string | null;
	error_detail_json: string | null;
	error_message: string | null;
	finished_at: string | null;
	id: string;
	output_json: string | null;
	request_json: string | null;
	response_json: string | null;
	run_id: string;
	started_at: string | null;
	status: StepRunStatus;
	step_id: string;
	step_kind: StepKind;
	updated_at: string;
}

export interface CreateRunOptions {
	context?: unknown;
	id?: string;
	priority?: number;
	scheduledAt?: string;
}

export interface ListRunsFilters {
	limit?: number;
	offset?: number;
	status?: WorkflowRunStatus;
	workflowId?: string;
}

export interface CreateStepRunOptions {
	dependsOn?: string[];
	id?: string;
	request?: unknown;
	status?: StepRunStatus;
}

export interface UpdateStepRunStatusOptions {
	errorCode?: string | null;
	errorDetail?: unknown;
	errorMessage?: string | null;
	finishedAt?: string | null;
	output?: unknown;
	request?: unknown;
	response?: unknown;
	startedAt?: string | null;
}

export interface RunFailureOptions {
	errorCode?: string | null;
	errorDetail?: unknown;
	errorMessage?: string | null;
	finishedAt?: string;
}

export interface RunResultOptions {
	finishedAt?: string;
	result?: unknown;
}

function addMilliseconds(
	isoTimestamp: string,
	leaseDurationMs: number,
): string {
	return new Date(
		Date.parse(isoTimestamp) + Math.max(0, Math.trunc(leaseDurationMs)),
	).toISOString();
}

export function createRun(
	db: DatabaseSync,
	workflowId: string,
	inputs: unknown,
	options: CreateRunOptions & {
		workflowHash: string;
		workflowVersion: number;
	},
): WorkflowRunRow {
	const runId = options.id ?? randomUUID();
	const scheduledAt = options.scheduledAt ?? new Date().toISOString();
	const now = new Date().toISOString();

	const row = db
		.prepare(
			`INSERT INTO workflow_runs (
				id,
				workflow_id,
				workflow_version,
				workflow_hash,
				status,
				priority,
				scheduled_at,
				inputs_json,
				context_json,
				created_at,
				updated_at
			) VALUES (?, ?, ?, ?, 'queued', ?, ?, ?, ?, ?, ?)
			RETURNING *;`,
		)
		.get(
			runId,
			workflowId,
			options.workflowVersion,
			options.workflowHash,
			options.priority ?? 0,
			scheduledAt,
			toJson(inputs),
			optionalJson(options.context),
			now,
			now,
		);

	return assertRow<WorkflowRunRow>(
		row,
		`Failed to load workflow_run ${runId} after insert`,
	);
}

export function getRun(db: DatabaseSync, runId: string): WorkflowRunRow | null {
	const row = db
		.prepare('SELECT * FROM workflow_runs WHERE id = ?;')
		.get(runId);
	return (row as unknown as WorkflowRunRow | undefined) ?? null;
}

export function listRuns(
	db: DatabaseSync,
	filters: ListRunsFilters = {},
): WorkflowRunRow[] {
	const clauses: string[] = [];
	const params: SQLInputValue[] = [];

	if (filters.workflowId) {
		clauses.push('workflow_id = ?');
		params.push(filters.workflowId);
	}
	if (filters.status) {
		clauses.push('status = ?');
		params.push(filters.status);
	}

	const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
	const limit = Math.max(1, filters.limit ?? 50);
	const offset = Math.max(0, filters.offset ?? 0);

	return db
		.prepare(
			`SELECT * FROM workflow_runs
			 ${where}
			 ORDER BY created_at DESC, id DESC
			 LIMIT ? OFFSET ?;`,
		)
		.all(...params, limit, offset) as unknown as WorkflowRunRow[];
}

export function createStepRun(
	db: DatabaseSync,
	runId: string,
	stepId: string,
	attempt: number,
	kind: StepKind,
	options: CreateStepRunOptions = {},
): StepRunRow {
	const stepRunId = options.id ?? randomUUID();
	const now = new Date().toISOString();

	const row = db
		.prepare(
			`INSERT INTO step_runs (
				id,
				run_id,
				step_id,
				step_kind,
				status,
				attempt,
				depends_on_json,
				request_json,
				created_at,
				updated_at
			) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
			RETURNING *;`,
		)
		.get(
			stepRunId,
			runId,
			stepId,
			kind,
			options.status ?? 'queued',
			attempt,
			optionalJson(options.dependsOn),
			optionalJson(options.request),
			now,
			now,
		);

	return assertRow<StepRunRow>(
		row,
		`Failed to load step_run ${stepRunId} after insert`,
	);
}

export function updateStepRunStatus(
	db: DatabaseSync,
	stepRunId: string,
	status: StepRunStatus,
	options: UpdateStepRunStatusOptions = {},
): StepRunRow | null {
	const updates: string[] = ['status = ?', 'updated_at = ?'];
	const params: SQLInputValue[] = [status, new Date().toISOString()];

	if (Object.hasOwn(options, 'startedAt')) {
		updates.push('started_at = ?');
		params.push(options.startedAt ?? null);
	}
	if (Object.hasOwn(options, 'finishedAt')) {
		updates.push('finished_at = ?');
		params.push(options.finishedAt ?? null);
	}
	if (Object.hasOwn(options, 'request')) {
		updates.push('request_json = ?');
		params.push(optionalJson(options.request));
	}
	if (Object.hasOwn(options, 'response')) {
		updates.push('response_json = ?');
		params.push(optionalJson(options.response));
	}
	if (Object.hasOwn(options, 'output')) {
		updates.push('output_json = ?');
		params.push(optionalJson(options.output));
	}
	if (Object.hasOwn(options, 'errorCode')) {
		updates.push('error_code = ?');
		params.push(options.errorCode ?? null);
	}
	if (Object.hasOwn(options, 'errorMessage')) {
		updates.push('error_message = ?');
		params.push(options.errorMessage ?? null);
	}
	if (Object.hasOwn(options, 'errorDetail')) {
		updates.push('error_detail_json = ?');
		params.push(optionalJson(options.errorDetail));
	}

	params.push(stepRunId);
	const row = db
		.prepare(
			`UPDATE step_runs
			 SET ${updates.join(', ')}
			 WHERE id = ?
			 RETURNING *;`,
		)
		.get(...params);

	return (row as unknown as StepRunRow | undefined) ?? null;
}

export function claimNextRun(
	db: DatabaseSync,
	workerId: string,
	leaseDurationMs: number,
): WorkflowRunRow | null {
	return runInTransaction(
		db,
		() => {
			const now = new Date().toISOString();
			const leaseUntil = addMilliseconds(now, leaseDurationMs);
			const claimed = db
				.prepare(
					`UPDATE workflow_runs
					 SET status = 'running',
					     claimed_by = ?,
					     lease_until = ?,
					     started_at = COALESCE(started_at, ?),
					     updated_at = ?
					 WHERE id = (
					   SELECT id
					   FROM workflow_runs
					   WHERE status = 'queued'
					     AND (lease_until IS NULL OR lease_until < ?)
					   ORDER BY priority DESC, scheduled_at ASC
					   LIMIT 1
					 )
					 RETURNING *;`,
				)
				.get(workerId, leaseUntil, now, now, now);

			return (claimed as unknown as WorkflowRunRow | undefined) ?? null;
		},
		{ mode: 'IMMEDIATE' },
	);
}

export function renewLease(
	db: DatabaseSync,
	runId: string,
	workerId: string,
	leaseDurationMs: number,
): WorkflowRunRow | null {
	const now = new Date().toISOString();
	const leaseUntil = addMilliseconds(now, leaseDurationMs);

	const row = db
		.prepare(
			`UPDATE workflow_runs
			 SET lease_until = ?,
			     updated_at = ?
			 WHERE id = ?
			   AND claimed_by = ?
			   AND status = 'running'
			 RETURNING *;`,
		)
		.get(leaseUntil, now, runId, workerId);

	return (row as unknown as WorkflowRunRow | undefined) ?? null;
}

export function markRunSucceeded(
	db: DatabaseSync,
	runId: string,
	workerId: string,
	options: RunResultOptions = {},
): WorkflowRunRow | null {
	const now = options.finishedAt ?? new Date().toISOString();
	const row = db
		.prepare(
			`UPDATE workflow_runs
			 SET status = 'succeeded',
			     result_json = ?,
			     error_code = NULL,
			     error_message = NULL,
			     error_detail_json = NULL,
			     claimed_by = NULL,
			     lease_until = NULL,
			     finished_at = ?,
			     updated_at = ?
			 WHERE id = ?
			   AND claimed_by = ?
			   AND status = 'running'
			 RETURNING *;`,
		)
		.get(optionalJson(options.result), now, now, runId, workerId);

	return (row as unknown as WorkflowRunRow | undefined) ?? null;
}

export function markRunFailed(
	db: DatabaseSync,
	runId: string,
	workerId: string,
	options: RunFailureOptions = {},
): WorkflowRunRow | null {
	const now = options.finishedAt ?? new Date().toISOString();
	const row = db
		.prepare(
			`UPDATE workflow_runs
			 SET status = 'failed',
			     error_code = ?,
			     error_message = ?,
			     error_detail_json = ?,
			     claimed_by = NULL,
			     lease_until = NULL,
			     finished_at = ?,
			     updated_at = ?
			 WHERE id = ?
			   AND claimed_by = ?
			   AND status = 'running'
			 RETURNING *;`,
		)
		.get(
			options.errorCode ?? null,
			options.errorMessage ?? null,
			optionalJson(options.errorDetail),
			now,
			now,
			runId,
			workerId,
		);

	return (row as unknown as WorkflowRunRow | undefined) ?? null;
}

export function markRunWaitingManual(
	db: DatabaseSync,
	runId: string,
	workerId: string,
): WorkflowRunRow | null {
	const now = new Date().toISOString();
	const row = db
		.prepare(
			`UPDATE workflow_runs
			 SET status = 'waiting_manual',
			     claimed_by = NULL,
			     lease_until = NULL,
			     updated_at = ?
			 WHERE id = ?
			   AND claimed_by = ?
			   AND status = 'running'
			 RETURNING *;`,
		)
		.get(now, runId, workerId);

	return (row as unknown as WorkflowRunRow | undefined) ?? null;
}

export function markRunCanceled(
	db: DatabaseSync,
	runId: string,
	workerId: string,
	options: RunResultOptions = {},
): WorkflowRunRow | null {
	const now = options.finishedAt ?? new Date().toISOString();
	const row = db
		.prepare(
			`UPDATE workflow_runs
			 SET status = 'canceled',
			     claimed_by = NULL,
			     lease_until = NULL,
			     finished_at = ?,
			     updated_at = ?
			 WHERE id = ?
			   AND claimed_by = ?
			   AND status = 'running'
			 RETURNING *;`,
		)
		.get(now, now, runId, workerId);

	return (row as unknown as WorkflowRunRow | undefined) ?? null;
}
