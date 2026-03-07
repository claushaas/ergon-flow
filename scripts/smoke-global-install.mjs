import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

function fail(message) {
	throw new Error(message);
}

function run(command, args, options = {}) {
	const result = spawnSync(command, args, {
		cwd: options.cwd,
		encoding: 'utf8',
		env: options.env,
	});
	if (result.status !== 0) {
		fail(
			[
				`Command failed: ${command} ${args.join(' ')}`,
				result.stdout.trim(),
				result.stderr.trim(),
			]
				.filter((part) => part.length > 0)
				.join('\n'),
		);
	}
	return result.stdout.trim();
}

function packWorkspacePackage(packageDir, packDir) {
	const output = run('pnpm', ['pack', '--pack-destination', packDir], {
		cwd: packageDir,
		env: process.env,
	});
	const tarballName = output
		.split('\n')
		.map((line) => line.trim())
		.filter((line) => line.length > 0)
		.at(-1);

	if (!tarballName) {
		fail(`pnpm pack did not report a tarball for ${packageDir}`);
	}

	const tarballPath = path.isAbsolute(tarballName)
		? tarballName
		: path.join(packDir, tarballName);
	if (!existsSync(tarballPath)) {
		fail(`Expected packed tarball at ${tarballPath}`);
	}

	return tarballPath;
}

function runErgon(args, cwd, env) {
	return run('ergon', args, { cwd, env });
}

const repoRoot = path.dirname(fileURLToPath(new URL('../package.json', import.meta.url)));
const tempRoot = mkdtempSync(path.join(tmpdir(), 'ergon-global-install-'));
const packDir = path.join(tempRoot, 'packs');
const installRoot = path.join(tempRoot, 'install-root');
const pnpmHome = path.join(tempRoot, 'pnpm-home');
const pnpmStoreDir = path.join(tempRoot, 'pnpm-store');
const homeDir = path.join(tempRoot, 'home');
const projectRoot = path.join(tempRoot, 'project');

try {
	mkdirSync(packDir, { recursive: true });
	mkdirSync(installRoot, { recursive: true });
	mkdirSync(pnpmHome, { recursive: true });
	mkdirSync(pnpmStoreDir, { recursive: true });
	mkdirSync(homeDir, { recursive: true });
	mkdirSync(projectRoot, { recursive: true });

	const packageDirs = [
		'packages/shared',
		'packages/clients',
		'packages/storage',
		'packages/engine',
		'packages/cli',
	].map((relativePath) => path.join(repoRoot, relativePath));
	const tarballs = packageDirs.map((packageDir) =>
		packWorkspacePackage(packageDir, packDir),
	);
	const tarballByPackageName = new Map([
		['@claushaas/ergon-shared', tarballs[0]],
		['@claushaas/ergon-clients', tarballs[1]],
		['@claushaas/ergon-storage', tarballs[2]],
		['@claushaas/ergon-engine', tarballs[3]],
		['@claushaas/ergon-cli', tarballs[4]],
	]);
	const installEnv = {
		...process.env,
		HOME: homeDir,
		PATH: `${pnpmHome}${path.delimiter}${process.env.PATH ?? ''}`,
		PNPM_HOME: pnpmHome,
		PNPM_STORE_DIR: pnpmStoreDir,
	};

	writeFileSync(
		path.join(installRoot, 'package.json'),
		`${JSON.stringify(
			{
				dependencies: Object.fromEntries(
					Array.from(tarballByPackageName.entries()).map(
						([packageName, tarballPath]) => [packageName, `file:${tarballPath}`],
					),
				),
				name: 'ergon-global-install-smoke',
				pnpm: {
					overrides: Object.fromEntries(
						Array.from(tarballByPackageName.entries()).map(
							([packageName, tarballPath]) => [packageName, `file:${tarballPath}`],
						),
					),
				},
				private: true,
				version: '0.0.0',
			},
			null,
			2,
		)}\n`,
		'utf8',
	);
	run('pnpm', ['install'], {
		cwd: installRoot,
		env: installEnv,
	});
	run('pnpm', ['link', '--global'], {
		cwd: path.join(installRoot, 'node_modules', '@claushaas', 'ergon-cli'),
		env: installEnv,
	});

	const reportedVersion = runErgon(['--version'], projectRoot, installEnv);
	if (reportedVersion !== '0.1.2') {
		fail(`Expected ergon --version to report 0.1.2, received ${reportedVersion}`);
	}

	const helpText = runErgon(['--help'], projectRoot, installEnv);
	if (!helpText.includes('ergon init') || !helpText.includes('pnpm add -g @claushaas/ergon-cli')) {
		fail(`Unexpected ergon --help output: ${helpText}`);
	}

	const templateList = JSON.parse(runErgon(['template', 'list'], projectRoot, installEnv));
	if (!Array.isArray(templateList) || templateList.length === 0) {
		fail(`Expected embedded templates after global install, received ${JSON.stringify(templateList)}`);
	}

	runErgon(['init'], projectRoot, installEnv);

	const configPath = path.join(projectRoot, '.ergon', 'config.json');
	if (!existsSync(configPath)) {
		fail(`Expected init to create ${configPath}`);
	}
	const config = JSON.parse(readFileSync(configPath, 'utf8'));
	if (config.cli_version !== '0.1.2' || config.library_version !== '0.1.2') {
		fail(`Unexpected project config metadata: ${JSON.stringify(config)}`);
	}

	const workflowsDir = path.join(projectRoot, '.ergon', 'library', 'workflows');
	writeFileSync(
		path.join(workflowsDir, 'smoke.global.yaml'),
		`
workflow:
  id: smoke.global
  version: 1
steps:
  - id: echo
    kind: exec
    command: "printf global"
outputs:
  stdout: artifacts.echo.stdout
`,
		'utf8',
	);

	const workflows = JSON.parse(runErgon(['workflow', 'list'], projectRoot, installEnv));
	if (!Array.isArray(workflows) || !workflows.some((workflow) => workflow.id === 'smoke.global')) {
		fail(`Expected synced smoke.global workflow, received ${JSON.stringify(workflows)}`);
	}

	const scheduledRun = JSON.parse(runErgon(['run', 'smoke.global'], projectRoot, installEnv));
	if (scheduledRun.status !== 'queued') {
		fail(`Expected queued run, received ${JSON.stringify(scheduledRun)}`);
	}

	runErgon(
		['worker', 'start', '--max-runs', '1', '--poll-interval-ms', '5', '--worker-id', 'global-smoke-worker'],
		projectRoot,
		installEnv,
	);

	const status = JSON.parse(runErgon(['run-status', scheduledRun.id], projectRoot, installEnv));
	if (status.run.status !== 'succeeded') {
		fail(`Expected succeeded run, received ${JSON.stringify(status)}`);
	}
	if (status.stepRuns.length !== 1 || status.stepRuns[0]?.status !== 'succeeded') {
		fail(`Unexpected step run state: ${JSON.stringify(status.stepRuns)}`);
	}
	if (JSON.parse(status.run.result_json).stdout !== 'global') {
		fail(`Unexpected workflow outputs: ${status.run.result_json}`);
	}
} finally {
	rmSync(tempRoot, { force: true, recursive: true });
}
