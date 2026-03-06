import { randomUUID } from 'node:crypto';
import type { DatabaseSync, SQLInputValue } from 'node:sqlite';
import { runInTransaction } from '../db.js';
import { appendEventInTransaction } from './events.js';
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

export type ManualDecision = 'approve' | 'reject';

export interface DecideManualStepOptions {
	actor: string;
	decidedAt?: string;
}

export interface DecideManualStepResult {
	decision: ManualDecision;
	run: WorkflowRunRow;
	stepRunId: string;
}

export interface CancelRunOptions {
	actor: string;
	finishedAt?: string;
	reason?: string;
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

export function listStepRuns(db: DatabaseSync, runId: string): StepRunRow[] {
	return db
		.prepare(
			`SELECT * FROM step_runs
			 WHERE run_id = ?
			 ORDER BY created_at ASC, attempt ASC, id ASC;`,
		)
		.all(runId) as unknown as StepRunRow[];
}

export function getLatestStepRun(
	db: DatabaseSync,
	runId: string,
	stepId: string,
): StepRunRow | null {
	const row = db
		.prepare(
			`SELECT * FROM step_runs
			 WHERE run_id = ?
			   AND step_id = ?
			 ORDER BY attempt DESC, created_at DESC, id DESC
			 LIMIT 1;`,
		)
		.get(runId, stepId);

	return (row as unknown as StepRunRow | undefined) ?? null;
}

export function getWaitingManualStepRun(
	db: DatabaseSync,
	runId: string,
	stepId: string,
): StepRunRow | null {
	const row = db
		.prepare(
			`SELECT * FROM step_runs
			 WHERE run_id = ?
			   AND step_id = ?
			   AND status = 'waiting_manual'
			 ORDER BY attempt DESC, created_at DESC, id DESC
			 LIMIT 1;`,
		)
		.get(runId, stepId);

	return (row as unknown as StepRunRow | undefined) ?? null;
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
					     attempt = CASE
					       WHEN status = 'running' THEN attempt + 1
					       ELSE attempt
					     END,
					     started_at = COALESCE(started_at, ?),
					     updated_at = ?
					 WHERE id = (
					   SELECT id
					   FROM workflow_runs
					   WHERE (
					     status = 'queued'
					     AND (lease_until IS NULL OR lease_until < ?)
					   ) OR (
					     status = 'running'
					     AND lease_until IS NOT NULL
					     AND lease_until < ?
					   )
					   ORDER BY priority DESC, scheduled_at ASC
					   LIMIT 1
					 )
					 RETURNING *;`,
				)
				.get(workerId, leaseUntil, now, now, now, now);

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

export function updateRunCursor(
	db: DatabaseSync,
	runId: string,
	workerId: string,
	currentStepIndex: number,
	currentStepId: string | null,
): WorkflowRunRow | null {
	const now = new Date().toISOString();
	const row = db
		.prepare(
			`UPDATE workflow_runs
			 SET current_step_index = ?,
			     current_step_id = ?,
			     updated_at = ?
			 WHERE id = ?
			   AND claimed_by = ?
			   AND status = 'running'
			 RETURNING *;`,
		)
		.get(currentStepIndex, currentStepId, now, runId, workerId);

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

export function requeueRunFromManual(
	db: DatabaseSync,
	runId: string,
): WorkflowRunRow | null {
	const now = new Date().toISOString();
	const row = db
		.prepare(
			`UPDATE workflow_runs
			 SET status = 'queued',
			     claimed_by = NULL,
			     lease_until = NULL,
			     error_code = NULL,
			     error_message = NULL,
			     error_detail_json = NULL,
			     finished_at = NULL,
			     updated_at = ?
			 WHERE id = ?
			   AND status = 'waiting_manual'
			 RETURNING *;`,
		)
		.get(now, runId);

	return (row as unknown as WorkflowRunRow | undefined) ?? null;
}

export function failRunFromManual(
	db: DatabaseSync,
	runId: string,
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
			   AND status = 'waiting_manual'
			 RETURNING *;`,
		)
		.get(
			options.errorCode ?? null,
			options.errorMessage ?? null,
			optionalJson(options.errorDetail),
			now,
			now,
			runId,
		);

	return (row as unknown as WorkflowRunRow | undefined) ?? null;
}

