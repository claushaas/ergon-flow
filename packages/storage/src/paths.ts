/**
 * Filesystem layout helpers for Ergon Flow run directories.
 *
 * Layout (relative to a configurable base directory):
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

function assertPathWithinBase(
	base: string,
	candidate: string,
	label: string,
): void {
	const relative = path.relative(path.resolve(base), path.resolve(candidate));
	if (relative === '') {
		return;
	}
	if (relative.startsWith('..') || path.isAbsolute(relative)) {
		throw new Error(
			`Unsafe ${label}: ${JSON.stringify(candidate)} escapes base ${JSON.stringify(base)}`,
		);
	}
}

function joinWithinBase(
	base: string,
	label: string,
	...segments: string[]
): string {
	const candidate = path.join(base, ...segments);
	assertPathWithinBase(base, candidate, label);
	return candidate;
}

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
		!segment.trim() ||
		segment === '.' ||
		segment === '..' ||
		segment.includes('/') ||
		segment.includes('\\') ||
		segment.includes('\0')
	) {
		throw new Error(`Unsafe path ${label}: ${JSON.stringify(segment)}`);
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
	return joinWithinBase(base, 'run path', RUNS_DIR, runId);
}

/**
 * Returns `.runs/<run_id>/artifacts/` relative to `base`.
 *
 * @example artifactsDir('/project', 'run-01') → '/project/.runs/run-01/artifacts'
 */
export function artifactsDir(base: string, runId: string): string {
	assertSafeSegment(runId, 'runId');
	return joinWithinBase(base, 'artifacts path', RUNS_DIR, runId, 'artifacts');
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
	assertSafeSegment(runId, 'runId');
	assertSafeSegment(stepId, 'stepId');
	if (!Number.isInteger(attempt) || attempt < 1) {
		throw new Error(`attempt must be a positive integer, got ${attempt}`);
	}
	return joinWithinBase(
		base,
		'step attempt path',
		RUNS_DIR,
		runId,
		'steps',
		stepId,
		String(attempt),
	);
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
	assertSafeSegment(runId, 'runId');
	assertSafeSegment(name, 'artifact name');
	return joinWithinBase(
		base,
		'artifact path',
		RUNS_DIR,
		runId,
		'artifacts',
		name,
	);
}
