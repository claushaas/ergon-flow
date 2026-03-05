import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';

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

function nowIso(): string {
	return new Date().toISOString();
}

function optionalJson(value: unknown): string | null {
	if (value === undefined) {
		return null;
	}
	return JSON.stringify(value ?? null);
}

export function insertArtifact(
	db: DatabaseSync,
	input: InsertArtifactInput,
): ArtifactRow {
	const artifactId = input.id ?? randomUUID();
	const createdAt = input.createdAt ?? nowIso();

	db.prepare(
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
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
	).run(
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

	const row = db
		.prepare('SELECT * FROM artifacts WHERE id = ?;')
		.get(artifactId);
	if (!row) {
		throw new Error(`Failed to load artifact ${artifactId} after insert`);
	}
	return row as unknown as ArtifactRow;
}
