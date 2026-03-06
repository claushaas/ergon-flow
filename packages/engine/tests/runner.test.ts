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
	markRunCanceled,
	openStorageDb,
	registerWorkflow,
	requeueRunFromManual,
	updateRunCursor,
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

class MaliciousArtifactExecutor implements Executor<ExecStepDefinition> {
	public readonly kind = 'exec' as const;

	public async execute(): Promise<ExecutorResult> {
		return {
			artifacts: [
				{
					name: '../../escape',
					type: 'text',
					value: 'bad',
				},
			],
			status: 'succeeded',
		};
	}
}

class FlakyExecExecutor implements Executor<ExecStepDefinition> {
	public readonly kind = 'exec' as const;
	private attempts = 0;

	public async execute(): Promise<ExecutorResult> {
		this.attempts += 1;
		if (this.attempts === 1) {
			throw new Error('transient boom');
		}
		return {
			outputs: {
				attempts: this.attempts,
			},
			status: 'succeeded',
		};
	}
}

class FailedStatusExecExecutor implements Executor<ExecStepDefinition> {
	public readonly kind = 'exec' as const;
	private attempts = 0;

	public async execute(): Promise<ExecutorResult> {
		this.attempts += 1;
		return {
			outputs: {
				attempts: this.attempts,
			},
			status: 'failed',
		};
	}
}

class CircularFailedStatusExecExecutor implements Executor<ExecStepDefinition> {
	public readonly kind = 'exec' as const;

	public async execute(): Promise<ExecutorResult> {
		const outputs: Record<string, unknown> = {};
		outputs.self = outputs;
		return {
			outputs,
			status: 'failed',
		};
	}
}

class CancelingExecExecutor implements Executor<ExecStepDefinition> {
	public readonly kind = 'exec' as const;

	public constructor(
		private readonly db: ReturnType<typeof openStorageDb>,
		private readonly claimEpoch: number,
		private readonly runId: string,
		private readonly workerId: string,
	) {}

