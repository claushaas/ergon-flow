import type {
	AgentResult,
	ClientRequest,
	ExecutionClient,
	Provider,
} from '@ergon/shared';
import { describe, expect, it } from 'vitest';
import { ClientRegistry, validateProviderConfig } from '../src/index.js';

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
			'Client already registered',
		);
	});

	it('fails when requesting an unregistered provider', () => {
		const registry = new ClientRegistry();
		expect(() => registry.get('codex')).toThrow('No client registered');
	});

	it('validates remote model provider config', () => {
		expect(() =>
			validateProviderConfig('openrouter', { apiKey: 'test-key' }),
		).not.toThrow();
		expect(() =>
			validateProviderConfig('openrouter', {
				baseUrl: 'https://api.example.com',
			} as never),
		).toThrow('openrouter apiKey is required');
		expect(() =>
			validateProviderConfig('openrouter', {
				apiKey: 'test-key',
				baseUrl: 'ssh://invalid',
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
			validateProviderConfig('claude-code', {
				env: { CLAUDE_HOME: 1 } as never,
			}),
		).toThrow('claude-code env values must be strings');
	});
});
