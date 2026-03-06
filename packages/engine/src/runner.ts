import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import type {
	ErrorCode,
	StepDefinition,
	StepRunStatus,
	WorkflowTemplate,
} from '@ergon/shared';
import { ERROR_CODES } from '@ergon/shared';
import {
	appendEvent,
	artifactPath,
	artifactsDir,
	assertSafeSegment,
	createStepRun,
	getRun,
	getWorkflow,
	insertArtifact,
	listArtifacts,
	listStepRuns,
	markRunFailed,
	markRunSucceeded,
	markRunWaitingManual,
	updateRunCursor,
	updateStepRunStatus,
} from '@ergon/storage';
import type {
	Executor,
	ExecutorArtifact,
	ExecutorResult,
} from './executors/index.js';
import {
	createExecutionContext,
	type ExecutorRegistry,
} from './executors/index.js';
import {
	interpolateTemplateString,
	loadAndValidateTemplateFromFile,
	renderStepRequestPayload,
} from './templating/index.js';

const EXACT_INTERPOLATION_PATTERN = /^{{\s*([^{}]+?)\s*}}$/;
const ERROR_CODE_SET: ReadonlySet<string> = new Set(ERROR_CODES);

export interface ExecuteRunOptions {
	artifactBaseDir?: string;
	db: DatabaseSync;
	executors: ExecutorRegistry;
	rootDir?: string;
}

interface ResolvedRunState {
	artifacts: Record<string, unknown>;
	completedSteps: Map<string, { output: unknown; status: StepRunStatus }>;
	nextStepIndex: number;
}

interface SkippedStepOptions {
	output: Record<string, unknown>;
	runId: string;
	step: StepDefinition;
	stepRun: ReturnType<typeof createStepRun>;
	stepRuns: ReturnType<typeof listStepRuns>;
}

interface FailureMetadata {
	code: ErrorCode;
	detail: Record<string, unknown>;
	message: string;
}

interface PreparedStepExecution {
	context: ReturnType<typeof createExecutionContext>;
	request: Record<string, unknown> | undefined;
	stepAttempt: number;
	stepRun: ReturnType<typeof createStepRun>;
}

const MAX_SAFE_JSON_BYTES = 128 * 1024;

function parseJson<T>(value: string | null, fallback: T): T {
	if (!value) {
		return fallback;
	}
	return JSON.parse(value) as T;
}

function safeJsonStringify(value: unknown): string | null {
	if (value === undefined) {
		return null;
	}

	const seen = new WeakSet<object>();
	let serialized: string;
	try {
		serialized = JSON.stringify(value, (_key, currentValue) => {
			if (!currentValue || typeof currentValue !== 'object') {
				return currentValue;
			}
			if (seen.has(currentValue)) {
				return '[Circular]';
			}
			seen.add(currentValue);
			return currentValue;
		});
	} catch {
		return JSON.stringify('[Unserializable]');
	}

	if (serialized === undefined) {
		return null;
	}

	const bytes = Buffer.byteLength(serialized, 'utf8');
	if (bytes <= MAX_SAFE_JSON_BYTES) {
		return serialized;
	}

	return JSON.stringify({
		note: 'truncated',
		size_bytes: bytes,
	});
}

function normalizeForStorage(value: unknown): unknown {
	const serialized = safeJsonStringify(value);
	if (!serialized) {
		return value === undefined ? undefined : null;
	}
	return JSON.parse(serialized);
}

function isErrorCode(value: unknown): value is ErrorCode {
	return typeof value === 'string' && ERROR_CODE_SET.has(value);
}

function getStepExecutor(
	executors: ExecutorRegistry,
	step: StepDefinition,
): Executor<StepDefinition> {
	return executors.get(step.kind);
}

