import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
	appendEvent,
	createRun,
	getWorker,
	listRuns,
	openStorageDb,
	registerWorkflow,
} from '@ergon/storage';
import { afterEach, describe, expect, it } from 'vitest';
import { ExecExecutor, ExecutorRegistry, startWorker } from '../src/index.js';

const tempDirs: string[] = [];
const migrationsDir = new URL('../../storage/src/migrations', import.meta.url);

function createTempRoot(): string {
	const dir = mkdtempSync(path.join(tmpdir(), 'ergon-engine-worker-'));
	tempDirs.push(dir);
	return dir;
}

function writeTemplate(rootDir: string, content: string): string {
	const templateDir = path.join(rootDir, 'templates');
	mkdirSync(templateDir, { recursive: true });
	const templatePath = path.join(templateDir, 'workflow.yaml');
	writeFileSync(templatePath, content, 'utf8');
	return path.relative(rootDir, templatePath);
}

afterEach(() => {
	for (const dir of tempDirs.splice(0)) {
		rmSync(dir, { force: true, recursive: true });
	}
});

describe('worker runtime (G1)', () => {
	it('claims queued runs, renews leases and records worker heartbeat', async () => {
		const rootDir = createTempRoot();
		const db = openStorageDb({
			dbPath: path.join(rootDir, 'ergon.db'),
			migrationsDir: migrationsDir.pathname,
		});
		const sourcePath = writeTemplate(
			rootDir,
			`
workflow:
  id: test.worker
  version: 1
steps:
  - id: long.exec
    kind: exec
    command: "echo ok"
`,
		);

		registerWorkflow(db, {
			hash: 'hash-worker-v1',
			id: 'test.worker',
			sourcePath,
			version: 1,
		});
		createRun(
			db,
			'test.worker',
			{ repo: 'acme/repo' },
			{
				id: 'run-worker-1',
				workflowHash: 'hash-worker-v1',
				workflowVersion: 1,
			},
		);

		const executors = new ExecutorRegistry([
			new ExecExecutor({
				async spawn() {
					await new Promise((resolve) => {
						setTimeout(resolve, 40);
					});

					return {
						code: 0,
						signal: null,
						stderr: '',
						stdout: 'ok\n',
					};
				},
			}),
		]);

		const result = await startWorker({
			db,
			executors,
			heartbeatIntervalMs: 10,
			hostname: 'worker-host',
			leaseDurationMs: 20,
			leaseRenewIntervalMs: 5,
			maxRuns: 1,
			pid: 1111,
			pollIntervalMs: 5,
			rootDir,
			workerId: 'worker-g1',
		});

		expect(result).toEqual({
			processedRuns: 1,
			workerId: 'worker-g1',
		});

		const run = listRuns(db, { workflowId: 'test.worker' })[0];
		expect(run?.status).toBe('succeeded');
		expect(run?.claimed_by).toBeNull();

		const leaseRenewals = db
			.prepare(
				`SELECT COUNT(*) as total
				 FROM events
				 WHERE run_id = ?
				   AND type = 'lease_renewed';`,
			)
			.get('run-worker-1') as { total: number };
		expect(leaseRenewals.total).toBeGreaterThan(0);

		const workflowStarted = db
			.prepare(
				`SELECT COUNT(*) as total
				 FROM events
				 WHERE run_id = ?
				   AND type = 'workflow_started';`,
			)
			.get('run-worker-1') as { total: number };
		expect(workflowStarted.total).toBe(1);

		const worker = getWorker(db, 'worker-g1');
		expect(worker?.hostname).toBe('worker-host');
		expect(worker?.pid).toBe(1111);
		expect(worker?.last_beat_at).toBeTruthy();

		db.close();
	});
});
