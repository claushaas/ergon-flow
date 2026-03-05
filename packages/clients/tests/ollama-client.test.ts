import type { ClientRequest } from '@ergon/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { OllamaModelClient } from '../src/index.js';

function createJsonResponse(body: unknown, init: ResponseInit = {}): Response {
	return new Response(JSON.stringify(body), {
		headers: { 'Content-Type': 'application/json' },
		status: 200,
		...init,
	});
}

afterEach(() => {
	vi.restoreAllMocks();
});

describe('OllamaModelClient (D3)', () => {
	it('sends messages to the Ollama chat endpoint and returns normalized text', async () => {
		const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
			createJsonResponse({
				message: {
					content: 'Generated patch',
				},
			}),
		);
		const client = new OllamaModelClient({
			baseUrl: 'http://localhost:11434',
			defaultModel: 'qwen2.5-coder',
			fetch: fetchMock,
		});

		const result = await client.run({
			provider: 'ollama',
			prompt: 'Generate a patch',
		});

		expect(result.text).toBe('Generated patch');
		const [url, init] = fetchMock.mock.calls[0] ?? [];
		expect(url).toBe('http://localhost:11434/api/chat');
		expect(init?.body).toBe(
			JSON.stringify({
				format: undefined,
				messages: [{ content: 'Generate a patch', role: 'user' }],
				model: 'qwen2.5-coder',
				stream: false,
			}),
		);
	});

	it('supports json mode', async () => {
		const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
			createJsonResponse({
				message: {
					content: '{"summary":"done"}',
				},
			}),
		);
		const client = new OllamaModelClient({
			defaultModel: 'qwen2.5-coder',
			fetch: fetchMock,
		});
		const request: ClientRequest = {
			json_mode: true,
			messages: [{ content: 'Return JSON', role: 'user' }],
			provider: 'ollama',
		};

		const result = await client.run(request);

		expect(result.text).toBe('{"summary":"done"}');
		const [, init] = fetchMock.mock.calls[0] ?? [];
		expect(init?.body).toBe(
			JSON.stringify({
				format: 'json',
				messages: request.messages,
				model: 'qwen2.5-coder',
				stream: false,
			}),
		);
	});

	it('fails when no model is configured', async () => {
		const client = new OllamaModelClient({
			fetch: vi.fn<typeof fetch>(),
		});

		await expect(
			client.run({
				provider: 'ollama',
				prompt: 'Generate a patch',
			}),
		).rejects.toThrow('Ollama request must include a model');
	});

	it('includes upstream failure detail when the API fails', async () => {
		const client = new OllamaModelClient({
			defaultModel: 'qwen2.5-coder',
			fetch: vi
				.fn<typeof fetch>()
				.mockResolvedValue(new Response('busy', { status: 503 })),
		});

		await expect(
			client.run({
				provider: 'ollama',
				prompt: 'Generate a patch',
			}),
		).rejects.toThrow('Ollama request failed (503): busy');
	});

	it('fails when the response does not include message content', async () => {
		const client = new OllamaModelClient({
			defaultModel: 'qwen2.5-coder',
			fetch: vi
				.fn<typeof fetch>()
				.mockResolvedValue(createJsonResponse({ message: {} })),
		});

		await expect(
			client.run({
				provider: 'ollama',
				prompt: 'Generate a patch',
			}),
		).rejects.toThrow('Ollama response message content is empty');
	});
});
