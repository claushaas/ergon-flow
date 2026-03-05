import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';

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

function nowIso(): string {
	return new Date().toISOString();
}

function optionalJson(value: unknown): string | null {
	if (value === undefined) {
		return null;
	}
	return JSON.stringify(value ?? null);
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
	let insertedSeq = 0;

	runInTransaction(db, () => {
		const row = db
			.prepare(
				'SELECT COALESCE(MAX(seq), 0) + 1 as next_seq FROM events WHERE run_id = ?;',
			)
			.get(runId) as { next_seq: number };

		insertedSeq = row.next_seq;
		db.prepare(
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
			) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?);`,
		).run(
			eventId,
			runId,
			options.stepRunId ?? null,
			type,
			timestamp,
			actor,
			insertedSeq,
			optionalJson(payload),
			createdAt,
		);
	});

	const row = db.prepare('SELECT * FROM events WHERE id = ?;').get(eventId);
	if (!row) {
		throw new Error(`Failed to load event ${eventId} after insert`);
	}
	return row as unknown as EventRow;
}

function runInTransaction(db: DatabaseSync, callback: () => void): void {
	db.exec('BEGIN IMMEDIATE;');
	try {
		callback();
		db.exec('COMMIT;');
	} catch (error) {
		try {
			db.exec('ROLLBACK;');
		} catch {
			// Keep the original failure as the primary error.
		}
		throw error;
	}
}
