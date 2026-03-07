import { printJson } from '../output/format.js';
import { syncProjectLibrary } from '../project.js';

export interface LibrarySyncCommandOptions {
	force?: boolean;
	rootDir?: string;
}

export function syncLibrary(commandOptions: LibrarySyncCommandOptions = {}) {
	return syncProjectLibrary({
		force: commandOptions.force,
		rootDir: commandOptions.rootDir ?? process.cwd(),
	});
}

export function runLibrarySyncCommand(
	commandOptions: LibrarySyncCommandOptions = {},
): void {
	printJson(syncLibrary(commandOptions));
}
