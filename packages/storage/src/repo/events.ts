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

export function appendEvent(
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

	const row = runInTransaction(
		db,
		() => {
			const seqRow = db
				.prepare(
					'SELECT COALESCE(MAX(seq), 0) + 1 as next_seq FROM events WHERE run_id = ?;',
				)
				.get(runId) as { next_seq: number };

			return db
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
		},
		{ mode: 'IMMEDIATE' },
	);

	return assertRow<EventRow>(
		row,
		`Failed to load event ${eventId} after insert`,
	);
}
