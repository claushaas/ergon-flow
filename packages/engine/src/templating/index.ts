import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import type {
	ArtifactDeclaration,
	ArtifactType,
	InputSpec,
	InputType,
	StepDefinition,
	WorkflowMetadata,
	WorkflowTemplate,
} from '@ergon/shared';
import { parse } from 'yaml';

const INPUT_TYPES: ReadonlySet<string> = new Set([
	'array',
	'boolean',
	'number',
	'object',
	'string',
]);

const YAML_EXTENSIONS: ReadonlySet<string> = new Set(['.yaml', '.yml']);

export interface LoadedTemplate {
	template: WorkflowTemplate;
	templatePath: string;
}

function asRecord(value: unknown): Record<string, unknown> | null {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		return null;
	}
	return value as Record<string, unknown>;
}

function asInputType(value: unknown): InputType | null {
	if (typeof value !== 'string' || !INPUT_TYPES.has(value)) {
		return null;
	}
	return value as InputType;
}

function normalizeWorkflow(rawWorkflow: unknown): WorkflowMetadata {
	const workflow = asRecord(rawWorkflow) ?? {};
	const tags = Array.isArray(workflow.tags)
		? workflow.tags.filter((tag): tag is string => typeof tag === 'string')
		: undefined;

	let version = 0;
	if (
		typeof workflow.version === 'number' &&
		Number.isFinite(workflow.version)
	) {
		version = Math.trunc(workflow.version);
	} else if (typeof workflow.version === 'string') {
		const parsed = Number.parseInt(workflow.version, 10);
		if (!Number.isNaN(parsed)) {
			version = parsed;
		}
	}

	return {
		author: typeof workflow.author === 'string' ? workflow.author : undefined,
		description:
			typeof workflow.description === 'string'
				? workflow.description
				: undefined,
		id: typeof workflow.id === 'string' ? workflow.id : '',
		tags,
		version,
	};
}

function normalizeInputs(rawInputs: unknown): WorkflowTemplate['inputs'] {
	const inputs = asRecord(rawInputs);
	if (!inputs) {
		return {};
	}

	const normalized: Record<string, InputSpec | InputType> = {};
	for (const [name, rawSpec] of Object.entries(inputs)) {
		const shorthandType = asInputType(rawSpec);
		if (shorthandType) {
			normalized[name] = shorthandType;
			continue;
		}

		const inputSpec = asRecord(rawSpec);
		if (!inputSpec) {
			continue;
		}

		const explicitType = asInputType(inputSpec.type);
		if (!explicitType) {
			continue;
		}

		normalized[name] = {
			default: inputSpec.default,
			description:
				typeof inputSpec.description === 'string'
					? inputSpec.description
					: undefined,
			required:
				typeof inputSpec.required === 'boolean'
					? inputSpec.required
					: undefined,
			type: explicitType,
		};
	}

	return normalized;
}

function normalizeArtifacts(
	rawArtifacts: unknown,
): Record<string, ArtifactDeclaration> | undefined {
	const artifacts = asRecord(rawArtifacts);
	if (!artifacts) {
		return undefined;
	}

	const normalized: Record<string, ArtifactDeclaration> = {};
	for (const [name, rawArtifact] of Object.entries(artifacts)) {
		const artifact = asRecord(rawArtifact);
		if (!artifact || typeof artifact.type !== 'string') {
			continue;
		}

		normalized[name] = { type: artifact.type as ArtifactType };
	}

	return normalized;
}

function normalizeOutputs(rawOutputs: unknown): Record<string, string> {
	const outputs = asRecord(rawOutputs);
	if (!outputs) {
		return {};
	}

	const normalized: Record<string, string> = {};
	for (const [key, rawValue] of Object.entries(outputs)) {
		if (typeof rawValue === 'string') {
			normalized[key] = rawValue;
		}
	}
	return normalized;
}

function normalizeSteps(rawSteps: unknown): StepDefinition[] {
	if (!Array.isArray(rawSteps)) {
		return [];
	}

	return rawSteps
		.map((rawStep) => {
			const step = asRecord(rawStep);
			if (
				!step ||
				typeof step.id !== 'string' ||
				typeof step.kind !== 'string'
			) {
				return null;
			}

			const dependsOn = Array.isArray(step.depends_on)
				? step.depends_on.filter(
						(item): item is string => typeof item === 'string',
					)
				: undefined;

			return {
				...step,
				depends_on: dependsOn,
			} as StepDefinition;
		})
		.filter((step): step is StepDefinition => step !== null);
}

export function normalizeTemplate(rawTemplate: unknown): WorkflowTemplate {
	const template = asRecord(rawTemplate) ?? {};
	return {
		artifacts: normalizeArtifacts(template.artifacts),
		inputs: normalizeInputs(template.inputs),
		outputs: normalizeOutputs(template.outputs),
		steps: normalizeSteps(template.steps),
		workflow: normalizeWorkflow(template.workflow),
	};
}

export function loadTemplateFromFile(templatePath: string): LoadedTemplate {
	const content = readFileSync(templatePath, 'utf8');
	const parsed = parse(content);
	return {
		template: normalizeTemplate(parsed),
		templatePath: path.resolve(templatePath),
	};
}

export function loadTemplatesFromDir(templatesDir: string): LoadedTemplate[] {
	if (!existsSync(templatesDir)) {
		return [];
	}

	const entries = readdirSync(templatesDir, { withFileTypes: true })
		.filter((entry) => entry.isFile())
		.filter((entry) =>
			YAML_EXTENSIONS.has(path.extname(entry.name).toLowerCase()),
		)
		.sort((left, right) => left.name.localeCompare(right.name));

	return entries.map((entry) =>
		loadTemplateFromFile(path.join(templatesDir, entry.name)),
	);
}

export function loadTemplatesFromWorkspace(
	rootDir: string = process.cwd(),
): LoadedTemplate[] {
	const templatesDir = path.join(rootDir, 'templates');
	return loadTemplatesFromDir(templatesDir);
}
