import { hostname as resolveHostname } from 'node:os';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import type {
	ErrorCode,
	StepDefinition,
	WorkflowTemplate,
} from '@ergon/shared';
import {
	appendEvent,
	claimNextRun,
	getRun,
	getWorkflow,
	heartbeatWorker,
	listStepRuns,
	markRunFailed,
	registerWorker,
	renewLease,
	updateStepRunStatus,
	type WorkflowRunRow,
} from '@ergon/storage';
import type { ExecutorRegistry } from './executors/index.js';
import { executeRun } from './runner.js';
import { loadAndValidateTemplateFromFile } from './templating/index.js';

export interface StartWorkerOptions {
	artifactBaseDir?: string;
	db: DatabaseSync;
	executors: ExecutorRegistry;
	heartbeatIntervalMs?: number;
	hostname?: string;
	leaseDurationMs?: number;
	leaseRenewIntervalMs?: number;
	maxPollIntervalMs?: number;
	maxRuns?: number;
	metadata?: Record<string, unknown>;
	pid?: number;
	pollIntervalMs?: number;
	rootDir?: string;
	signal?: AbortSignal;
	sleep?: (ms: number) => Promise<void>;
	workerId: string;
}

export interface WorkerRunResult {
	processedRuns: number;
	workerId: string;
}

const DEFAULT_HEARTBEAT_INTERVAL_MS = 5_000;
const DEFAULT_LEASE_DURATION_MS = 30_000;
const DEFAULT_POLL_INTERVAL_MS = 1_000;

function resolvePathWithinBase(
	baseDir: string,
	unsafePath: string,
	label: string,
): string {
	if (path.isAbsolute(unsafePath)) {
		throw new Error(`Unsafe ${label}: absolute paths are not allowed`);
	}

	const resolvedBase = path.resolve(baseDir);
	const resolvedPath = path.resolve(resolvedBase, unsafePath);
	const relative = path.relative(resolvedBase, resolvedPath);
	if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
		throw new Error(`Unsafe ${label}: path escapes base directory`);
	}

	return resolvedPath;
}

function delay(ms: number): Promise<void> {
	return new Promise((resolve) => {
		setTimeout(resolve, ms);
	});
}

function normalizeInterval(
	value: number | undefined,
	fallback: number,
): number {
	if (value === undefined) {
		return fallback;
	}
	return Math.max(1, Math.trunc(value));
}

function isAbortError(error: unknown): boolean {
	return error instanceof Error && error.name === 'AbortError';
}

function describeError(error: unknown): {
	detail: Record<string, unknown>;
	message: string;
} {
	if (error instanceof Error) {
		return {
			detail: {
				name: error.name,
			},
			message: error.message,
		};
	}

	return {
		detail: {
			value: String(error),
		},
		message: 'Worker execution failed',
	};
}

function createWorkerActor(workerId: string): string {
	return `worker:${workerId}`;
}

function getFailureCodeForStep(step: StepDefinition): ErrorCode {
	switch (step.kind) {
		case 'agent':
		case 'notify':
			return 'provider_error';
		case 'artifact':
			return 'artifact_failed';
		case 'condition':
			return 'condition_failed';
		case 'exec':
			return 'exec_failed';
		case 'manual':
			return 'manual_rejected';
		default:
			return 'schema_invalid';
	}
}

function canRetryRecoveredStep(step: StepDefinition, attempt: number): boolean {
	const retry = step.retry;
	if (!retry) {
		return false;
	}

	const maxAttempts = Math.max(1, Math.trunc(retry.max_attempts));
	if (attempt >= maxAttempts) {
		return false;
	}

	const failureCode = getFailureCodeForStep(step);
	if (!retry.on || retry.on.length === 0) {
		return true;
	}

	return retry.on.includes(failureCode);
}

function loadTemplateForRun(
	db: DatabaseSync,
	run: WorkflowRunRow,
	rootDir: string,
): WorkflowTemplate {
	const workflow = getWorkflow(db, run.workflow_id, run.workflow_version);
	if (!workflow) {
		throw new Error(
			`Workflow "${run.workflow_id}"@${run.workflow_version} was not found`,
		);
	}

	const templatePath = resolvePathWithinBase(
		rootDir,
		workflow.source_path,
		'workflow source_path',
	);

	return loadAndValidateTemplateFromFile(templatePath).template;
}

