import { fileURLToPath } from 'node:url';
import { openStorageDb } from '@ergon/storage';

const STORAGE_MIGRATIONS_DIR = fileURLToPath(
	new URL('../../storage/src/migrations', import.meta.url),
);

export function openCliDb(dbPath: string) {
	return openStorageDb({
		dbPath,
		migrationsDir: STORAGE_MIGRATIONS_DIR,
	});
}
