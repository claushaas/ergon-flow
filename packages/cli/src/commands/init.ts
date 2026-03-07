import { printJson } from '../output/format.js';
import { initializeProject, resolveProjectPaths } from '../project.js';

export interface InitCommandOptions {
	rootDir?: string;
}

export function initProject(commandOptions: InitCommandOptions = {}) {
	const rootDir = commandOptions.rootDir ?? process.cwd();
	const project = resolveProjectPaths(rootDir, rootDir);
	const metadata = initializeProject({ rootDir: project.rootDir });

	return {
		configPath: project.configPath,
		libraryVersion: metadata.library_version,
		rootDir: project.rootDir,
	};
}

export function runInitCommand(commandOptions: InitCommandOptions = {}): void {
	printJson(initProject(commandOptions));
}
