import type {
	AgentResult,
	ClientRequest,
	ExecutionClient,
	Provider,
} from '@ergon/shared';
import { describe, expect, it } from 'vitest';
import {
	ClientRegistry,
	validateProviderConfig,
} from '../src/index.js';

class StubClient implements ExecutionClient {
	public readonly provider: Provider;

	public constructor(provider: Provider) {
		this.provider = provider;
	}

	public async run(_request: ClientRequest): Promise<AgentResult> {
		return { text: `${this.provider}:ok` };
	}
}

describe('ClientRegistry (D1)', () => {
	it('returns a registered client by provider', () => {
		const registry = new ClientRegistry({
			clients: [new StubClient('openrouter')],
			configs: {
				openrouter: { apiKey: 'test-key' },
			},
		});

		expect(registry.has('openrouter')).toBe(true);
		expect(registry.get('openrouter').provider).toBe('openrouter');
	});

	it('rejects duplicate provider registration', () => {
		const registry = new ClientRegistry({
			configs: {
				openrouter: { apiKey: 'test-key' },
			},
		});

		registry.register(new StubClient('openrouter'));
		expect(() => registry.register(new StubClient('openrouter'))).toThrow(
			'Client already registered for provider "openrouter"',
		);
	});

	it('fails when requesting an unregistered provider', () => {
		const registry = new ClientRegistry();
		expect(() => registry.get('codex')).toThrow(
			'No client registered for provider "codex"',
		);
	});

	it('validates remote model provider config', () => {
		expect(() =>
			validateProviderConfig('openrouter', { apiKey: 'test-key' }),
		).not.toThrow();
		expect(() =>
			validateProviderConfig('openrouter', {
				baseUrl: 'https://openrouter.ai/api/v1',
			} as never),
		).toThrow('openrouter apiKey is required');
		expect(() =>
			validateProviderConfig('openrouter', {
				apiKey: 'test-key',
				baseUrl: 'ssh://invalid',
			} as never),
		).toThrow('openrouter baseUrl must use the http or https protocol');
		expect(() =>
			validateProviderConfig('openrouter', {
				apiKey: 'test-key',
				baseUrl: 'https://api.example.com',
			} as never),
		).toThrow('openrouter baseUrl must use an allowed host');
		expect(() =>
			validateProviderConfig('openrouter', {
				apiKey: 'test-key',
				baseUrl: 'not-a-url',
			} as never),
		).toThrow('openrouter baseUrl must be a valid http(s) URL');
	});

	it('validates ollama and CLI provider configs', () => {
		expect(() =>
			validateProviderConfig('ollama', { baseUrl: 'http://localhost:11434' }),
		).not.toThrow();
		expect(() =>
			validateProviderConfig('codex', {
				args: ['exec', '--json'],
				command: 'codex',
				env: { CODEX_HOME: '/tmp/codex' },
			}),
		).not.toThrow();
		expect(() =>
			validateProviderConfig('codex', {
				command: '',
			}),
		).toThrow('codex command must be a non-empty string');
		expect(() =>
			validateProviderConfig('codex', {
				command: 'bash',
			}),
		).toThrow('codex command must be one of: codex');
		expect(() =>
			validateProviderConfig('claude-code', {
				env: { CLAUDE_HOME: 1 } as never,
			}),
		).toThrow('claude-code env values must be strings');
		expect(() =>
			validateProviderConfig('claude-code', {
				env: { NODE_OPTIONS: '--inspect' },
			}),
		).toThrow('claude-code env keys must start with CLAUDE_');
		expect(() =>
			validateProviderConfig('ollama', {
				baseUrl: 'http://192.168.1.10:11434',
			}),
		).toThrow('ollama baseUrl must use a local host');
	});
});
