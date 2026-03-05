import { describe, expect, it, vi } from 'vitest';
import {
	ClaudeCodeAgentClient,
	CodexAgentClient,
	OpenClawAgentClient,
	createClientRegistry,
} from '../src/index.js';

describe('CLI agent clients (D3)', () => {
	it('runs Codex with prompt input and returns stdout', async () => {
		const spawnMock = vi.fn().mockResolvedValue({
			code: 0,
			signal: null,
			stderr: '',
			stdout: 'codex-result\n',
		});
		const client = new CodexAgentClient({
			env: { CODEX_HOME: '/tmp/codex' },
			spawn: spawnMock,
		});

		const result = await client.run({
			provider: 'codex',
			prompt: 'Review this patch',
		});

		expect(result.text).toBe('codex-result');
		expect(spawnMock).toHaveBeenCalledWith({
			args: [],
			command: 'codex',
			env: { CODEX_HOME: '/tmp/codex' },
			input: 'Review this patch',
		});
	});

	it('formats chat messages for Claude Code stdin', async () => {
		const spawnMock = vi.fn().mockResolvedValue({
			code: 0,
			signal: null,
			stderr: '',
			stdout: 'claude-result',
		});
		const client = new ClaudeCodeAgentClient({
			spawn: spawnMock,
		});

		await client.run({
			messages: [
				{ content: 'You are a reviewer.', role: 'system' },
				{ content: 'Review this patch', role: 'user' },
			],
			provider: 'claude-code',
		});

		expect(spawnMock).toHaveBeenCalledWith({
			args: [],
			command: 'claude',
			env: undefined,
			input: 'system: You are a reviewer.\n\nuser: Review this patch',
		});
	});

	it('uses the openclaw agent subcommand by default', async () => {
		const spawnMock = vi.fn().mockResolvedValue({
			code: 0,
			signal: null,
			stderr: '',
			stdout: 'openclaw-result',
		});
		const client = new OpenClawAgentClient({
			spawn: spawnMock,
		});

		const result = await client.run({
			provider: 'openclaw',
			prompt: 'Plan this task',
		});

		expect(result.text).toBe('openclaw-result');
		expect(spawnMock).toHaveBeenCalledWith({
			args: ['agent'],
			command: 'openclaw',
			env: undefined,
			input: 'Plan this task',
		});
	});

	it('surfaces command failure detail from stderr', async () => {
		const client = new CodexAgentClient({
			spawn: vi.fn().mockResolvedValue({
				code: 2,
				signal: null,
				stderr: 'invalid flag',
				stdout: '',
			}),
		});

		await expect(
			client.run({
				provider: 'codex',
				prompt: 'Review this patch',
			}),
		).rejects.toThrow('Codex command failed (2): invalid flag');
	});

	it('fails when the command returns no output', async () => {
		const client = new ClaudeCodeAgentClient({
			spawn: vi.fn().mockResolvedValue({
				code: 0,
				signal: null,
				stderr: '',
				stdout: '   ',
			}),
		});

		await expect(
			client.run({
				provider: 'claude-code',
				prompt: 'Review this patch',
			}),
		).rejects.toThrow('Claude Code command produced empty output');
	});

	it('builds a registry with optional adapters from config', () => {
		const registry = createClientRegistry({
			'claude-code': { command: 'claude' },
			codex: { command: 'codex' },
			ollama: { baseUrl: 'http://localhost:11434' },
			openclaw: { command: 'openclaw' },
			openrouter: { apiKey: 'test-key' },
		});

		expect(registry.has('openrouter')).toBe(true);
		expect(registry.has('ollama')).toBe(true);
		expect(registry.has('codex')).toBe(true);
		expect(registry.has('claude-code')).toBe(true);
		expect(registry.has('openclaw')).toBe(true);
	});
});
