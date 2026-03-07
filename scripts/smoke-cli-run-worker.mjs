import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

function fail(message) {
	throw new Error(message);
}

function runCli(cliPath, cwd, args) {
	const result = spawnSync(process.execPath, [cliPath, ...args], {
		cwd,
		encoding: 'utf8',
		env: process.env,
	});
	if (result.status !== 0) {
		fail(
			[
				`Command failed: node ${cliPath} ${args.join(' ')}`,
				result.stdout.trim(),
				result.stderr.trim(),
			]
				.filter((part) => part.length > 0)
				.join('\n'),
		);
	}
	return result.stdout.trim();
}

const cliPath = fileURLToPath(
	new URL('../packages/cli/dist/main.js', import.meta.url),
);
const tempRoot = mkdtempSync(path.join(tmpdir(), 'ergon-cli-smoke-'));

try {
	runCli(cliPath, tempRoot, ['template', 'list']);
	runCli(cliPath, tempRoot, ['init']);

	const workflowsDir = path.join(tempRoot, '.ergon', 'library', 'workflows');
	mkdirSync(workflowsDir, { recursive: true });
	writeFileSync(
		path.join(workflowsDir, 'smoke.release.yaml'),
		`
workflow:
  id: smoke.release
  version: 1
steps:
  - id: echo
    kind: exec
    command: "printf smoke"
outputs:
  stdout: artifacts.echo.stdout
`,
		'utf8',
	);

	runCli(cliPath, tempRoot, ['workflow', 'list']);

	const scheduledRun = JSON.parse(
		runCli(cliPath, tempRoot, ['run', 'smoke.release']),
	);
	if (scheduledRun.status !== 'queued') {
		fail(`Expected queued run, received ${JSON.stringify(scheduledRun)}`);
	}

	runCli(cliPath, tempRoot, [
		'worker',
		'start',
		'--max-runs',
		'1',
		'--poll-interval-ms',
		'5',
		'--worker-id',
		'smoke-worker',
	]);

	const status = JSON.parse(
		runCli(cliPath, tempRoot, ['run-status', scheduledRun.id]),
	);
	if (status.run.status !== 'succeeded') {
		fail(`Expected succeeded run, received ${JSON.stringify(status)}`);
	}
	if (status.stepRuns.length !== 1 || status.stepRuns[0]?.status !== 'succeeded') {
		fail(`Unexpected step run state: ${JSON.stringify(status.stepRuns)}`);
	}
	const outputs = JSON.parse(status.run.result_json);
	if (outputs.stdout !== 'smoke') {
		fail(`Unexpected workflow outputs: ${JSON.stringify(outputs)}`);
	}
} finally {
	rmSync(tempRoot, { force: true, recursive: true });
}
