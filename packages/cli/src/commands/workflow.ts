import path from 'node:path';
import {
	loadAndValidateTemplateFromFile,
	loadTemplatesFromDir,
} from '@claushaas/engine';
import {
	listWorkflows,
	openStorageDb,
	registerWorkflow,
} from '@claushaas/storage';
import { loadCliConfig } from '../config/index.js';
import { printJson } from '../output/format.js';
import { assertInitializedProject } from '../project.js';
import { hashFile } from '../utils.js';

export interface WorkflowListCommandOptions {
	dbPath?: string;
	rootDir?: string;
}

export function syncWorkflows(
	commandOptions: WorkflowListCommandOptions = {},
): ReturnType<typeof listWorkflows> {
	const config = loadCliConfig(commandOptions.rootDir);
	assertInitializedProject(config, 'workflow list');
	const db = openStorageDb({
		dbPath: commandOptions.dbPath ?? config.dbPath,
	});

	try {
		for (const loadedTemplate of loadTemplatesFromDir(config.workflowsDir)) {
			const { template, templatePath } = loadAndValidateTemplateFromFile(
				loadedTemplate.templatePath,
			);
			registerWorkflow(db, {
				description: template.workflow.description,
				hash: hashFile(templatePath),
				id: template.workflow.id,
				sourcePath: path.relative(config.rootDir, templatePath),
				version: template.workflow.version,
			});
		}

		return listWorkflows(db);
	} finally {
		db.close();
	}
}

export function runWorkflowListCommand(
	commandOptions: WorkflowListCommandOptions = {},
): void {
	printJson(syncWorkflows(commandOptions));
}
