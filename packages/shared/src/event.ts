import type { EventType } from './enums.js';

/**
 * Represents a row in the events table.
 * Matches DB_SCHEMA.md § 7.7.
 *
 * `seq` is monotonic per-run and allocated transactionally.
 * `id` should be a ULID so ORDER BY id approximates chronological order.
 */
export interface Event {
	actor: string;
	created_at: string;
	id: string;
	payload_json: string | null;
	run_id: string;
	seq: number;
	step_run_id: string | null;
	ts: string;
	type: EventType;
}