function prepareStepExecution(
	db: DatabaseSync,
	runId: string,
	workerId: string,
	stepIndex: number,
	step: StepDefinition,
	template: WorkflowTemplate,
	inputs: Record<string, unknown>,
	artifacts: Record<string, unknown>,
	stepRuns: ReturnType<typeof listStepRuns>,
): PreparedStepExecution {
	const stepAttempt = getStepAttempt(step.id, stepRuns);
	const context = createExecutionContext({
		artifacts,
		inputs,
		run: {
			attempt: stepAttempt,
			runId,
			stepIndex,
			workerId,
			workflowId: template.workflow.id,
			workflowVersion: template.workflow.version,
		},
	});
	const request = buildRequestSnapshot(step, context);
	const stepRun = createStepRun(db, runId, step.id, stepAttempt, step.kind, {
		dependsOn: step.depends_on ?? [],
		request,
	});

	return {
		context,
		request,
		stepAttempt,
		stepRun,
	};
}

function getStepAttempt(
	stepId: string,
	stepRuns: ReturnType<typeof listStepRuns>,
): number {
	return (
		Math.max(
			0,
			...stepRuns
				.filter((stepRun) => stepRun.step_id === stepId)
				.map((stepRun) => stepRun.attempt),
		) + 1
	);
}

function buildCompletedSteps(
	stepRuns: ReturnType<typeof listStepRuns>,
): Map<string, { output: unknown; status: StepRunStatus }> {
	const latestByStep = new Map<
		string,
		{ attempt: number; output: unknown; status: StepRunStatus }
	>();

	for (const stepRun of stepRuns) {
		const current = latestByStep.get(stepRun.step_id);
		if (current && current.attempt >= stepRun.attempt) {
			continue;
		}
		latestByStep.set(stepRun.step_id, {
			attempt: stepRun.attempt,
			output: parseJson(stepRun.output_json, null),
			status: stepRun.status,
		});
	}

	return new Map(
		Array.from(latestByStep.entries()).map(([stepId, value]) => [
			stepId,
			{
				output: value.output,
				status: value.status,
			},
		]),
	);
}

function getArtifactFilePath(
	rootDir: string,
	artifactRow: ReturnType<typeof listArtifacts>[number],
): string {
	return resolvePathWithinBase(rootDir, artifactRow.path, 'artifact path');
}

function resolvePathWithinBase(
	baseDir: string,
	unsafePath: string,
	label: string,
): string {
	if (path.isAbsolute(unsafePath)) {
		throw new Error(`Unsafe ${label}: absolute paths are not allowed`);
	}

	const resolvedBase = path.resolve(baseDir);
	const resolvedPath = path.resolve(resolvedBase, unsafePath);
	const relative = path.relative(resolvedBase, resolvedPath);
	if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
		throw new Error(`Unsafe ${label}: path escapes base directory`);
	}

	return resolvedPath;
}

function restoreArtifacts(
	artifactBaseDir: string,
	runArtifacts: ReturnType<typeof listArtifacts>,
): Record<string, unknown> {
	const restored: Record<string, unknown> = {};

	for (const artifact of runArtifacts) {
		const artifactFile = getArtifactFilePath(artifactBaseDir, artifact);
		if (!existsSync(artifactFile)) {
			continue;
		}

		const content = readFileSync(artifactFile, 'utf8');
		restored[artifact.name] =
			artifact.type === 'text' ? content : JSON.parse(content);
	}

	return restored;
}

function resolveNextStepIndex(
	template: WorkflowTemplate,
	completedSteps: Map<string, { output: unknown; status: StepRunStatus }>,
	currentStepIndex: number,
): number {
	let nextStepIndex = Math.max(0, currentStepIndex);

	while (nextStepIndex < template.steps.length) {
		const step = template.steps[nextStepIndex];
		if (!step) {
			break;
		}

		const previous = completedSteps.get(step.id);
		if (previous?.status === 'skipped' || previous?.status === 'succeeded') {
			nextStepIndex += 1;
			continue;
		}

		break;
	}

	return nextStepIndex;
}

