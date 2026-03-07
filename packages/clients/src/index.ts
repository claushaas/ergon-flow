import { spawn as nodeSpawn } from 'node:child_process';
import {
	type AgentResult,
	type ChatMessage,
	type ClientRequest,
	createChildProcessAbortController,
	type ExecutionClient,
	type Provider,
} from '@claushaas/shared';

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

export interface OllamaClientOptions extends OllamaProviderConfig {
	defaultModel?: string;
	fetch?: typeof fetch;
}

export interface CliSpawnResult {
	code: number | null;
	signal: NodeJS.Signals | null;
	stderr: string;
	stdout: string;
}

export type CliSpawn = (options: {
	args: string[];
	command: string;
	env?: Record<string, string>;
	input: string;
	signal?: AbortSignal;
}) => Promise<CliSpawnResult>;

export interface CliClientOptions extends CliAgentProviderConfig {
	spawn?: CliSpawn;
}

const OPENROUTER_ALLOWED_HOSTS = new Set(['openrouter.ai']);
const OLLAMA_ALLOWED_HOSTS = new Set(['127.0.0.1', '::1', 'localhost']);
const CLI_ALLOWED_COMMANDS: Record<
	'claude-code' | 'codex' | 'openclaw',
	string[]
> = {
	'claude-code': ['claude', 'claude-code'],
	codex: ['codex'],
	openclaw: ['openclaw'],
};
const CLI_ALLOWED_ENV_PREFIXES: Record<
	'claude-code' | 'codex' | 'openclaw',
	string
> = {
	'claude-code': 'CLAUDE_',
	codex: 'CODEX_',
	openclaw: 'OPENCLAW_',
};

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

function parseBaseUrl(baseUrl: unknown, provider: Provider): URL | undefined {
	if (baseUrl === undefined) {
		return undefined;
	}
	if (!isNonEmptyString(baseUrl)) {
		throw new Error(`${provider} baseUrl must be a non-empty string`);
	}
	try {
		return new URL(baseUrl);
	} catch {
		throw new Error(`${provider} baseUrl must be a valid http(s) URL`);
	}
}

function validateBaseUrl(
	baseUrl: unknown,
	provider: Provider,
): URL | undefined {
	const parsedUrl = parseBaseUrl(baseUrl, provider);
	if (!parsedUrl) {
		return undefined;
	}
	if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
		throw new Error(`${provider} baseUrl must use the http or https protocol`);
	}
	return parsedUrl;
}

function validateCliConfig(
	provider: 'claude-code' | 'codex' | 'openclaw',
	config: Record<string, unknown> | undefined,
): void {
	if (!config) {
		return;
	}
	if (config.command !== undefined && !isNonEmptyString(config.command)) {
		throw new Error(`${provider} command must be a non-empty string`);
	}
	if (
		config.command !== undefined &&
		!CLI_ALLOWED_COMMANDS[provider].includes(config.command)
	) {
		throw new Error(
			`${provider} command must be one of: ${CLI_ALLOWED_COMMANDS[provider].join(', ')}`,
		);
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
		if (
			env &&
			Object.keys(env).some(
				(key) => !key.startsWith(CLI_ALLOWED_ENV_PREFIXES[provider]),
			)
		) {
			throw new Error(
				`${provider} env keys must start with ${CLI_ALLOWED_ENV_PREFIXES[provider]}`,
			);
		}
	}
}

function validateOpenRouterBaseUrl(baseUrl: unknown): void {
	const parsedUrl = validateBaseUrl(baseUrl, 'openrouter');
	if (!parsedUrl) {
		return;
	}
	if (!OPENROUTER_ALLOWED_HOSTS.has(parsedUrl.hostname)) {
		throw new Error('openrouter baseUrl must use an allowed host');
	}
}

