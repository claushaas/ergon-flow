#!/usr/bin/env node

import { runApproveCommand } from './commands/approve.js';
import { runRunCommand, runRunStatusCommand } from './commands/run.js';
import { runTemplateListCommand } from './commands/template.js';
import { parseWorkerCommandArgs, runWorkerCommand } from './commands/worker.js';
import { runWorkflowListCommand } from './commands/workflow.js';

async function main(argv: string[]): Promise<void> {
	const [command, subcommand, ...rest] = argv;

	if (command === 'worker' && subcommand === 'start') {
		await runWorkerCommand(parseWorkerCommandArgs(rest));
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
	if (command === 'approve' && subcommand && rest[0]) {
		const decisionIndex = rest.indexOf('--decision');
		const decision =
			decisionIndex >= 0 && decisionIndex < rest.length - 1
				? rest[decisionIndex + 1]
				: undefined;
		if (!decision || decision.startsWith('--')) {
			throw new Error(
				'Missing value for "--decision". Expected "approve" or "reject".',
			);
		}

		runApproveCommand(subcommand, rest[0], { decision });
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
