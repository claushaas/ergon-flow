import type {
	AgentResult,
	ChatMessage,
	ClientRequest,
	ExecutionClient,
	Provider,
} from '@ergon/shared';

export interface SharedProviderConfig {
	baseUrl?: string;
}

export interface RemoteModelProviderConfig extends SharedProviderConfig {
	apiKey: string;
}

export interface OllamaProviderConfig extends SharedProviderConfig {}

export interface CliAgentProviderConfig {
	args?: string[];
	command?: string;
	env?: Record<string, string>;
}

export type ProviderConfig =
	| CliAgentProviderConfig
	| OllamaProviderConfig
	| RemoteModelProviderConfig;

export type ProviderConfigMap = Partial<Record<Provider, ProviderConfig>>;

export interface OpenRouterClientOptions extends RemoteModelProviderConfig {
	appName?: string;
	defaultModel?: string;
	fetch?: typeof fetch;
	siteUrl?: string;
}

function isNonEmptyString(value: unknown): value is string {
	return typeof value === 'string' && value.trim().length > 0;
}

function assertPlainObject(
	value: unknown,
	label: string,
): Record<string, unknown> | undefined {
	if (value === undefined) {
		return undefined;
	}
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new Error(`${label} must be an object`);
	}
	return value as Record<string, unknown>;
}

function validateBaseUrl(baseUrl: unknown, provider: Provider): void {
	if (baseUrl === undefined) {
		return;
	}
	if (!isNonEmptyString(baseUrl)) {
		throw new Error(`${provider} baseUrl must be a non-empty string`);
	}
	let parsedUrl: URL;
	try {
		parsedUrl = new URL(baseUrl);
	} catch {
		throw new Error(`${provider} baseUrl must be a valid http(s) URL`);
	}
	if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
		throw new Error(`${provider} baseUrl must use the http or https protocol`);
	}
}

function validateCliConfig(
	provider: Provider,
	config: Record<string, unknown> | undefined,
): void {
	if (!config) {
		return;
	}
	if (config.command !== undefined && !isNonEmptyString(config.command)) {
		throw new Error(`${provider} command must be a non-empty string`);
	}
	if (
		config.args !== undefined &&
		(!Array.isArray(config.args) ||
			config.args.some((value) => typeof value !== 'string'))
	) {
		throw new Error(`${provider} args must be an array of strings`);
	}
	if (config.env !== undefined) {
		const env = assertPlainObject(config.env, `${provider} env`);
		if (env && Object.values(env).some((value) => typeof value !== 'string')) {
			throw new Error(`${provider} env values must be strings`);
		}
	}
}

function normalizeMessageContent(content: unknown): string {
	if (typeof content === 'string') {
		return content;
	}
	if (Array.isArray(content)) {
		return content
			.map((part) => {
				if (
					!part ||
					typeof part !== 'object' ||
					!('text' in part) ||
					typeof part.text !== 'string'
				) {
					return '';
				}
				return part.text;
			})
			.filter((value) => value.length > 0)
			.join('\n');
	}
	return '';
}

function resolveMessages(request: ClientRequest): ChatMessage[] {
	if (request.messages && request.messages.length > 0) {
		return request.messages;
	}
	if (isNonEmptyString(request.prompt)) {
		return [{ content: request.prompt, role: 'user' }];
	}
	throw new Error('OpenRouter request must include a prompt or messages');
}

function resolveTextResult(payload: unknown): string {
	if (!payload || typeof payload !== 'object') {
		throw new Error('OpenRouter response must be a JSON object');
	}
	const choices = (payload as { choices?: unknown }).choices;
	if (!Array.isArray(choices) || choices.length === 0) {
		throw new Error('OpenRouter response did not include any choices');
	}
	const firstChoice = choices[0];
	if (!firstChoice || typeof firstChoice !== 'object') {
		throw new Error('OpenRouter response choice is invalid');
	}
	const message = (firstChoice as { message?: unknown }).message;
	if (!message || typeof message !== 'object') {
		throw new Error('OpenRouter response did not include a message');
	}
	const text = normalizeMessageContent(
		(message as { content?: unknown }).content,
	).trim();
	if (!text) {
		throw new Error('OpenRouter response message content is empty');
	}
	return text;
}

