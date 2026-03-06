import { randomUUID } from 'node:crypto';
import { createDefaultExecutorRegistry, startWorker } from '@ergon/engine';
import { openStorageDb } from '@ergon/storage';
import { loadCliConfig } from '../config/index.js';

export interface WorkerCommandOptions {
	artifactBaseDir?: string;
	dbPath?: string;
	heartbeatIntervalMs?: number;
	leaseDurationMs?: number;
	leaseRenewIntervalMs?: number;
	maxPollIntervalMs?: number;
	maxRuns?: number;
	pollIntervalMs?: number;
	rootDir?: string;
	workerId?: string;
}

function parseNumericFlag(
	value: string | undefined,
	flagName: string,
): number | undefined {
	if (value === undefined) {
		return undefined;
	}
	const parsed = Number.parseInt(value, 10);
	if (!Number.isFinite(parsed)) {
		throw new Error(`Invalid numeric value for ${flagName}: ${value}`);
	}
	return parsed;
}

export function parseWorkerCommandArgs(argv: string[]): WorkerCommandOptions {
	const options: WorkerCommandOptions = {};

	for (let index = 0; index < argv.length; index += 1) {
		const token = argv[index];
		const nextValue = argv[index + 1];

		switch (token) {
			case '--artifact-base-dir':
				options.artifactBaseDir = nextValue;
				index += 1;
				break;
			case '--db':
				options.dbPath = nextValue;
				index += 1;
				break;
			case '--heartbeat-interval-ms':
				options.heartbeatIntervalMs = parseNumericFlag(
					nextValue,
					'--heartbeat-interval-ms',
				);
				index += 1;
				break;
			case '--lease-duration-ms':
				options.leaseDurationMs = parseNumericFlag(
					nextValue,
					'--lease-duration-ms',
				);
				index += 1;
				break;
			case '--lease-renew-interval-ms':
				options.leaseRenewIntervalMs = parseNumericFlag(
					nextValue,
					'--lease-renew-interval-ms',
				);
				index += 1;
				break;
			case '--max-poll-interval-ms':
				options.maxPollIntervalMs = parseNumericFlag(
					nextValue,
					'--max-poll-interval-ms',
				);
				index += 1;
				break;
			case '--max-runs':
				options.maxRuns = parseNumericFlag(nextValue, '--max-runs');
				index += 1;
				break;
			case '--poll-interval-ms':
				options.pollIntervalMs = parseNumericFlag(
					nextValue,
					'--poll-interval-ms',
				);
				index += 1;
				break;
			case '--root-dir':
				options.rootDir = nextValue;
				index += 1;
				break;
			case '--worker-id':
				options.workerId = nextValue;
				index += 1;
				break;
			default:
				throw new Error(`Unknown worker option: ${token}`);
		}
	}

	return options;
}

export async function runWorkerCommand(
	commandOptions: WorkerCommandOptions = {},
): Promise<void> {
	const config = loadCliConfig(commandOptions.rootDir);
	const db = openStorageDb({
		dbPath: commandOptions.dbPath ?? config.dbPath,
	});

	try {
		const workerId = commandOptions.workerId ?? `worker-${randomUUID()}`;
		const executors = createDefaultExecutorRegistry({
			providerConfigs: config.providerConfigs,
		});

		const result = await startWorker({
			artifactBaseDir: commandOptions.artifactBaseDir ?? config.rootDir,
			db,
			executors,
			heartbeatIntervalMs: commandOptions.heartbeatIntervalMs,
			leaseDurationMs: commandOptions.leaseDurationMs,
			leaseRenewIntervalMs: commandOptions.leaseRenewIntervalMs,
			maxPollIntervalMs: commandOptions.maxPollIntervalMs,
			maxRuns: commandOptions.maxRuns,
			pollIntervalMs: commandOptions.pollIntervalMs,
			rootDir: commandOptions.rootDir ?? config.rootDir,
			workerId,
		});

		console.log(
			JSON.stringify({
				dbPath: commandOptions.dbPath ?? config.dbPath,
				processed_runs: result.processedRuns,
				worker_id: result.workerId,
			}),
		);
	} finally {
		db.close();
	}
}
