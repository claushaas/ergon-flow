import path from 'node:path';
import {
	loadProjectLibraryMetadata,
	type ProjectLibraryMetadata,
	resolveProjectPaths,
} from '../project.js';

export interface CliConfig {
	configPath: string;
	dbPath: string;
	embeddedLibraryDir: string;
	embeddedWorkflowsDir: string;
	ergonDir: string;
	initialized: boolean;
	libraryDir: string;
	projectMetadata: ProjectLibraryMetadata | null;
	providerConfigs: Record<string, unknown>;
	rootDir: string;
	storageDir: string;
	workflowsDir: string;
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
	const project = resolveProjectPaths(cwd, ergonRootDir);

	return {
		configPath: project.configPath,
		dbPath: path.resolve(
			project.rootDir,
			ergonDbPath ?? '.ergon/storage/ergon.db',
		),
		embeddedLibraryDir: project.embeddedLibraryDir,
		embeddedWorkflowsDir: project.embeddedWorkflowsDir,
		ergonDir: project.ergonDir,
		initialized: project.initialized,
		libraryDir: project.libraryDir,
		projectMetadata: loadProjectLibraryMetadata(project),
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
		rootDir: project.rootDir,
		storageDir: project.storageDir,
		workflowsDir: project.workflowsDir,
	};
}
