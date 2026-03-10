import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	realpathSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
	claimNextRun,
	createRun,
	createStepRun,
	getRun,
	listEvents,
	listStepRuns,
	listWorkflows,
	markRunWaitingManual,
	openStorageDb,
	registerWorkflow,
	updateRunCursor,
	updateStepRunStatus,
} from '@claushaas/ergon-storage';
import { afterEach, describe, expect, it } from 'vitest';
import { decideManualStep } from '../src/commands/approve.js';
import { cancelWorkflowRun } from '../src/commands/cancel.js';
import { initProject } from '../src/commands/init.js';
import { syncLibrary } from '../src/commands/library.js';
import {
	getRunStatus,
	listWorkflowRuns,
	scheduleRun,
} from '../src/commands/run.js';
import { installSkill } from '../src/commands/skill.js';
import { listTemplates } from '../src/commands/template.js';
import { syncWorkflows } from '../src/commands/workflow.js';
import { loadCliConfig } from '../src/config/index.js';

const tempDirs: string[] = [];

function createTempRoot(): string {
	const dir = mkdtempSync(path.join(tmpdir(), 'ergon-cli-core-'));
	tempDirs.push(dir);
	return dir;
}

function writeWorkflow(
	rootDir: string,
	fileName: string,
	content: string,
): void {
	const workflowDir = path.join(rootDir, '.ergon', 'library', 'workflows');
	mkdirSync(workflowDir, { recursive: true });
	writeFileSync(path.join(workflowDir, fileName), content, 'utf8');
}

function initializeProjectRoot(rootDir: string): void {
	initProject({ rootDir });
}

function readProjectConfig(rootDir: string) {
	return JSON.parse(
		readFileSync(path.join(rootDir, '.ergon', 'config.json'), 'utf8'),
	) as {
		cli_version: string;
		env_file?: string;
		format_version: number;
		initialized_at: string;
		library_files: Record<string, string>;
		library_mode: 'detached' | 'managed';
		library_version?: string;
	};
}

function writeSkill(rootDir: string, skillId: string): void {
	const skillDir = path.join(rootDir, 'skill', skillId, 'references');
	mkdirSync(skillDir, { recursive: true });
	writeFileSync(
		path.join(rootDir, 'skill', skillId, 'SKILL.md'),
		`---
name: ${skillId}
description: test skill
---
`,
		'utf8',
	);
	writeFileSync(path.join(skillDir, 'guide.md'), '# Guide\n', 'utf8');
}

afterEach(() => {
	for (const dir of tempDirs.splice(0)) {
		rmSync(dir, { force: true, recursive: true });
	}
});

