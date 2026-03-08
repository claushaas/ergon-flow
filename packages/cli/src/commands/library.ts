import { printJson } from '../output/format.js';
import { syncProjectLibrary } from '../project.js';

export interface LibrarySyncCommandOptions {
	detach?: boolean;
	force?: boolean;
	reattach?: boolean;
	rootDir?: string;
}

export function syncLibrary(commandOptions: LibrarySyncCommandOptions = {}) {
	return syncProjectLibrary({
		detach: commandOptions.detach,
		force: commandOptions.force,
		reattach: commandOptions.reattach,
		rootDir: commandOptions.rootDir ?? process.cwd(),
	});
}

export function runLibrarySyncCommand(
	commandOptions: LibrarySyncCommandOptions = {},
): void {
	printJson(syncLibrary(commandOptions));
}
