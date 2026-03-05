import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
	assertValidTemplate,
	interpolateTemplateString,
	loadAndValidateTemplateFromFile,
	loadTemplateFromFile,
	loadTemplatesFromDir,
	loadTemplatesFromWorkspace,
	normalizeTemplate,
	renderTemplateStepRequests,
	validateTemplate,
	validateTemplateInterpolation,
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

	it('validates optional agent output configuration', () => {
		const validTemplate = normalizeTemplate({
			steps: [
				{
					id: 'review',
					kind: 'agent',
					output: { name: 'review', type: 'json' },
					provider: 'openrouter',
					prompt: 'Review changes',
				},
			],
			workflow: { id: 'workflow.output', version: 1 },
		});
		const invalidTemplate = normalizeTemplate({
			steps: [
				{
					id: 'review',
					kind: 'agent',
					output: { name: '', type: 'binary' },
					provider: 'openrouter',
					prompt: 'Review changes',
				},
			],
			workflow: { id: 'workflow.output.invalid', version: 1 },
		});

		expect(validateTemplate(validTemplate).valid).toBe(true);
		const invalidResult = validateTemplate(invalidTemplate);
		expect(invalidResult.valid).toBe(false);
		expect(
			invalidResult.errors.some((error) =>
				error.path.endsWith('.output.name'),
			),
		).toBe(true);
		expect(
			invalidResult.errors.some((error) =>
				error.path.endsWith('.output.type'),
			),
		).toBe(true);
	});

	it('rejects circular dependencies across multiple steps', () => {
		const template = normalizeTemplate({
			steps: [
				{
					command: 'echo a',
					depends_on: ['step.c'],
					id: 'step.a',
					kind: 'exec',
				},
				{
					command: 'echo b',
					depends_on: ['step.a'],
					id: 'step.b',
					kind: 'exec',
				},
				{
					command: 'echo c',
					depends_on: ['step.b'],
					id: 'step.c',
					kind: 'exec',
				},
			],
			workflow: { id: 'workflow.cycle', version: 1 },
		});

		const result = validateTemplate(template);
		expect(result.valid).toBe(false);
		expect(
			result.errors.some((error) =>
				error.message.includes('circular dependency detected'),
			),
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

describe('template interpolation (C3)', () => {
	it('interpolates inputs and artifacts in step payloads', () => {
		const template = normalizeTemplate({
			steps: [
				{
					id: 'step.agent',
					kind: 'agent',
					prompt:
						'Task: {{ inputs.task }} / Plan: {{ artifacts.plan.summary }}',
					provider: 'openrouter',
				},
				{
					command: 'cd {{ inputs.repo.path }} && echo {{ artifacts.value }}',
					id: 'step.exec',
					kind: 'exec',
				},
				{
					channel: 'stdout',
					id: 'step.notify',
					kind: 'notify',
					message: 'Done {{ inputs.task }}',
				},
			],
			workflow: { id: 'workflow.interpolate', version: 1 },
		});

		const rendered = renderTemplateStepRequests(template, {
			artifacts: {
				plan: { summary: 'Implement parser' },
				value: 42,
			},
			inputs: {
				repo: { path: '/tmp/repo' },
				task: 'Refactor module',
			},
		});

		expect(rendered).toHaveLength(3);
		expect(rendered[0]?.payload.prompt).toContain('Refactor module');
		expect(rendered[0]?.payload.prompt).toContain('Implement parser');
		expect(rendered[1]?.payload.command).toContain("'/tmp/repo'");
		expect(rendered[1]?.payload.command).toContain("'42'");
		expect(rendered[2]?.payload.message).toBe('Done "Refactor module"');
	});

	it('escapes interpolated values for exec shell commands', () => {
		const template = normalizeTemplate({
			steps: [
				{
					command: 'echo {{ inputs.user_input }}',
					id: 'step.exec.shell',
					kind: 'exec',
				},
			],
			workflow: { id: 'workflow.interpolate.shell', version: 1 },
		});
		const rendered = renderTemplateStepRequests(template, {
			inputs: {
				user_input: "hello; rm -rf / && echo 'owned'",
			},
		});

		expect(rendered[0]?.payload.command).toBe(
			`echo 'hello; rm -rf / && echo '"'"'owned'"'"''`,
		);
	});

	it('sanitizes interpolated prompt values', () => {
		const value = interpolateTemplateString(
			'Analyze: {{ inputs.payload }}',
			{
				inputs: {
					payload: '```text``` {{ artifacts.plan }}',
				},
			},
			'prompt',
		);

		expect(value).toContain('Analyze: "```text``` {{ artifacts.plan }}"');
	});

	it('fails interpolation on unsupported source and unknown references', () => {
		expect(() =>
			interpolateTemplateString('{{ steps.plan.output }}', {
				artifacts: {},
				inputs: {},
			}),
		).toThrow('unsupported interpolation source');

		expect(() =>
			interpolateTemplateString('{{ artifacts.plan.missing }}', {
				artifacts: { plan: { summary: 'ok' } },
				inputs: {},
			}),
		).toThrow('unknown interpolation reference');
	});

	it('reports interpolation errors through validation helper', () => {
		const template = normalizeTemplate({
			steps: [
				{
					id: 'step.agent',
					kind: 'agent',
					prompt: 'Task {{ inputs.task }}',
					provider: 'openrouter',
				},
				{
					command: 'echo {{ steps.not_allowed }}',
					id: 'step.exec',
					kind: 'exec',
				},
			],
			workflow: { id: 'workflow.interpolate.validation', version: 1 },
		});

		const result = validateTemplateInterpolation(template, {
			artifacts: {},
			inputs: {},
		});
		expect(result.valid).toBe(false);
		expect(
			result.errors.some((error) =>
				error.message.includes('unsupported interpolation source'),
			),
		).toBe(true);
	});
});
