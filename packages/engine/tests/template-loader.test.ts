import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
	loadTemplateFromFile,
	loadTemplatesFromDir,
	loadTemplatesFromWorkspace,
	normalizeTemplate,
} from '../src/templating/index.js';

const tempDirs: string[] = [];

function createTempDir(): string {
	const dir = mkdtempSync(path.join(tmpdir(), 'ergon-engine-c1-'));
	tempDirs.push(dir);
	return dir;
}

afterEach(() => {
	for (const dir of tempDirs.splice(0)) {
		rmSync(dir, { force: true, recursive: true });
	}
});

describe('template loader (C1)', () => {
	it('loads and normalizes a single YAML template file', () => {
		const dir = createTempDir();
		const templatePath = path.join(dir, 'code.simple.yaml');
		writeFileSync(
			templatePath,
			`workflow:\n  id: code.simple\n  version: "7"\n\ninputs:\n  repo_path: string\n  retries:\n    type: number\n    default: 2\n\nsteps:\n  - id: run\n    kind: exec\n    command: echo ok\n\noutputs:\n  result: artifacts.run\n`,
			'utf8',
		);

		const loaded = loadTemplateFromFile(templatePath);
		expect(loaded.templatePath).toBe(path.resolve(templatePath));
		expect(loaded.template.workflow.id).toBe('code.simple');
		expect(loaded.template.workflow.version).toBe(7);
		expect(loaded.template.inputs?.repo_path).toBe('string');
		expect(loaded.template.inputs?.retries).toMatchObject({
			default: 2,
			type: 'number',
		});
		expect(loaded.template.steps).toHaveLength(1);
		expect(loaded.template.outputs).toEqual({ result: 'artifacts.run' });
	});

	it('loads only YAML files from directory in lexical order', () => {
		const dir = createTempDir();
		writeFileSync(
			path.join(dir, 'b.yaml'),
			`workflow:\n  id: workflow.b\n  version: 1\nsteps: []\n`,
			'utf8',
		);
		writeFileSync(
			path.join(dir, 'a.yml'),
			`workflow:\n  id: workflow.a\n  version: 1\nsteps: []\n`,
			'utf8',
		);
		writeFileSync(path.join(dir, 'ignore.txt'), 'not yaml', 'utf8');

		const templates = loadTemplatesFromDir(dir);
		expect(templates).toHaveLength(2);
		expect(templates[0]?.template.workflow.id).toBe('workflow.a');
		expect(templates[1]?.template.workflow.id).toBe('workflow.b');
	});

	it('loads templates from workspace /templates directory', () => {
		const root = createTempDir();
		const templatesDir = path.join(root, 'templates');
		const templatePath = path.join(templatesDir, 'workflow.yaml');
		mkdirSync(templatesDir, { recursive: true });
		writeFileSync(
			templatePath,
			`workflow:\n  id: workflow.workspace\n  version: 1\nsteps: []\n`,
			'utf8',
		);

		const templates = loadTemplatesFromWorkspace(root);
		expect(templates).toHaveLength(1);
		expect(templates[0]?.template.workflow.id).toBe('workflow.workspace');
	});

	it('normalizes missing sections into stable defaults', () => {
		const template = normalizeTemplate({
			workflow: { id: 'workflow.min', version: 1 },
		});

		expect(template.inputs).toEqual({});
		expect(template.outputs).toEqual({});
		expect(template.steps).toEqual([]);
	});
});
