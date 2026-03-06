import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { listWorkflows, openStorageDb } from '@ergon/storage';
import { afterEach, describe, expect, it } from 'vitest';
import { getRunStatus, scheduleRun } from '../src/commands/run.js';
import { listTemplates } from '../src/commands/template.js';
import { syncWorkflows } from '../src/commands/workflow.js';

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
	const workflowDir = path.join(rootDir, 'library', 'workflows');
	mkdirSync(workflowDir, { recursive: true });
	writeFileSync(path.join(workflowDir, fileName), content, 'utf8');
}

afterEach(() => {
	for (const dir of tempDirs.splice(0)) {
		rmSync(dir, { force: true, recursive: true });
	}
});

describe('core CLI commands (H1)', () => {
	it('lists templates from library/workflows and validates them', () => {
		const rootDir = createTempRoot();
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

		expect(listTemplates({ rootDir })).toEqual([
			{
				description: 'Test workflow',
				id: 'code.test',
				path: 'library/workflows/code.test.yaml',
				stepCount: 1,
				valid: true,
				version: 1,
			},
		]);
	});

	it('syncs workflows into storage and lists them', () => {
		const rootDir = createTempRoot();
		const dbPath = path.join(rootDir, '.ergon', 'storage', 'ergon.db');
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
		expect(workflows).toHaveLength(1);
		expect(workflows[0]?.id).toBe('code.sync');
		expect(workflows[0]?.version).toBe(2);

		const db = openStorageDb({ dbPath });
		expect(listWorkflows(db)).toHaveLength(1);
		db.close();
	});

	it('schedules a run and reports run status', () => {
		const rootDir = createTempRoot();
		const dbPath = path.join(rootDir, '.ergon', 'storage', 'ergon.db');
		writeWorkflow(
			rootDir,
			'code.run.yaml',
			`
workflow:
  id: code.run
  version: 1
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

	it('accepts --inputs as a JSON file path', () => {
		const rootDir = createTempRoot();
		const dbPath = path.join(rootDir, '.ergon', 'storage', 'ergon.db');
		writeWorkflow(
			rootDir,
			'code.file-input.yaml',
			`
workflow:
  id: code.file-input
  version: 1
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
});
