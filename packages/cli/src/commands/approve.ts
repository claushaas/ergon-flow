import {
	openStorageDb,
	decideManualStep as persistManualDecision,
} from '@claushaas/storage';
import { loadCliConfig } from '../config/index.js';
import { printJson } from '../output/format.js';
import { assertInitializedProject } from '../project.js';
import { assertValidStepId } from '../utils.js';

export type ManualDecision = 'approve' | 'reject';

export interface ApproveCommandOptions {
	dbPath?: string;
	decision: string;
	rootDir?: string;
}

export interface ParsedApproveCommandArgs {
	decision: string;
	stepId: string;
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

export function parseApproveCommandArgs(
	args: string[],
): ParsedApproveCommandArgs {
	const positionalArgs = [...args];
	const decisionIndex = positionalArgs.indexOf('--decision');
	let decision: string | undefined;

	if (decisionIndex >= 0) {
		const value = positionalArgs[decisionIndex + 1];
		if (!value || value.startsWith('--')) {
			throw new Error(
				'Missing value for "--decision". Expected "approve" or "reject".',
			);
		}

		decision = value;
		positionalArgs.splice(decisionIndex, 2);
	}

	if (!decision) {
		throw new Error(
			'Missing value for "--decision". Expected "approve" or "reject".',
		);
	}

	const stepId = positionalArgs[0];
	if (!stepId) {
		throw new Error('Missing required argument: <step_id>');
	}

	return {
		decision,
		stepId,
	};
}

export function decideManualStep(
	runId: string,
	stepId: string,
	commandOptions: ApproveCommandOptions,
) {
	const config = loadCliConfig(commandOptions.rootDir);
	assertInitializedProject(config, 'approve');
	const db = openStorageDb({
		dbPath: commandOptions.dbPath ?? config.dbPath,
	});

	try {
		const decision = assertManualDecision(commandOptions.decision);
		const normalizedStepId = assertValidStepId(stepId);
		return persistManualDecision(db, runId, normalizedStepId, decision, {
			actor: resolveCliActor(),
		});
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
