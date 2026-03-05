import type { ErrorCode, WorkflowRunStatus } from './enums.js';

/**
 * Represents a row in the workflow_runs table.
 * Matches DB_SCHEMA.md § 7.4.
 */
export interface WorkflowRun {
	attempt: number;
	claimed_by: string | null;
	context_json: string | null;
	created_at: string;
	current_step_id: string | null;
	current_step_index: number;
	error_code: ErrorCode | null;
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
