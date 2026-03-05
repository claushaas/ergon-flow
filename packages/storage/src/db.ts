import { mkdirSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';

export interface StorageDbOptions {
	busyTimeoutMs?: number;
	dbPath: string;
	migrationsDir?: string;
}

export interface TransactionOptions {
	mode?: 'DEFERRED' | 'EXCLUSIVE' | 'IMMEDIATE';
}

const DEFAULT_BUSY_TIMEOUT_MS = 5_000;
const DEFAULT_MIGRATIONS_DIR = fileURLToPath(
	new URL('./migrations', import.meta.url),
);

export function openStorageDb(options: StorageDbOptions): DatabaseSync {
	const dbPath = path.resolve(options.dbPath);
	mkdirSync(path.dirname(dbPath), { recursive: true });

	const db = new DatabaseSync(dbPath);
	try {
		applyPragmas(db, options.busyTimeoutMs ?? DEFAULT_BUSY_TIMEOUT_MS);
		runMigrations(db, options.migrationsDir ?? DEFAULT_MIGRATIONS_DIR);
		return db;
	} catch (error) {
		db.close();
		throw error;
	}
}

export function runInTransaction<T>(
	db: DatabaseSync,
	callback: () => T,
	options: TransactionOptions = {},
): T {
	const mode = options.mode ?? 'DEFERRED';
	db.exec(`BEGIN ${mode};`);
	try {
		const result = callback();
		db.exec('COMMIT;');
		return result;
	} catch (error) {
		try {
			db.exec('ROLLBACK;');
		} catch {
			// Keep the original failure as the primary error.
		}
		throw error;
	}
}

function applyPragmas(db: DatabaseSync, busyTimeoutMs: number): void {
	db.exec('PRAGMA journal_mode = WAL;');
	db.exec('PRAGMA synchronous = NORMAL;');
	db.exec('PRAGMA foreign_keys = ON;');
	db.exec(`PRAGMA busy_timeout = ${Math.max(0, Math.trunc(busyTimeoutMs))};`);
}

function runMigrations(db: DatabaseSync, migrationsDir: string): void {
	db.exec(`
		CREATE TABLE IF NOT EXISTS schema_migrations (
			name TEXT PRIMARY KEY,
			applied_at TEXT NOT NULL
		);
	`);

	const appliedRows = db
		.prepare('SELECT name FROM schema_migrations;')
		.all() as Array<{ name: string }>;
	const applied = new Set(appliedRows.map((row) => row.name));

	const migrationFiles = readdirSync(migrationsDir)
		.filter((entry) => /^\d+.*\.sql$/i.test(entry))
		.sort((a, b) => a.localeCompare(b));
	const insertMigration = db.prepare(
		'INSERT INTO schema_migrations(name, applied_at) VALUES (?, ?);',
	);

	for (const migrationFile of migrationFiles) {
		if (applied.has(migrationFile)) {
			continue;
		}

		const sql = readFileSync(path.join(migrationsDir, migrationFile), 'utf8');
		if (!sql.trim()) {
			continue;
		}

		runInTransaction(db, () => {
			db.exec(sql);
			insertMigration.run(migrationFile, new Date().toISOString());
		});
	}
}
