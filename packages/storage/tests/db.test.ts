import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import { openStorageDb, runInTransaction } from '../src/db.js';

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
		expect(indexExists(db, 'idx_artifacts_run')).toBe(true);
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

	it('supports multiple workflow versions and composite fk references', () => {
		const dbPath = createTempDbPath();
		const db = openStorageDb({ dbPath });

		const insertWorkflow = db.prepare(`
			INSERT INTO workflows(
				id,
				version,
				description,
				source_path,
				hash,
				created_at,
				updated_at
			) VALUES (?, ?, ?, ?, ?, ?, ?);
		`);

		const now = new Date().toISOString();
		insertWorkflow.run(
			'code.refactor',
			1,
			'v1',
			'library/workflows/code.refactor.yaml',
			'hash-v1',
			now,
			now,
		);
		insertWorkflow.run(
			'code.refactor',
			2,
			'v2',
			'library/workflows/code.refactor.yaml',
			'hash-v2',
			now,
			now,
		);

		const workflowCount = db
			.prepare('SELECT COUNT(*) as total FROM workflows WHERE id = ?;')
			.get('code.refactor') as { total: number };
		expect(workflowCount.total).toBe(2);

		const insertRun = db.prepare(`
			INSERT INTO workflow_runs(
				id,
				workflow_id,
				workflow_version,
				workflow_hash,
				status,
				scheduled_at,
				inputs_json,
				created_at,
				updated_at
			) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?);
		`);

		insertRun.run(
			'run-1',
			'code.refactor',
			2,
			'hash-v2',
			'queued',
			now,
			'{}',
			now,
			now,
		);

		expect(() =>
			insertRun.run(
				'run-2',
				'code.refactor',
				999,
				'hash-v999',
				'queued',
				now,
				'{}',
				now,
				now,
			),
		).toThrow();

		db.close();
	});

	it('rejects invalid runtime transaction mode values', () => {
		const dbPath = createTempDbPath();
		const db = openStorageDb({ dbPath });

		expect(() =>
			runInTransaction(
				db,
				() => {
					// no-op
				},
				{ mode: 'MALICIOUS; DROP TABLE workflows;' as never },
			),
		).toThrow('Invalid transaction mode');

		db.close();
	});
});
