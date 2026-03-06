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

function splitArgs(value: string | undefined): string[] | undefined {
	return value?.split(/\s+/).filter((entry) => entry.length > 0);
}

export function loadCliConfig(cwd: string = process.cwd()): CliConfig {
	const ergonRootDir = readStringEnv('ERGON_ROOT_DIR');
	const ergonDbPath = readStringEnv('ERGON_DB_PATH');
	const claudeCodeCommand = readStringEnv('CLAUDE_CODE_COMMAND');
	const claudeCodeArgs = readStringEnv('CLAUDE_CODE_ARGS');
	const codexCommand = readStringEnv('CODEX_COMMAND');
	const codexArgs = readStringEnv('CODEX_ARGS');
	const ollamaBaseUrl = readStringEnv('OLLAMA_BASE_URL');
	const ollamaModel = readStringEnv('OLLAMA_MODEL');
	const openClawCommand = readStringEnv('OPENCLAW_COMMAND');
	const openClawArgs = readStringEnv('OPENCLAW_ARGS');
	const openRouterApiKey = readStringEnv('OPENROUTER_API_KEY');
	const openRouterAppName = readStringEnv('OPENROUTER_APP_NAME');
	const openRouterBaseUrl = readStringEnv('OPENROUTER_BASE_URL');
	const openRouterModel = readStringEnv('OPENROUTER_MODEL');
	const openRouterSiteUrl = readStringEnv('OPENROUTER_SITE_URL');
	const rootDir = path.resolve(ergonRootDir ?? cwd);

	return {
		dbPath: path.resolve(rootDir, ergonDbPath ?? '.ergon/storage/ergon.db'),
		providerConfigs: {
			'claude-code':
				claudeCodeCommand || claudeCodeArgs
					? {
							args: splitArgs(claudeCodeArgs),
							command: claudeCodeCommand,
						}
					: undefined,
			codex:
				codexCommand || codexArgs
					? {
							args: splitArgs(codexArgs),
							command: codexCommand,
						}
					: undefined,
			ollama:
				ollamaBaseUrl || ollamaModel
					? {
							baseUrl: ollamaBaseUrl,
							defaultModel: ollamaModel,
						}
					: undefined,
			openclaw:
				openClawCommand || openClawArgs
					? {
							args: splitArgs(openClawArgs),
							command: openClawCommand,
						}
					: undefined,
			openrouter: openRouterApiKey
				? {
						apiKey: openRouterApiKey,
						appName: openRouterAppName,
						baseUrl: openRouterBaseUrl,
						defaultModel: openRouterModel,
						siteUrl: openRouterSiteUrl,
					}
				: undefined,
		},
		rootDir,
	};
}
