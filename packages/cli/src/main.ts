#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SUPPRESS_WARNING_FLAG = '--disable-warning=ExperimentalWarning';
const SUPPRESSION_ENV_KEY = 'ERGON_SUPPRESS_EXPERIMENTAL_WARNING';

async function ensureSuppressedWarnings(): Promise<boolean> {
	if (
		process.execArgv.includes(SUPPRESS_WARNING_FLAG) ||
		process.env[SUPPRESSION_ENV_KEY] === '1'
	) {
		return false;
	}

	const entryPath = fileURLToPath(import.meta.url);
	const child = spawn(
		process.execPath,
		[
			SUPPRESS_WARNING_FLAG,
			...process.execArgv,
			entryPath,
			...process.argv.slice(2),
		],
		{
			env: {
				...process.env,
				[SUPPRESSION_ENV_KEY]: '1',
			},
			stdio: 'inherit',
		},
	);

	await new Promise<void>((resolve, reject) => {
		child.on('error', reject);
		child.on('close', (code, signal) => {
			if (signal) {
				process.kill(process.pid, signal);
				return;
			}
			process.exitCode = code ?? 1;
			resolve();
		});
	});

	return true;
}

async function main(): Promise<void> {
	if (await ensureSuppressedWarnings()) {
		return;
	}

	const { runCli } = await import('./app.js');
	await runCli(process.argv.slice(2));
}

main().catch((error) => {
	const message = error instanceof Error ? error.message : String(error);
	console.error(message);
	process.exitCode = 1;
});
