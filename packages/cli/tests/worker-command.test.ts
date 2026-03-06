import { afterEach, describe, expect, it } from 'vitest';
import { parseApproveCommandArgs } from '../src/commands/approve.js';
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

afterEach(() => {
	for (const key of ENV_KEYS) {
		delete process.env[key];
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
		process.env.CODEX_COMMAND = 'codex';
		process.env.CODEX_ARGS = 'plan --json';
		process.env.OPENROUTER_API_KEY = 'secret';
		process.env.OPENROUTER_MODEL = 'openai/gpt-5';

		const config = loadCliConfig('/tmp/ergon');

		expect(config.rootDir).toBe('/tmp/ergon');
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
});