function resolveRunState(
	artifactBaseDir: string,
	template: WorkflowTemplate,
	run: NonNullable<ReturnType<typeof getRun>>,
	db: DatabaseSync,
): ResolvedRunState {
	const stepRuns = listStepRuns(db, run.id);
	const completedSteps = buildCompletedSteps(stepRuns);
	return {
		artifacts: restoreArtifacts(artifactBaseDir, listArtifacts(db, run.id)),
		completedSteps,
		nextStepIndex: resolveNextStepIndex(
			template,
			completedSteps,
			run.current_step_index,
		),
	};
}

function buildRequestSnapshot(
	step: StepDefinition,
	context: ReturnType<typeof createExecutionContext>,
): Record<string, unknown> | undefined {
	switch (step.kind) {
		case 'agent':
			return {
				model: step.model,
				provider: step.provider,
				...renderStepRequestPayload(step, {
					artifacts: context.artifacts,
					inputs: context.inputs,
				}),
			};
		case 'exec':
			return {
				command: renderStepRequestPayload(step, {
					artifacts: context.artifacts,
					inputs: context.inputs,
				}).command,
				cwd: step.cwd
					? interpolateTemplateString(step.cwd, {
							artifacts: context.artifacts,
							inputs: context.inputs,
						})
					: undefined,
				env: step.env
					? Object.fromEntries(
							Object.entries(step.env).map(([key, value]) => [
								key,
								interpolateTemplateString(value, {
									artifacts: context.artifacts,
									inputs: context.inputs,
								}),
							]),
						)
					: undefined,
			};
		case 'condition':
			return {
				expression: interpolateTemplateString(step.expression, {
					artifacts: context.artifacts,
					inputs: context.inputs,
				}),
			};
		case 'manual':
			return {
				message: step.message?.trim() || undefined,
			};
		case 'notify':
			return {
				...renderStepRequestPayload(step, {
					artifacts: context.artifacts,
					inputs: context.inputs,
				}),
				channel: step.channel,
				target: step.target
					? interpolateTemplateString(step.target, {
							artifacts: context.artifacts,
							inputs: context.inputs,
						})
					: undefined,
			};
		case 'artifact':
			return {
				input: step.input,
				operation: step.operation,
			};
		default: {
			const exhaustive: never = step;
			void exhaustive;
			return undefined;
		}
	}
}

function shouldSkipStep(
	step: StepDefinition,
	completedSteps: Map<string, { output: unknown; status: StepRunStatus }>,
): boolean {
	const dependencies = step.depends_on ?? [];
	if (dependencies.length === 0) {
		return false;
	}

	for (const dependency of dependencies) {
		const state = completedSteps.get(dependency);
		if (!state) {
			return false;
		}
		if (state.status === 'failed' || state.status === 'skipped') {
			return true;
		}
		if (
			state.status === 'succeeded' &&
			isConditionOutput(state.output) &&
			state.output.passed === false
		) {
			return true;
		}
	}

	return false;
}

function isConditionOutput(value: unknown): value is { passed: boolean } {
	if (!value || typeof value !== 'object') {
		return false;
	}
	return (
		'passed' in value &&
		typeof (value as { passed?: unknown }).passed === 'boolean'
	);
}

function getArtifactFileName(artifact: ExecutorArtifact): string {
	assertSafeSegment(artifact.name, 'artifact name');
	switch (artifact.type) {
		case 'text':
			return `${artifact.name}.txt`;
		default:
			return `${artifact.name}.json`;
	}
}

function toArtifactFileContent(artifact: ExecutorArtifact): string {
	if (artifact.type === 'text' && typeof artifact.value === 'string') {
		return artifact.value;
	}
	return JSON.stringify(artifact.value, null, 2);
}

function toStoragePath(rootDir: string, filePath: string): string {
	return path.relative(rootDir, filePath).split(path.sep).join('/');
}