function validateOllamaBaseUrl(baseUrl: unknown): void {
	const parsedUrl = validateBaseUrl(baseUrl, 'ollama');
	if (!parsedUrl) {
		return;
	}
	if (!OLLAMA_ALLOWED_HOSTS.has(parsedUrl.hostname)) {
		throw new Error('ollama baseUrl must use a local host');
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

function resolveMessages(
	request: ClientRequest,
	providerLabel: string,
): ChatMessage[] {
	if (request.messages && request.messages.length > 0) {
		return request.messages;
	}
	if (isNonEmptyString(request.prompt)) {
		return [{ content: request.prompt, role: 'user' }];
	}
	throw new Error(`${providerLabel} request must include a prompt or messages`);
}

function resolveModel(
	request: ClientRequest,
	defaultModel: string | undefined,
	providerLabel: string,
): string {
	const model = request.model ?? defaultModel;
	if (!isNonEmptyString(model)) {
		throw new Error(`${providerLabel} request must include a model`);
	}
	return model;
}

function resolveChoiceMessageText(
	payload: unknown,
	providerLabel: string,
): string {
	if (!payload || typeof payload !== 'object') {
		throw new Error(`${providerLabel} response must be a JSON object`);
	}
	const choices = (payload as { choices?: unknown }).choices;
	if (!Array.isArray(choices) || choices.length === 0) {
		throw new Error(`${providerLabel} response did not include any choices`);
	}
	const firstChoice = choices[0];
	if (!firstChoice || typeof firstChoice !== 'object') {
		throw new Error(`${providerLabel} response choice is invalid`);
	}
	const message = (firstChoice as { message?: unknown }).message;
	if (!message || typeof message !== 'object') {
		throw new Error(`${providerLabel} response did not include a message`);
	}
	const text = normalizeMessageContent(
		(message as { content?: unknown }).content,
	).trim();
	if (!text) {
		throw new Error(`${providerLabel} response message content is empty`);
	}
	return text;
}

function resolveOllamaText(payload: unknown, providerLabel: string): string {
	if (!payload || typeof payload !== 'object') {
		throw new Error(`${providerLabel} response must be a JSON object`);
	}
	const message = (payload as { message?: unknown }).message;
	if (!message || typeof message !== 'object') {
		throw new Error(`${providerLabel} response did not include a message`);
	}
	const text = normalizeMessageContent(
		(message as { content?: unknown }).content,
	).trim();
	if (!text) {
		throw new Error(`${providerLabel} response message content is empty`);
	}
	return text;
}

function resolveCliInput(
	request: ClientRequest,
	providerLabel: string,
): string {
	const messages = request.messages;
	if (messages && messages.length > 0) {
		return JSON.stringify(
			messages.map((message) => ({
				content: message.content,
				role: message.role,
			})),
			null,
			2,
		);
	}
	if (isNonEmptyString(request.prompt)) {
		return request.prompt;
	}
	throw new Error(`${providerLabel} request must include a prompt or messages`);
}

async function defaultSpawn(options: {
	args: string[];
	command: string;
	env?: Record<string, string>;
	input: string;
	signal?: AbortSignal;
}): Promise<CliSpawnResult> {
	return await new Promise<CliSpawnResult>((resolve, reject) => {
		const child = nodeSpawn(options.command, options.args, {
			env: options.env ? { ...process.env, ...options.env } : process.env,
			stdio: 'pipe',
		});
		let stdout = '';
		let stderr = '';
		let settled = false;
		const { cleanupAbort, registerAbort } = createChildProcessAbortController({
			abortMessage: 'Client command aborted',
			child,
			isSettled: () => settled,
			onAbort: reject,
			setSettled: () => {
				settled = true;
			},
			signal: options.signal,
		});
		const settle = <T>(handler: () => T): T | undefined => {
			if (settled) {
				cleanupAbort();
				return undefined;
			}
			settled = true;
			cleanupAbort();
			return handler();
		};

		child.stdout.on('data', (chunk) => {
			stdout += chunk.toString();
		});
		child.stderr.on('data', (chunk) => {
			stderr += chunk.toString();
		});
		child.on('error', (error) => {
			settle(() => reject(error));
		});
		child.on('close', (code, signal) => {
			settle(() =>
				resolve({
					code,
					signal,
					stderr,
					stdout,
				}),
			);
		});
		if (registerAbort()) {
			return;
		}

		child.stdin.write(options.input);
		child.stdin.end();
	});
}

export function validateProviderConfig(
	provider: Provider,
	config?: ProviderConfig,
): void {
	const normalizedConfig = assertPlainObject(config, `${provider} config`);

	switch (provider) {
		case 'openrouter':
			if (!isNonEmptyString(normalizedConfig?.apiKey)) {
				throw new Error(`${provider} apiKey is required`);
			}
			validateOpenRouterBaseUrl(normalizedConfig.baseUrl);
			return;
		case 'ollama':
			validateOllamaBaseUrl(normalizedConfig?.baseUrl);
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
		const model = resolveModel(request, this.defaultModel, 'OpenRouter');

		const response = await this.fetchImpl(`${this.baseUrl}/chat/completions`, {
			body: JSON.stringify({
				messages: resolveMessages(request, 'OpenRouter'),
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
			signal: request.signal,
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
			text: resolveChoiceMessageText(raw, 'OpenRouter'),
		};
	}
}

export class OllamaModelClient implements ExecutionClient {
	public readonly provider = 'ollama' as const;
	private readonly baseUrl: string;
	private readonly defaultModel?: string;
	private readonly fetchImpl: typeof fetch;

	public constructor(options: OllamaClientOptions = {}) {
		validateProviderConfig('ollama', options);
		this.baseUrl = options.baseUrl ?? 'http://127.0.0.1:11434';
		this.defaultModel = options.defaultModel;
		this.fetchImpl = options.fetch ?? fetch;
	}

	public async run(request: ClientRequest): Promise<AgentResult> {
		const model = resolveModel(request, this.defaultModel, 'Ollama');
		const response = await this.fetchImpl(`${this.baseUrl}/api/chat`, {
			body: JSON.stringify({
				format: request.json_mode ? 'json' : undefined,
				messages: resolveMessages(request, 'Ollama'),
				model,
				stream: false,
			}),
			headers: {
				'Content-Type': 'application/json',
			},
			method: 'POST',
			signal: request.signal,
		});

		if (!response.ok) {
			const detail = (await response.text()).trim();
			throw new Error(
				detail
					? `Ollama request failed (${response.status}): ${detail}`
					: `Ollama request failed (${response.status})`,
			);
		}

		const raw = await response.json();
		return {
			raw,
			text: resolveOllamaText(raw, 'Ollama'),
		};
	}
}

abstract class CliAgentClientBase implements ExecutionClient {
	public abstract readonly provider: Provider;
	private readonly args: string[];
	private readonly command: string;
	private readonly env?: Record<string, string>;
	private readonly providerId: Provider;
	private readonly spawnImpl: CliSpawn;

	protected constructor(
		provider: Provider,
		defaultCommand: string,
		defaultArgs: string[],
		options: CliClientOptions = {},
	) {
		validateProviderConfig(provider, options);
		this.providerId = provider;
		this.command = options.command ?? defaultCommand;
		this.args = options.args ?? defaultArgs;
		this.env = options.env;
		this.spawnImpl = options.spawn ?? defaultSpawn;
	}

	public async run(request: ClientRequest): Promise<AgentResult> {
		const result = await this.spawnImpl({
			args: this.args,
			command: this.command,
			env: this.env,
			input: resolveCliInput(request, this.displayName),
			signal: request.signal,
		});
		if (result.code !== 0) {
			const detail = result.stderr.trim() || result.stdout.trim();
			throw new Error(
				detail
					? `${this.displayName} command failed (${String(result.code)}): ${detail}`
					: `${this.displayName} command failed (${String(result.code)})`,
			);
		}
		const text = result.stdout.trim();
		if (!text) {
			throw new Error(`${this.displayName} command produced empty output`);
		}
		return {
			raw: result,
			text,
		};
	}

	protected get displayName(): string {
		switch (this.providerId) {
			case 'claude-code':
				return 'Claude Code';
			case 'codex':
				return 'Codex';
			case 'openclaw':
				return 'OpenClaw';
			default: {
				return this.providerId;
			}
		}
	}
}

export class CodexAgentClient extends CliAgentClientBase {
	public readonly provider = 'codex' as const;

	public constructor(options: CliClientOptions = {}) {
		super('codex', 'codex', [], options);
	}
}

export class ClaudeCodeAgentClient extends CliAgentClientBase {
	public readonly provider = 'claude-code' as const;

	public constructor(options: CliClientOptions = {}) {
		super('claude-code', 'claude', [], options);
	}
}

export class OpenClawAgentClient extends CliAgentClientBase {
	public readonly provider = 'openclaw' as const;

	public constructor(options: CliClientOptions = {}) {
		super('openclaw', 'openclaw', ['agent'], options);
	}
}

const CLIENT_FACTORIES: Partial<
	Record<Provider, (config: ProviderConfig) => ExecutionClient>
> = {
	'claude-code': (config) =>
		new ClaudeCodeAgentClient(config as CliClientOptions),
	codex: (config) => new CodexAgentClient(config as CliClientOptions),
	ollama: (config) => new OllamaModelClient(config as OllamaClientOptions),
	openclaw: (config) => new OpenClawAgentClient(config as CliClientOptions),
	openrouter: (config) =>
		new OpenRouterModelClient(config as OpenRouterClientOptions),
};

export function createDefaultClients(
	configs: ProviderConfigMap = {},
): ExecutionClient[] {
	return Object.entries(configs)
		.map(([provider, config]) => {
			if (!config) {
				return undefined;
			}
			const factory = CLIENT_FACTORIES[provider as Provider];
			return factory ? factory(config) : undefined;
		})
		.filter((client): client is ExecutionClient => client !== undefined);
}

export function createClientRegistry(
	configs: ProviderConfigMap = {},
): ClientRegistry {
	return new ClientRegistry({
		clients: createDefaultClients(configs),
		configs,
	});
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
			if (config) {
				validateProviderConfig(provider as Provider, config);
			}
		}

		for (const client of options.clients ?? []) {
			this.register(client);
		}
	}

	public get(provider: Provider): ExecutionClient {
		const client = this.clients.get(provider);
		if (client) {
			return client;
		}

		const config = this.configs[provider];
		const factory = CLIENT_FACTORIES[provider];
		if (config && factory) {
			const created = factory(config);
			this.clients.set(provider, created);
			return created;
		}

		throw new Error(`No client registered for provider "${provider}"`);
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
		const config = this.configs[client.provider];
		if (config) {
			validateProviderConfig(client.provider, config);
		}
		this.clients.set(client.provider, client);
	}
}
