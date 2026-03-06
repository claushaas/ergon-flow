import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
	appendEvent,
	createRun,
	createStepRun,
	getRun,
	insertArtifact,
	listRuns,
	openStorageDb,
	registerWorkflow,
	updateStepRunStatus,
} from '../src/index.js';

const tempDirs: string[] = [];

function createTempDbPath(): string {
	const dir = mkdtempSync(path.join(tmpdir(), 'ergon-storage-api-'));
	tempDirs.push(dir);
	return path.join(dir, 'ergon.db');
}

afterEach(() => {
	for (const dir of tempDirs.splice(0)) {
		rmSync(dir, { force: true, recursive: true });
	}
});

describe('storage api (B2)', () => {
	it('registers workflow, creates run, step run, event and artifact', () => {
		const db = openStorageDb({ dbPath: createTempDbPath() });

		const workflow = registerWorkflow(db, {
			description: 'Refactor workflow',
			hash: 'workflow-hash-v1',
			id: 'code.refactor',
			sourcePath: 'library/workflows/code.refactor.yaml',
			version: 1,
		});
		expect(workflow.id).toBe('code.refactor');
		expect(workflow.version).toBe(1);

		const run = createRun(
			db,
			'code.refactor',
			{ repository: 'acme/repo' },
			{
				priority: 10,
				workflowHash: workflow.hash,
				workflowVersion: workflow.version,
			},
		);
		expect(run.status).toBe('queued');
		expect(run.claim_epoch).toBe(0);
		expect(run.workflow_id).toBe('code.refactor');
		expect(run.workflow_version).toBe(1);

		const sameRun = getRun(db, run.id);
		expect(sameRun?.id).toBe(run.id);

		const runs = listRuns(db, {
			status: 'queued',
			workflowId: 'code.refactor',
		});
		expect(runs).toHaveLength(1);
		expect(runs[0]?.id).toBe(run.id);

		const stepRun = createStepRun(db, run.id, 'analyze', 1, 'agent', {
			dependsOn: [],
			request: { prompt: 'Analyze' },
		});
		expect(stepRun.status).toBe('queued');
		expect(stepRun.step_kind).toBe('agent');

		const runningStep = updateStepRunStatus(db, stepRun.id, 'running', {
			startedAt: new Date().toISOString(),
		});
		expect(runningStep?.status).toBe('running');
		expect(runningStep?.started_at).toBeTruthy();

		const doneStep = updateStepRunStatus(db, stepRun.id, 'succeeded', {
			finishedAt: new Date().toISOString(),
			output: { summary: 'ok' },
			response: { text: 'done' },
		});
		expect(doneStep?.status).toBe('succeeded');
		expect(doneStep?.output_json).toContain('summary');

		const artifact = insertArtifact(db, {
			meta: { schema: 'agent.analysis.v1' },
			name: 'analysis',
			path: '.runs/run-1/artifacts/analysis.json',
			runId: run.id,
			sizeBytes: 42,
			stepRunId: stepRun.id,
			type: 'json',
		});
		expect(artifact.run_id).toBe(run.id);
		expect(artifact.step_run_id).toBe(stepRun.id);

		const event1 = appendEvent(
			db,
			run.id,
			'step_started',
			{ step_id: 'analyze' },
			{ actor: 'worker:test-1', stepRunId: stepRun.id },
		);
		const event2 = appendEvent(
			db,
			run.id,
			'step_succeeded',
			{ step_id: 'analyze' },
			{ actor: 'worker:test-1', stepRunId: stepRun.id },
		);

		expect(event1.seq).toBe(2);
		expect(event2.seq).toBe(3);
		expect(event2.run_id).toBe(run.id);

		db.close();
	});

	it('lists runs with limit and offset', () => {
		const db = openStorageDb({ dbPath: createTempDbPath() });

		registerWorkflow(db, {
			hash: 'workflow-hash-v1',
			id: 'code.hotfix',
			sourcePath: 'library/workflows/code.hotfix.yaml',
			version: 1,
		});

		const runA = createRun(
			db,
			'code.hotfix',
			{ n: 1 },
			{
				workflowHash: 'workflow-hash-v1',
				workflowVersion: 1,
			},
		);
		const runB = createRun(
			db,
			'code.hotfix',
			{ n: 2 },
			{
				workflowHash: 'workflow-hash-v1',
				workflowVersion: 1,
			},
		);
		const runC = createRun(
			db,
			'code.hotfix',
			{ n: 3 },
			{
				workflowHash: 'workflow-hash-v1',
				workflowVersion: 1,
			},
		);

		expect(runA.id).not.toBe(runB.id);
		expect(runB.id).not.toBe(runC.id);

		const firstPage = listRuns(db, {
			limit: 2,
			offset: 0,
			workflowId: 'code.hotfix',
		});
		expect(firstPage).toHaveLength(2);

		const secondPage = listRuns(db, {
			limit: 2,
			offset: 2,
			workflowId: 'code.hotfix',
		});
		expect(secondPage).toHaveLength(1);

		db.close();
	});
});
