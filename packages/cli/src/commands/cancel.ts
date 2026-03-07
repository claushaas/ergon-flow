import { cancelRun, openStorageDb } from '@claushaas/ergon-storage';
import { loadCliConfig } from '../config/index.js';
import { printJson } from '../output/format.js';
import { assertInitializedProject } from '../project.js';

export interface CancelCommandOptions {
	dbPath?: string;
	rootDir?: string;
}

function resolveCliActor(): string {
	const username =
		process.env.USER?.trim() || process.env.USERNAME?.trim() || 'unknown';
	return `cli:${username}`;
}

export function cancelWorkflowRun(
	runId: string,
	commandOptions: CancelCommandOptions = {},
) {
	const config = loadCliConfig(commandOptions.rootDir);
	assertInitializedProject(config, 'cancel');
	const db = openStorageDb({
		dbPath: commandOptions.dbPath ?? config.dbPath,
	});

	try {
		return cancelRun(db, runId, {
			actor: resolveCliActor(),
		});
	} finally {
		db.close();
	}
}

export function runCancelCommand(
	runId: string,
	commandOptions: CancelCommandOptions = {},
): void {
	printJson(cancelWorkflowRun(runId, commandOptions));
}