export function decideManualStep(
	db: DatabaseSync,
	runId: string,
	stepId: string,
	decision: ManualDecision,
	options: DecideManualStepOptions,
): DecideManualStepResult {
	return runInTransaction(
		db,
		() => {
			const run = getRun(db, runId);
			if (!run) {
				throw new Error(`Workflow run "${runId}" was not found`);
			}
			if (run.status !== 'waiting_manual') {
				throw new Error(
					`Workflow run "${runId}" is not waiting for manual approval`,
				);
			}
			if (run.current_step_id !== stepId) {
				throw new Error(
					`Workflow run "${runId}" is waiting on step "${run.current_step_id ?? 'unknown'}", not "${stepId}"`,
				);
			}

			const waitingStepRun = getWaitingManualStepRun(db, runId, stepId);
			if (!waitingStepRun) {
				throw new Error(
					`Manual step "${stepId}" is not waiting for approval on run "${runId}"`,
				);
			}

			const decisionAt = options.decidedAt ?? new Date().toISOString();
			appendEventInTransaction(
				db,
				runId,
				decision === 'approve' ? 'manual_approved' : 'manual_rejected',
				{
					decision,
					run_id: runId,
					step_id: stepId,
					step_run_id: waitingStepRun.id,
				},
				{
					actor: options.actor,
					stepRunId: waitingStepRun.id,
					ts: decisionAt,
				},
			);

			if (decision === 'approve') {
				const queuedRun = requeueRunFromManual(db, runId);
				if (!queuedRun) {
					throw new Error(
						`Workflow run "${runId}" could not be requeued after approval`,
					);
				}

				return {
					decision,
					run: queuedRun,
					stepRunId: waitingStepRun.id,
				};
			}

			const errorMessage = `Manual step "${stepId}" was rejected`;
			updateStepRunStatus(db, waitingStepRun.id, 'failed', {
				errorCode: 'manual_rejected',
				errorDetail: {
					actor: options.actor,
				},
				errorMessage,
				finishedAt: decisionAt,
				output: {
					actor: options.actor,
					decided_at: decisionAt,
					decision: 'reject',
				},
			});
			appendEventInTransaction(
				db,
				runId,
				'step_failed',
				{
					error_code: 'manual_rejected',
					message: errorMessage,
					step_id: stepId,
				},
				{
					actor: options.actor,
					stepRunId: waitingStepRun.id,
					ts: decisionAt,
				},
			);

			const failedRun = failRunFromManual(db, runId, {
				errorCode: 'manual_rejected',
				errorDetail: {
					actor: options.actor,
					step_id: stepId,
					step_run_id: waitingStepRun.id,
				},
				errorMessage,
				finishedAt: decisionAt,
			});
			if (!failedRun) {
				throw new Error(
					`Workflow run "${runId}" could not be marked as failed after rejection`,
				);
			}

			appendEventInTransaction(
				db,
				runId,
				'workflow_failed',
				{
					error_code: 'manual_rejected',
					message: errorMessage,
				},
				{
					actor: options.actor,
					ts: decisionAt,
				},
			);

			return {
				decision,
				run: failedRun,
				stepRunId: waitingStepRun.id,
			};
		},
		{ mode: 'IMMEDIATE' },
	);
}

export function cancelRun(
	db: DatabaseSync,
	runId: string,
	options: CancelRunOptions,
): WorkflowRunRow {
	return runInTransaction(
		db,
		() => {
			const run = getRun(db, runId);
			if (!run) {
				throw new Error(`Workflow run "${runId}" was not found`);
			}

			if (run.status === 'failed' || run.status === 'succeeded') {
				throw new Error(
					`Workflow run "${runId}" is already ${run.status} and cannot be canceled`,
				);
			}

			if (run.status === 'canceled') {
				return run;
			}

			const finishedAt = options.finishedAt ?? new Date().toISOString();
			const row = db
				.prepare(
					`UPDATE workflow_runs
					 SET status = 'canceled',
					     claimed_by = NULL,
					     lease_until = NULL,
					     finished_at = ?,
					     updated_at = ?
					 WHERE id = ?
					   AND status IN ('queued', 'running', 'waiting_manual')
					 RETURNING *;`,
				)
				.get(finishedAt, finishedAt, runId);

			if (!row) {
				const currentRun = getRun(db, runId);
				const statusInfo = currentRun
					? `status is "${currentRun.status}"`
					: 'it no longer exists';
				throw new Error(
					`Failed to cancel workflow run "${runId}"; its ${statusInfo}.`,
				);
			}
			const canceledRun = row as unknown as WorkflowRunRow;

			appendEventInTransaction(
				db,
				runId,
				'workflow_canceled',
				{
					reason: options.reason ?? 'external_cancel',
				},
				{
					actor: options.actor,
					ts: finishedAt,
				},
			);

			return canceledRun;
		},
		{ mode: 'IMMEDIATE' },
	);
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
