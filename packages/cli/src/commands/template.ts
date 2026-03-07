import path from 'node:path';
import {
	loadAndValidateTemplateFromFile,
	loadTemplatesFromDir,
} from '@claushaas/ergon-engine';
import { loadCliConfig } from '../config/index.js';
import { printJson } from '../output/format.js';
import { resolveEmbeddedTemplateDisplayPath } from '../utils.js';

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
	const templatesDir = config.initialized
		? config.workflowsDir
		: config.embeddedWorkflowsDir;

	return loadTemplatesFromDir(templatesDir).map((loadedTemplate) => {
		try {
			const validated = loadAndValidateTemplateFromFile(
				loadedTemplate.templatePath,
			);
			return {
				description: validated.template.workflow.description,
				id: validated.template.workflow.id,
				path: config.initialized
					? path.relative(config.rootDir, validated.templatePath)
					: resolveEmbeddedTemplateDisplayPath(validated.templatePath),
				stepCount: validated.template.steps.length,
				valid: true,
				version: validated.template.workflow.version,
			};
		} catch (_error) {
			return {
				description: loadedTemplate.template.workflow.description,
				id: loadedTemplate.template.workflow.id,
				path: config.initialized
					? path.relative(config.rootDir, loadedTemplate.templatePath)
					: resolveEmbeddedTemplateDisplayPath(loadedTemplate.templatePath),
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