function persistArtifacts(
	db: DatabaseSync,
	rootDir: string,
	runId: string,
	stepRunId: string,
	artifacts: ExecutorArtifact[],
): Record<string, unknown> {
	const stored: Record<string, unknown> = {};

	for (const artifact of artifacts) {
		const artifactFile = artifactPath(
			rootDir,
			runId,
			getArtifactFileName(artifact),
		);
		mkdirSync(path.dirname(artifactFile), { recursive: true });
		const content = toArtifactFileContent(artifact);
		writeFileSync(artifactFile, content, 'utf8');
		const buffer = Buffer.from(content, 'utf8');

		insertArtifact(db, {
			meta: null,
			name: artifact.name,
			path: toStoragePath(rootDir, artifactFile),
			runId,
			sha256: createHash('sha256').update(buffer).digest('hex'),
			sizeBytes: buffer.byteLength,
			stepRunId,
			type: artifact.type,
		});
		stored[artifact.name] = artifact.value;
	}

	return stored;
}

function appendStepEvents(
	db: DatabaseSync,
	runId: string,
	stepRunId: string,
	workerId: string,
	events: ExecutorResult['events'],
): void {
	for (const event of events ?? []) {
		appendEvent(db, runId, event.type, event.payload, {
			actor: `worker:${workerId}`,
			stepRunId,
		});
	}
}

function handleSkippedStep(
	db: DatabaseSync,
	workerId: string,
	options: SkippedStepOptions,
): void {
	updateStepRunStatus(db, options.stepRun.id, 'skipped', {
		finishedAt: new Date().toISOString(),
		output: options.output,
	});
	appendEvent(
		db,
		options.runId,
		'step_skipped',
		{
			step_id: options.step.id,
			...options.output,
		},
		{
			actor: `worker:${workerId}`,
			stepRunId: options.stepRun.id,
		},
	);
	options.stepRuns.push({
		...options.stepRun,
		output_json: safeJsonStringify(options.output),
		status: 'skipped',
	});
}

function resolveReferenceValue(
	reference: string,
	inputs: Record<string, unknown>,
	artifacts: Record<string, unknown>,
): unknown {
	const [root, ...pathParts] = reference.trim().split('.');
	const source =
		root === 'inputs' ? inputs : root === 'artifacts' ? artifacts : null;
	if (!source || pathParts.length === 0) {
		throw new Error(`Unsupported workflow output reference "${reference}"`);
	}

	let current: unknown = source;
	for (const part of pathParts) {
		if (!current || typeof current !== 'object' || Array.isArray(current)) {
			throw new Error(`Workflow output reference "${reference}" was not found`);
		}
		current = (current as Record<string, unknown>)[part];
		if (current === undefined) {
			throw new Error(`Workflow output reference "${reference}" was not found`);
		}
	}

	return current;
}

function resolveWorkflowOutputs(
	template: WorkflowTemplate,
	inputs: Record<string, unknown>,
	artifacts: Record<string, unknown>,
): Record<string, unknown> {
	const outputs = template.outputs ?? {};
	const resolved: Record<string, unknown> = {};

	for (const [key, value] of Object.entries(outputs)) {
		const exactMatch = value.match(EXACT_INTERPOLATION_PATTERN);
		if (exactMatch?.[1]) {
			resolved[key] = resolveReferenceValue(exactMatch[1], inputs, artifacts);
			continue;
		}

		resolved[key] = interpolateTemplateString(value, { artifacts, inputs });
	}

	return resolved;
}

function getFailureCodeForStep(
	step: StepDefinition,
	error: unknown,
): ErrorCode {
	if (
		error &&
		typeof error === 'object' &&
		'code' in error &&
		isErrorCode((error as { code?: unknown }).code)
	) {
		return (error as { code: ErrorCode }).code;
	}

	switch (step.kind) {
		case 'agent':
		case 'notify':
			return 'provider_error';
		case 'artifact':
			return 'artifact_failed';
		case 'condition':
			return 'condition_failed';
		case 'exec':
			return 'exec_failed';
		case 'manual':
			return 'manual_rejected';
		default: {
			const exhaustive: never = step;
			void exhaustive;
			return 'schema_invalid';
		}
	}
}

function buildFailureMetadata(
	step: StepDefinition,
	error: unknown,
): FailureMetadata {
	return {
		code: getFailureCodeForStep(step, error),
		detail:
			error instanceof Error
				? {
						name: error.name,
						stack: error.stack,
					}
				: {
						error,
					},
		message:
			error instanceof Error ? error.message : `Step "${step.id}" failed`,
	};
}

