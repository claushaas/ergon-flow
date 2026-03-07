import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
	getWorker,
	heartbeatWorker,
	openStorageDb,
	registerWorker,
} from '../src/index.js';

const tempDirs: string[] = [];

function createTempDbPath(): string {
	const dir = mkdtempSync(path.join(tmpdir(), 'ergon-storage-workers-'));
	tempDirs.push(dir);
	return path.join(dir, 'ergon.db');
}

afterEach(() => {
	for (const dir of tempDirs.splice(0)) {
		rmSync(dir, { force: true, recursive: true });
	}
});

describe('worker repository', () => {
	it('registers workers and updates their heartbeat', () => {
		const db = openStorageDb({ dbPath: createTempDbPath() });

		const registered = registerWorker(db, {
			hostname: 'host-a',
			id: 'worker-a',
			meta: { version: '0.1.0' },
			pid: 1234,
			startedAt: '2026-03-06T12:00:00.000Z',
		});
		expect(registered.id).toBe('worker-a');
		expect(registered.hostname).toBe('host-a');
		expect(registered.pid).toBe(1234);

		const heartbeat = heartbeatWorker(db, {
			hostname: 'host-b',
			id: 'worker-a',
			lastBeatAt: '2026-03-06T12:00:05.000Z',
			meta: { version: '0.1.2' },
			pid: 4321,
		});
		expect(heartbeat.hostname).toBe('host-b');
		expect(heartbeat.pid).toBe(4321);
		expect(heartbeat.last_beat_at).toBe('2026-03-06T12:00:05.000Z');

		const stored = getWorker(db, 'worker-a');
		expect(stored?.started_at).toBe('2026-03-06T12:00:00.000Z');
		expect(stored?.meta_json).toBe(JSON.stringify({ version: '0.1.2' }));

		db.close();
	});
});
