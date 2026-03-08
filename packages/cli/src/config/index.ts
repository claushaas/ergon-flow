import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import {
	loadProjectLibraryMetadata,
	type ProjectLibraryMetadata,
	resolveProjectPaths,
} from '../project.js';
import { resolvePathWithinBase } from '../utils.js';

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

function readStringValue(
	values: Readonly<Record<string, string | undefined>>,
	name: string,
): string | undefined {
	const value = values[name]?.trim();
	return value ? value : undefined;
}

function parseDotEnv(content: string): Record<string, string> {
	const parsed: Record<string, string> = {};

	for (const rawLine of content.split(/\r?\n/)) {
		const line = rawLine.trim();
		if (!line || line.startsWith('#')) {
			continue;
		}

		const normalized = line.startsWith('export ')
			? line.slice('export '.length).trim()
			: line;
		const separatorIndex = normalized.indexOf('=');
		if (separatorIndex <= 0) {
			continue;
		}

		const key = normalized.slice(0, separatorIndex).trim();
		if (!key) {
			continue;
		}

		let value = normalized.slice(separatorIndex + 1).trim();
		if (
			(value.startsWith('"') && value.endsWith('"')) ||
			(value.startsWith("'") && value.endsWith("'"))
		) {
			value = value.slice(1, -1);
		}

		parsed[key] = value;
	}

	return parsed;
}

function loadProjectEnvValues(
	rootDir: string,
	projectMetadata: ProjectLibraryMetadata | null,
): Record<string, string> {
	const relativeEnvPath = projectMetadata?.env_file?.trim() || '.env';
	const envPath = resolvePathWithinBase(rootDir, relativeEnvPath, 'env file');
	if (!existsSync(envPath)) {
		return {};
	}

	return parseDotEnv(readFileSync(envPath, 'utf8'));
}

function splitArgs(value: string | undefined): string[] | undefined {
	if (!value) {
		return undefined;
	}

	const args: string[] = [];
	let current = '';
	let inSingleQuote = false;
	let inDoubleQuote = false;
	let escaping = false;

	for (const char of value) {
		if (escaping) {
			current += char;
			escaping = false;
			continue;
		}

		if (char === '\\') {
			escaping = true;
			continue;
		}

		if (char === "'" && !inDoubleQuote) {
			inSingleQuote = !inSingleQuote;
			continue;
		}

		if (char === '"' && !inSingleQuote) {
			inDoubleQuote = !inDoubleQuote;
			continue;
		}

		if (!inSingleQuote && !inDoubleQuote && /\s/.test(char)) {
			if (current.length > 0) {
				args.push(current);
				current = '';
			}
			continue;
		}

		current += char;
	}

	if (escaping) {
		current += '\\';
	}

	if (inSingleQuote || inDoubleQuote) {
		throw new Error('Invalid provider args: unterminated quoted string');
	}

	if (current.length > 0) {
		args.push(current);
	}

	return args.length > 0 ? args : undefined;
}

export function loadCliConfig(cwd: string = process.cwd()): CliConfig {
	const ergonRootDir = readStringEnv('ERGON_ROOT_DIR');
	const project = resolveProjectPaths(cwd, ergonRootDir);
	const projectMetadata = loadProjectLibraryMetadata(project);
	const mergedEnv = {
		...loadProjectEnvValues(project.rootDir, projectMetadata),
		...Object.fromEntries(
			Object.entries(process.env).map(([key, value]) => [key, value ?? undefined]),
		),
	};
	const ergonDbPath = readStringValue(mergedEnv, 'ERGON_DB_PATH');
	const claudeCodeCommand = readStringValue(mergedEnv, 'CLAUDE_CODE_COMMAND');
	const claudeCodeArgs = readStringValue(mergedEnv, 'CLAUDE_CODE_ARGS');
	const codexCommand = readStringValue(mergedEnv, 'CODEX_COMMAND');
	const codexArgs = readStringValue(mergedEnv, 'CODEX_ARGS');
	const ollamaBaseUrl = readStringValue(mergedEnv, 'OLLAMA_BASE_URL');
	const ollamaModel = readStringValue(mergedEnv, 'OLLAMA_MODEL');
	const openClawCommand = readStringValue(mergedEnv, 'OPENCLAW_COMMAND');
	const openClawArgs = readStringValue(mergedEnv, 'OPENCLAW_ARGS');
	const openRouterApiKey = readStringValue(mergedEnv, 'OPENROUTER_API_KEY');
	const openRouterAppName = readStringValue(mergedEnv, 'OPENROUTER_APP_NAME');
	const openRouterBaseUrl = readStringValue(mergedEnv, 'OPENROUTER_BASE_URL');
	const openRouterModel = readStringValue(mergedEnv, 'OPENROUTER_MODEL');
	const openRouterSiteUrl = readStringValue(mergedEnv, 'OPENROUTER_SITE_URL');

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
		projectMetadata,
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
