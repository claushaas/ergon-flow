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
import type {
	ClientRequest,
	ExecutionClient,
	Provider,
} from '@claushaas/shared';
import {
	claimNextRun,
	createRun,
	listEvents,
	listStepRuns,
	openStorageDb,
	registerWorkflow,
} from '@claushaas/storage';
import { afterEach, describe, expect, it } from 'vitest';
import { AgentExecutor, ExecutorRegistry, executeRun } from '../src/index.js';

const tempDirs: string[] = [];
const migrationsDir = new URL('../../storage/src/migrations', import.meta.url);

class AbortAwareClient implements ExecutionClient {
	public readonly provider: Provider = 'openrouter';

	public async run(request: ClientRequest) {
		return await new Promise((_resolve, reject) => {
			if (request.signal?.aborted) {
				reject(request.signal.reason);
				return;
			}
			request.signal?.addEventListener(
				'abort',
				() => {
					reject(request.signal?.reason);
				},
				{ once: true },
			);
		});
	}
}

function createTempRoot(): string {
	const dir = mkdtempSync(path.join(tmpdir(), 'ergon-runtime-edge-'));
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

describe('runtime edge cases (phase 5)', () => {
	it('cancels an in-flight agent request when the run is externally canceled', async () => {
		const rootDir = createTempRoot();
		const db = openStorageDb({
			dbPath: path.join(rootDir, 'ergon.db'),
			migrationsDir: migrationsDir.pathname,
		});
		const sourcePath = writeTemplate(
			rootDir,
			`
workflow:
  id: test.cancel.agent
  version: 1
inputs:
  task:
    type: string
steps:
  - id: analyze
    kind: agent
    provider: openrouter
    prompt: "Analyze {{ inputs.task }}"
`,
		);
		const workflowHash = hashTemplate(rootDir, sourcePath);

		registerWorkflow(db, {
			hash: workflowHash,
			id: 'test.cancel.agent',
			sourcePath,
			version: 1,
		});
		const run = createRun(
			db,
			'test.cancel.agent',
			{ task: 'runtime cancellation' },
			{
				id: 'run-cancel-agent',
				workflowHash,
				workflowVersion: 1,
			},
		);
		const claim = claimNextRun(db, 'worker-cancel-agent', 30_000);
		expect(claim?.id).toBe(run.id);

		const executors = new ExecutorRegistry([
			new AgentExecutor({
				resolveClient() {
					return new AbortAwareClient();
				},
			}),
		]);

		const executionPromise = executeRun(
			run.id,
			{
				claimEpoch: claim?.claim_epoch ?? 1,
				workerId: 'worker-cancel-agent',
			},
			{
				db,
				executors,
				rootDir,
			},
		);

		await new Promise((resolve) => {
			setTimeout(resolve, 20);
		});
		db.prepare(
			`UPDATE workflow_runs
			 SET status = 'canceled',
			     claimed_by = NULL,
			     lease_until = NULL,
			     finished_at = ?,
			     updated_at = ?
			 WHERE id = ?;`,
		).run('2026-03-06T00:00:00.000Z', '2026-03-06T00:00:00.000Z', run.id);

		const canceledRun = await executionPromise;
		expect(canceledRun?.status).toBe('canceled');

		const stepRuns = listStepRuns(db, run.id);
		expect(stepRuns).toHaveLength(1);
		expect(stepRuns[0]?.status).toBe('failed');
		expect(stepRuns[0]?.error_message).toContain('canceled during step');

		expect(listEvents(db, run.id).map((event) => event.type)).toContain(
			'workflow_canceled',
		);

		db.close();
	});
});
