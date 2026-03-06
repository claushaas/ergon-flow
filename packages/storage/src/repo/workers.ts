import type { DatabaseSync } from 'node:sqlite';
import { assertRow, nowIso, optionalJson } from './utils.js';

export interface WorkerRow {
	hostname: string | null;
	id: string;
	last_beat_at: string;
	meta_json: string | null;
	pid: number | null;
	started_at: string;
}

export interface RegisterWorkerInput {
	hostname?: string;
	id: string;
	lastBeatAt?: string;
	meta?: unknown;
	pid?: number;
	startedAt?: string;
}

export interface HeartbeatWorkerInput {
	hostname?: string;
	id: string;
	lastBeatAt?: string;
	meta?: unknown;
	pid?: number;
}

export function getWorker(db: DatabaseSync, workerId: string): WorkerRow | null {
	const row = db.prepare('SELECT * FROM workers WHERE id = ?;').get(workerId);
	return (row as WorkerRow | undefined) ?? null;
}

export function registerWorker(
	db: DatabaseSync,
	input: RegisterWorkerInput,
): WorkerRow {
	const startedAt = input.startedAt ?? nowIso();
	const lastBeatAt = input.lastBeatAt ?? startedAt;

	const row = db
		.prepare(
			`INSERT INTO workers (
				id,
				hostname,
				pid,
				started_at,
				last_beat_at,
				meta_json
			) VALUES (?, ?, ?, ?, ?, ?)
			ON CONFLICT(id) DO UPDATE SET
				hostname = excluded.hostname,
				pid = excluded.pid,
				started_at = excluded.started_at,
				last_beat_at = excluded.last_beat_at,
				meta_json = excluded.meta_json
			RETURNING *;`,
		)
		.get(
			input.id,
			input.hostname ?? null,
			input.pid ?? null,
			startedAt,
			lastBeatAt,
			optionalJson(input.meta),
		);

	return assertRow<WorkerRow>(
		row,
		`Failed to load worker ${input.id} after register`,
	);
}

export function heartbeatWorker(
	db: DatabaseSync,
	input: HeartbeatWorkerInput,
): WorkerRow {
	const lastBeatAt = input.lastBeatAt ?? nowIso();

	const row = db
		.prepare(
			`UPDATE workers
			 SET hostname = COALESCE(?, hostname),
			     pid = COALESCE(?, pid),
			     last_beat_at = ?,
			     meta_json = COALESCE(?, meta_json)
			 WHERE id = ?
			 RETURNING *;`,
		)
		.get(
			input.hostname ?? null,
			input.pid ?? null,
			lastBeatAt,
			input.meta === undefined ? null : optionalJson(input.meta),
			input.id,
		);

	return assertRow<WorkerRow>(
		row,
		`Failed to load worker ${input.id} after heartbeat`,
	);
}
