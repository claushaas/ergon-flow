import { hostname as resolveHostname } from 'node:os';
import type { DatabaseSync } from 'node:sqlite';
import {
	appendEvent,
	claimNextRun,
	getRun,
	heartbeatWorker,
	markRunFailed,
	registerWorker,
	renewLease,
	type WorkflowRunRow,
} from '@ergon/storage';
import { executeRun } from './runner.js';
import type { ExecutorRegistry } from './executors/index.js';

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

function delay(ms: number): Promise<void> {
	return new Promise((resolve) => {
		setTimeout(resolve, ms);
	});
}

function normalizeInterval(value: number | undefined, fallback: number): number {
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

function startHeartbeatLoop(
	options: Required<
		Pick<StartWorkerOptions, 'db' | 'workerId'>
	> & {
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
	appendEvent(
		options.db,
		run.id,
		'workflow_started',
		{
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
