import type { DatabaseSync } from 'node:sqlite';
import { assertRow, nowIso } from './utils.js';

export interface RegisterWorkflowInput {
	description?: string;
	hash: string;
	id: string;
	sourcePath: string;
	version: number;
}

export interface WorkflowRow {
	created_at: string;
	description: string | null;
	hash: string;
	id: string;
	source_path: string;
	updated_at: string;
	version: number;
}

export function registerWorkflow(
	db: DatabaseSync,
	input: RegisterWorkflowInput,
): WorkflowRow {
	const now = nowIso();

	const row = db
		.prepare(
			`INSERT INTO workflows (
				id,
				version,
				description,
				source_path,
				hash,
				created_at,
				updated_at
			) VALUES (?, ?, ?, ?, ?, ?, ?)
			ON CONFLICT(id, version) DO UPDATE SET
				description = excluded.description,
				source_path = excluded.source_path,
				hash = excluded.hash,
				updated_at = excluded.updated_at
			RETURNING *;`,
		)
		.get(
			input.id,
			input.version,
			input.description ?? null,
			input.sourcePath,
			input.hash,
			now,
			now,
		);

	return assertRow<WorkflowRow>(
		row,
		`Failed to load workflow ${input.id}@${input.version} after upsert`,
	);
}
