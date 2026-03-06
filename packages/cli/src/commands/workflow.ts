import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
	loadAndValidateTemplateFromFile,
	loadTemplatesFromDir,
} from '@ergon/engine';
import { listWorkflows, registerWorkflow } from '@ergon/storage';
import { loadCliConfig } from '../config/index.js';
import { openCliDb } from '../db.js';
import { printJson } from '../output/format.js';

export interface WorkflowListCommandOptions {
	dbPath?: string;
	rootDir?: string;
}

function resolveWorkflowTemplatesDir(rootDir: string): string {
	return path.join(rootDir, 'library', 'workflows');
}

function hashFile(filePath: string): string {
	return createHash('sha256').update(readFileSync(filePath)).digest('hex');
}

export function syncWorkflows(
	commandOptions: WorkflowListCommandOptions = {},
): ReturnType<typeof listWorkflows> {
	const config = loadCliConfig(commandOptions.rootDir);
	const db = openCliDb(commandOptions.dbPath ?? config.dbPath);

	try {
		const templatesDir = resolveWorkflowTemplatesDir(config.rootDir);
		for (const loadedTemplate of loadTemplatesFromDir(templatesDir)) {
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
