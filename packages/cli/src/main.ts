#!/usr/bin/env node

import { parseWorkerCommandArgs, runWorkerCommand } from './commands/worker.js';

async function main(argv: string[]): Promise<void> {
	const [command, subcommand, ...rest] = argv;

	if (command === 'worker' && subcommand === 'start') {
		await runWorkerCommand(parseWorkerCommandArgs(rest));
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
