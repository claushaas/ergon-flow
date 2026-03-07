#!/usr/bin/env node

import {
	parseApproveCommandArgs,
	runApproveCommand,
} from './commands/approve.js';
import { runCancelCommand } from './commands/cancel.js';
import { runInitCommand } from './commands/init.js';
import { runLibrarySyncCommand } from './commands/library.js';
import { runRunCommand, runRunStatusCommand } from './commands/run.js';
import { runTemplateListCommand } from './commands/template.js';
import { parseWorkerCommandArgs, runWorkerCommand } from './commands/worker.js';
import { runWorkflowListCommand } from './commands/workflow.js';
import { getCliHelpText, getCliVersionText } from './help.js';

function readFlagValue(argv: string[], flagName: string): string | undefined {
	const flagIndex = argv.indexOf(flagName);
	if (flagIndex < 0) {
		return undefined;
	}

	const value = argv[flagIndex + 1];
	if (!value || value.startsWith('--')) {
		throw new Error(`Missing value for ${flagName}`);
	}

	return value;
}

async function main(argv: string[]): Promise<void> {
	const [command, subcommand, ...rest] = argv;

	if (!command || command === 'help' || command === '--help') {
		console.log(getCliHelpText());
		return;
	}
	if (command === 'version' || command === '--version') {
		console.log(getCliVersionText());
		return;
	}
	if (command === 'init') {
		runInitCommand({
			rootDir: readFlagValue(argv.slice(1), '--root'),
		});
		return;
	}
	if (command === 'worker' && subcommand === 'start') {
		await runWorkerCommand(parseWorkerCommandArgs(rest));
		return;
	}
	if (command === 'library' && subcommand === 'sync') {
		runLibrarySyncCommand({
			force: rest.includes('--force'),
			rootDir: readFlagValue(rest, '--root'),
		});
		return;
	}
	if (command === 'template' && subcommand === 'list') {
		runTemplateListCommand();
		return;
	}
	if (command === 'workflow' && subcommand === 'list') {
		runWorkflowListCommand();
		return;
	}
	if (command === 'approve' && subcommand) {
		const { decision, stepId } = parseApproveCommandArgs(rest);
		runApproveCommand(subcommand, stepId, { decision });
		return;
	}
	if (command === 'cancel' && subcommand) {
		runCancelCommand(subcommand);
		return;
	}
	if (command === 'run' && subcommand) {
		const inputsIndex = rest.indexOf('--inputs');
		runRunCommand(subcommand, {
			inputs:
				inputsIndex >= 0 && inputsIndex < rest.length - 1
					? rest[inputsIndex + 1]
					: undefined,
		});
		return;
	}
	if (command === 'run-status' && subcommand) {
		runRunStatusCommand(subcommand);
		return;
	}

	throw new Error(
		`Unsupported command: ${[command, subcommand].filter(Boolean).join(' ') || '(empty)'}`,
	);
}

main(process.argv.slice(2)).catch((error) => {
	const message = error instanceof Error ? error.message : String(error);
	console.error(message);
	process.exitCode = 1;
});
