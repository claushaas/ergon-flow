import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
	loadAndValidateTemplateFromFile,
	resolveWorkflowInputs,
} from '@claushaas/ergon-engine';
import {
	createRun,
	getRun,
	getWorkflow,
	listStepRuns,
	openStorageDb,
	registerWorkflow,
} from '@claushaas/ergon-storage';
import { loadCliConfig } from '../config/index.js';
import { printJson } from '../output/format.js';
import { assertInitializedProject } from '../project.js';
import {
	assertValidWorkflowId,
	hashFile,
	resolvePathWithinBase,
} from '../utils.js';

export interface RunCommandOptions {
	dbPath?: string;
	inputs?: string;
	rootDir?: string;
}

export interface RunStatusCommandOptions {
	dbPath?: string;
	rootDir?: string;
}

function resolveWorkflowTemplatePath(
	workflowsDir: string,
	workflowId: string,
): string {
	return path.join(workflowsDir, `${assertValidWorkflowId(workflowId)}.yaml`);
}

function parseInputs(
	rawInputs: string | undefined,
	rootDir: string,
): Record<string, unknown> {
	if (!rawInputs) {
		return {};
	}

	const trimmedInputs = rawInputs.trim();
	const content = trimmedInputs.startsWith('{')
		? trimmedInputs
		: readFileSync(
				resolvePathWithinBase(rootDir, trimmedInputs, 'inputs path'),
				'utf8',
			);
	const parsed = JSON.parse(content) as unknown;
	if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
		throw new Error('Run inputs must be a JSON object');
	}
	return parsed as Record<string, unknown>;
}

export function scheduleRun(
	workflowId: string,
	commandOptions: RunCommandOptions = {},
) {
	const config = loadCliConfig(commandOptions.rootDir);
	assertInitializedProject(config, 'run');
	const db = openStorageDb({
		dbPath: commandOptions.dbPath ?? config.dbPath,
	});

	try {
		const templatePath = resolveWorkflowTemplatePath(
			config.workflowsDir,
			workflowId,
		);
		const { template } = loadAndValidateTemplateFromFile(templatePath);
		const workflowHash = hashFile(templatePath);
		registerWorkflow(db, {
			description: template.workflow.description,
			hash: workflowHash,
			id: template.workflow.id,
			sourcePath: path.relative(config.rootDir, templatePath),
			version: template.workflow.version,
		});

		const workflow = getWorkflow(
			db,
			template.workflow.id,
			template.workflow.version,
		);
		if (!workflow) {
			throw new Error(
				`Workflow "${template.workflow.id}" could not be registered`,
			);
		}

		return createRun(
			db,
			workflow.id,
			resolveWorkflowInputs(
				template,
				parseInputs(commandOptions.inputs, config.rootDir),
			),
			{
				workflowHash: workflow.hash,
				workflowVersion: workflow.version,
			},
		);
	} finally {
		db.close();
	}
}

export function getRunStatus(
	runId: string,
	commandOptions: RunStatusCommandOptions = {},
): {
	run: NonNullable<ReturnType<typeof getRun>>;
	stepRuns: ReturnType<typeof listStepRuns>;
} {
	const config = loadCliConfig(commandOptions.rootDir);
	assertInitializedProject(config, 'run-status');
	const db = openStorageDb({
		dbPath: commandOptions.dbPath ?? config.dbPath,
	});

	try {
		const run = getRun(db, runId);
		if (!run) {
			throw new Error(`Workflow run "${runId}" was not found`);
		}

		return {
			run,
			stepRuns: listStepRuns(db, runId),
		};
	} finally {
		db.close();
	}
}

export function runRunCommand(
	workflowId: string,
	commandOptions: RunCommandOptions = {},
): void {
	printJson(scheduleRun(workflowId, commandOptions));
}

export function runRunStatusCommand(
	runId: string,
	commandOptions: RunStatusCommandOptions = {},
): void {
	printJson(getRunStatus(runId, commandOptions));
}
