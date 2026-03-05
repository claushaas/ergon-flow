import type { ErrorCode, StepKind, StepRunStatus } from './enums.js';

/**
 * Represents a row in the step_runs table.
 * Matches DB_SCHEMA.md § 7.5.
 */
export interface StepRun {
	attempt: number;
	created_at: string;
	depends_on_json: string | null;
	error_code: ErrorCode | null;
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