describe('core CLI commands (H1)', () => {
	it('lists templates from library/workflows and validates them', () => {
		const rootDir = createTempRoot();
		initializeProjectRoot(rootDir);
		writeWorkflow(
			rootDir,
			'code.test.yaml',
			`
workflow:
  id: code.test
  version: 1
  description: Test workflow
steps:
  - id: echo
    kind: exec
    command: "echo ok"
`,
		);

		expect(listTemplates({ rootDir })).toContainEqual({
			description: 'Test workflow',
			id: 'code.test',
			path: '.ergon/library/workflows/code.test.yaml',
			stepCount: 1,
			valid: true,
			version: 1,
		});
	});

	it('lists embedded templates before project initialization', () => {
		const rootDir = createTempRoot();

		expect(listTemplates({ rootDir })).not.toHaveLength(0);
		expect(
			listTemplates({ rootDir }).every((template) =>
				template.path.startsWith('embedded/library/workflows/'),
			),
		).toBe(true);
	});

	it('installs the embedded CLI skill into the default ./skills directory', () => {
		const rootDir = createTempRoot();
		const nestedDir = path.join(rootDir, 'consumer-repo');
		mkdirSync(nestedDir, { recursive: true });

		const previousCwd = process.cwd();
		process.chdir(nestedDir);
		try {
			const result = installSkill(undefined);

			expect(result.skillId).toBe('ergon-flow-expert');
			expect(realpathSync(result.destinationPath)).toBe(
				realpathSync(path.join(nestedDir, 'skills', 'ergon-flow-expert')),
			);
			expect(result.filesCopied).toBeGreaterThan(2);
			expect(
				readFileSync(path.join(result.destinationPath, 'SKILL.md'), 'utf8'),
			).toContain('ergon-flow-expert');
			expect(
				existsSync(
					path.join(result.destinationPath, 'references', 'ergon-cli.md'),
				),
			).toBe(true);
		} finally {
			process.chdir(previousCwd);
		}
	});

	it('requires an explicit skill id when multiple source skills exist under --root', () => {
		const rootDir = createTempRoot();
		writeSkill(rootDir, 'ergon-flow-expert');
		writeSkill(rootDir, 'release-version-bump');

		expect(() => installSkill(undefined, { rootDir })).toThrow(
			'Multiple skills are available',
		);
	});

	it('fails clearly when --root points to a repository without distributable skills', () => {
		const rootDir = createTempRoot();

		expect(() => installSkill(undefined, { rootDir })).toThrow(
			'No repo-distributed skills were found',
		);
	});

	it('installs a skill from an explicit --root into an explicit destination path', () => {
		const rootDir = createTempRoot();
		const destinationDir = '.codex/skills';
		writeSkill(rootDir, 'ergon-flow-expert');
		const previousCwd = process.cwd();
		process.chdir(rootDir);
		try {
			const result = installSkill('ergon-flow-expert', {
				destinationDir,
				rootDir,
			});

			expect(realpathSync(result.destinationPath)).toBe(
				realpathSync(path.join(rootDir, destinationDir, 'ergon-flow-expert')),
			);
			expect(
				readFileSync(
					path.join(result.destinationPath, 'references', 'guide.md'),
					'utf8',
				),
			).toBe('# Guide\n');
		} finally {
			process.chdir(previousCwd);
		}
	});

	it('overwrites an existing installed skill at the destination path', () => {
		const rootDir = createTempRoot();
		const destinationDir = '.codex/skills';
		const destinationPath = path.join(
			rootDir,
			destinationDir,
			'ergon-flow-expert',
		);
		writeSkill(rootDir, 'ergon-flow-expert');
		mkdirSync(path.join(destinationPath, 'references'), { recursive: true });
		writeFileSync(
			path.join(destinationPath, 'stale.txt'),
			'remove me\n',
			'utf8',
		);
		writeFileSync(
			path.join(destinationPath, 'references', 'guide.md'),
			'# Old Guide\n',
			'utf8',
		);
		const previousCwd = process.cwd();
		process.chdir(rootDir);
		try {
			const result = installSkill('ergon-flow-expert', {
				destinationDir,
				rootDir,
			});

			expect(realpathSync(result.destinationPath)).toBe(
				realpathSync(destinationPath),
			);
			expect(existsSync(path.join(destinationPath, 'stale.txt'))).toBe(false);
			expect(
				readFileSync(
					path.join(destinationPath, 'references', 'guide.md'),
					'utf8',
				),
			).toBe('# Guide\n');
		} finally {
			process.chdir(previousCwd);
		}
	});

	it('rejects skill installation paths outside the current workspace', () => {
		const rootDir = createTempRoot();
		const previousCwd = process.cwd();
		process.chdir(rootDir);
		try {
			expect(() =>
				installSkill(undefined, { destinationDir: '../outside' }),
			).toThrow('Invalid skill install path: path escapes the workspace root');
			expect(() =>
				installSkill(undefined, { destinationDir: '/tmp/skills' }),
			).toThrow('Invalid skill install path: absolute paths are not allowed');
		} finally {
			process.chdir(previousCwd);
		}
	});

	it('rejects top-level skill directories that are symbolic links', () => {
		const rootDir = createTempRoot();
		const externalSkillDir = path.join(rootDir, 'external-skill');
		mkdirSync(externalSkillDir, { recursive: true });
		writeFileSync(
			path.join(externalSkillDir, 'SKILL.md'),
			'---\nname: ergon-flow-expert\ndescription: test skill\n---\n',
			'utf8',
		);
		mkdirSync(path.join(rootDir, 'skill'), { recursive: true });
		symlinkSync(
			externalSkillDir,
			path.join(rootDir, 'skill', 'ergon-flow-expert'),
		);

		expect(() => installSkill('ergon-flow-expert', { rootDir })).toThrow(
			'is a symbolic link',
		);
	});

	it('rejects symbolic links found inside a skill directory', () => {
		const rootDir = createTempRoot();
		const destinationDir = 'installed-skills';
		writeSkill(rootDir, 'ergon-flow-expert');
		symlinkSync(
			path.join(rootDir, 'README.md'),
			path.join(
				rootDir,
				'skill',
				'ergon-flow-expert',
				'references',
				'linked.md',
			),
		);
		const previousCwd = process.cwd();
		process.chdir(rootDir);
		try {
			expect(() =>
				installSkill('ergon-flow-expert', { destinationDir, rootDir }),
			).toThrow('contains a symbolic link');
		} finally {
			process.chdir(previousCwd);
		}
	});

	it('syncs workflows into storage and lists them', () => {
		const rootDir = createTempRoot();
		const dbPath = path.join(rootDir, '.ergon', 'storage', 'ergon.db');
		initializeProjectRoot(rootDir);
		writeWorkflow(
			rootDir,
			'code.sync.yaml',
			`
workflow:
  id: code.sync
  version: 2
steps:
  - id: echo
    kind: exec
    command: "echo sync"
`,
		);

		const workflows = syncWorkflows({ dbPath, rootDir });
		expect(workflows).toContainEqual(
			expect.objectContaining({
				id: 'code.sync',
				version: 2,
			}),
		);

		const db = openStorageDb({ dbPath });
		expect(listWorkflows(db)).toContainEqual(
			expect.objectContaining({
				id: 'code.sync',
				version: 2,
			}),
		);
		db.close();
	});

	it('schedules a run and reports run status', () => {
		const rootDir = createTempRoot();
		const dbPath = path.join(rootDir, '.ergon', 'storage', 'ergon.db');
		initializeProjectRoot(rootDir);
		writeWorkflow(
			rootDir,
			'code.run.yaml',
			`
workflow:
  id: code.run
  version: 1
inputs:
  message:
    type: string
steps:
  - id: echo
    kind: exec
    command: "echo {{ inputs.message }}"
`,
		);

		const run = scheduleRun('code.run', {
			dbPath,
			inputs: '{"message":"hello"}',
			rootDir,
		});

		expect(run.workflow_id).toBe('code.run');
		expect(run.status).toBe('queued');

		const status = getRunStatus(run.id, { dbPath, rootDir });
		expect(status.run.id).toBe(run.id);
		expect(status.run.status).toBe('queued');
		expect(status.stepRuns).toEqual([]);
	});

	it('lists runs with workflow and status filters', () => {
		const rootDir = createTempRoot();
		const dbPath = path.join(rootDir, '.ergon', 'storage', 'ergon.db');
		initializeProjectRoot(rootDir);
		writeWorkflow(
			rootDir,
			'code.list.yaml',
			`
workflow:
  id: code.list
  version: 1
steps:
  - id: echo
    kind: exec
    command: "echo ok"
`,
		);

		const runA = scheduleRun('code.list', { dbPath, rootDir });
		const runB = scheduleRun('code.list', { dbPath, rootDir });
		expect(runA.id).not.toBe(runB.id);

		const allRuns = listWorkflowRuns({
			dbPath,
			rootDir,
			workflowId: 'code.list',
		});
		expect(allRuns).toHaveLength(2);
		expect(allRuns.every((run) => run.workflow_id === 'code.list')).toBe(true);

		const queuedRuns = listWorkflowRuns({
			dbPath,
			rootDir,
			status: 'queued',
			workflowId: 'code.list',
		});
		expect(queuedRuns).toHaveLength(2);
		expect(queuedRuns.every((run) => run.status === 'queued')).toBe(true);

		const limitedRuns = listWorkflowRuns({
			dbPath,
			limit: 1,
			rootDir,
			workflowId: 'code.list',
		});
		expect(limitedRuns).toHaveLength(1);
	});

	it('materializes workflow input defaults when scheduling a run', () => {
		const rootDir = createTempRoot();
		const dbPath = path.join(rootDir, '.ergon', 'storage', 'ergon.db');
		initializeProjectRoot(rootDir);
		writeWorkflow(
			rootDir,
			'code.defaults.yaml',
			`
workflow:
  id: code.defaults
  version: 1
inputs:
  message:
    type: string
  notify:
    type: object
    default:
      channel: stdout
      target: ""
steps:
  - id: echo
    kind: exec
    command: "echo {{ inputs.message }}"
`,
		);

		const run = scheduleRun('code.defaults', {
			dbPath,
			inputs: '{"message":"hello"}',
			rootDir,
		});

		expect(JSON.parse(run.inputs_json)).toEqual({
			message: 'hello',
			notify: {
				channel: 'stdout',
				target: '',
			},
		});
	});

	it('rejects unknown, missing and invalid workflow inputs when scheduling', () => {
		const rootDir = createTempRoot();
		const dbPath = path.join(rootDir, '.ergon', 'storage', 'ergon.db');
		initializeProjectRoot(rootDir);
		writeWorkflow(
			rootDir,
			'code.inputs.yaml',
			`
workflow:
  id: code.inputs
  version: 1
inputs:
  message:
    type: string
steps:
  - id: echo
    kind: exec
    command: "echo {{ inputs.message }}"
`,
		);

		expect(() =>
			scheduleRun('code.inputs', {
				dbPath,
				inputs: '{"unexpected":true}',
				rootDir,
			}),
		).toThrow('Unknown workflow input "unexpected"');
		expect(() =>
			scheduleRun('code.inputs', {
				dbPath,
				inputs: '{"message":42}',
				rootDir,
			}),
		).toThrow('Workflow input "message" must be of type "string"');
		expect(() =>
			scheduleRun('code.inputs', {
				dbPath,
				rootDir,
			}),
		).toThrow('Missing required workflow input "message"');
	});

	it('accepts --inputs as a JSON file path', () => {
		const rootDir = createTempRoot();
		const dbPath = path.join(rootDir, '.ergon', 'storage', 'ergon.db');
		initializeProjectRoot(rootDir);
		writeWorkflow(
			rootDir,
			'code.file-input.yaml',
			`
workflow:
  id: code.file-input
  version: 1
inputs:
  message:
    type: string
steps:
  - id: echo
    kind: exec
    command: "echo {{ inputs.message }}"
`,
		);
		const inputsPath = path.join(rootDir, 'inputs.json');
		writeFileSync(inputsPath, '{"message":"from-file"}', 'utf8');

		const run = scheduleRun('code.file-input', {
			dbPath,
			inputs: 'inputs.json',
			rootDir,
		});

		expect(JSON.parse(run.inputs_json)).toEqual({
			message: 'from-file',
		});
	});

	it('rejects workflow ids with path traversal sequences', () => {
		const rootDir = createTempRoot();
		const dbPath = path.join(rootDir, '.ergon', 'storage', 'ergon.db');
		initializeProjectRoot(rootDir);

		expect(() =>
			scheduleRun('../secrets', {
				dbPath,
				rootDir,
			}),
		).toThrow('Invalid workflow id');
	});

	it('rejects input file paths that escape the workspace root', () => {
		const rootDir = createTempRoot();
		const dbPath = path.join(rootDir, '.ergon', 'storage', 'ergon.db');
		initializeProjectRoot(rootDir);
		writeWorkflow(
			rootDir,
			'code.secure-input.yaml',
			`
workflow:
  id: code.secure-input
  version: 1
inputs:
  message:
    type: string
steps:
  - id: echo
    kind: exec
    command: "echo {{ inputs.message }}"
`,
		);

		expect(() =>
			scheduleRun('code.secure-input', {
				dbPath,
				inputs: '../outside.json',
				rootDir,
			}),
		).toThrow('Invalid inputs path');
	});

	it('requires project initialization for stateful commands', () => {
		const rootDir = createTempRoot();
		const dbPath = path.join(rootDir, '.ergon', 'storage', 'ergon.db');

		expect(() => syncWorkflows({ dbPath, rootDir })).toThrow(
			'Run "ergon init" first',
		);
		expect(() =>
			scheduleRun('code.run', {
				dbPath,
				rootDir,
			}),
		).toThrow('Run "ergon init" first');
		expect(() => getRunStatus('run-1', { dbPath, rootDir })).toThrow(
			'Run "ergon init" first',
		);
	});

	it('initializes a local .ergon project and records machine metadata', () => {
		const rootDir = createTempRoot();

		const result = initProject({ rootDir });
		const configPath = path.join(rootDir, '.ergon', 'config.json');
		const parsedConfig = readProjectConfig(rootDir);

		expect(result.rootDir).toBe(rootDir);
		expect(result.configPath).toBe(configPath);
		expect(result.libraryMode).toBe('managed');
		expect(parsedConfig.format_version).toBe(1);
		expect(parsedConfig.cli_version).toBe('0.2.3');
		expect(parsedConfig.env_file).toBe('.env');
		expect(parsedConfig.library_mode).toBe('managed');
		expect(parsedConfig.library_version).toBe('0.2.3');
		expect(parsedConfig.initialized_at).toEqual(expect.any(String));
		expect(Object.keys(parsedConfig.library_files)).toContain(
			'workflows/code.refactor.yaml',
		);
	});

	it('initializes a detached project without copying the embedded library', () => {
		const rootDir = createTempRoot();

		const result = initProject({ noLibrary: true, rootDir });
		const parsedConfig = readProjectConfig(rootDir);
		const workflowsDir = path.join(rootDir, '.ergon', 'library', 'workflows');

		expect(result.libraryMode).toBe('detached');
		expect(result.libraryVersion).toBeUndefined();
		expect(parsedConfig.library_mode).toBe('detached');
		expect(parsedConfig.library_version).toBeUndefined();
		expect(parsedConfig.library_files).toEqual({});
		expect(existsSync(path.join(rootDir, '.ergon', 'library'))).toBe(true);
		expect(() =>
			readFileSync(path.join(workflowsDir, 'code.refactor.yaml')),
		).toThrow();
	});

	it('discovers the nearest initialized project root from nested directories', () => {
		const rootDir = createTempRoot();
		initializeProjectRoot(rootDir);
		const nestedDir = path.join(rootDir, 'repo', 'src', 'components');
		mkdirSync(nestedDir, { recursive: true });

		const config = loadCliConfig(nestedDir);

		expect(config.rootDir).toBe(rootDir);
		expect(config.initialized).toBe(true);
		expect(config.workflowsDir).toBe(
			path.join(rootDir, '.ergon', 'library', 'workflows'),
		);
	});

	it('syncs the local library without overwriting modified files by default', () => {
		const rootDir = createTempRoot();
		initializeProjectRoot(rootDir);
		const workflowPath = path.join(
			rootDir,
			'.ergon',
			'library',
			'workflows',
			'code.refactor.yaml',
		);
		writeFileSync(workflowPath, '# locally modified\n', 'utf8');

		const summary = syncLibrary({ rootDir });

		expect(summary.conflicted).toContain('workflows/code.refactor.yaml');
		expect(summary.libraryMode).toBe('managed');
		expect(readFileSync(workflowPath, 'utf8')).toBe('# locally modified\n');
	});

	it('force-syncs the local library and refreshes machine metadata', () => {
		const rootDir = createTempRoot();
		initializeProjectRoot(rootDir);
		const workflowPath = path.join(
			rootDir,
			'.ergon',
			'library',
			'workflows',
			'code.refactor.yaml',
		);
		writeFileSync(workflowPath, '# locally modified\n', 'utf8');

		const summary = syncLibrary({ force: true, rootDir });
		const parsedConfig = readProjectConfig(rootDir);

		expect(summary.updated).toContain('workflows/code.refactor.yaml');
		expect(summary.libraryMode).toBe('managed');
		expect(readFileSync(workflowPath, 'utf8')).not.toBe('# locally modified\n');
		expect(parsedConfig.library_version).toBe('0.2.3');
		expect(parsedConfig.library_files['workflows/code.refactor.yaml']).toEqual(
			expect.any(String),
		);
	});

	it('fails clearly when syncing a detached project without reattaching', () => {
		const rootDir = createTempRoot();
		initProject({ noLibrary: true, rootDir });

		expect(() => syncLibrary({ rootDir })).toThrow(
			'is detached from the embedded library',
		);
	});

	it('detaches a managed project without deleting existing library files', () => {
		const rootDir = createTempRoot();
		initializeProjectRoot(rootDir);
		const workflowPath = path.join(
			rootDir,
			'.ergon',
			'library',
			'workflows',
			'code.refactor.yaml',
		);
		const beforeDetach = readFileSync(workflowPath, 'utf8');

		const summary = syncLibrary({ detach: true, rootDir });
		const parsedConfig = readProjectConfig(rootDir);

		expect(summary.libraryMode).toBe('detached');
		expect(parsedConfig.library_mode).toBe('detached');
		expect(parsedConfig.library_files).toEqual({});
		expect(parsedConfig.library_version).toBe('0.2.3');
		expect(readFileSync(workflowPath, 'utf8')).toBe(beforeDetach);
	});

	it('reattaches a detached project and rebuilds managed metadata', () => {
		const rootDir = createTempRoot();
		initProject({ noLibrary: true, rootDir });

		const summary = syncLibrary({ reattach: true, rootDir });
		const parsedConfig = readProjectConfig(rootDir);

		expect(summary.libraryMode).toBe('managed');
		expect(summary.added).toContain('workflows/code.refactor.yaml');
		expect(parsedConfig.library_mode).toBe('managed');
		expect(parsedConfig.library_version).toBe('0.2.3');
		expect(parsedConfig.library_files['workflows/code.refactor.yaml']).toEqual(
			expect.any(String),
		);
	});

	it('treats reattach on an already managed project as a normal sync', () => {
		const rootDir = createTempRoot();
		initializeProjectRoot(rootDir);

		const summary = syncLibrary({ reattach: true, rootDir });

		expect(summary.libraryMode).toBe('managed');
		expect(summary.conflicted).toEqual([]);
	});

	it('reattaches a detached project with force and overwrites embedded files', () => {
		const rootDir = createTempRoot();
		initializeProjectRoot(rootDir);
		const workflowPath = path.join(
			rootDir,
			'.ergon',
			'library',
			'workflows',
			'code.refactor.yaml',
		);

		syncLibrary({ detach: true, rootDir });
		writeFileSync(workflowPath, '# locally modified while detached\n', 'utf8');

		const summary = syncLibrary({ force: true, reattach: true, rootDir });

		expect(summary.libraryMode).toBe('managed');
		expect(summary.updated).toContain('workflows/code.refactor.yaml');
		expect(readFileSync(workflowPath, 'utf8')).not.toBe(
			'# locally modified while detached\n',
		);
	});

	it('rejects conflicting detach and reattach flags', () => {
		const rootDir = createTempRoot();
		initializeProjectRoot(rootDir);

		expect(() =>
			syncLibrary({ detach: true, reattach: true, rootDir }),
		).toThrow('Cannot use "--detach" and "--reattach" together');
	});

	it('approves a waiting manual step and requeues the run', () => {
		const rootDir = createTempRoot();
		const dbPath = path.join(rootDir, '.ergon', 'storage', 'ergon.db');
		initializeProjectRoot(rootDir);
		const db = openStorageDb({ dbPath });

		registerWorkflow(db, {
			hash: 'hash-approve-v1',
			id: 'code.approve',
			sourcePath: '.ergon/library/workflows/code.approve.yaml',
			version: 1,
		});
		const run = createRun(
			db,
			'code.approve',
			{},
			{
				workflowHash: 'hash-approve-v1',
				workflowVersion: 1,
			},
		);
		const claim = claimNextRun(db, 'worker-1', 30_000);
		expect(claim?.id).toBe(run.id);
		updateRunCursor(db, run.id, 'worker-1', claim?.claim_epoch ?? 1, 0, 'gate');
		const stepRun = createStepRun(db, run.id, 'gate', 1, 'manual');
		updateStepRunStatus(db, stepRun.id, 'waiting_manual', {
			finishedAt: new Date().toISOString(),
			startedAt: new Date().toISOString(),
		});
		markRunWaitingManual(db, run.id, 'worker-1', claim?.claim_epoch ?? 1);
		db.close();

		const result = decideManualStep(run.id, 'gate', {
			dbPath,
			decision: 'approve',
			rootDir,
		});

		expect(result.decision).toBe('approve');
		expect(result.run.status).toBe('queued');

		const verificationDb = openStorageDb({ dbPath });
		expect(getRun(verificationDb, run.id)?.status).toBe('queued');
		expect(
			listEvents(verificationDb, run.id).map((event) => event.type),
		).toEqual(['workflow_scheduled', 'manual_approved']);
		verificationDb.close();
	});

	it('rejects a waiting manual step and fails the run', () => {
		const rootDir = createTempRoot();
		const dbPath = path.join(rootDir, '.ergon', 'storage', 'ergon.db');
		initializeProjectRoot(rootDir);
		const db = openStorageDb({ dbPath });

		registerWorkflow(db, {
			hash: 'hash-reject-v1',
			id: 'code.reject',
			sourcePath: '.ergon/library/workflows/code.reject.yaml',
			version: 1,
		});
		const run = createRun(
			db,
			'code.reject',
			{},
			{
				workflowHash: 'hash-reject-v1',
				workflowVersion: 1,
			},
		);
		const claim = claimNextRun(db, 'worker-2', 30_000);
		expect(claim?.id).toBe(run.id);
		updateRunCursor(db, run.id, 'worker-2', claim?.claim_epoch ?? 1, 0, 'gate');
		const stepRun = createStepRun(db, run.id, 'gate', 1, 'manual');
		updateStepRunStatus(db, stepRun.id, 'waiting_manual', {
			finishedAt: new Date().toISOString(),
			startedAt: new Date().toISOString(),
		});
		markRunWaitingManual(db, run.id, 'worker-2', claim?.claim_epoch ?? 1);
		db.close();

		const result = decideManualStep(run.id, 'gate', {
			dbPath,
			decision: 'reject',
			rootDir,
		});

		expect(result.decision).toBe('reject');
		expect(result.run.status).toBe('failed');

		const verificationDb = openStorageDb({ dbPath });
		expect(getRun(verificationDb, run.id)?.error_code).toBe('manual_rejected');
		expect(listStepRuns(verificationDb, run.id)[0]?.status).toBe('failed');
		expect(
			listEvents(verificationDb, run.id).map((event) => event.type),
		).toEqual([
			'workflow_scheduled',
			'manual_rejected',
			'step_failed',
			'workflow_failed',
		]);
		verificationDb.close();
	});

	it('cancels a queued run and appends workflow_canceled', () => {
		const rootDir = createTempRoot();
		const dbPath = path.join(rootDir, '.ergon', 'storage', 'ergon.db');
		initializeProjectRoot(rootDir);
		writeWorkflow(
			rootDir,
			'code.cancel.yaml',
			`
workflow:
  id: code.cancel
  version: 1
steps:
  - id: echo
    kind: exec
    command: "echo cancel"
`,
		);

		const run = scheduleRun('code.cancel', {
			dbPath,
			rootDir,
		});
		const canceledRun = cancelWorkflowRun(run.id, { dbPath, rootDir });

		expect(canceledRun.status).toBe('canceled');

		const verificationDb = openStorageDb({ dbPath });
		expect(getRun(verificationDb, run.id)?.status).toBe('canceled');
		expect(
			listEvents(verificationDb, run.id).map((event) => event.type),
		).toEqual(['workflow_scheduled', 'workflow_canceled']);
		verificationDb.close();
	});

	it('cancels a waiting manual run without mutating step state', () => {
		const rootDir = createTempRoot();
		const dbPath = path.join(rootDir, '.ergon', 'storage', 'ergon.db');
		initializeProjectRoot(rootDir);
		const db = openStorageDb({ dbPath });

		registerWorkflow(db, {
			hash: 'hash-cancel-manual-v1',
			id: 'code.cancel.manual',
			sourcePath: '.ergon/library/workflows/code.cancel.manual.yaml',
			version: 1,
		});
		const run = createRun(
			db,
			'code.cancel.manual',
			{},
			{
				workflowHash: 'hash-cancel-manual-v1',
				workflowVersion: 1,
			},
		);
		const claim = claimNextRun(db, 'worker-3', 30_000);
		expect(claim?.id).toBe(run.id);
		updateRunCursor(db, run.id, 'worker-3', claim?.claim_epoch ?? 1, 0, 'gate');
		const stepRun = createStepRun(db, run.id, 'gate', 1, 'manual');
		updateStepRunStatus(db, stepRun.id, 'waiting_manual', {
			finishedAt: new Date().toISOString(),
			startedAt: new Date().toISOString(),
		});
		markRunWaitingManual(db, run.id, 'worker-3', claim?.claim_epoch ?? 1);
		db.close();

		const canceledRun = cancelWorkflowRun(run.id, { dbPath, rootDir });
		expect(canceledRun.status).toBe('canceled');

		const verificationDb = openStorageDb({ dbPath });
		expect(listStepRuns(verificationDb, run.id)[0]?.status).toBe(
			'waiting_manual',
		);
		expect(
			listEvents(verificationDb, run.id).map((event) => event.type),
		).toEqual(['workflow_scheduled', 'workflow_canceled']);
		verificationDb.close();
	});

	it('rejects manual approve/reject after the run has already been canceled', () => {
		const rootDir = createTempRoot();
		const dbPath = path.join(rootDir, '.ergon', 'storage', 'ergon.db');
		initializeProjectRoot(rootDir);
		const db = openStorageDb({ dbPath });

		registerWorkflow(db, {
			hash: 'hash-cancel-decision-v1',
			id: 'code.cancel.decision',
			sourcePath: '.ergon/library/workflows/code.cancel.decision.yaml',
			version: 1,
		});
		const run = createRun(
			db,
			'code.cancel.decision',
			{},
			{
				workflowHash: 'hash-cancel-decision-v1',
				workflowVersion: 1,
			},
		);
		const claim = claimNextRun(db, 'worker-4', 30_000);
		expect(claim?.id).toBe(run.id);
		updateRunCursor(db, run.id, 'worker-4', claim?.claim_epoch ?? 1, 0, 'gate');
		const stepRun = createStepRun(db, run.id, 'gate', 1, 'manual');
		updateStepRunStatus(db, stepRun.id, 'waiting_manual', {
			finishedAt: new Date().toISOString(),
			startedAt: new Date().toISOString(),
		});
		markRunWaitingManual(db, run.id, 'worker-4', claim?.claim_epoch ?? 1);
		db.close();

		const canceledRun = cancelWorkflowRun(run.id, { dbPath, rootDir });
		expect(canceledRun.status).toBe('canceled');

		expect(() =>
			decideManualStep(run.id, 'gate', {
				dbPath,
				decision: 'approve',
				rootDir,
			}),
		).toThrow(`Workflow run "${run.id}" is not waiting for manual approval`);
		expect(() =>
			decideManualStep(run.id, 'gate', {
				dbPath,
				decision: 'reject',
				rootDir,
			}),
		).toThrow(`Workflow run "${run.id}" is not waiting for manual approval`);
	});
});