function canRetryStep(
	step: StepDefinition,
	attempt: number,
	failureCode: ErrorCode,
): boolean {
	const retry = step.retry;
	if (!retry) {
		return false;
	}

	const maxAttempts = Math.max(1, Math.trunc(retry.max_attempts));
	if (attempt >= maxAttempts) {
		return false;
	}

	if (!retry.on || retry.on.length === 0) {
		return true;
	}

	return retry.on.includes(failureCode);
}

function markStepRetry(
	db: DatabaseSync,
	runId: string,
	workerId: string,
	stepId: string,
	stepRunId: string,
	nextAttempt: number,
	failure: FailureMetadata,
	output?: Record<string, unknown>,
): void {
	updateStepRunStatus(db, stepRunId, 'failed', {
		errorCode: failure.code,
		errorDetail: normalizeForStorage(failure.detail),
		errorMessage: failure.message,
		finishedAt: new Date().toISOString(),
		output: normalizeForStorage(output),
	});
	appendEvent(
		db,
		runId,
		'step_failed',
		{
			error_code: failure.code,
			error_message: failure.message,
			step_id: stepId,
		},
		{
			actor: `worker:${workerId}`,
			stepRunId,
		},
	);
	appendEvent(
		db,
		runId,
		'step_retry',
		{
			error_code: failure.code,
			next_attempt: nextAttempt,
			step_id: stepId,
		},
		{
			actor: `worker:${workerId}`,
			stepRunId,
		},
	);
}

function recordRetryableFailure(
	db: DatabaseSync,
	runId: string,
	workerId: string,
	stepId: string,
	stepRun: ReturnType<typeof createStepRun>,
	stepRuns: ReturnType<typeof listStepRuns>,
	nextAttempt: number,
	failure: FailureMetadata,
	output?: Record<string, unknown>,
): void {
	markStepRetry(
		db,
		runId,
		workerId,
		stepId,
		stepRun.id,
		nextAttempt,
		failure,
		output,
	);
	stepRuns.push({
		...stepRun,
		error_code: failure.code,
		error_detail_json: safeJsonStringify(failure.detail),
		error_message: failure.message,
		output_json: safeJsonStringify(output),
		status: 'failed',
	});
}

function markStepFailed(
	db: DatabaseSync,
	runId: string,
	workerId: string,
	step: StepDefinition,
	stepRunId: string,
	error: unknown,
	output?: Record<string, unknown>,
): never {
	const failure = buildFailureMetadata(step, error);

	updateStepRunStatus(db, stepRunId, 'failed', {
		errorCode: failure.code,
		errorDetail: normalizeForStorage(failure.detail),
		errorMessage: failure.message,
		finishedAt: new Date().toISOString(),
		output: normalizeForStorage(output),
	});
	appendEvent(
		db,
		runId,
		'step_failed',
		{
			error_code: failure.code,
			error_message: failure.message,
			step_id: step.id,
		},
		{
			actor: `worker:${workerId}`,
			stepRunId,
		},
	);
	appendEvent(
		db,
		runId,
		'workflow_failed',
		{
			error_code: failure.code,
			error_message: failure.message,
			step_id: step.id,
		},
		{
			actor: `worker:${workerId}`,
		},
	);
	markRunFailed(db, runId, workerId, {
		errorCode: failure.code,
		errorDetail: normalizeForStorage(failure.detail),
		errorMessage: failure.message,
	});
	throw error instanceof Error ? error : new Error(failure.message);
}

function hasWorkflowCanceledEvent(db: DatabaseSync, runId: string): boolean {
	const existingEvent = db
		.prepare(
			"SELECT 1 FROM events WHERE run_id = ? AND type = 'workflow_canceled' LIMIT 1;",
		)
		.get(runId);

	return Boolean(existingEvent);
}

