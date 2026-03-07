import { createHash } from 'node:crypto';
import {
	copyFileSync,
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	statSync,
	writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ERGON_DIR_NAME = '.ergon';
const ERGON_CONFIG_FILE_NAME = 'config.json';
const ERGON_DB_RELATIVE_PATH = path.join('storage', 'ergon.db');
const CONFIG_FORMAT_VERSION = 1;

export interface ProjectLibraryMetadata {
	cli_version: string;
	format_version: number;
	initialized_at: string;
	library_files: Record<string, string>;
	library_version: string;
}

export interface ProjectPaths {
	configPath: string;
	dbPath: string;
	embeddedLibraryDir: string;
	embeddedWorkflowsDir: string;
	ergonDir: string;
	initialized: boolean;
	libraryDir: string;
	rootDir: string;
	storageDir: string;
	workflowsDir: string;
}

export interface InitializeProjectOptions {
	rootDir: string;
}

export interface SyncLibraryOptions {
	force?: boolean;
	rootDir: string;
}

export interface SyncLibrarySummary {
	added: string[];
	conflicted: string[];
	force: boolean;
	rootDir: string;
	skipped: string[];
	updated: string[];
}

function hashContent(content: string | Buffer): string {
	return createHash('sha256').update(content).digest('hex');
}

function hashFile(filePath: string): string {
	return hashContent(readFileSync(filePath));
}

function getPackageRootDir(): string {
	const moduleDir = path.dirname(fileURLToPath(import.meta.url));
	return path.resolve(moduleDir, '..');
}

export function getCliVersion(): string {
	const packageRootDir = getPackageRootDir();
	const packageJsonPath = path.join(packageRootDir, 'package.json');
	const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as {
		version?: unknown;
	};

	if (
		typeof packageJson.version !== 'string' ||
		packageJson.version.length === 0
	) {
		throw new Error(`CLI package version is missing in "${packageJsonPath}"`);
	}

	return packageJson.version;
}

export function getEmbeddedLibraryDir(): string {
	const packageRootDir = getPackageRootDir();
	const candidates = [
		path.join(packageRootDir, 'dist', 'library'),
		path.resolve(packageRootDir, '..', '..', 'library'),
	];

	for (const candidate of candidates) {
		if (existsSync(candidate) && statSync(candidate).isDirectory()) {
			return candidate;
		}
	}

	throw new Error(
		`Embedded library is not available. Expected one of: ${candidates.join(', ')}`,
	);
}

function resolveRootDir(
	cwd: string,
	explicitRootDir: string | undefined,
): string {
	if (explicitRootDir) {
		return path.resolve(explicitRootDir);
	}

	const envRootDir = process.env.ERGON_ROOT_DIR?.trim();
	if (envRootDir) {
		return path.resolve(envRootDir);
	}

	let currentDir = path.resolve(cwd);
	while (true) {
		if (existsSync(path.join(currentDir, ERGON_DIR_NAME))) {
			return currentDir;
		}
		const parentDir = path.dirname(currentDir);
		if (parentDir === currentDir) {
			return path.resolve(cwd);
		}
		currentDir = parentDir;
	}
}

function toPortableRelativePath(relativePath: string): string {
	return relativePath.split(path.sep).join('/');
}

function listFilesRecursive(baseDir: string): string[] {
	const files: string[] = [];

	const visit = (currentDir: string): void => {
		for (const entry of readdirSync(currentDir, { withFileTypes: true }).sort(
			(a, b) => a.name.localeCompare(b.name),
		)) {
			const entryPath = path.join(currentDir, entry.name);
			if (entry.isDirectory()) {
				visit(entryPath);
				continue;
			}
			if (entry.isFile()) {
				files.push(toPortableRelativePath(path.relative(baseDir, entryPath)));
			}
		}
	};

	if (!existsSync(baseDir)) {
		return files;
	}

	visit(baseDir);
	return files;
}

function readProjectLibraryMetadata(
	configPath: string,
): ProjectLibraryMetadata | null {
	if (!existsSync(configPath)) {
		return null;
	}

	const parsed = JSON.parse(
		readFileSync(configPath, 'utf8'),
	) as Partial<ProjectLibraryMetadata>;
	if (
		typeof parsed !== 'object' ||
		parsed === null ||
		typeof parsed.format_version !== 'number' ||
		typeof parsed.initialized_at !== 'string' ||
		typeof parsed.cli_version !== 'string' ||
		typeof parsed.library_version !== 'string' ||
		typeof parsed.library_files !== 'object' ||
		parsed.library_files === null ||
		Array.isArray(parsed.library_files)
	) {
		throw new Error(`Invalid Ergon project config at "${configPath}"`);
	}

	return {
		cli_version: parsed.cli_version,
		format_version: parsed.format_version,
		initialized_at: parsed.initialized_at,
		library_files: Object.fromEntries(
			Object.entries(parsed.library_files).filter(
				([relativePath, hash]) =>
					typeof relativePath === 'string' && typeof hash === 'string',
			),
		),
		library_version: parsed.library_version,
	};
}

function writeProjectLibraryMetadata(
	configPath: string,
	metadata: ProjectLibraryMetadata,
): void {
	writeFileSync(
		`${configPath}`,
		`${JSON.stringify(metadata, null, 2)}\n`,
		'utf8',
	);
}

function buildLibraryMetadata(libraryDir: string): ProjectLibraryMetadata {
	const cliVersion = getCliVersion();
	return {
		cli_version: cliVersion,
		format_version: CONFIG_FORMAT_VERSION,
		initialized_at: new Date().toISOString(),
		library_files: Object.fromEntries(
			listFilesRecursive(libraryDir).map((relativePath) => [
				relativePath,
				hashFile(path.join(libraryDir, relativePath)),
			]),
		),
		library_version: cliVersion,
	};
}

export function resolveProjectPaths(
	cwd: string = process.cwd(),
	explicitRootDir?: string,
): ProjectPaths {
	const rootDir = resolveRootDir(cwd, explicitRootDir);
	const ergonDir = path.join(rootDir, ERGON_DIR_NAME);
	const libraryDir = path.join(ergonDir, 'library');
	return {
		configPath: path.join(ergonDir, ERGON_CONFIG_FILE_NAME),
		dbPath: path.join(ergonDir, ERGON_DB_RELATIVE_PATH),
		embeddedLibraryDir: getEmbeddedLibraryDir(),
		embeddedWorkflowsDir: path.join(getEmbeddedLibraryDir(), 'workflows'),
		ergonDir,
		initialized: existsSync(ergonDir),
		libraryDir,
		rootDir,
		storageDir: path.join(ergonDir, 'storage'),
		workflowsDir: path.join(libraryDir, 'workflows'),
	};
}

export function loadProjectLibraryMetadata(
	project: ProjectPaths,
): ProjectLibraryMetadata | null {
	return readProjectLibraryMetadata(project.configPath);
}

export function assertInitializedProject(
	project: ProjectPaths,
	commandName: string,
): ProjectPaths {
	if (!project.initialized || !existsSync(project.configPath)) {
		throw new Error(
			`The "${commandName}" command requires an initialized Ergon project at "${project.rootDir}". Run "ergon init" first.`,
		);
	}

	return project;
}

export function initializeProject(
	options: InitializeProjectOptions,
): ProjectLibraryMetadata {
	const project = resolveProjectPaths(options.rootDir, options.rootDir);
	if (project.initialized) {
		throw new Error(
			`Ergon is already initialized at "${project.rootDir}". Use "ergon library sync" to update managed assets.`,
		);
	}

	mkdirSync(project.storageDir, { recursive: true });
	mkdirSync(project.libraryDir, { recursive: true });

	for (const relativePath of listFilesRecursive(project.embeddedLibraryDir)) {
		const sourcePath = path.join(project.embeddedLibraryDir, relativePath);
		const targetPath = path.join(project.libraryDir, relativePath);
		mkdirSync(path.dirname(targetPath), { recursive: true });
		copyFileSync(sourcePath, targetPath);
	}

	const metadata = buildLibraryMetadata(project.libraryDir);
	writeProjectLibraryMetadata(project.configPath, metadata);
	return metadata;
}

export function syncProjectLibrary(
	options: SyncLibraryOptions,
): SyncLibrarySummary {
	const project = assertInitializedProject(
		resolveProjectPaths(options.rootDir, options.rootDir),
		'library sync',
	);
	const previousMetadata = loadProjectLibraryMetadata(project);
	if (!previousMetadata) {
		throw new Error(
			`Invalid Ergon project at "${project.rootDir}": missing "${project.configPath}"`,
		);
	}

	const summary: SyncLibrarySummary = {
		added: [],
		conflicted: [],
		force: options.force === true,
		rootDir: project.rootDir,
		skipped: [],
		updated: [],
	};
	const nextManagedFiles = { ...previousMetadata.library_files };

	for (const relativePath of listFilesRecursive(project.embeddedLibraryDir)) {
		const sourcePath = path.join(project.embeddedLibraryDir, relativePath);
		const targetPath = path.join(project.libraryDir, relativePath);
		const sourceHash = hashFile(sourcePath);
		const existingManagedHash = previousMetadata.library_files[relativePath];

		if (!existsSync(targetPath)) {
			mkdirSync(path.dirname(targetPath), { recursive: true });
			copyFileSync(sourcePath, targetPath);
			nextManagedFiles[relativePath] = sourceHash;
			summary.added.push(relativePath);
			continue;
		}

		const localHash = hashFile(targetPath);
		if (options.force) {
			if (localHash === sourceHash) {
				nextManagedFiles[relativePath] = sourceHash;
				summary.skipped.push(relativePath);
				continue;
			}

			copyFileSync(sourcePath, targetPath);
			nextManagedFiles[relativePath] = sourceHash;
			summary.updated.push(relativePath);
			continue;
		}

		if (localHash === sourceHash) {
			nextManagedFiles[relativePath] = sourceHash;
			summary.skipped.push(relativePath);
			continue;
		}

		if (existingManagedHash && existingManagedHash === localHash) {
			copyFileSync(sourcePath, targetPath);
			nextManagedFiles[relativePath] = sourceHash;
			summary.updated.push(relativePath);
			continue;
		}

		summary.conflicted.push(relativePath);
	}

	writeProjectLibraryMetadata(project.configPath, {
		cli_version: getCliVersion(),
		format_version: previousMetadata.format_version,
		initialized_at: previousMetadata.initialized_at,
		library_files: nextManagedFiles,
		library_version: getCliVersion(),
	});

	return summary;
}
