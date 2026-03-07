import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { parseApproveCommandArgs } from '../src/commands/approve.js';
import { initProject } from '../src/commands/init.js';
import { parseWorkerCommandArgs } from '../src/commands/worker.js';
import { loadCliConfig } from '../src/config/index.js';

const ENV_KEYS = [
	'ERGON_ROOT_DIR',
	'ERGON_DB_PATH',
	'CLAUDE_CODE_COMMAND',
	'CLAUDE_CODE_ARGS',
	'CODEX_COMMAND',
	'CODEX_ARGS',
	'OLLAMA_BASE_URL',
	'OLLAMA_MODEL',
	'OPENCLAW_COMMAND',
	'OPENCLAW_ARGS',
	'OPENROUTER_API_KEY',
	'OPENROUTER_APP_NAME',
	'OPENROUTER_BASE_URL',
	'OPENROUTER_MODEL',
	'OPENROUTER_SITE_URL',
] as const;
const tempDirs: string[] = [];

function createTempRoot(): string {
	const dir = mkdtempSync(path.join(tmpdir(), 'ergon-cli-config-'));
	tempDirs.push(dir);
	return dir;
}

afterEach(() => {
	for (const key of ENV_KEYS) {
		delete process.env[key];
	}
	for (const dir of tempDirs.splice(0)) {
		rmSync(dir, { force: true, recursive: true });
	}
});

describe('parseWorkerCommandArgs', () => {
	it('parses worker flags with explicit values', () => {
		expect(
			parseWorkerCommandArgs([
				'--db',
				'./ergon.db',
				'--worker-id',
				'worker-a',
				'--max-runs',
				'1',
			]),
		).toEqual({
			dbPath: './ergon.db',
			maxRuns: 1,
			workerId: 'worker-a',
		});
	});

	it('rejects missing flag values and nested flags as values', () => {
		expect(() => parseWorkerCommandArgs(['--db'])).toThrow(
			'Missing value for --db',
		);
		expect(() =>
			parseWorkerCommandArgs(['--db', '--worker-id', 'worker-a']),
		).toThrow('Missing value for --db');
	});
});

describe('parseApproveCommandArgs', () => {
	it('accepts the decision flag before or after the step id', () => {
		expect(parseApproveCommandArgs(['gate', '--decision', 'approve'])).toEqual({
			decision: 'approve',
			stepId: 'gate',
		});
		expect(parseApproveCommandArgs(['--decision', 'reject', 'gate'])).toEqual({
			decision: 'reject',
			stepId: 'gate',
		});
	});

	it('rejects missing decision values and missing step ids', () => {
		expect(() => parseApproveCommandArgs(['gate', '--decision'])).toThrow(
			'Missing value for "--decision"',
		);
		expect(() => parseApproveCommandArgs(['--decision', 'approve'])).toThrow(
			'Missing required argument: <step_id>',
		);
	});
});

describe('loadCliConfig', () => {
	it('reads provider env vars once into the config object', () => {
		const rootDir = createTempRoot();
		process.env.CODEX_COMMAND = 'codex';
		process.env.CODEX_ARGS = 'plan --json';
		process.env.OPENROUTER_API_KEY = 'secret';
		process.env.OPENROUTER_MODEL = 'openai/gpt-5';

		const config = loadCliConfig(rootDir);

		expect(config.rootDir).toBe(rootDir);
		expect(config.initialized).toBe(false);
		expect(config.providerConfigs).toMatchObject({
			codex: {
				args: ['plan', '--json'],
				command: 'codex',
			},
			openrouter: {
				apiKey: 'secret',
				defaultModel: 'openai/gpt-5',
			},
		});
	});

	it('walks up to the nearest initialized project root', () => {
		const rootDir = createTempRoot();
		initProject({ rootDir });
		const nestedDir = path.join(rootDir, 'repo', 'src', 'nested');
		mkdirSync(nestedDir, { recursive: true });

		const config = loadCliConfig(nestedDir);

		expect(config.rootDir).toBe(rootDir);
		expect(config.initialized).toBe(true);
		expect(config.workflowsDir).toBe(
			path.join(rootDir, '.ergon', 'library', 'workflows'),
		);
	});

	it('keeps ERGON_ROOT_DIR as an explicit override', () => {
		const rootDir = createTempRoot();
		const otherRootDir = createTempRoot();
		initProject({ rootDir });
		mkdirSync(path.join(otherRootDir, '.ergon'), { recursive: true });
		process.env.ERGON_ROOT_DIR = otherRootDir;

		const config = loadCliConfig(rootDir);

		expect(config.rootDir).toBe(otherRootDir);
		expect(config.initialized).toBe(true);
	});
});
