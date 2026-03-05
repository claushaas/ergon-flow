import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
	artifactPath,
	artifactsDir,
	assertSafeSegment,
	RUNS_DIR,
	runDir,
	stepAttemptDir,
} from '../src/paths.js';

const BASE = '/project';

describe('RUNS_DIR', () => {
	it('is .runs', () => {
		expect(RUNS_DIR).toBe('.runs');
	});
});

describe('assertSafeSegment', () => {
	it('accepts valid identifiers', () => {
		expect(() => assertSafeSegment('run-01')).not.toThrow();
		expect(() => assertSafeSegment('01JFXYZ')).not.toThrow();
		expect(() => assertSafeSegment('analyze')).not.toThrow();
		expect(() => assertSafeSegment('patch.diff')).not.toThrow();
	});

	it('rejects empty string', () => {
		expect(() => assertSafeSegment('')).toThrow();
	});

	it('rejects whitespace-only segment', () => {
		expect(() => assertSafeSegment('   ')).toThrow();
	});

	it('rejects single dot', () => {
		expect(() => assertSafeSegment('.')).toThrow();
	});

	it('rejects double dot', () => {
		expect(() => assertSafeSegment('..')).toThrow();
	});

	it('rejects segments containing forward slash', () => {
		expect(() => assertSafeSegment('../evil')).toThrow();
		expect(() => assertSafeSegment('a/b')).toThrow();
	});

	it('rejects segments containing backslash', () => {
		expect(() => assertSafeSegment('a\\b')).toThrow();
	});

	it('rejects segments containing null byte', () => {
		expect(() => assertSafeSegment('a\0b')).toThrow();
	});

	it('includes label in error message when provided', () => {
		expect(() => assertSafeSegment('..', 'runId')).toThrow(/runId/);
	});
});

describe('runDir', () => {
	it('returns base/.runs/runId', () => {
		expect(runDir(BASE, 'run-01')).toBe(path.join(BASE, '.runs', 'run-01'));
	});

	it('works with relative base', () => {
		expect(runDir('.', 'run-01')).toBe(path.join('.', '.runs', 'run-01'));
	});

	it('throws on path-traversal runId', () => {
		expect(() => runDir(BASE, '../evil')).toThrow(/runId/);
	});

	it('throws on empty runId', () => {
		expect(() => runDir(BASE, '')).toThrow();
	});
});

describe('artifactsDir', () => {
	it('returns base/.runs/runId/artifacts', () => {
		expect(artifactsDir(BASE, 'run-01')).toBe(
			path.join(BASE, '.runs', 'run-01', 'artifacts'),
		);
	});

	it('throws on unsafe runId', () => {
		expect(() => artifactsDir(BASE, '..')).toThrow();
	});
});

describe('stepAttemptDir', () => {
	it('returns base/.runs/runId/steps/stepId/attempt', () => {
		expect(stepAttemptDir(BASE, 'run-01', 'analyze', 1)).toBe(
			path.join(BASE, '.runs', 'run-01', 'steps', 'analyze', '1'),
		);
	});

	it('handles attempt > 1', () => {
		expect(stepAttemptDir(BASE, 'run-01', 'patch', 3)).toBe(
			path.join(BASE, '.runs', 'run-01', 'steps', 'patch', '3'),
		);
	});

	it('throws on unsafe stepId', () => {
		expect(() => stepAttemptDir(BASE, 'run-01', '../evil', 1)).toThrow(
			/stepId/,
		);
	});

	it('throws on attempt < 1', () => {
		expect(() => stepAttemptDir(BASE, 'run-01', 'analyze', 0)).toThrow(
			/attempt/,
		);
	});

	it('throws on non-integer attempt', () => {
		expect(() => stepAttemptDir(BASE, 'run-01', 'analyze', 1.5)).toThrow(
			/attempt/,
		);
	});
});

describe('artifactPath', () => {
	it('returns artifacts dir joined with name', () => {
		expect(artifactPath(BASE, 'run-01', 'patch.diff')).toBe(
			path.join(BASE, '.runs', 'run-01', 'artifacts', 'patch.diff'),
		);
	});

	it('throws on unsafe artifact name', () => {
		expect(() => artifactPath(BASE, 'run-01', '../secret')).toThrow(
			/artifact name/,
		);
	});

	it('throws on empty name', () => {
		expect(() => artifactPath(BASE, 'run-01', '')).toThrow();
	});
});
