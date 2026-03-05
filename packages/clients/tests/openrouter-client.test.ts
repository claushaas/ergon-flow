import type { ClientRequest } from '@ergon/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { OpenRouterModelClient } from '../src/index.js';

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

describe('OpenRouterModelClient (D2)', () => {
	it('sends a prompt as a single user message and returns normalized text', async () => {
		const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
			createJsonResponse({
				choices: [{ message: { content: 'Refactor completed' } }],
			}),
		);
		const client = new OpenRouterModelClient({
			apiKey: 'test-key',
			appName: 'Ergon Flow',
			defaultModel: 'deepseek/deepseek-v3.2',
			fetch: fetchMock,
			siteUrl: 'https://ergon.flow',
		});

		const result = await client.run({
			provider: 'openrouter',
			prompt: 'Review this patch',
		});

		expect(result.text).toBe('Refactor completed');
		expect(result.raw).toEqual({
			choices: [{ message: { content: 'Refactor completed' } }],
		});
		expect(fetchMock).toHaveBeenCalledTimes(1);
		const [url, init] = fetchMock.mock.calls[0] ?? [];
		expect(url).toBe('https://openrouter.ai/api/v1/chat/completions');
		expect(init?.method).toBe('POST');
		expect(init?.headers).toMatchObject({
			Authorization: 'Bearer test-key',
			'Content-Type': 'application/json',
			'HTTP-Referer': 'https://ergon.flow',
			'X-Title': 'Ergon Flow',
		});
		expect(init?.body).toBe(
			JSON.stringify({
				messages: [{ content: 'Review this patch', role: 'user' }],
				model: 'deepseek/deepseek-v3.2',
			}),
		);
	});

	it('supports json mode and explicit chat messages', async () => {
		const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
			createJsonResponse({
				choices: [
					{
						message: {
							content: [
								{ text: '{\"summary\":\"done\"}', type: 'text' },
								{ text: '', type: 'text' },
							],
						},
					},
				],
			}),
		);
		const client = new OpenRouterModelClient({
			apiKey: 'test-key',
			fetch: fetchMock,
		});
		const request: ClientRequest = {
			json_mode: true,
			messages: [
				{ content: 'You are a JSON formatter.', role: 'system' },
				{ content: 'Return a summary', role: 'user' },
			],
			model: 'moonshotai/kimi-k2.5',
			provider: 'openrouter',
		};

		const result = await client.run(request);

		expect(result.text).toBe('{"summary":"done"}');
		const [, init] = fetchMock.mock.calls[0] ?? [];
		expect(init?.body).toBe(
			JSON.stringify({
				messages: request.messages,
				model: 'moonshotai/kimi-k2.5',
				response_format: { type: 'json_object' },
			}),
		);
	});

	it('fails when neither prompt nor messages are provided', async () => {
		const client = new OpenRouterModelClient({
			apiKey: 'test-key',
			defaultModel: 'deepseek/deepseek-v3.2',
			fetch: vi.fn<typeof fetch>(),
		});

		await expect(
			client.run({
				provider: 'openrouter',
			}),
		).rejects.toThrow('OpenRouter request must include a prompt or messages');
	});

	it('fails when no model is available on request or client defaults', async () => {
		const client = new OpenRouterModelClient({
			apiKey: 'test-key',
			fetch: vi.fn<typeof fetch>(),
		});

		await expect(
			client.run({
				provider: 'openrouter',
				prompt: 'Review this patch',
			}),
		).rejects.toThrow('OpenRouter request must include a model');
	});

	it('includes upstream failure detail when the API returns a non-2xx response', async () => {
		const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
			new Response('rate limited', { status: 429 }),
		);
		const client = new OpenRouterModelClient({
			apiKey: 'test-key',
			defaultModel: 'deepseek/deepseek-v3.2',
			fetch: fetchMock,
		});

		await expect(
			client.run({
				provider: 'openrouter',
				prompt: 'Review this patch',
			}),
		).rejects.toThrow('OpenRouter request failed (429): rate limited');
	});

	it('fails when the API response does not include choices', async () => {
		const client = new OpenRouterModelClient({
			apiKey: 'test-key',
			defaultModel: 'deepseek/deepseek-v3.2',
			fetch: vi
				.fn<typeof fetch>()
				.mockResolvedValue(createJsonResponse({ id: 'resp_1' })),
		});

		await expect(
			client.run({
				provider: 'openrouter',
				prompt: 'Review this patch',
			}),
		).rejects.toThrow('OpenRouter response did not include any choices');
	});

	it('fails when the API response choice does not include a message', async () => {
		const client = new OpenRouterModelClient({
			apiKey: 'test-key',
			defaultModel: 'deepseek/deepseek-v3.2',
			fetch: vi
				.fn<typeof fetch>()
				.mockResolvedValue(createJsonResponse({ choices: [{}] })),
		});

		await expect(
			client.run({
				provider: 'openrouter',
				prompt: 'Review this patch',
			}),
		).rejects.toThrow('OpenRouter response did not include a message');
	});

	it('fails when the API response message content is empty', async () => {
		const client = new OpenRouterModelClient({
			apiKey: 'test-key',
			defaultModel: 'deepseek/deepseek-v3.2',
			fetch: vi.fn<typeof fetch>().mockResolvedValue(
				createJsonResponse({
					choices: [{ message: { content: [{ type: 'text' }] } }],
				}),
			),
		});

		await expect(
			client.run({
				provider: 'openrouter',
				prompt: 'Review this patch',
			}),
		).rejects.toThrow('OpenRouter response message content is empty');
	});
});