function getStepToRecover(
	template: WorkflowTemplate,
	run: WorkflowRunRow,
	stepId: string,
): StepDefinition {
	const step = template.steps.find((entry) => entry.id === stepId);
	if (!step) {
		throw new Error(
			`Workflow run "${run.id}" could not resolve recovery step "${stepId}" from the current workflow version. The workflow may have been updated.`,
		);
	}
	return step;
}

function recoverExpiredLeaseStep(
	db: DatabaseSync,
	run: WorkflowRunRow,
	workerId: string,
	rootDir: string,
): ReturnType<typeof getRun> {
	if (run.attempt <= 0) {
		return null;
	}

	const runningStepRun = listStepRuns(db, run.id)
		.filter((stepRun) => stepRun.status === 'running')
		.at(-1);
	if (!runningStepRun) {
		return null;
	}

	const template = loadTemplateForRun(db, run, rootDir);
	const step = getStepToRecover(template, run, runningStepRun.step_id);
	const failureCode = getFailureCodeForStep(step);
	const failureMessage = `Step "${step.id}" lost its lease while running`;
	const failureDetail = {
		reason: 'lease_expired',
		recovered_by: workerId,
		stale_attempt: runningStepRun.attempt,
		step_id: step.id,
	};

	updateStepRunStatus(db, runningStepRun.id, 'failed', {
		errorCode: failureCode,
		errorDetail: failureDetail,
		errorMessage: failureMessage,
		finishedAt: new Date().toISOString(),
	});
	appendEvent(
		db,
		run.id,
		'step_failed',
		{
			error_code: failureCode,
			error_message: failureMessage,
			recovered_from_expired_lease: true,
			step_id: step.id,
		},
		{
			actor: createWorkerActor(workerId),
			stepRunId: runningStepRun.id,
		},
	);

	if (canRetryRecoveredStep(step, runningStepRun.attempt)) {
		appendEvent(
			db,
			run.id,
			'step_retry',
			{
				error_code: failureCode,
				next_attempt: runningStepRun.attempt + 1,
				recovered_from_expired_lease: true,
				step_id: step.id,
			},
			{
				actor: createWorkerActor(workerId),
				stepRunId: runningStepRun.id,
			},
		);
		return getRun(db, run.id);
	}

	appendEvent(
		db,
		run.id,
		'workflow_failed',
		{
			error_code: failureCode,
			error_message: failureMessage,
			recovered_from_expired_lease: true,
			step_id: step.id,
		},
		{
			actor: createWorkerActor(workerId),
		},
	);
	markRunFailed(db, run.id, workerId, {
		errorCode: failureCode,
		errorDetail: failureDetail,
		errorMessage: failureMessage,
	});
	return getRun(db, run.id);
}

function startHeartbeatLoop(
	options: Required<Pick<StartWorkerOptions, 'db' | 'workerId'>> & {
		heartbeatIntervalMs: number;
		hostname: string;
		metadata?: Record<string, unknown>;
		pid: number;
	},
): NodeJS.Timeout {
	const timer = setInterval(() => {
		heartbeatWorker(options.db, {
			hostname: options.hostname,
			id: options.workerId,
			meta: options.metadata,
			pid: options.pid,
		});
	}, options.heartbeatIntervalMs);
	timer.unref?.();
	return timer;
}

function startLeaseRenewalLoop(
	db: DatabaseSync,
	run: WorkflowRunRow,
	workerId: string,
	leaseRenewIntervalMs: number,
	leaseDurationMs: number,
): NodeJS.Timeout {
	let renewing = false;
	const timer = setInterval(async () => {
		if (renewing) {
			return;
		}

		renewing = true;
		try {
			const renewedRun = renewLease(db, run.id, workerId, leaseDurationMs);
			if (!renewedRun) {
				clearInterval(timer);
				return;
			}

			appendEvent(
				db,
				run.id,
				'lease_renewed',
				{
					lease_until: renewedRun.lease_until,
					worker_id: workerId,
				},
				{
					actor: createWorkerActor(workerId),
				},
			);
		} finally {
			renewing = false;
		}
	}, leaseRenewIntervalMs);
	timer.unref?.();
	return timer;
}

