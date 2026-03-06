import path from 'node:path';

export interface CliConfig {
	dbPath: string;
	providerConfigs: Record<string, unknown>;
	rootDir: string;
}

function readStringEnv(name: string): string | undefined {
	const value = process.env[name]?.trim();
	return value ? value : undefined;
}

export function loadCliConfig(cwd: string = process.cwd()): CliConfig {
	const rootDir = path.resolve(readStringEnv('ERGON_ROOT_DIR') ?? cwd);
	const openRouterApiKey = readStringEnv('OPENROUTER_API_KEY');

	return {
		dbPath: path.resolve(
			rootDir,
			readStringEnv('ERGON_DB_PATH') ?? '.ergon/storage/ergon.db',
		),
		providerConfigs: {
			'claude-code':
				readStringEnv('CLAUDE_CODE_COMMAND') ||
				readStringEnv('CLAUDE_CODE_ARGS')
					? {
							args: readStringEnv('CLAUDE_CODE_ARGS')?.split(' ') ?? undefined,
							command: readStringEnv('CLAUDE_CODE_COMMAND'),
						}
					: undefined,
			codex:
				readStringEnv('CODEX_COMMAND') || readStringEnv('CODEX_ARGS')
					? {
							args: readStringEnv('CODEX_ARGS')?.split(' ') ?? undefined,
							command: readStringEnv('CODEX_COMMAND'),
						}
					: undefined,
			ollama:
				readStringEnv('OLLAMA_BASE_URL') || readStringEnv('OLLAMA_MODEL')
					? {
							baseUrl: readStringEnv('OLLAMA_BASE_URL'),
							defaultModel: readStringEnv('OLLAMA_MODEL'),
						}
					: undefined,
			openclaw:
				readStringEnv('OPENCLAW_COMMAND') || readStringEnv('OPENCLAW_ARGS')
					? {
							args: readStringEnv('OPENCLAW_ARGS')?.split(' ') ?? undefined,
							command: readStringEnv('OPENCLAW_COMMAND'),
						}
					: undefined,
			openrouter: openRouterApiKey
				? {
						apiKey: openRouterApiKey,
						appName: readStringEnv('OPENROUTER_APP_NAME'),
						baseUrl: readStringEnv('OPENROUTER_BASE_URL'),
						defaultModel: readStringEnv('OPENROUTER_MODEL'),
						siteUrl: readStringEnv('OPENROUTER_SITE_URL'),
					}
				: undefined,
		},
		rootDir,
	};
}
