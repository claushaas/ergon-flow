import { printJson } from '../output/format.js';
import { initializeProject, resolveProjectPaths } from '../project.js';

export interface InitCommandOptions {
	noLibrary?: boolean;
	rootDir?: string;
}

export function initProject(commandOptions: InitCommandOptions = {}) {
	const rootDir = commandOptions.rootDir ?? process.cwd();
	const project = resolveProjectPaths(rootDir, rootDir);
	const metadata = initializeProject({
		noLibrary: commandOptions.noLibrary,
		rootDir: project.rootDir,
	});

	return {
		configPath: project.configPath,
		libraryMode: metadata.library_mode,
		libraryVersion: metadata.library_version,
		rootDir: project.rootDir,
	};
}

export function runInitCommand(commandOptions: InitCommandOptions = {}): void {
	printJson(initProject(commandOptions));
}
