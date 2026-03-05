import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
	claimNextRun,
	createRun,
	markRunCanceled,
	markRunFailed,
	markRunSucceeded,
	markRunWaitingManual,
	openStorageDb,
	registerWorkflow,
	renewLease,
} from '../src/index.js';

const tempDirs: string[] = [];

function createTempDbPath(): string {
	const dir = mkdtempSync(path.join(tmpdir(), 'ergon-storage-b3-'));
	tempDirs.push(dir);
	return path.join(dir, 'ergon.db');
}

afterEach(() => {
	for (const dir of tempDirs.splice(0)) {
		rmSync(dir, { force: true, recursive: true });
	}
});

describe('claim and lease primitives (B3)', () => {
	it('claims runs atomically across two workers without duplication', () => {
		const dbPath = createTempDbPath();
		const dbScheduler = openStorageDb({ dbPath });
		const workerA = openStorageDb({ dbPath });
		const workerB = openStorageDb({ dbPath });

		registerWorkflow(dbScheduler, {
			hash: 'hash-refactor-v1',
			id: 'code.refactor',
			sourcePath: 'library/workflows/code.refactor.yaml',
			version: 1,
		});

		createRun(
			dbScheduler,
			'code.refactor',
			{ n: 1 },
			{
				id: 'run-low-priority',
				priority: 0,
				scheduledAt: '2026-03-05T16:00:10.000Z',
				workflowHash: 'hash-refactor-v1',
				workflowVersion: 1,
			},
		);
		createRun(
			dbScheduler,
			'code.refactor',
			{ n: 2 },
			{
				id: 'run-high-priority',
				priority: 10,
				scheduledAt: '2026-03-05T16:00:00.000Z',
				workflowHash: 'hash-refactor-v1',
				workflowVersion: 1,
			},
		);

		const claimedByA = claimNextRun(workerA, 'worker-a', 60_000);
		const claimedByB = claimNextRun(workerB, 'worker-b', 60_000);
		const thirdClaim = claimNextRun(workerA, 'worker-a', 60_000);

		expect(claimedByA?.id).toBe('run-high-priority');
		expect(claimedByB?.id).toBe('run-low-priority');
		expect(claimedByA?.id).not.toBe(claimedByB?.id);
		expect(thirdClaim).toBeNull();
		expect(claimedByA?.status).toBe('running');
		expect(claimedByB?.status).toBe('running');

		dbScheduler.close();
		workerA.close();
		workerB.close();
	});

	it('renews lease and marks terminal statuses', () => {
		const db = openStorageDb({ dbPath: createTempDbPath() });

		registerWorkflow(db, {
			hash: 'hash-hotfix-v1',
			id: 'code.hotfix',
			sourcePath: 'library/workflows/code.hotfix.yaml',
			version: 1,
		});

		createRun(
			db,
			'code.hotfix',
			{ n: 1 },
			{
				id: 'run-lease',
				workflowHash: 'hash-hotfix-v1',
				workflowVersion: 1,
			},
		);

		const claimed = claimNextRun(db, 'worker-1', 30_000);
		expect(claimed?.status).toBe('running');
		expect(claimed?.claimed_by).toBe('worker-1');

		const renewed = renewLease(db, 'run-lease', 'worker-1', 90_000);
		expect(renewed?.id).toBe('run-lease');
		expect(renewed?.lease_until).toBeTruthy();

		const waitingManual = markRunWaitingManual(db, 'run-lease');
		expect(waitingManual?.status).toBe('waiting_manual');
		expect(waitingManual?.claimed_by).toBeNull();
		expect(waitingManual?.lease_until).toBeNull();

		createRun(
			db,
			'code.hotfix',
			{ n: 2 },
			{
				id: 'run-succeed',
				workflowHash: 'hash-hotfix-v1',
				workflowVersion: 1,
			},
		);
		claimNextRun(db, 'worker-1', 30_000);
		const succeeded = markRunSucceeded(db, 'run-succeed', {
			result: { ok: true },
		});
		expect(succeeded?.status).toBe('succeeded');
		expect(succeeded?.finished_at).toBeTruthy();

		createRun(
			db,
			'code.hotfix',
			{ n: 3 },
			{
				id: 'run-fail',
				workflowHash: 'hash-hotfix-v1',
				workflowVersion: 1,
			},
		);
		claimNextRun(db, 'worker-1', 30_000);
		const failed = markRunFailed(db, 'run-fail', {
			errorCode: 'provider_error',
			errorDetail: { detail: 'network timeout' },
			errorMessage: 'provider failed',
		});
		expect(failed?.status).toBe('failed');
		expect(failed?.error_code).toBe('provider_error');

		createRun(
			db,
			'code.hotfix',
			{ n: 4 },
			{
				id: 'run-cancel',
				workflowHash: 'hash-hotfix-v1',
				workflowVersion: 1,
			},
		);
		claimNextRun(db, 'worker-1', 30_000);
		const canceled = markRunCanceled(db, 'run-cancel');
		expect(canceled?.status).toBe('canceled');
		expect(canceled?.finished_at).toBeTruthy();

		db.close();
	});
});
