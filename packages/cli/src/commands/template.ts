import path from 'node:path';
import {
	loadAndValidateTemplateFromFile,
	loadTemplatesFromDir,
} from '@ergon/engine';
import { loadCliConfig } from '../config/index.js';
import { printJson } from '../output/format.js';
import { resolveWorkflowTemplatesDir } from '../utils.js';

export interface TemplateListCommandOptions {
	rootDir?: string;
}

export function listTemplates(
	commandOptions: TemplateListCommandOptions = {},
): Array<{
	description?: string;
	id: string;
	path: string;
	stepCount: number;
	valid: boolean;
	version: number;
}> {
	const config = loadCliConfig(commandOptions.rootDir);
	const templatesDir = resolveWorkflowTemplatesDir(config.rootDir);

	return loadTemplatesFromDir(templatesDir).map((loadedTemplate) => {
		try {
			const validated = loadAndValidateTemplateFromFile(
				loadedTemplate.templatePath,
			);
			return {
				description: validated.template.workflow.description,
				id: validated.template.workflow.id,
				path: path.relative(config.rootDir, validated.templatePath),
				stepCount: validated.template.steps.length,
				valid: true,
				version: validated.template.workflow.version,
			};
		} catch (_error) {
			return {
				description: loadedTemplate.template.workflow.description,
				id: loadedTemplate.template.workflow.id,
				path: path.relative(config.rootDir, loadedTemplate.templatePath),
				stepCount: loadedTemplate.template.steps.length,
				valid: false,
				version: loadedTemplate.template.workflow.version,
			};
		}
	});
}

export function runTemplateListCommand(
	commandOptions: TemplateListCommandOptions = {},
): void {
	printJson(listTemplates(commandOptions));
}