function abortIfCanceled(
	db: DatabaseSync,
	runId: string,
	workerId: string,
	reason: 'canceled_before_next_step' | 'canceled_during_step',
): ReturnType<typeof getRun> {
	const currentRun = getRun(db, runId);
	if (!currentRun) {
		throw new Error(`Workflow run "${runId}" was not found`);
	}

	if (currentRun.status !== 'canceled') {
		return null;
	}

	if (!hasWorkflowCanceledEvent(db, runId)) {
		appendEvent(
			db,
			runId,
			'workflow_canceled',
			{
				reason,
			},
			{
				actor: `worker:${workerId}`,
			},
		);
	}

	return currentRun;
}

export async function executeRun(
	runId: string,
	workerId: string,
	options: ExecuteRunOptions,
) {
	const rootDir = path.resolve(options.rootDir ?? process.cwd());
	const artifactBaseDir = path.resolve(options.artifactBaseDir ?? rootDir);
	const run = getRun(options.db, runId);
	if (!run) {
		throw new Error(`Workflow run "${runId}" was not found`);
	}
	if (run.status !== 'running' || run.claimed_by !== workerId) {
		throw new Error(
			`Workflow run "${runId}" is not claimed by worker "${workerId}"`,
		);
	}

	const workflow = getWorkflow(
		options.db,
		run.workflow_id,
		run.workflow_version,
	);
	if (!workflow) {
		throw new Error(
			`Workflow "${run.workflow_id}"@${run.workflow_version} was not found`,
		);
	}

	const templatePath = resolvePathWithinBase(
		rootDir,
		workflow.source_path,
		'workflow source_path',
	);
	const { template } = loadAndValidateTemplateFromFile(templatePath);
	const inputs = parseJson<Record<string, unknown>>(run.inputs_json, {});
	const state = resolveRunState(artifactBaseDir, template, run, options.db);
	const stepRuns = listStepRuns(options.db, run.id);

	mkdirSync(artifactsDir(artifactBaseDir, run.id), { recursive: true });

	for (
		let stepIndex = state.nextStepIndex;
		stepIndex < template.steps.length;
		stepIndex += 1
	) {
		const canceledRun = abortIfCanceled(
			options.db,
			run.id,
			workerId,
			'canceled_before_next_step',
		);
		if (canceledRun) {
			return canceledRun;
		}

		const step = template.steps[stepIndex];
		if (!step) {
			break;
		}

		updateRunCursor(options.db, run.id, workerId, stepIndex, step.id);

		if (shouldSkipStep(step, state.completedSteps)) {
			const { stepRun } = prepareStepExecution(
				options.db,
				run.id,
				workerId,
				stepIndex,
				step,
				template,
				inputs,
				state.artifacts,
				stepRuns,
			);
			const skippedOutput = {
				reason: 'dependency_not_satisfied',
				skipped_by: step.depends_on ?? [],
			};
			state.completedSteps.set(step.id, {
				output: skippedOutput,
				status: 'skipped',
			});
			handleSkippedStep(options.db, workerId, {
				output: skippedOutput,
				runId: run.id,
				step,
				stepRun,
				stepRuns,
			});
			updateRunCursor(
				options.db,
				run.id,
				workerId,
				stepIndex + 1,
				template.steps[stepIndex + 1]?.id ?? null,
			);
			continue;
		}

		while (true) {
			const { context, request, stepAttempt, stepRun } = prepareStepExecution(
				options.db,
				run.id,
				workerId,
				stepIndex,
				step,
				template,
				inputs,
				state.artifacts,
				stepRuns,
			);

			updateStepRunStatus(options.db, stepRun.id, 'running', {
				request,
				startedAt: new Date().toISOString(),
			});
			appendEvent(
				options.db,
				run.id,
				'step_started',
				{
					attempt: stepAttempt,
					step_id: step.id,
					step_kind: step.kind,
				},
				{
					actor: `worker:${workerId}`,
					stepRunId: stepRun.id,
				},
			);

			let result: ExecutorResult;
			try {
				result = await getStepExecutor(options.executors, step).execute(
					step,
					context,
				);
			} catch (error) {
				const failure = buildFailureMetadata(step, error);
				if (canRetryStep(step, stepAttempt, failure.code)) {
					recordRetryableFailure(
						options.db,
						run.id,
						workerId,
						step.id,
						stepRun,
						stepRuns,
						stepAttempt + 1,
						failure,
					);
					continue;
				}
				markStepFailed(options.db, run.id, workerId, step, stepRun.id, error);
			}

			appendStepEvents(options.db, run.id, stepRun.id, workerId, result.events);

			if (result.status === 'failed') {
				const failure = buildFailureMetadata(
					step,
					new Error(`Step "${step.id}" returned status failed`),
				);
				if (canRetryStep(step, stepAttempt, failure.code)) {
					recordRetryableFailure(
						options.db,
						run.id,
						workerId,
						step.id,
						stepRun,
						stepRuns,
						stepAttempt + 1,
						failure,
						result.outputs,
					);
					continue;
				}
				markStepFailed(
					options.db,
					run.id,
					workerId,
					step,
					stepRun.id,
					new Error(`Step "${step.id}" returned status failed`),
					result.outputs,
				);
			}

			if (result.status === 'waiting_manual') {
				const canceledRun = abortIfCanceled(
					options.db,
					run.id,
					workerId,
					'canceled_during_step',
				);
				if (canceledRun) {
					return canceledRun;
				}

				updateStepRunStatus(options.db, stepRun.id, 'waiting_manual', {
					finishedAt: new Date().toISOString(),
					output: normalizeForStorage(result.outputs),
				});
				markRunWaitingManual(options.db, run.id, workerId);
				return getRun(options.db, run.id);
			}

			if (result.status === 'skipped') {
				const skippedOutput = result.outputs ?? {};
				state.completedSteps.set(step.id, {
					output: skippedOutput,
					status: 'skipped',
				});
				handleSkippedStep(options.db, workerId, {
					output: skippedOutput,
					runId: run.id,
					step,
					stepRun,
					stepRuns,
				});
				const canceledRun = abortIfCanceled(
					options.db,
					run.id,
					workerId,
					'canceled_during_step',
				);
				if (canceledRun) {
					return canceledRun;
				}
				updateRunCursor(
					options.db,
					run.id,
					workerId,
					stepIndex + 1,
					template.steps[stepIndex + 1]?.id ?? null,
				);
				break;
			}

			const storedArtifacts = persistArtifacts(
				options.db,
				artifactBaseDir,
				run.id,
				stepRun.id,
				result.artifacts ?? [],
			);
			Object.assign(state.artifacts, storedArtifacts);
			updateStepRunStatus(options.db, stepRun.id, 'succeeded', {
				finishedAt: new Date().toISOString(),
				output: normalizeForStorage(result.outputs),
			});
			appendEvent(
				options.db,
				run.id,
				'step_succeeded',
				{
					artifact_names: Object.keys(storedArtifacts),
					step_id: step.id,
				},
				{
					actor: `worker:${workerId}`,
					stepRunId: stepRun.id,
				},
			);
			state.completedSteps.set(step.id, {
				output: result.outputs,
				status: 'succeeded',
			});
			const canceledRun = abortIfCanceled(
				options.db,
				run.id,
				workerId,
				'canceled_during_step',
			);
			if (canceledRun) {
				return canceledRun;
			}
			updateRunCursor(
				options.db,
				run.id,
				workerId,
				stepIndex + 1,
				template.steps[stepIndex + 1]?.id ?? null,
			);
			stepRuns.push({
				...stepRun,
				output_json: safeJsonStringify(result.outputs),
				status: 'succeeded',
			});
			break;
		}
	}

	const workflowResult = resolveWorkflowOutputs(
		template,
		inputs,
		state.artifacts,
	);
	appendEvent(
		options.db,
		run.id,
		'workflow_succeeded',
		{
			result: workflowResult,
		},
		{
			actor: `worker:${workerId}`,
		},
	);
	markRunSucceeded(options.db, run.id, workerId, {
		result: workflowResult,
	});
	return getRun(options.db, run.id);
}
