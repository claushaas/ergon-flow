import type { ArtifactType } from './enums.js';

/**
 * Represents a row in the artifacts table.
 * Matches DB_SCHEMA.md § 7.6.
 */
export interface Artifact {
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
	type: ArtifactType;
}
