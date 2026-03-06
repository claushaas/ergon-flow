import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { loadAndValidateTemplateFromFile } from '@ergon/engine';
import {
	createRun,
	getRun,
	getWorkflow,
	listStepRuns,
	registerWorkflow,
} from '@ergon/storage';
import { loadCliConfig } from '../config/index.js';
import { openCliDb } from '../db.js';
import { printJson } from '../output/format.js';

export interface RunCommandOptions {
	dbPath?: string;
	inputs?: string;
	rootDir?: string;
}

export interface RunStatusCommandOptions {
	dbPath?: string;
	rootDir?: string;
}

function hashFile(filePath: string): string {
	return createHash('sha256').update(readFileSync(filePath)).digest('hex');
}

function resolveWorkflowTemplatePath(
	rootDir: string,
	workflowId: string,
): string {
	return path.join(rootDir, 'library', 'workflows', `${workflowId}.yaml`);
}

function parseInputs(
	rawInputs: string | undefined,
	rootDir: string,
): Record<string, unknown> {
	if (!rawInputs) {
		return {};
	}

	const absoluteInputPath = path.resolve(rootDir, rawInputs);
	const content =
		existsSync(absoluteInputPath) && !rawInputs.trim().startsWith('{')
			? readFileSync(absoluteInputPath, 'utf8')
			: rawInputs;
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
	const db = openCliDb(commandOptions.dbPath ?? config.dbPath);

	try {
		const templatePath = resolveWorkflowTemplatePath(
			config.rootDir,
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
			parseInputs(commandOptions.inputs, config.rootDir),
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
	const db = openCliDb(commandOptions.dbPath ?? config.dbPath);

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
