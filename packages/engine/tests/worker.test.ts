import { createHash } from 'node:crypto';
import {
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
	createRun,
	createStepRun,
	getWorker,
	listRuns,
	listStepRuns,
	openStorageDb,
	registerWorkflow,
	updateRunCursor,
	updateStepRunStatus,
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
	const templateDir = path.join(rootDir, 'library', 'workflows');
	mkdirSync(templateDir, { recursive: true });
	const templatePath = path.join(templateDir, 'workflow.yaml');
	writeFileSync(templatePath, content, 'utf8');
	return path.relative(rootDir, templatePath);
}

function hashTemplate(rootDir: string, sourcePath: string): string {
	return createHash('sha256')
		.update(readFileSync(path.join(rootDir, sourcePath)))
		.digest('hex');
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
		const workflowHash = hashTemplate(rootDir, sourcePath);

		registerWorkflow(db, {
			hash: workflowHash,
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
				workflowHash,
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

	it('retries the in-flight step after reclaiming an expired lease', async () => {
		const rootDir = createTempRoot();
		const db = openStorageDb({
			dbPath: path.join(rootDir, 'ergon.db'),
			migrationsDir: migrationsDir.pathname,
		});
		const sourcePath = writeTemplate(
			rootDir,
			`
workflow:
  id: test.worker.recovery
  version: 1
steps:
  - id: recover.exec
    kind: exec
    command: "echo recovered"
    retry:
      max_attempts: 2
      on:
        - exec_failed
`,
		);
		const workflowHash = hashTemplate(rootDir, sourcePath);

		registerWorkflow(db, {
			hash: workflowHash,
			id: 'test.worker.recovery',
			sourcePath,
			version: 1,
		});
		createRun(
			db,
			'test.worker.recovery',
			{},
			{
				id: 'run-worker-recovery',
				workflowHash,
				workflowVersion: 1,
			},
		);

		const claimedRun = db
			.prepare(
				`UPDATE workflow_runs
				 SET status = 'running',
				     claimed_by = 'worker-dead',
				     lease_until = ?,
				     started_at = ?,
				     updated_at = ?,
				     current_step_id = 'recover.exec',
				     current_step_index = 0,
				     attempt = 1
				 WHERE id = 'run-worker-recovery'
				 RETURNING *;`,
			)
			.get(
				'2026-03-05T00:00:00.000Z',
				'2026-03-05T00:00:00.000Z',
				'2026-03-05T00:00:00.000Z',
			);
		expect(claimedRun).toBeTruthy();

		const staleStepRun = createStepRun(
			db,
			'run-worker-recovery',
			'recover.exec',
			1,
			'exec',
		);
		updateStepRunStatus(db, staleStepRun.id, 'running', {
			startedAt: '2026-03-05T00:00:00.000Z',
		});
		updateRunCursor(
			db,
			'run-worker-recovery',
			'worker-dead',
			0,
			0,
			'recover.exec',
		);

		const executors = new ExecutorRegistry([
			new ExecExecutor({
				async spawn() {
					return {
						code: 0,
						signal: null,
						stderr: '',
						stdout: 'recovered\n',
					};
				},
			}),
		]);

		const result = await startWorker({
			db,
			executors,
			maxRuns: 1,
			pollIntervalMs: 5,
			rootDir,
			workerId: 'worker-recovered',
		});

		expect(result.processedRuns).toBe(1);

		const run = listRuns(db, { workflowId: 'test.worker.recovery' })[0];
		expect(run?.status).toBe('succeeded');

		const stepRuns = listStepRuns(db, 'run-worker-recovery');
		expect(stepRuns).toHaveLength(2);
		expect(stepRuns.map((stepRun) => stepRun.status)).toEqual([
			'failed',
			'succeeded',
		]);

		const retryEvents = db
			.prepare(
				`SELECT COUNT(*) as total
				 FROM events
				 WHERE run_id = ?
				   AND type = 'step_retry';`,
			)
			.get('run-worker-recovery') as { total: number };
		expect(retryEvents.total).toBe(1);

		db.close();
	});

	it('fails the run when an expired in-flight step cannot be retried', async () => {
		const rootDir = createTempRoot();
		const db = openStorageDb({
			dbPath: path.join(rootDir, 'ergon.db'),
			migrationsDir: migrationsDir.pathname,
		});
		const sourcePath = writeTemplate(
			rootDir,
			`
workflow:
  id: test.worker.recovery.fail
  version: 1
steps:
  - id: fail.exec
    kind: exec
    command: "echo fail"
`,
		);
		const workflowHash = hashTemplate(rootDir, sourcePath);

		registerWorkflow(db, {
			hash: workflowHash,
			id: 'test.worker.recovery.fail',
			sourcePath,
			version: 1,
		});
		createRun(
			db,
			'test.worker.recovery.fail',
			{},
			{
				id: 'run-worker-recovery-fail',
				workflowHash,
				workflowVersion: 1,
			},
		);

		db.prepare(
			`UPDATE workflow_runs
			 SET status = 'running',
			     claimed_by = 'worker-dead',
			     lease_until = ?,
			     started_at = ?,
			     updated_at = ?,
			     current_step_id = 'fail.exec',
			     current_step_index = 0,
			     attempt = 1
			 WHERE id = 'run-worker-recovery-fail';`,
		).run(
			'2026-03-05T00:00:00.000Z',
			'2026-03-05T00:00:00.000Z',
			'2026-03-05T00:00:00.000Z',
		);

		const staleStepRun = createStepRun(
			db,
			'run-worker-recovery-fail',
			'fail.exec',
			1,
			'exec',
		);
		updateStepRunStatus(db, staleStepRun.id, 'running', {
			startedAt: '2026-03-05T00:00:00.000Z',
		});
		updateRunCursor(
			db,
			'run-worker-recovery-fail',
			'worker-dead',
			0,
			0,
			'fail.exec',
		);

		const executors = new ExecutorRegistry([
			new ExecExecutor({
				async spawn() {
					return {
						code: 0,
						signal: null,
						stderr: '',
						stdout: 'should not run\n',
					};
				},
			}),
		]);

		const result = await startWorker({
			db,
			executors,
			maxRuns: 1,
			pollIntervalMs: 5,
			rootDir,
			workerId: 'worker-recovered-fail',
		});

		expect(result.processedRuns).toBe(1);

		const run = listRuns(db, { workflowId: 'test.worker.recovery.fail' })[0];
		expect(run?.status).toBe('failed');

		const stepRuns = listStepRuns(db, 'run-worker-recovery-fail');
		expect(stepRuns).toHaveLength(1);
		expect(stepRuns[0]?.status).toBe('failed');

		db.close();
	});

	it('fails recovery clearly when the stale step no longer exists in the template', async () => {
		const rootDir = createTempRoot();
		const db = openStorageDb({
			dbPath: path.join(rootDir, 'ergon.db'),
			migrationsDir: migrationsDir.pathname,
		});
		const sourcePath = writeTemplate(
			rootDir,
			`
workflow:
  id: test.worker.recovery.mismatch
  version: 1
steps:
  - id: renamed.exec
    kind: exec
    command: "echo renamed"
`,
		);
		const workflowHash = hashTemplate(rootDir, sourcePath);

		registerWorkflow(db, {
			hash: workflowHash,
			id: 'test.worker.recovery.mismatch',
			sourcePath,
			version: 1,
		});
		createRun(
			db,
			'test.worker.recovery.mismatch',
			{},
			{
				id: 'run-worker-recovery-mismatch',
				workflowHash,
				workflowVersion: 1,
			},
		);

		db.prepare(
			`UPDATE workflow_runs
			 SET status = 'running',
			     claimed_by = 'worker-dead',
			     lease_until = ?,
			     started_at = ?,
			     updated_at = ?,
			     current_step_id = 'removed.exec',
			     current_step_index = 0,
			     attempt = 1
			 WHERE id = 'run-worker-recovery-mismatch';`,
		).run(
			'2026-03-05T00:00:00.000Z',
			'2026-03-05T00:00:00.000Z',
			'2026-03-05T00:00:00.000Z',
		);

		const staleStepRun = createStepRun(
			db,
			'run-worker-recovery-mismatch',
			'removed.exec',
			1,
			'exec',
		);
		updateStepRunStatus(db, staleStepRun.id, 'running', {
			startedAt: '2026-03-05T00:00:00.000Z',
		});
		updateRunCursor(
			db,
			'run-worker-recovery-mismatch',
			'worker-dead',
			0,
			0,
			'removed.exec',
		);

		const executors = new ExecutorRegistry([
			new ExecExecutor({
				async spawn() {
					return {
						code: 0,
						signal: null,
						stderr: '',
						stdout: 'should not run\n',
					};
				},
			}),
		]);

		await expect(
			startWorker({
				db,
				executors,
				maxRuns: 1,
				pollIntervalMs: 5,
				rootDir,
				workerId: 'worker-recovered-mismatch',
			}),
		).rejects.toThrow(
			'could not resolve recovery step "removed.exec" from the current workflow version',
		);

		db.close();
	});

	it('refuses to execute a run when the workflow source changes after scheduling', async () => {
		const rootDir = createTempRoot();
		const db = openStorageDb({
			dbPath: path.join(rootDir, 'ergon.db'),
			migrationsDir: migrationsDir.pathname,
		});
		const sourcePath = writeTemplate(
			rootDir,
			`
workflow:
  id: test.worker.drift
  version: 1
steps:
  - id: drift.exec
    kind: exec
    command: "echo initial"
`,
		);
		const workflowHash = hashTemplate(rootDir, sourcePath);

		registerWorkflow(db, {
			hash: workflowHash,
			id: 'test.worker.drift',
			sourcePath,
			version: 1,
		});
		createRun(
			db,
			'test.worker.drift',
			{},
			{
				id: 'run-worker-drift',
				workflowHash,
				workflowVersion: 1,
			},
		);
		writeFileSync(
			path.join(rootDir, sourcePath),
			`
workflow:
  id: test.worker.drift
  version: 1
steps:
  - id: drift.exec
    kind: exec
    command: "echo changed"
`,
			'utf8',
		);

		const executors = new ExecutorRegistry([
			new ExecExecutor({
				async spawn() {
					return {
						code: 0,
						signal: null,
						stderr: '',
						stdout: 'should not run\n',
					};
				},
			}),
		]);

		await expect(
			startWorker({
				db,
				executors,
				maxRuns: 1,
				pollIntervalMs: 5,
				rootDir,
				workerId: 'worker-drift',
			}),
		).rejects.toThrow(
			'Workflow run "run-worker-drift" cannot execute because the registered workflow source changed after scheduling',
		);

		db.close();
	});
});
