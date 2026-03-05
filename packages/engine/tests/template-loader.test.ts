import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
	assertValidTemplate,
	loadAndValidateTemplateFromFile,
	loadTemplateFromFile,
	loadTemplatesFromDir,
	loadTemplatesFromWorkspace,
	normalizeTemplate,
	validateTemplate,
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

	it('filters malformed steps without id/kind string', () => {
		const template = normalizeTemplate({
			steps: [
				{ command: 'echo ok', id: 'ok.step', kind: 'exec' },
				{ id: 'missing-kind' },
				{ kind: 'exec' },
				{ id: 42, kind: 'exec' },
				'invalid-step',
			],
			workflow: { id: 'workflow.steps', version: 1 },
		});

		expect(template.steps).toHaveLength(1);
		expect(template.steps[0]).toMatchObject({
			id: 'ok.step',
			kind: 'exec',
		});
	});
});

describe('template validation (C2)', () => {
	it('validates a normalized valid template', () => {
		const template = normalizeTemplate({
			steps: [{ command: 'echo ok', id: 'step.exec', kind: 'exec' }],
			workflow: { id: 'workflow.valid', version: 1 },
		});

		const result = validateTemplate(template);
		expect(result.valid).toBe(true);
		expect(result.errors).toEqual([]);
	});

	it('reports required field errors from template metadata and steps', () => {
		const template = normalizeTemplate({
			steps: [],
			workflow: { id: '', version: 0 },
		});

		const result = validateTemplate(template);
		expect(result.valid).toBe(false);
		expect(result.errors.some((error) => error.path === 'workflow.id')).toBe(
			true,
		);
		expect(
			result.errors.some((error) => error.path === 'workflow.version'),
		).toBe(true);
		expect(result.errors.some((error) => error.path === 'steps')).toBe(true);
	});

	it('rejects duplicate step ids', () => {
		const template = normalizeTemplate({
			steps: [
				{ command: 'echo one', id: 'dup.step', kind: 'exec' },
				{ command: 'echo two', id: 'dup.step', kind: 'exec' },
			],
			workflow: { id: 'workflow.dup', version: 1 },
		});

		const result = validateTemplate(template);
		expect(result.valid).toBe(false);
		expect(
			result.errors.some((error) =>
				error.message.includes('duplicate step id "dup.step"'),
			),
		).toBe(true);
	});

	it('rejects invalid depends_on references', () => {
		const template = normalizeTemplate({
			steps: [
				{ command: 'echo one', id: 'step.one', kind: 'exec' },
				{
					command: 'echo two',
					depends_on: ['step.missing', 'step.two'],
					id: 'step.two',
					kind: 'exec',
				},
			],
			workflow: { id: 'workflow.depends', version: 1 },
		});

		const result = validateTemplate(template);
		expect(result.valid).toBe(false);
		expect(
			result.errors.some((error) =>
				error.message.includes(
					'depends_on references unknown step "step.missing"',
				),
			),
		).toBe(true);
		expect(
			result.errors.some((error) => error.message.includes('depend on itself')),
		).toBe(true);
	});

	it('validates provider fields on agent steps', () => {
		const missingProvider = normalizeTemplate({
			steps: [{ id: 'agent.one', kind: 'agent', prompt: 'hello' }],
			workflow: { id: 'workflow.agent', version: 1 },
		});
		const invalidProvider = normalizeTemplate({
			steps: [
				{
					id: 'agent.two',
					kind: 'agent',
					prompt: 'hello',
					provider: 'unknown-provider',
				},
			],
			workflow: { id: 'workflow.agent', version: 1 },
		});

		const missingResult = validateTemplate(missingProvider);
		const invalidResult = validateTemplate(invalidProvider);
		expect(missingResult.valid).toBe(false);
		expect(
			missingResult.errors.some((error) => error.path.endsWith('.provider')),
		).toBe(true);
		expect(invalidResult.valid).toBe(false);
		expect(
			invalidResult.errors.some((error) =>
				error.message.includes('is not supported'),
			),
		).toBe(true);
	});

	it('throws on invalid template via assert and file loader helper', () => {
		const invalidTemplate = normalizeTemplate({
			steps: [{ id: 'agent.bad', kind: 'agent' }],
			workflow: { id: 'workflow.bad', version: 1 },
		});
		expect(() => assertValidTemplate(invalidTemplate)).toThrow(
			'Template validation failed',
		);

		const dir = createTempDir();
		const templatePath = path.join(dir, 'invalid.yaml');
		writeFileSync(
			templatePath,
			`workflow:\n  id: workflow.from.file\n  version: 1\nsteps:\n  - id: agent.file\n    kind: agent\n`,
			'utf8',
		);
		expect(() => loadAndValidateTemplateFromFile(templatePath)).toThrow(
			'Template validation failed',
		);
	});
});
