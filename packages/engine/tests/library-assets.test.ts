import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { PROVIDERS } from '@ergon/shared';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import {
	loadTemplatesFromWorkspace,
	validateTemplate,
} from '../src/templating/index.js';

interface AgentProfile {
	capabilities?: unknown;
	execution?: {
		retries?: unknown;
		timeout_seconds?: unknown;
	};
	id?: unknown;
	kind?: unknown;
	model?: unknown;
	notes?: unknown;
	output?: {
		schema?: unknown;
	};
	provider?: unknown;
	settings?: unknown;
}

const LIBRARY_DIR = path.resolve(process.cwd(), 'library');
const AGENTS_DIR = path.join(LIBRARY_DIR, 'agents');
const SCHEMAS_DIR = path.join(LIBRARY_DIR, 'schemas');

function readJsonFile(filePath: string): unknown {
	return JSON.parse(readFileSync(filePath, 'utf8')) as unknown;
}

function readYamlFile(filePath: string): unknown {
	return parse(readFileSync(filePath, 'utf8')) as unknown;
}

describe('library assets', () => {
	it('keeps the built-in workflow library valid for the current runtime', () => {
		const templates = loadTemplatesFromWorkspace(process.cwd());
		expect(templates.length).toBeGreaterThan(0);
		for (const loaded of templates) {
			expect(validateTemplate(loaded.template).valid).toBe(true);
		}
	});

	it('keeps schema files parseable and internally consistent', () => {
		const schemaFiles = readdirSync(SCHEMAS_DIR)
			.filter((file) => file.endsWith('.json'))
			.sort();
		expect(schemaFiles.length).toBeGreaterThan(0);

		const schemaIds = new Set<string>();
		for (const fileName of schemaFiles) {
			const schemaPath = path.join(SCHEMAS_DIR, fileName);
			const schema = readJsonFile(schemaPath) as Record<string, unknown>;
			expect(typeof schema.$id).toBe('string');
			expect(schema.$id).toBe(fileName.replace(/\.json$/, ''));
			expect(schema.$schema).toBe('http://json-schema.org/draft-07/schema#');
			expect(schema.type).toBe('object');
			expect(schema.title).toEqual(expect.any(String));
			expect(schemaIds.has(schema.$id as string)).toBe(false);
			schemaIds.add(schema.$id as string);
		}
	});

	it('keeps agent profiles structurally aligned with supported providers and schema ids', () => {
		const schemaIds = new Set(
			readdirSync(SCHEMAS_DIR)
				.filter((file) => file.endsWith('.json'))
				.map((file) => file.replace(/\.json$/, '')),
		);
		const agentFiles = readdirSync(AGENTS_DIR)
			.filter((file) => file.endsWith('.yaml'))
			.sort();
		expect(agentFiles.length).toBeGreaterThan(0);

		for (const fileName of agentFiles) {
			const profile = readYamlFile(
				path.join(AGENTS_DIR, fileName),
			) as AgentProfile;
			expect(typeof profile.id).toBe('string');
			expect(profile.id).toBe(fileName.replace(/\.yaml$/, ''));
			expect(typeof profile.kind).toBe('string');
			expect(typeof profile.provider).toBe('string');
			expect(PROVIDERS).toContain(profile.provider);
			expect(typeof profile.model).toBe('string');
			expect(Array.isArray(profile.capabilities)).toBe(true);
			expect(
				(profile.capabilities as unknown[]).every(
					(value) => typeof value === 'string' && value.length > 0,
				),
			).toBe(true);
			expect(profile.settings).toMatchObject({});
			expect(typeof profile.execution?.retries).toBe('number');
			expect(Number.isInteger(profile.execution?.retries)).toBe(true);
			expect((profile.execution?.retries as number) >= 0).toBe(true);
			expect(typeof profile.execution?.timeout_seconds).toBe('number');
			expect(Number.isInteger(profile.execution?.timeout_seconds)).toBe(true);
			expect((profile.execution?.timeout_seconds as number) > 0).toBe(true);
			expect(typeof profile.output?.schema).toBe('string');
			expect(schemaIds.has(profile.output?.schema as string)).toBe(true);
			expect(typeof profile.notes).toBe('string');
		}
	});
});