async function executeClaimedRun(
	run: WorkflowRunRow,
	options: StartWorkerOptions,
	leaseRenewIntervalMs: number,
	leaseDurationMs: number,
): Promise<void> {
	const recoveredRun = recoverExpiredLeaseStep(
		options.db,
		run,
		options.workerId,
		path.resolve(options.rootDir ?? process.cwd()),
	);
	if (recoveredRun?.status === 'failed') {
		return;
	}

	appendEvent(
		options.db,
		run.id,
		'workflow_started',
		{
			recovered_from_expired_lease: run.attempt > 0,
			worker_id: options.workerId,
		},
		{
			actor: createWorkerActor(options.workerId),
		},
	);

	const renewalTimer = startLeaseRenewalLoop(
		options.db,
		run,
		options.workerId,
		leaseRenewIntervalMs,
		leaseDurationMs,
	);

	try {
		await executeRun(run.id, options.workerId, {
			artifactBaseDir: options.artifactBaseDir,
			db: options.db,
			executors: options.executors,
			rootDir: options.rootDir,
		});
	} catch (error) {
		const currentRun = getRun(options.db, run.id);
		if (
			currentRun &&
			currentRun.status === 'running' &&
			currentRun.claimed_by === options.workerId
		) {
			const { detail, message } = describeError(error);
			appendEvent(
				options.db,
				run.id,
				'workflow_failed',
				{
					error: detail,
				},
				{
					actor: createWorkerActor(options.workerId),
				},
			);
			markRunFailed(options.db, run.id, options.workerId, {
				errorCode: 'exec_failed',
				errorDetail: {
					...detail,
					stage: 'worker_runtime',
				},
				errorMessage: message,
			});
		}

		throw error;
	} finally {
		clearInterval(renewalTimer);
	}
}

export async function startWorker(
	options: StartWorkerOptions,
): Promise<WorkerRunResult> {
	const heartbeatIntervalMs = normalizeInterval(
		options.heartbeatIntervalMs,
		DEFAULT_HEARTBEAT_INTERVAL_MS,
	);
	const leaseDurationMs = normalizeInterval(
		options.leaseDurationMs,
		DEFAULT_LEASE_DURATION_MS,
	);
	const leaseRenewIntervalMs = normalizeInterval(
		options.leaseRenewIntervalMs,
		Math.max(1, Math.trunc(leaseDurationMs / 2)),
	);
	const pollIntervalMs = normalizeInterval(
		options.pollIntervalMs,
		DEFAULT_POLL_INTERVAL_MS,
	);
	const maxPollIntervalMs = normalizeInterval(
		options.maxPollIntervalMs,
		pollIntervalMs * 8,
	);
	const sleep = options.sleep ?? delay;
	const hostname = options.hostname ?? resolveHostname();
	const pid = options.pid ?? process.pid;

	registerWorker(options.db, {
		hostname,
		id: options.workerId,
		meta: options.metadata,
		pid,
	});

	const heartbeatTimer = startHeartbeatLoop({
		db: options.db,
		heartbeatIntervalMs,
		hostname,
		metadata: options.metadata,
		pid,
		workerId: options.workerId,
	});

	let processedRuns = 0;
	let currentBackoffMs = pollIntervalMs;

	try {
		while (!options.signal?.aborted) {
			if (
				options.maxRuns !== undefined &&
				processedRuns >= Math.max(0, options.maxRuns)
			) {
				break;
			}

			const claimedRun = claimNextRun(
				options.db,
				options.workerId,
				leaseDurationMs,
			);
			if (!claimedRun) {
				await sleep(currentBackoffMs);
				currentBackoffMs = Math.min(maxPollIntervalMs, currentBackoffMs * 2);
				continue;
			}

			currentBackoffMs = pollIntervalMs;
			await executeClaimedRun(
				claimedRun,
				options,
				leaseRenewIntervalMs,
				leaseDurationMs,
			);
			processedRuns += 1;
		}
	} catch (error) {
		if (!isAbortError(error)) {
			throw error;
		}
	} finally {
		clearInterval(heartbeatTimer);
	}

	return {
		processedRuns,
		workerId: options.workerId,
	};
}
