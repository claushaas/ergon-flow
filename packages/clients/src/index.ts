import type { ExecutionClient, Provider } from '@ergon/shared';

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
