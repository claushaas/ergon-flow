import {
	appendEvent,
	failRunFromManual,
	getRun,
	getWaitingManualStepRun,
	openStorageDb,
	requeueRunFromManual,
	updateStepRunStatus,
} from '@ergon/storage';
import { loadCliConfig } from '../config/index.js';
import { printJson } from '../output/format.js';
import { assertValidStepId } from '../utils.js';

export type ManualDecision = 'approve' | 'reject';

export interface ApproveCommandOptions {
	dbPath?: string;
	decision: string;
	rootDir?: string;
}

function assertManualDecision(value: string): ManualDecision {
	if (value !== 'approve' && value !== 'reject') {
		throw new Error(
			`Invalid decision "${value}". Expected "approve" or "reject".`,
		);
	}

	return value;
}

function resolveCliActor(): string {
	const username =
		process.env.USER?.trim() || process.env.USERNAME?.trim() || 'unknown';
	return `cli:${username}`;
}

export function decideManualStep(
	runId: string,
	stepId: string,
	commandOptions: ApproveCommandOptions,
) {
	const config = loadCliConfig(commandOptions.rootDir);
	const db = openStorageDb({
		dbPath: commandOptions.dbPath ?? config.dbPath,
	});

	try {
		const decision = assertManualDecision(commandOptions.decision);
		const normalizedStepId = assertValidStepId(stepId);
		const run = getRun(db, runId);
		if (!run) {
			throw new Error(`Workflow run "${runId}" was not found`);
		}
		if (run.status !== 'waiting_manual') {
			throw new Error(
				`Workflow run "${runId}" is not waiting for manual approval`,
			);
		}
		if (run.current_step_id !== normalizedStepId) {
			throw new Error(
				`Workflow run "${runId}" is waiting on step "${run.current_step_id ?? 'unknown'}", not "${normalizedStepId}"`,
			);
		}

		const waitingStepRun = getWaitingManualStepRun(db, runId, normalizedStepId);
		if (!waitingStepRun) {
			throw new Error(
				`Manual step "${normalizedStepId}" is not waiting for approval on run "${runId}"`,
			);
		}

		const actor = resolveCliActor();
		const decisionAt = new Date().toISOString();
		const payload = {
			decision,
			run_id: runId,
			step_id: normalizedStepId,
			step_run_id: waitingStepRun.id,
		};

		appendEvent(
			db,
			runId,
			decision === 'approve' ? 'manual_approved' : 'manual_rejected',
			payload,
			{
				actor,
				stepRunId: waitingStepRun.id,
				ts: decisionAt,
			},
		);

		if (decision === 'approve') {
			const queuedRun = requeueRunFromManual(db, runId);
			if (!queuedRun) {
				throw new Error(
					`Workflow run "${runId}" could not be requeued after approval`,
				);
			}

			return {
				decision,
				run: queuedRun,
				stepRunId: waitingStepRun.id,
			};
		}

		const errorMessage = `Manual step "${normalizedStepId}" was rejected`;
		updateStepRunStatus(db, waitingStepRun.id, 'failed', {
			errorCode: 'manual_rejected',
			errorDetail: {
				actor,
			},
			errorMessage,
			finishedAt: decisionAt,
			output: {
				actor,
				decided_at: decisionAt,
				decision: 'reject',
			},
		});
		appendEvent(
			db,
			runId,
			'step_failed',
			{
				error_code: 'manual_rejected',
				message: errorMessage,
				step_id: normalizedStepId,
			},
			{
				actor,
				stepRunId: waitingStepRun.id,
				ts: decisionAt,
			},
		);
		const failedRun = failRunFromManual(db, runId, {
			errorCode: 'manual_rejected',
			errorDetail: {
				actor,
				step_id: normalizedStepId,
				step_run_id: waitingStepRun.id,
			},
			errorMessage,
			finishedAt: decisionAt,
		});
		if (!failedRun) {
			throw new Error(
				`Workflow run "${runId}" could not be marked as failed after rejection`,
			);
		}
		appendEvent(
			db,
			runId,
			'workflow_failed',
			{
				error_code: 'manual_rejected',
				message: errorMessage,
			},
			{
				actor,
				ts: decisionAt,
			},
		);

		return {
			decision,
			run: failedRun,
			stepRunId: waitingStepRun.id,
		};
	} finally {
		db.close();
	}
}

export function runApproveCommand(
	runId: string,
	stepId: string,
	commandOptions: ApproveCommandOptions,
): void {
	printJson(decideManualStep(runId, stepId, commandOptions));
}
