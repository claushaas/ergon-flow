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
import { PROVIDERS, STEP_KINDS } from '@ergon/shared';
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

export interface TemplateValidationError {
	message: string;
	path: string;
}

export interface TemplateValidationResult {
	errors: TemplateValidationError[];
	valid: boolean;
}

const STEP_KIND_SET: ReadonlySet<string> = new Set(STEP_KINDS);
const PROVIDER_SET: ReadonlySet<string> = new Set(PROVIDERS);

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

function isNonEmptyString(value: unknown): value is string {
	return typeof value === 'string' && value.trim().length > 0;
}

function pushError(
	errors: TemplateValidationError[],
	path: string,
	message: string,
): void {
	errors.push({ message, path });
}

function validateStepRequiredFields(
	step: StepDefinition,
	index: number,
	errors: TemplateValidationError[],
): void {
	const stepPath = `steps[${index}]`;

	switch (step.kind) {
		case 'agent': {
			const provider = (step as { provider?: unknown }).provider;
			if (!isNonEmptyString(provider)) {
				pushError(
					errors,
					`${stepPath}.provider`,
					'agent step requires a non-empty provider',
				);
				return;
			}
			if (!PROVIDER_SET.has(provider)) {
				pushError(
					errors,
					`${stepPath}.provider`,
					`agent provider "${provider}" is not supported`,
				);
			}
			return;
		}
		case 'artifact': {
			const artifactStep = step as { input?: unknown; operation?: unknown };
			if (!isNonEmptyString(artifactStep.input)) {
				pushError(
					errors,
					`${stepPath}.input`,
					'artifact step requires a non-empty input',
				);
			}
			if (!isNonEmptyString(artifactStep.operation)) {
				pushError(
					errors,
					`${stepPath}.operation`,
					'artifact step requires a non-empty operation',
				);
			}
			return;
		}
		case 'condition': {
			const conditionStep = step as { expression?: unknown };
			if (!isNonEmptyString(conditionStep.expression)) {
				pushError(
					errors,
					`${stepPath}.expression`,
					'condition step requires a non-empty expression',
				);
			}
			return;
		}
		case 'exec': {
			const execStep = step as { command?: unknown };
			if (!isNonEmptyString(execStep.command)) {
				pushError(
					errors,
					`${stepPath}.command`,
					'exec step requires a non-empty command',
				);
			}
			return;
		}
		case 'notify': {
			const notifyStep = step as { channel?: unknown; message?: unknown };
			if (!isNonEmptyString(notifyStep.channel)) {
				pushError(
					errors,
					`${stepPath}.channel`,
					'notify step requires a non-empty channel',
				);
			}
			if (!isNonEmptyString(notifyStep.message)) {
				pushError(
					errors,
					`${stepPath}.message`,
					'notify step requires a non-empty message',
				);
			}
			return;
		}
		case 'manual':
			return;
		default:
			return;
	}
}

export function validateTemplate(
	template: WorkflowTemplate,
): TemplateValidationResult {
	const errors: TemplateValidationError[] = [];

	if (!isNonEmptyString(template.workflow.id)) {
		pushError(errors, 'workflow.id', 'workflow.id is required');
	}
	if (
		!Number.isInteger(template.workflow.version) ||
		template.workflow.version <= 0
	) {
		pushError(
			errors,
			'workflow.version',
			'workflow.version must be a positive integer',
		);
	}
	if (!Array.isArray(template.steps) || template.steps.length === 0) {
		pushError(errors, 'steps', 'at least one step is required');
	}

	const stepIds = new Set<string>();
	for (const [index, step] of template.steps.entries()) {
		const stepPath = `steps[${index}]`;
		const stepId = (step as { id?: unknown }).id;
		const stepKind = (step as { kind?: unknown }).kind;

		if (!isNonEmptyString(stepId)) {
			pushError(errors, `${stepPath}.id`, 'step.id is required');
		} else if (stepIds.has(stepId)) {
			pushError(
				errors,
				`${stepPath}.id`,
				`duplicate step id "${stepId}" is not allowed`,
			);
		} else {
			stepIds.add(stepId);
		}

		if (!isNonEmptyString(stepKind)) {
			pushError(errors, `${stepPath}.kind`, 'step.kind is required');
			continue;
		}

		if (!STEP_KIND_SET.has(stepKind)) {
			pushError(
				errors,
				`${stepPath}.kind`,
				`step.kind "${stepKind}" is not supported`,
			);
			continue;
		}

		validateStepRequiredFields(step, index, errors);
	}

	for (const [index, step] of template.steps.entries()) {
		const stepPath = `steps[${index}]`;
		const dependsOn = (step as { depends_on?: unknown }).depends_on;
		if (!dependsOn) {
			continue;
		}
		if (!Array.isArray(dependsOn)) {
			pushError(
				errors,
				`${stepPath}.depends_on`,
				'depends_on must be an array of step ids',
			);
			continue;
		}

		for (const [dependsIndex, dependency] of dependsOn.entries()) {
			const dependencyPath = `${stepPath}.depends_on[${dependsIndex}]`;
			if (!isNonEmptyString(dependency)) {
				pushError(
					errors,
					dependencyPath,
					'dependency id must be a non-empty string',
				);
				continue;
			}
			if (!stepIds.has(dependency)) {
				pushError(
					errors,
					dependencyPath,
					`depends_on references unknown step "${dependency}"`,
				);
			}
			if (dependency === step.id) {
				pushError(errors, dependencyPath, 'step cannot depend on itself');
			}
		}
	}

	return {
		errors,
		valid: errors.length === 0,
	};
}

export function assertValidTemplate(template: WorkflowTemplate): void {
	const validation = validateTemplate(template);
	if (validation.valid) {
		return;
	}

	const summary = validation.errors
		.map((error) => `${error.path}: ${error.message}`)
		.join('; ');
	throw new Error(`Template validation failed: ${summary}`);
}

export function loadAndValidateTemplateFromFile(
	templatePath: string,
): LoadedTemplate {
	const loaded = loadTemplateFromFile(templatePath);
	assertValidTemplate(loaded.template);
	return loaded;
}