export function validateProviderConfig(
	provider: Provider,
	config?: ProviderConfig,
): void {
	const normalizedConfig = assertPlainObject(config, `${provider} config`);

	switch (provider) {
		case 'anthropic':
		case 'openai':
		case 'openrouter':
			if (!isNonEmptyString(normalizedConfig?.apiKey)) {
				throw new Error(`${provider} apiKey is required`);
			}
			validateBaseUrl(normalizedConfig.baseUrl, provider);
			return;
		case 'ollama':
			validateBaseUrl(normalizedConfig?.baseUrl, provider);
			return;
		case 'claude-code':
		case 'codex':
		case 'openclaw':
			validateCliConfig(provider, normalizedConfig);
			return;
		default: {
			const exhaustive: never = provider;
			void exhaustive;
		}
	}
}

export class OpenRouterModelClient implements ExecutionClient {
	public readonly provider = 'openrouter' as const;
	private readonly apiKey: string;
	private readonly appName?: string;
	private readonly baseUrl: string;
	private readonly defaultModel?: string;
	private readonly fetchImpl: typeof fetch;
	private readonly siteUrl?: string;

	public constructor(options: OpenRouterClientOptions) {
		validateProviderConfig('openrouter', options);
		this.apiKey = options.apiKey;
		this.appName = options.appName;
		this.baseUrl = options.baseUrl ?? 'https://openrouter.ai/api/v1';
		this.defaultModel = options.defaultModel;
		this.fetchImpl = options.fetch ?? fetch;
		this.siteUrl = options.siteUrl;
	}

	public async run(request: ClientRequest): Promise<AgentResult> {
		const model = request.model ?? this.defaultModel;
		if (!isNonEmptyString(model)) {
			throw new Error('OpenRouter request must include a model');
		}

		const response = await this.fetchImpl(`${this.baseUrl}/chat/completions`, {
			body: JSON.stringify({
				messages: resolveMessages(request),
				model,
				...(request.json_mode
					? { response_format: { type: 'json_object' } }
					: {}),
			}),
			headers: {
				Authorization: `Bearer ${this.apiKey}`,
				'Content-Type': 'application/json',
				...(this.siteUrl ? { 'HTTP-Referer': this.siteUrl } : {}),
				...(this.appName ? { 'X-Title': this.appName } : {}),
			},
			method: 'POST',
		});

		if (!response.ok) {
			const detail = (await response.text()).trim();
			throw new Error(
				detail
					? `OpenRouter request failed (${response.status}): ${detail}`
					: `OpenRouter request failed (${response.status})`,
			);
		}

		const raw = await response.json();
		return {
			raw,
			text: resolveTextResult(raw),
		};
	}
}

export class ClientRegistry {
	private readonly clients = new Map<Provider, ExecutionClient>();
	private readonly configs: ProviderConfigMap;

	public constructor(
		options: {
			clients?: ExecutionClient[];
			configs?: ProviderConfigMap;
		} = {},
	) {
		this.configs = options.configs ?? {};

		for (const [provider, config] of Object.entries(this.configs)) {
			validateProviderConfig(provider as Provider, config);
		}

		for (const client of options.clients ?? []) {
			this.register(client);
		}
	}

	public get(provider: Provider): ExecutionClient {
		const client = this.clients.get(provider);
		if (!client) {
			throw new Error(`No client registered for provider "${provider}"`);
		}
		validateProviderConfig(provider, this.configs[provider]);
		return client;
	}

	public has(provider: Provider): boolean {
		return this.clients.has(provider);
	}

	public register(client: ExecutionClient): void {
		if (this.clients.has(client.provider)) {
			throw new Error(
				`Client already registered for provider "${client.provider}"`,
			);
		}
		validateProviderConfig(client.provider, this.configs[client.provider]);
		this.clients.set(client.provider, client);
	}
}
