import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { assertRow, nowIso, optionalJson } from './utils.js';

export interface ArtifactRow {
	created_at: string;
	id: string;
	meta_json: string | null;
	mime: string | null;
	name: string;
	path: string;
	run_id: string;
	sha256: string | null;
	size_bytes: number | null;
	step_run_id: string;
	type: string;
}

export interface InsertArtifactInput {
	createdAt?: string;
	id?: string;
	meta?: unknown;
	mime?: string | null;
	name: string;
	path: string;
	runId: string;
	sha256?: string | null;
	sizeBytes?: number | null;
	stepRunId: string;
	type: string;
}

export function insertArtifact(
	db: DatabaseSync,
	input: InsertArtifactInput,
): ArtifactRow {
	const artifactId = input.id ?? randomUUID();
	const createdAt = input.createdAt ?? nowIso();

	const row = db
		.prepare(
			`INSERT INTO artifacts (
				id,
				run_id,
				step_run_id,
				name,
				type,
				mime,
				path,
				size_bytes,
				sha256,
				meta_json,
				created_at
			) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING *;`,
		)
		.get(
			artifactId,
			input.runId,
			input.stepRunId,
			input.name,
			input.type,
			input.mime ?? null,
			input.path,
			input.sizeBytes ?? null,
			input.sha256 ?? null,
			optionalJson(input.meta),
			createdAt,
		);

	return assertRow<ArtifactRow>(
		row,
		`Failed to load artifact ${artifactId} after insert`,
	);
}
