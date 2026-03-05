import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import { openStorageDb } from '../src/db.js';

const tempDirs: string[] = [];

function createTempDbPath(): string {
	const dir = mkdtempSync(path.join(tmpdir(), 'ergon-storage-'));
	tempDirs.push(dir);
	return path.join(dir, 'ergon.db');
}

function tableExists(db: DatabaseSync, tableName: string): boolean {
	const row = db
		.prepare(
			"SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?;",
		)
		.get(tableName) as { name?: string } | undefined;

	return row?.name === tableName;
}

function indexExists(db: DatabaseSync, indexName: string): boolean {
	const row = db
		.prepare(
			"SELECT name FROM sqlite_master WHERE type = 'index' AND name = ?;",
		)
		.get(indexName) as { name?: string } | undefined;

	return row?.name === indexName;
}

function readNumericPragma(db: DatabaseSync, pragma: string): number {
	const row = db.prepare(`PRAGMA ${pragma};`).get() as Record<string, unknown>;
	const [value] = Object.values(row);
	if (typeof value !== 'number') {
		throw new Error(`Expected numeric pragma ${pragma}, got ${String(value)}`);
	}
	return value;
}

function readTextPragma(db: DatabaseSync, pragma: string): string {
	const row = db.prepare(`PRAGMA ${pragma};`).get() as Record<string, unknown>;
	const [value] = Object.values(row);
	if (typeof value !== 'string') {
		throw new Error(`Expected text pragma ${pragma}, got ${String(value)}`);
	}
	return value;
}

afterEach(() => {
	for (const dir of tempDirs.splice(0)) {
		rmSync(dir, { force: true, recursive: true });
	}
});

describe('openStorageDb', () => {
	it('applies sqlite pragmas and runs B1 migrations', () => {
		const dbPath = createTempDbPath();
		const db = openStorageDb({ dbPath });

		expect(readTextPragma(db, 'journal_mode').toLowerCase()).toBe('wal');
		expect(readNumericPragma(db, 'foreign_keys')).toBe(1);
		expect(readNumericPragma(db, 'busy_timeout')).toBe(5000);

		expect(tableExists(db, 'schema_migrations')).toBe(true);
		expect(tableExists(db, 'workflows')).toBe(true);
		expect(tableExists(db, 'workers')).toBe(true);
		expect(tableExists(db, 'workflow_runs')).toBe(true);
		expect(tableExists(db, 'step_runs')).toBe(true);
		expect(tableExists(db, 'artifacts')).toBe(true);
		expect(tableExists(db, 'events')).toBe(true);

		expect(indexExists(db, 'idx_workflow_runs_queue')).toBe(true);
		expect(indexExists(db, 'idx_workflow_runs_lease')).toBe(true);
		expect(indexExists(db, 'idx_workflow_runs_workflow')).toBe(true);
		expect(indexExists(db, 'idx_step_runs_run')).toBe(true);
		expect(indexExists(db, 'idx_artifacts_run')).toBe(true);
		expect(indexExists(db, 'idx_events_run')).toBe(true);
		expect(indexExists(db, 'idx_events_type')).toBe(true);

		db.close();
	});

	it('is idempotent when opening the same database multiple times', () => {
		const dbPath = createTempDbPath();

		const first = openStorageDb({ dbPath });
		first.close();

		const second = openStorageDb({ dbPath });
		const row = second
			.prepare('SELECT COUNT(*) as total FROM schema_migrations;')
			.get() as { total: number };

		expect(row.total).toBe(2);
		second.close();
	});
});
