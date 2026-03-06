import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { runInTransaction } from '../db.js';
import { assertRow, nowIso, optionalJson } from './utils.js';

export interface EventRow {
	actor: string;
	created_at: string;
	id: string;
	payload_json: string | null;
	run_id: string;
	seq: number;
	step_run_id: string | null;
	ts: string;
	type: string;
}

export interface AppendEventOptions {
	actor?: string;
	id?: string;
	stepRunId?: string | null;
	ts?: string;
}

function insertEvent(
	db: DatabaseSync,
	runId: string,
	type: string,
	payload?: unknown,
	options: AppendEventOptions = {},
): EventRow {
	const eventId = options.id ?? randomUUID();
	const timestamp = options.ts ?? nowIso();
	const createdAt = nowIso();
	const actor = options.actor ?? 'system';

	const seqRow = db
		.prepare(
			'SELECT COALESCE(MAX(seq), 0) + 1 as next_seq FROM events WHERE run_id = ?;',
		)
		.get(runId) as { next_seq: number };

	const row = db
		.prepare(
			`INSERT INTO events (
				id,
				run_id,
				step_run_id,
				type,
				ts,
				actor,
				seq,
				payload_json,
				created_at
			) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING *;`,
		)
		.get(
			eventId,
			runId,
			options.stepRunId ?? null,
			type,
			timestamp,
			actor,
			seqRow.next_seq,
			optionalJson(payload),
			createdAt,
		);

	return assertRow<EventRow>(
		row,
		`Failed to load event ${eventId} after insert`,
	);
}

export function appendEvent(
	db: DatabaseSync,
	runId: string,
	type: string,
	payload?: unknown,
	options: AppendEventOptions = {},
): EventRow {
	return runInTransaction(
		db,
		() => insertEvent(db, runId, type, payload, options),
		{ mode: 'IMMEDIATE' },
	);
}

export function appendEventInTransaction(
	db: DatabaseSync,
	runId: string,
	type: string,
	payload?: unknown,
	options: AppendEventOptions = {},
): EventRow {
	return insertEvent(db, runId, type, payload, options);
}

export function listEvents(db: DatabaseSync, runId: string): EventRow[] {
	return db
		.prepare(
			`SELECT * FROM events
			 WHERE run_id = ?
			 ORDER BY seq ASC;`,
		)
		.all(runId) as unknown as EventRow[];
}

export function getLatestEventForStepRun(
	db: DatabaseSync,
	runId: string,
	stepRunId: string,
	types: readonly string[],
): EventRow | null {
	if (types.length === 0) {
		return null;
	}

	const placeholders = types.map(() => '?').join(', ');
	const row = db
		.prepare(
			`SELECT * FROM events
			 WHERE run_id = ?
			   AND step_run_id = ?
			   AND type IN (${placeholders})
			 ORDER BY seq DESC
			 LIMIT 1;`,
		)
		.get(runId, stepRunId, ...types);

	return (row as unknown as EventRow | undefined) ?? null;
}
