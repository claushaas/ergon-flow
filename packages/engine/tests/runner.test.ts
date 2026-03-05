import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type {
	ExecStepDefinition,
	ExecutionClient,
	Provider,
} from '@ergon/shared';
import {
	appendEvent,
	artifactPath,
	claimNextRun,
	createRun,
	createStepRun,
	insertArtifact,
	listArtifacts,
	listStepRuns,
	openStorageDb,
	registerWorkflow,
	updateStepRunStatus,
} from '@ergon/storage';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type {
	ExecutionContext,
	Executor,
	ExecutorResult,
} from '../src/index.js';
import {
	AgentExecutor,
	ArtifactExecutor,
	ExecutorRegistry,
	executeRun,
	ManualExecutor,
	NotifyExecutor,
} from '../src/index.js';

const tempDirs: string[] = [];
const migrationsDir = new URL('../../storage/src/migrations', import.meta.url);

function createTempRoot(): string {
	const dir = mkdtempSync(path.join(tmpdir(), 'ergon-engine-runner-'));
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

function createStubClient(provider: Provider, text: string): ExecutionClient {
	return {
		provider,
		async run() {
			return {
				raw: { text },
				text,
			};
		},
	};
}

class ThrowingExecExecutor implements Executor<ExecStepDefinition> {
	public readonly kind = 'exec' as const;

	public async execute(
		step: ExecStepDefinition,
		_context: ExecutionContext,
	): Promise<ExecutorResult> {
		throw new Error(`boom:${step.id}`);
	}
}

afterEach(() => {
	for (const dir of tempDirs.splice(0)) {
		rmSync(dir, { force: true, recursive: true });
	}
});

describe('engine runner (F1)', () => {
	it('executes a run, persists artifacts and records terminal result', async () => {
		const rootDir = createTempRoot();
		const db = openStorageDb({
			dbPath: path.join(rootDir, 'ergon.db'),
			migrationsDir: migrationsDir.pathname,
		});
		const sourcePath = writeTemplate(
			rootDir,
			`
workflow:
  id: test.runner
  version: 1
outputs:
  final_answer: "{{ artifacts.report.answer }}"
steps:
  - id: analyze
    kind: agent
    provider: openrouter
    prompt: "Summarize"
  - id: report.copy
    kind: artifact
    input: analysis
    operation: rename:report
  - id: notify
    kind: notify
    channel: stdout
    message: "done {{ artifacts.report.answer }}"
`,
		);

		registerWorkflow(db, {
			hash: 'hash-runner-v1',
			id: 'test.runner',
			sourcePath,
			version: 1,
		});
		const queuedRun = createRun(
			db,
			'test.runner',
			{ repo: 'acme/repo' },
			{
				workflowHash: 'hash-runner-v1',
				workflowVersion: 1,
			},
		);
		const claimedRun = claimNextRun(db, 'worker-1', 30_000);
		expect(claimedRun?.id).toBe(queuedRun.id);

		const log = vi.fn();
		const executors = new ExecutorRegistry([
			new AgentExecutor({
				resolveClient() {
					return createStubClient('openrouter', '{"answer":"ok"}');
				},
			}),
			new ArtifactExecutor(),
			new NotifyExecutor({ log }),
		]);

		const finishedRun = await executeRun(queuedRun.id, 'worker-1', {
			db,
			executors,
			rootDir,
		});

		expect(finishedRun?.status).toBe('succeeded');
		expect(finishedRun?.current_step_id).toBeNull();
		expect(finishedRun?.current_step_index).toBe(3);
		expect(JSON.parse(finishedRun?.result_json ?? '{}')).toEqual({
			final_answer: 'ok',
		});

		const stepRuns = listStepRuns(db, queuedRun.id);
		expect(stepRuns).toHaveLength(3);
		expect(stepRuns.map((stepRun) => stepRun.status)).toEqual([
			'succeeded',
			'succeeded',
			'succeeded',
		]);

		const artifacts = listArtifacts(db, queuedRun.id);
		expect(artifacts.map((artifact) => artifact.name)).toEqual([
			'analysis',
			'report',
		]);
		expect(log).toHaveBeenCalledWith('"done ok"');

		const storedAnalysis = path.join(rootDir, artifacts[0]?.path ?? '');
		expect(storedAnalysis).toContain('.runs');

		const eventRows = db
			.prepare('SELECT type FROM events WHERE run_id = ? ORDER BY seq ASC;')
			.all(queuedRun.id) as Array<{ type: string }>;
		expect(eventRows.map((event) => event.type)).toEqual([
			'step_started',
			'step_succeeded',
			'step_started',
			'step_succeeded',
			'step_started',
			'step_succeeded',
			'workflow_succeeded',
		]);

		db.close();
	});

	it('resumes from step history and persisted artifacts', async () => {
		const rootDir = createTempRoot();
		const db = openStorageDb({
			dbPath: path.join(rootDir, 'ergon.db'),
			migrationsDir: migrationsDir.pathname,
		});
		const sourcePath = writeTemplate(
			rootDir,
			`
workflow:
  id: test.resume
  version: 1
outputs:
  extracted: "{{ artifacts.answer_text }}"
steps:
  - id: analyze
    kind: agent
    provider: openrouter
    prompt: "Summarize"
  - id: extract.answer
    kind: artifact
    input: analysis
    operation: extract:answer:answer_text
`,
		);

		registerWorkflow(db, {
			hash: 'hash-resume-v1',
			id: 'test.resume',
			sourcePath,
			version: 1,
		});
		const queuedRun = createRun(
			db,
			'test.resume',
			{},
			{
				workflowHash: 'hash-resume-v1',
				workflowVersion: 1,
			},
		);
		expect(claimNextRun(db, 'worker-2', 30_000)?.id).toBe(queuedRun.id);

		const priorStepRun = createStepRun(
			db,
			queuedRun.id,
			'analyze',
			1,
			'agent',
			{
				request: { prompt: 'Summarize' },
			},
		);
		updateStepRunStatus(db, priorStepRun.id, 'succeeded', {
			finishedAt: new Date().toISOString(),
			output: {
				artifact_name: 'analysis',
				text: '{"answer":"resumed"}',
			},
			startedAt: new Date().toISOString(),
		});
		appendEvent(
			db,
			queuedRun.id,
			'step_succeeded',
			{ step_id: 'analyze' },
			{ actor: 'worker:worker-2', stepRunId: priorStepRun.id },
		);

		const analysisFile = artifactPath(rootDir, queuedRun.id, 'analysis.json');
		mkdirSync(path.dirname(analysisFile), { recursive: true });
		writeFileSync(
			analysisFile,
			JSON.stringify({ answer: 'resumed' }, null, 2),
			'utf8',
		);
		insertArtifact(db, {
			name: 'analysis',
			path: path.relative(rootDir, analysisFile),
			runId: queuedRun.id,
			sizeBytes: 22,
			stepRunId: priorStepRun.id,
			type: 'analysis',
		});

		const finishedRun = await executeRun(queuedRun.id, 'worker-2', {
			db,
			executors: new ExecutorRegistry([new ArtifactExecutor()]),
			rootDir,
		});

		expect(finishedRun?.status).toBe('succeeded');
		expect(JSON.parse(finishedRun?.result_json ?? '{}')).toEqual({
			extracted: 'resumed',
		});

		const stepRuns = listStepRuns(db, queuedRun.id);
		expect(
			stepRuns.map((stepRun) => [stepRun.step_id, stepRun.attempt]),
		).toEqual([
			['analyze', 1],
			['extract.answer', 1],
		]);

		db.close();
	});

	it('marks a run as waiting_manual when the executor pauses', async () => {
		const rootDir = createTempRoot();
		const db = openStorageDb({
			dbPath: path.join(rootDir, 'ergon.db'),
			migrationsDir: migrationsDir.pathname,
		});
		const sourcePath = writeTemplate(
			rootDir,
			`
workflow:
  id: test.manual
  version: 1
steps:
  - id: gate
    kind: manual
    message: "Approve execution"
`,
		);

		registerWorkflow(db, {
			hash: 'hash-manual-v1',
			id: 'test.manual',
			sourcePath,
			version: 1,
		});
		const queuedRun = createRun(
			db,
			'test.manual',
			{},
			{
				workflowHash: 'hash-manual-v1',
				workflowVersion: 1,
			},
		);
		expect(claimNextRun(db, 'worker-3', 30_000)?.id).toBe(queuedRun.id);

		const pausedRun = await executeRun(queuedRun.id, 'worker-3', {
			db,
			executors: new ExecutorRegistry([new ManualExecutor()]),
			rootDir,
		});

		expect(pausedRun?.status).toBe('waiting_manual');
		expect(pausedRun?.claimed_by).toBeNull();
		expect(pausedRun?.current_step_id).toBe('gate');
		expect(pausedRun?.current_step_index).toBe(0);

		const stepRuns = listStepRuns(db, queuedRun.id);
		expect(stepRuns).toHaveLength(1);
		expect(stepRuns[0]?.status).toBe('waiting_manual');

		const eventRows = db
			.prepare('SELECT type FROM events WHERE run_id = ? ORDER BY seq ASC;')
			.all(queuedRun.id) as Array<{ type: string }>;
		expect(eventRows.map((event) => event.type)).toEqual([
			'step_started',
			'manual_waiting',
		]);

		db.close();
	});

	it('marks the run failed when a step raises an error', async () => {
		const rootDir = createTempRoot();
		const db = openStorageDb({
			dbPath: path.join(rootDir, 'ergon.db'),
			migrationsDir: migrationsDir.pathname,
		});
		const sourcePath = writeTemplate(
			rootDir,
			`
workflow:
  id: test.failed
  version: 1
steps:
  - id: explode
    kind: exec
    command: "false"
`,
		);

		registerWorkflow(db, {
			hash: 'hash-failed-v1',
			id: 'test.failed',
			sourcePath,
			version: 1,
		});
		const queuedRun = createRun(
			db,
			'test.failed',
			{},
			{
				workflowHash: 'hash-failed-v1',
				workflowVersion: 1,
			},
		);
		expect(claimNextRun(db, 'worker-4', 30_000)?.id).toBe(queuedRun.id);

		await expect(
			executeRun(queuedRun.id, 'worker-4', {
				db,
				executors: new ExecutorRegistry([new ThrowingExecExecutor()]),
				rootDir,
			}),
		).rejects.toThrow('boom:explode');

		const failedRun = db
			.prepare('SELECT status, error_message FROM workflow_runs WHERE id = ?;')
			.get(queuedRun.id) as { error_message: string; status: string };
		expect(failedRun.status).toBe('failed');
		expect(failedRun.error_message).toContain('boom:explode');

		const stepRuns = listStepRuns(db, queuedRun.id);
		expect(stepRuns).toHaveLength(1);
		expect(stepRuns[0]?.status).toBe('failed');
		expect(stepRuns[0]?.error_message).toContain('boom:explode');

		const eventRows = db
			.prepare('SELECT type FROM events WHERE run_id = ? ORDER BY seq ASC;')
			.all(queuedRun.id) as Array<{ type: string }>;
		expect(eventRows.map((event) => event.type)).toEqual([
			'step_started',
			'step_failed',
			'workflow_failed',
		]);

		db.close();
	});
});
