/**
 * Filesystem layout helpers for Ergon Flow run directories.
 *
 * Layout (relative to a configurable base directory, default: process.cwd()):
 *
 *   .runs/
 *     <run_id>/
 *       artifacts/
 *       steps/
 *         <step_id>/
 *           <attempt>/
 *
 * All helpers are pure functions (no I/O) and validate that path segments
 * cannot escape the base directory (no path traversal).
 *
 * Matches DB_SCHEMA.md § 3.
 */

import path from 'node:path';

// ─── Constants ───────────────────────────────────────────────────────────────

export const RUNS_DIR = '.runs';

// ─── Segment validation ──────────────────────────────────────────────────────

/**
 * Throws if `segment` contains characters that could enable path traversal
 * or produce an ambiguous filesystem path.
 *
 * Rejected: empty string, `.`, `..`, any `/`, `\`, or null byte.
 */
export function assertSafeSegment(segment: string, label = 'segment'): void {
	if (
		!segment ||
		segment === '.' ||
		segment === '..' ||
		segment.includes('/') ||
		segment.includes('\\') ||
		segment.includes('\0')
	) {
		throw new Error(
			`Unsafe path ${label}: ${JSON.stringify(segment)}`,
		);
	}
}

// ─── Path builders ───────────────────────────────────────────────────────────

/**
 * Returns `.runs/<run_id>/` relative to `base`.
 *
 * @example runDir('/project', 'run-01') → '/project/.runs/run-01'
 */
export function runDir(base: string, runId: string): string {
	assertSafeSegment(runId, 'runId');
	return path.join(base, RUNS_DIR, runId);
}

/**
 * Returns `.runs/<run_id>/artifacts/` relative to `base`.
 *
 * @example artifactsDir('/project', 'run-01') → '/project/.runs/run-01/artifacts'
 */
export function artifactsDir(base: string, runId: string): string {
	return path.join(runDir(base, runId), 'artifacts');
}

/**
 * Returns `.runs/<run_id>/steps/<step_id>/<attempt>/` relative to `base`.
 *
 * @example stepAttemptDir('/project', 'run-01', 'analyze', 1)
 *   → '/project/.runs/run-01/steps/analyze/1'
 */
export function stepAttemptDir(
	base: string,
	runId: string,
	stepId: string,
	attempt: number,
): string {
	assertSafeSegment(stepId, 'stepId');
	if (!Number.isInteger(attempt) || attempt < 1) {
		throw new Error(`attempt must be a positive integer, got ${attempt}`);
	}
	return path.join(runDir(base, runId), 'steps', stepId, String(attempt));
}

/**
 * Returns the path for a named artifact file under `.runs/<run_id>/artifacts/`.
 *
 * `name` may contain a single filename component only (no directory separators).
 *
 * @example artifactPath('/project', 'run-01', 'patch.diff')
 *   → '/project/.runs/run-01/artifacts/patch.diff'
 */
export function artifactPath(
	base: string,
	runId: string,
	name: string,
): string {
	assertSafeSegment(name, 'artifact name');
	return path.join(artifactsDir(base, runId), name);
}