	public async execute(): Promise<ExecutorResult> {
		const canceledRun = markRunCanceled(
			this.db,
			this.runId,
			this.workerId,
			this.claimEpoch,
		);
		expect(canceledRun?.status).toBe('canceled');

		return {
			outputs: {
				canceled: true,
			},
			status: 'succeeded',
		};
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
  final_answer: artifacts.report.answer
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
		const workflowHash = hashTemplate(rootDir, sourcePath);

		registerWorkflow(db, {
			hash: workflowHash,
			id: 'test.runner',
			sourcePath,
			version: 1,
		});
		const queuedRun = createRun(
			db,
			'test.runner',
			{ repo: 'acme/repo' },
			{
				workflowHash,
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

		const finishedRun = await executeRun(
			queuedRun.id,
			{
				claimEpoch: claimedRun?.claim_epoch ?? 1,
				workerId: 'worker-1',
			},
			{
				db,
				executors,
				rootDir,
			},
		);

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
			'run.summary',
		]);
		expect(log).toHaveBeenCalledWith(
			`"[ergon-flow] workflow=test.runner run=${queuedRun.id} step=notify channel=stdout\\ndone ok"`,
		);
		const storedSummary = path.join(rootDir, artifacts[2]?.path ?? '');
		expect(JSON.parse(readFileSync(storedSummary, 'utf8'))).toEqual({
			channel: 'stdout',
			message: 'done ok',
			run_id: queuedRun.id,
			step_id: 'notify',
			workflow_id: 'test.runner',
			workflow_version: 1,
		});

		const storedAnalysis = path.join(rootDir, artifacts[0]?.path ?? '');
		expect(storedAnalysis).toContain('.runs');

		const eventRows = db
			.prepare('SELECT type FROM events WHERE run_id = ? ORDER BY seq ASC;')
			.all(queuedRun.id) as Array<{ type: string }>;
		expect(eventRows.map((event) => event.type)).toEqual([
			'workflow_scheduled',
			'step_scheduled',
			'step_started',
			'step_succeeded',
			'step_scheduled',
			'step_started',
			'step_succeeded',
			'step_scheduled',
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
  extracted: artifacts.answer_text
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
		const workflowHash = hashTemplate(rootDir, sourcePath);

		registerWorkflow(db, {
			hash: workflowHash,
			id: 'test.resume',
			sourcePath,
			version: 1,
		});
		const queuedRun = createRun(
			db,
			'test.resume',
			{},
			{
				workflowHash,
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

		const finishedRun = await executeRun(
			queuedRun.id,
			{
				claimEpoch: 1,
				workerId: 'worker-2',
			},
			{
				db,
				executors: new ExecutorRegistry([new ArtifactExecutor()]),
				rootDir,
			},
		);

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
		const workflowHash = hashTemplate(rootDir, sourcePath);

		registerWorkflow(db, {
			hash: workflowHash,
			id: 'test.manual',
			sourcePath,
			version: 1,
		});
		const queuedRun = createRun(
			db,
			'test.manual',
			{},
			{
				workflowHash,
				workflowVersion: 1,
			},
		);
		const claimedRun = claimNextRun(db, 'worker-3', 30_000);
		expect(claimedRun?.id).toBe(queuedRun.id);

		const pausedRun = await executeRun(
			queuedRun.id,
			{
				claimEpoch: claimedRun?.claim_epoch ?? 1,
				workerId: 'worker-3',
			},
			{
				db,
				executors: new ExecutorRegistry([new ManualExecutor()]),
				rootDir,
			},
		);

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
			'workflow_scheduled',
			'step_scheduled',
			'step_started',
			'manual_waiting',
		]);

		db.close();
	});

	it('resumes an approved manual step without pausing the run again', async () => {
		const rootDir = createTempRoot();
		const db = openStorageDb({
			dbPath: path.join(rootDir, 'ergon.db'),
			migrationsDir: migrationsDir.pathname,
		});
		const sourcePath = writeTemplate(
			rootDir,
			`
workflow:
  id: test.manual.resume
  version: 1
steps:
  - id: gate
    kind: manual
    message: "Approve execution"
  - id: notify
    kind: notify
    channel: stdout
    message: "approved"
`,
		);
		const workflowHash = hashTemplate(rootDir, sourcePath);

		registerWorkflow(db, {
			hash: workflowHash,
			id: 'test.manual.resume',
			sourcePath,
			version: 1,
		});
		const queuedRun = createRun(
			db,
			'test.manual.resume',
			{},
			{
				workflowHash,
				workflowVersion: 1,
			},
		);
		const firstClaim = claimNextRun(db, 'worker-4', 30_000);
		expect(firstClaim?.id).toBe(queuedRun.id);

		const pausedRun = await executeRun(
			queuedRun.id,
			{
				claimEpoch: firstClaim?.claim_epoch ?? 1,
				workerId: 'worker-4',
			},
			{
				db,
				executors: new ExecutorRegistry([new ManualExecutor()]),
				rootDir,
			},
		);

		expect(pausedRun?.status).toBe('waiting_manual');
		const waitingStepRun = listStepRuns(db, queuedRun.id)[0];
		expect(waitingStepRun?.status).toBe('waiting_manual');

		appendEvent(
			db,
			queuedRun.id,
			'manual_approved',
			{
				decision: 'approve',
				step_id: 'gate',
			},
			{
				actor: 'cli:test-user',
				stepRunId: waitingStepRun?.id,
			},
		);
		expect(requeueRunFromManual(db, queuedRun.id)?.status).toBe('queued');
		const secondClaim = claimNextRun(db, 'worker-5', 30_000);
		expect(secondClaim?.id).toBe(queuedRun.id);

		const log = vi.fn();
		const resumedRun = await executeRun(
			queuedRun.id,
			{
				claimEpoch: secondClaim?.claim_epoch ?? 2,
				workerId: 'worker-5',
			},
			{
				db,
				executors: new ExecutorRegistry([
					new ManualExecutor(),
					new NotifyExecutor({ log }),
				]),
				rootDir,
			},
		);

		expect(resumedRun?.status).toBe('succeeded');
		expect(log).toHaveBeenCalledWith(
			`"[ergon-flow] workflow=test.manual.resume run=${queuedRun.id} step=notify channel=stdout\\napproved"`,
		);

		const stepRuns = listStepRuns(db, queuedRun.id);
		expect(
			stepRuns.map((stepRun) => [
				stepRun.step_id,
				stepRun.attempt,
				stepRun.status,
			]),
		).toEqual([
			['gate', 1, 'succeeded'],
			['notify', 1, 'succeeded'],
		]);

		const eventRows = db
			.prepare('SELECT type FROM events WHERE run_id = ? ORDER BY seq ASC;')
			.all(queuedRun.id) as Array<{ type: string }>;
		expect(eventRows.map((event) => event.type)).toEqual([
			'workflow_scheduled',
			'step_scheduled',
			'step_started',
			'manual_waiting',
			'manual_approved',
			'step_succeeded',
			'step_scheduled',
			'step_started',
			'step_succeeded',
			'workflow_succeeded',
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
		const workflowHash = hashTemplate(rootDir, sourcePath);

		registerWorkflow(db, {
			hash: workflowHash,
			id: 'test.failed',
			sourcePath,
			version: 1,
		});
		const queuedRun = createRun(
			db,
			'test.failed',
			{},
			{
				workflowHash,
				workflowVersion: 1,
			},
		);
		const claimedRun = claimNextRun(db, 'worker-4', 30_000);
		expect(claimedRun?.id).toBe(queuedRun.id);

		await expect(
			executeRun(
				queuedRun.id,
				{
					claimEpoch: claimedRun?.claim_epoch ?? 1,
					workerId: 'worker-4',
				},
				{
					db,
					executors: new ExecutorRegistry([new ThrowingExecExecutor()]),
					rootDir,
				},
			),
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
			'workflow_scheduled',
			'step_scheduled',
			'step_started',
			'step_failed',
			'workflow_failed',
		]);

		db.close();
	});

	it('rejects workflow source_path that escapes the workspace root', async () => {
		const rootDir = createTempRoot();
		const db = openStorageDb({
			dbPath: path.join(rootDir, 'ergon.db'),
			migrationsDir: migrationsDir.pathname,
		});

		registerWorkflow(db, {
			hash: 'hash-unsafe-path',
			id: 'test.unsafe.source-path',
			sourcePath: '../outside.yaml',
			version: 1,
		});
		const queuedRun = createRun(
			db,
			'test.unsafe.source-path',
			{},
			{
				workflowHash: 'hash-unsafe-path',
				workflowVersion: 1,
			},
		);
		const claimedRun = claimNextRun(db, 'worker-5', 30_000);
		expect(claimedRun?.id).toBe(queuedRun.id);

		await expect(
			executeRun(
				queuedRun.id,
				{
					claimEpoch: claimedRun?.claim_epoch ?? 1,
					workerId: 'worker-5',
				},
				{
					db,
					executors: new ExecutorRegistry(),
					rootDir,
				},
			),
		).rejects.toThrow('Unsafe workflow source_path');

		db.close();
	});

	it('rejects artifact names that attempt path traversal', async () => {
		const rootDir = createTempRoot();
		const db = openStorageDb({
			dbPath: path.join(rootDir, 'ergon.db'),
			migrationsDir: migrationsDir.pathname,
		});
		const sourcePath = writeTemplate(
			rootDir,
			`
workflow:
  id: test.unsafe.artifact
  version: 1
steps:
  - id: explode
    kind: exec
    command: "echo unsafe"
`,
		);
		const workflowHash = hashTemplate(rootDir, sourcePath);

		registerWorkflow(db, {
			hash: workflowHash,
			id: 'test.unsafe.artifact',
			sourcePath,
			version: 1,
		});
		const queuedRun = createRun(
			db,
			'test.unsafe.artifact',
			{},
			{
				workflowHash,
				workflowVersion: 1,
			},
		);
		const claimedRun = claimNextRun(db, 'worker-6', 30_000);
		expect(claimedRun?.id).toBe(queuedRun.id);

		await expect(
			executeRun(
				queuedRun.id,
				{
					claimEpoch: claimedRun?.claim_epoch ?? 1,
					workerId: 'worker-6',
				},
				{
					db,
					executors: new ExecutorRegistry([new MaliciousArtifactExecutor()]),
					rootDir,
				},
			),
		).rejects.toThrow('Unsafe path artifact name');

		db.close();
	});

	it('skips dependents when a dependency has already failed', async () => {
		const rootDir = createTempRoot();
		const db = openStorageDb({
			dbPath: path.join(rootDir, 'ergon.db'),
			migrationsDir: migrationsDir.pathname,
		});
		const sourcePath = writeTemplate(
			rootDir,
			`
workflow:
  id: test.skip.failed
  version: 1
steps:
  - id: build
    kind: exec
    command: "echo build"
  - id: notify
    kind: notify
    depends_on: [build]
    channel: stdout
    message: "should skip"
`,
		);
		const workflowHash = hashTemplate(rootDir, sourcePath);

		registerWorkflow(db, {
			hash: workflowHash,
			id: 'test.skip.failed',
			sourcePath,
			version: 1,
		});
		const queuedRun = createRun(
			db,
			'test.skip.failed',
			{},
			{
				workflowHash,
				workflowVersion: 1,
			},
		);
		const claimedRun = claimNextRun(db, 'worker-7', 30_000);
		expect(claimedRun?.id).toBe(queuedRun.id);

		const priorStepRun = createStepRun(db, queuedRun.id, 'build', 1, 'exec', {
			request: { command: 'echo build' },
		});
		updateStepRunStatus(db, priorStepRun.id, 'failed', {
			errorMessage: 'failed before resume',
			finishedAt: new Date().toISOString(),
			startedAt: new Date().toISOString(),
		});
		updateRunCursor(
			db,
			queuedRun.id,
			'worker-7',
			claimedRun?.claim_epoch ?? 1,
			1,
			'notify',
		);

		const pausedRun = await executeRun(
			queuedRun.id,
			{
				claimEpoch: claimedRun?.claim_epoch ?? 1,
				workerId: 'worker-7',
			},
			{
				db,
				executors: new ExecutorRegistry([new NotifyExecutor({ log: vi.fn() })]),
				rootDir,
			},
		);

		expect(pausedRun?.status).toBe('succeeded');
		const stepRuns = listStepRuns(db, queuedRun.id);
		expect(
			stepRuns.map((stepRun) => [stepRun.step_id, stepRun.status]),
		).toEqual([
			['build', 'failed'],
			['notify', 'skipped'],
		]);

		db.close();
	});

	it('retries a step and succeeds on a later attempt', async () => {
		const rootDir = createTempRoot();
		const db = openStorageDb({
			dbPath: path.join(rootDir, 'ergon.db'),
			migrationsDir: migrationsDir.pathname,
		});
		const sourcePath = writeTemplate(
			rootDir,
			`
workflow:
  id: test.retry.success
  version: 1
steps:
  - id: flaky
    kind: exec
    command: "echo retry"
    retry:
      max_attempts: 2
`,
		);
		const workflowHash = hashTemplate(rootDir, sourcePath);

		registerWorkflow(db, {
			hash: workflowHash,
			id: 'test.retry.success',
			sourcePath,
			version: 1,
		});
		const queuedRun = createRun(
			db,
			'test.retry.success',
			{},
			{
				workflowHash,
				workflowVersion: 1,
			},
		);
		const claimedRun = claimNextRun(db, 'worker-8', 30_000);
		expect(claimedRun?.id).toBe(queuedRun.id);

		const finishedRun = await executeRun(
			queuedRun.id,
			{
				claimEpoch: claimedRun?.claim_epoch ?? 1,
				workerId: 'worker-8',
			},
			{
				db,
				executors: new ExecutorRegistry([new FlakyExecExecutor()]),
				rootDir,
			},
		);

		expect(finishedRun?.status).toBe('succeeded');
		const stepRuns = listStepRuns(db, queuedRun.id);
		expect(
			stepRuns.map((stepRun) => [
				stepRun.step_id,
				stepRun.attempt,
				stepRun.status,
				stepRun.error_code,
			]),
		).toEqual([
			['flaky', 1, 'failed', 'exec_failed'],
			['flaky', 2, 'succeeded', null],
		]);

		const eventRows = db
			.prepare('SELECT type FROM events WHERE run_id = ? ORDER BY seq ASC;')
			.all(queuedRun.id) as Array<{ type: string }>;
		expect(eventRows.map((event) => event.type)).toEqual([
			'workflow_scheduled',
			'step_scheduled',
			'step_started',
			'step_failed',
			'step_retry',
			'step_scheduled',
			'step_started',
			'step_succeeded',
			'workflow_succeeded',
		]);

		db.close();
	});

	it('does not retry when the failure category is not allowed', async () => {
		const rootDir = createTempRoot();
		const db = openStorageDb({
			dbPath: path.join(rootDir, 'ergon.db'),
			migrationsDir: migrationsDir.pathname,
		});
		const sourcePath = writeTemplate(
			rootDir,
			`
workflow:
  id: test.retry.filtered
  version: 1
steps:
  - id: flaky
    kind: exec
    command: "echo retry"
    retry:
      max_attempts: 3
      on: [provider_error]
`,
		);
		const workflowHash = hashTemplate(rootDir, sourcePath);

		registerWorkflow(db, {
			hash: workflowHash,
			id: 'test.retry.filtered',
			sourcePath,
			version: 1,
		});
		const queuedRun = createRun(
			db,
			'test.retry.filtered',
			{},
			{
				workflowHash,
				workflowVersion: 1,
			},
		);
		const claimedRun = claimNextRun(db, 'worker-9', 30_000);
		expect(claimedRun?.id).toBe(queuedRun.id);

		await expect(
			executeRun(
				queuedRun.id,
				{
					claimEpoch: claimedRun?.claim_epoch ?? 1,
					workerId: 'worker-9',
				},
				{
					db,
					executors: new ExecutorRegistry([new ThrowingExecExecutor()]),
					rootDir,
				},
			),
		).rejects.toThrow('boom:flaky');

		const stepRuns = listStepRuns(db, queuedRun.id);
		expect(stepRuns).toHaveLength(1);
		expect(stepRuns[0]?.attempt).toBe(1);
		expect(stepRuns[0]?.error_code).toBe('exec_failed');

		db.close();
	});

	it('fails after exhausting max_attempts for failed executor results', async () => {
		const rootDir = createTempRoot();
		const db = openStorageDb({
			dbPath: path.join(rootDir, 'ergon.db'),
			migrationsDir: migrationsDir.pathname,
		});
		const sourcePath = writeTemplate(
			rootDir,
			`
workflow:
  id: test.retry.exhausted
  version: 1
steps:
  - id: unstable
    kind: exec
    command: "echo retry"
    retry:
      max_attempts: 2
`,
		);
		const workflowHash = hashTemplate(rootDir, sourcePath);

		registerWorkflow(db, {
			hash: workflowHash,
			id: 'test.retry.exhausted',
			sourcePath,
			version: 1,
		});
		const queuedRun = createRun(
			db,
			'test.retry.exhausted',
			{},
			{
				workflowHash,
				workflowVersion: 1,
			},
		);
		const claimedRun = claimNextRun(db, 'worker-10', 30_000);
		expect(claimedRun?.id).toBe(queuedRun.id);

		await expect(
			executeRun(
				queuedRun.id,
				{
					claimEpoch: claimedRun?.claim_epoch ?? 1,
					workerId: 'worker-10',
				},
				{
					db,
					executors: new ExecutorRegistry([new FailedStatusExecExecutor()]),
					rootDir,
				},
			),
		).rejects.toThrow('returned status failed');

		const failedRun = db
			.prepare('SELECT status, error_code FROM workflow_runs WHERE id = ?;')
			.get(queuedRun.id) as { error_code: string; status: string };
		expect(failedRun).toEqual({
			error_code: 'exec_failed',
			status: 'failed',
		});

		const stepRuns = listStepRuns(db, queuedRun.id);
		expect(
			stepRuns.map((stepRun) => [
				stepRun.attempt,
				stepRun.status,
				stepRun.error_code,
			]),
		).toEqual([
			[1, 'failed', 'exec_failed'],
			[2, 'failed', 'exec_failed'],
		]);

		const eventRows = db
			.prepare('SELECT type FROM events WHERE run_id = ? ORDER BY seq ASC;')
			.all(queuedRun.id) as Array<{ type: string }>;
		expect(eventRows.map((event) => event.type)).toEqual([
			'workflow_scheduled',
			'step_scheduled',
			'step_started',
			'step_failed',
			'step_retry',
			'step_scheduled',
			'step_started',
			'step_failed',
			'workflow_failed',
		]);

		db.close();
	});

	it('does not crash when retry metadata contains circular values', async () => {
		const rootDir = createTempRoot();
		const db = openStorageDb({
			dbPath: path.join(rootDir, 'ergon.db'),
			migrationsDir: migrationsDir.pathname,
		});
		const sourcePath = writeTemplate(
			rootDir,
			`
workflow:
  id: test.retry.circular
  version: 1
steps:
  - id: unstable
    kind: exec
    command: "echo retry"
    retry:
      max_attempts: 2
`,
		);
		const workflowHash = hashTemplate(rootDir, sourcePath);

		registerWorkflow(db, {
			hash: workflowHash,
			id: 'test.retry.circular',
			sourcePath,
			version: 1,
		});
		const queuedRun = createRun(
			db,
			'test.retry.circular',
			{},
			{
				workflowHash,
				workflowVersion: 1,
			},
		);
		const claimedRun = claimNextRun(db, 'worker-11', 30_000);
		expect(claimedRun?.id).toBe(queuedRun.id);

		await expect(
			executeRun(
				queuedRun.id,
				{
					claimEpoch: claimedRun?.claim_epoch ?? 1,
					workerId: 'worker-11',
				},
				{
					db,
					executors: new ExecutorRegistry([
						new CircularFailedStatusExecExecutor(),
					]),
					rootDir,
				},
			),
		).rejects.toThrow('returned status failed');

		const stepRuns = listStepRuns(db, queuedRun.id);
		expect(stepRuns).toHaveLength(2);
		expect(stepRuns[0]?.output_json).toContain('[Circular]');

		db.close();
	});

	it('aborts cleanly before the next step when the run is canceled', async () => {
		const rootDir = createTempRoot();
		const db = openStorageDb({
			dbPath: path.join(rootDir, 'ergon.db'),
			migrationsDir: migrationsDir.pathname,
		});
		const sourcePath = writeTemplate(
			rootDir,
			`
workflow:
  id: test.cancel.before-next-step
  version: 1
steps:
  - id: cancel-me
    kind: exec
    command: "echo first"
  - id: notify
    kind: notify
    channel: stdout
    message: "should never run"
`,
		);
		const workflowHash = hashTemplate(rootDir, sourcePath);

		registerWorkflow(db, {
			hash: workflowHash,
			id: 'test.cancel.before-next-step',
			sourcePath,
			version: 1,
		});
		const queuedRun = createRun(
			db,
			'test.cancel.before-next-step',
			{},
			{
				workflowHash,
				workflowVersion: 1,
			},
		);
		const claimedRun = claimNextRun(db, 'worker-12', 30_000);
		expect(claimedRun?.id).toBe(queuedRun.id);

		const log = vi.fn();
		const canceledRun = await executeRun(
			queuedRun.id,
			{
				claimEpoch: claimedRun?.claim_epoch ?? 1,
				workerId: 'worker-12',
			},
			{
				db,
				executors: new ExecutorRegistry([
					new CancelingExecExecutor(
						db,
						claimedRun?.claim_epoch ?? 1,
						queuedRun.id,
						'worker-12',
					),
					new NotifyExecutor({ log }),
				]),
				rootDir,
			},
		);

		expect(canceledRun?.status).toBe('canceled');
		expect(canceledRun?.current_step_id).toBe('cancel-me');
		expect(canceledRun?.current_step_index).toBe(0);

		const stepRuns = listStepRuns(db, queuedRun.id);
		expect(
			stepRuns.map((stepRun) => [stepRun.step_id, stepRun.status]),
		).toEqual([['cancel-me', 'failed']]);
		expect(log).not.toHaveBeenCalled();

		const eventRows = db
			.prepare('SELECT type FROM events WHERE run_id = ? ORDER BY seq ASC;')
			.all(queuedRun.id) as Array<{ type: string }>;
		expect(eventRows.map((event) => event.type)).toEqual([
			'workflow_scheduled',
			'step_scheduled',
			'step_started',
			'workflow_canceled',
			'step_failed',
		]);

		db.close();
	});

	it('does not append duplicate workflow_canceled events', async () => {
		const rootDir = createTempRoot();
		const db = openStorageDb({
			dbPath: path.join(rootDir, 'ergon.db'),
			migrationsDir: migrationsDir.pathname,
		});
		const sourcePath = writeTemplate(
			rootDir,
			`
workflow:
  id: test.cancel.single-event
  version: 1
steps:
  - id: cancel-me
    kind: exec
    command: "echo first"
  - id: notify
    kind: notify
    channel: stdout
    message: "should never run"
`,
		);
		const workflowHash = hashTemplate(rootDir, sourcePath);

		registerWorkflow(db, {
			hash: workflowHash,
			id: 'test.cancel.single-event',
			sourcePath,
			version: 1,
		});
		const queuedRun = createRun(
			db,
			'test.cancel.single-event',
			{},
			{
				workflowHash,
				workflowVersion: 1,
			},
		);
		const claimedRun = claimNextRun(db, 'worker-13', 30_000);
		expect(claimedRun?.id).toBe(queuedRun.id);

		appendEvent(
			db,
			queuedRun.id,
			'workflow_canceled',
			{
				reason: 'external_cancel',
			},
			{
				actor: 'worker:external',
			},
		);

		await executeRun(
			queuedRun.id,
			{
				claimEpoch: claimedRun?.claim_epoch ?? 1,
				workerId: 'worker-13',
			},
			{
				db,
				executors: new ExecutorRegistry([
					new CancelingExecExecutor(
						db,
						claimedRun?.claim_epoch ?? 1,
						queuedRun.id,
						'worker-13',
					),
					new NotifyExecutor({ log: vi.fn() }),
				]),
				rootDir,
			},
		);

		const eventRows = db
			.prepare(
				"SELECT type, payload_json FROM events WHERE run_id = ? AND type = 'workflow_canceled' ORDER BY seq ASC;",
			)
			.all(queuedRun.id) as Array<{ payload_json: string; type: string }>;
		expect(eventRows).toHaveLength(1);
		expect(JSON.parse(eventRows[0]?.payload_json ?? '{}')).toEqual({
			reason: 'external_cancel',
		});

		db.close();
	});
});
