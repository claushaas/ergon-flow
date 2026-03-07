import { createHash } from 'node:crypto';
import {
	existsSync,
	mkdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from 'node:fs';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import type {
	ErrorCode,
	StepDefinition,
	StepRunStatus,
	WorkflowTemplate,
} from '@claushaas/ergon-shared';
import { ERROR_CODES } from '@claushaas/ergon-shared';
import {
	appendEvent,
	appendEventInTransaction,
	artifactsDir,
	assertSafeSegment,
	createStepRun,
	getLatestEventForStepRun,
	getRun,
	getRunForClaim,
	getWaitingManualStepRun,
	getWorkflow,
	insertArtifact,
	listArtifacts,
	listStepRuns,
	markRunFailed,
	markRunSucceeded,
	markRunWaitingManual,
	type RunClaim,
	type StepRunRow,
	stepAttemptDir,
	updateRunCursor,
	updateStepRunStatus,
	withRunClaim,
} from '@claushaas/ergon-storage';
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
	resolveTemplateReference,
} from './templating/index.js';
import { assertWorkflowTemplateIdentity } from './workflowIdentity.js';

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
}

interface ExecuteStepOptions {
	artifactBaseDir: string;
	claim: RunClaim;
	db: DatabaseSync;
	executors: ExecutorRegistry;
	inputs: Record<string, unknown>;
	runId: string;
	state: ResolvedRunState;
	step: StepDefinition;
	stepIndex: number;
	stepRuns: ReturnType<typeof listStepRuns>;
	template: WorkflowTemplate;
}

interface ExecuteStepResult {
	canceledRun: ReturnType<typeof getRun>;
	shouldContinue: boolean;
}

interface PersistedArtifact {
	filePath: string;
	name: string;
	record: {
		meta: unknown;
		mime: string | null;
		path: string;
		runId: string;
		sha256: string;
		sizeBytes: number;
		stepRunId: string;
		type: string;
	};
	value: unknown;
}

type StepAbortReason =
	| {
			message: string;
			type: 'canceled';
	  }
	| {
			message: string;
			type: 'claim_lost';
	  }
	| {
			message: string;
			type: 'timeout';
	  };

const MAX_SAFE_JSON_BYTES = 128 * 1024;
const EXECUTION_ABORT_POLL_MS = 50;
const REDACTED_VALUE = '[REDACTED]';
const REDACTED_KEY_PATTERN =
	/(api[_-]?key|authorization|token|secret|password|prompt|target|env|messages?)/i;

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

function redactForPersistence(
	value: unknown,
	key?: string,
	seen: WeakSet<object> = new WeakSet(),
): unknown {
	if (value === undefined || value === null) {
		return value;
	}
	if (key && REDACTED_KEY_PATTERN.test(key)) {
		return REDACTED_VALUE;
	}
	if (Array.isArray(value)) {
		return value.map((entry) => redactForPersistence(entry, undefined, seen));
	}
	if (typeof value === 'object') {
		if (seen.has(value as object)) {
			return '[Circular]';
		}
		seen.add(value as object);
		const redacted: Record<string, unknown> = {};
		for (const [entryKey, entryValue] of Object.entries(
			value as Record<string, unknown>,
		)) {
			redacted[entryKey] = redactForPersistence(entryValue, entryKey, seen);
		}
		return redacted;
	}
	return value;
}

function persistableValue(value: unknown): unknown {
	return normalizeForStorage(redactForPersistence(value));
}

function createAbortError(message: string): Error {
	return Object.assign(new Error(message), { name: 'AbortError' });
}

function createStepAbortMonitor(
	db: DatabaseSync,
	runId: string,
	claim: RunClaim,
	step: StepDefinition,
): {
	abortReason: () => StepAbortReason | null;
	cleanup: () => void;
	signal: AbortSignal;
} {
	const controller = new AbortController();
	let abortReason: StepAbortReason | null = null;
	let timeoutId: NodeJS.Timeout | undefined;
	const intervalId = setInterval(() => {
		if (controller.signal.aborted) {
			return;
		}
		const currentRun = getRun(db, runId);
		if (!currentRun) {
			abortReason = {
				message: `Workflow run "${runId}" disappeared while step "${step.id}" was running`,
				type: 'claim_lost',
			};
			controller.abort(createAbortError(abortReason.message));
			return;
		}
		if (currentRun.status === 'canceled') {
			abortReason = {
				message: `Workflow run "${runId}" was canceled during step "${step.id}"`,
				type: 'canceled',
			};
			controller.abort(createAbortError(abortReason.message));
			return;
		}
		if (
			currentRun.status !== 'running' ||
			currentRun.claimed_by !== claim.workerId ||
			currentRun.claim_epoch !== claim.claimEpoch
		) {
			abortReason = {
				message: `Workflow run "${runId}" lost claim ownership during step "${step.id}"`,
				type: 'claim_lost',
			};
			controller.abort(createAbortError(abortReason.message));
		}
	}, EXECUTION_ABORT_POLL_MS);

	if (typeof step.timeout_ms === 'number') {
		timeoutId = setTimeout(() => {
			if (controller.signal.aborted) {
				return;
			}
			abortReason = {
				message: `Step "${step.id}" exceeded timeout of ${step.timeout_ms}ms`,
				type: 'timeout',
			};
			controller.abort(createAbortError(abortReason.message));
		}, step.timeout_ms);
	}

	return {
		abortReason: () => abortReason,
		cleanup: () => {
			clearInterval(intervalId);
			if (timeoutId) {
				clearTimeout(timeoutId);
			}
		},
		signal: controller.signal,
	};
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
	runId: string,
	workerId: string,
	stepIndex: number,
	step: StepDefinition,
	template: WorkflowTemplate,
	inputs: Record<string, unknown>,
	artifacts: Record<string, unknown>,
	signal: AbortSignal,
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
		signal,
	});
	const request = buildRequestSnapshot(step, context);

	return {
		context,
		request,
		stepAttempt,
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

function startStepAttempt(
	db: DatabaseSync,
	runId: string,
	claim: RunClaim,
	step: StepDefinition,
	stepAttempt: number,
	stepIndex: number,
	request: Record<string, unknown> | undefined,
): StepRunRow | null {
	return withRunClaim(db, runId, claim, () => {
		const now = new Date().toISOString();
		const persistableRequest = persistableValue(request);
		const stepRun = createStepRun(db, runId, step.id, stepAttempt, step.kind, {
			dependsOn: step.depends_on ?? [],
			request: persistableRequest,
		});
		appendEventInTransaction(
			db,
			runId,
			'step_scheduled',
			{
				attempt: stepAttempt,
				step_id: step.id,
				step_kind: step.kind,
			},
			{
				actor: `worker:${claim.workerId}`,
				stepRunId: stepRun.id,
				ts: now,
			},
		);
		updateRunCursor(
			db,
			runId,
			claim.workerId,
			claim.claimEpoch,
			stepIndex,
			step.id,
		);
		updateStepRunStatus(db, stepRun.id, 'running', {
			request: persistableRequest,
			startedAt: now,
		});
		appendEventInTransaction(
			db,
			runId,
			'step_started',
			{
				attempt: stepAttempt,
				step_id: step.id,
				step_kind: step.kind,
			},
			{
				actor: `worker:${claim.workerId}`,
				stepRunId: stepRun.id,
				ts: now,
			},
		);
		return stepRun;
	});
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
	stepRuns: ReturnType<typeof listStepRuns>,
	runArtifacts: ReturnType<typeof listArtifacts>,
): Record<string, unknown> {
	const restored: Record<string, unknown> = {};
	const succeededStepRunIds = new Set(
		stepRuns
			.filter((stepRun) => stepRun.status === 'succeeded')
			.map((stepRun) => stepRun.id),
	);

	for (const artifact of runArtifacts) {
		if (!succeededStepRunIds.has(artifact.step_run_id)) {
			continue;
		}
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
		artifacts: restoreArtifacts(
			artifactBaseDir,
			stepRuns,
			listArtifacts(db, run.id),
		),
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
				message: renderStepRequestPayload(step, {
					artifacts: context.artifacts,
					inputs: context.inputs,
				}).message,
			};
		case 'notify':
			return {
				...renderStepRequestPayload(step, {
					artifacts: context.artifacts,
					inputs: context.inputs,
				}),
				channel: interpolateTemplateString(step.channel, {
					artifacts: context.artifacts,
					inputs: context.inputs,
				}),
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

function stageArtifacts(
	rootDir: string,
	runId: string,
	step: StepDefinition,
	stepAttempt: number,
	stepRunId: string,
	artifacts: ExecutorArtifact[],
): PersistedArtifact[] {
	const _stored: Record<string, unknown> = {};
	const persisted: PersistedArtifact[] = [];

	for (const artifact of artifacts) {
		const artifactFile = path.join(
			stepAttemptDir(rootDir, runId, step.id, stepAttempt),
			getArtifactFileName(artifact),
		);
		mkdirSync(path.dirname(artifactFile), { recursive: true });
		const content = toArtifactFileContent(artifact);
		writeFileSync(artifactFile, content, 'utf8');
		const buffer = Buffer.from(content, 'utf8');

		persisted.push({
			filePath: artifactFile,
			name: artifact.name,
			record: {
				meta: {
					attempt: stepAttempt,
					step_id: step.id,
				},
				mime: null,
				path: toStoragePath(rootDir, artifactFile),
				runId,
				sha256: createHash('sha256').update(buffer).digest('hex'),
				sizeBytes: buffer.byteLength,
				stepRunId,
				type: artifact.type,
			},
			value: artifact.value,
		});
	}

	return persisted;
}

function cleanupStagedArtifacts(artifacts: PersistedArtifact[]): void {
	for (const artifact of artifacts) {
		rmSync(artifact.filePath, { force: true });
	}
}

function finalizeArtifacts(
	db: DatabaseSync,
	artifacts: PersistedArtifact[],
): Record<string, unknown> {
	const stored: Record<string, unknown> = {};
	for (const artifact of artifacts) {
		insertArtifact(db, {
			meta: artifact.record.meta,
			mime: artifact.record.mime,
			name: artifact.name,
			path: artifact.record.path,
			runId: artifact.record.runId,
			sha256: artifact.record.sha256,
			sizeBytes: artifact.record.sizeBytes,
			stepRunId: artifact.record.stepRunId,
			type: artifact.record.type,
		});
		stored[artifact.name] = artifact.value;
	}
	return stored;
}

function appendStepEventsInTransaction(
	db: DatabaseSync,
	runId: string,
	stepRunId: string,
	workerId: string,
	events: ExecutorResult['events'],
): void {
	for (const event of events ?? []) {
		appendEventInTransaction(db, runId, event.type, event.payload, {
			actor: `worker:${workerId}`,
			stepRunId,
		});
	}
}

function handleSkippedStep(
	db: DatabaseSync,
	claim: RunClaim,
	options: SkippedStepOptions,
	nextStepIndex: number,
	nextStepId: string | null,
): boolean {
	const skipped = withRunClaim(db, options.runId, claim, () => {
		updateStepRunStatus(db, options.stepRun.id, 'skipped', {
			finishedAt: new Date().toISOString(),
			output: persistableValue(options.output),
		});
		appendEventInTransaction(
			db,
			options.runId,
			'step_skipped',
			{
				step_id: options.step.id,
				...options.output,
			},
			{
				actor: `worker:${claim.workerId}`,
				stepRunId: options.stepRun.id,
			},
		);
		updateRunCursor(
			db,
			options.runId,
			claim.workerId,
			claim.claimEpoch,
			nextStepIndex,
			nextStepId,
		);
		return true;
	});
	if (!skipped) {
		return false;
	}
	options.stepRuns.push({
		...options.stepRun,
		output_json: safeJsonStringify(persistableValue(options.output)),
		status: 'skipped',
	});
	return true;
}

function resolveWorkflowOutputs(
	template: WorkflowTemplate,
	inputs: Record<string, unknown>,
	artifacts: Record<string, unknown>,
): Record<string, unknown> {
	const outputs = template.outputs ?? {};
	const resolved: Record<string, unknown> = {};

	for (const [key, value] of Object.entries(outputs)) {
		if (/^(artifacts|inputs)\./.test(value.trim())) {
			resolved[key] = resolveTemplateReference(value, { artifacts, inputs });
			continue;
		}
		const exactMatch = value.match(EXACT_INTERPOLATION_PATTERN);
		if (exactMatch?.[1]) {
			resolved[key] = resolveTemplateReference(exactMatch[1], {
				artifacts,
				inputs,
			});
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
	claim: RunClaim,
	stepId: string,
	stepRunId: string,
	nextAttempt: number,
	failure: FailureMetadata,
	output?: Record<string, unknown>,
): boolean {
	return Boolean(
		withRunClaim(db, runId, claim, () => {
			updateStepRunStatus(db, stepRunId, 'failed', {
				errorCode: failure.code,
				errorDetail: persistableValue(failure.detail),
				errorMessage: failure.message,
				finishedAt: new Date().toISOString(),
				output: persistableValue(output),
			});
			appendEventInTransaction(
				db,
				runId,
				'step_failed',
				{
					error_code: failure.code,
					error_message: failure.message,
					step_id: stepId,
				},
				{
					actor: `worker:${claim.workerId}`,
					stepRunId,
				},
			);
			appendEventInTransaction(
				db,
				runId,
				'step_retry',
				{
					error_code: failure.code,
					next_attempt: nextAttempt,
					step_id: stepId,
				},
				{
					actor: `worker:${claim.workerId}`,
					stepRunId,
				},
			);
			return true;
		}),
	);
}

function recordRetryableFailure(
	db: DatabaseSync,
	runId: string,
	claim: RunClaim,
	stepId: string,
	stepRun: ReturnType<typeof createStepRun>,
	stepRuns: ReturnType<typeof listStepRuns>,
	nextAttempt: number,
	failure: FailureMetadata,
	output?: Record<string, unknown>,
): void {
	const recorded = markStepRetry(
		db,
		runId,
		claim,
		stepId,
		stepRun.id,
		nextAttempt,
		failure,
		output,
	);
	if (!recorded) {
		throw new Error(
			`Workflow run "${runId}" lost claim ownership before retrying step "${stepId}"`,
		);
	}
	stepRuns.push({
		...stepRun,
		error_code: failure.code,
		error_detail_json: safeJsonStringify(persistableValue(failure.detail)),
		error_message: failure.message,
		output_json: safeJsonStringify(persistableValue(output)),
		status: 'failed',
	});
}

function markStepFailed(
	db: DatabaseSync,
	runId: string,
	claim: RunClaim,
	step: StepDefinition,
	stepRunId: string,
	error: unknown,
	output?: Record<string, unknown>,
): never {
	const failure = buildFailureMetadata(step, error);
	const failed = withRunClaim(db, runId, claim, () => {
		updateStepRunStatus(db, stepRunId, 'failed', {
			errorCode: failure.code,
			errorDetail: persistableValue(failure.detail),
			errorMessage: failure.message,
			finishedAt: new Date().toISOString(),
			output: persistableValue(output),
		});
		appendEventInTransaction(
			db,
			runId,
			'step_failed',
			{
				error_code: failure.code,
				error_message: failure.message,
				step_id: step.id,
			},
			{
				actor: `worker:${claim.workerId}`,
				stepRunId,
			},
		);
		appendEventInTransaction(
			db,
			runId,
			'workflow_failed',
			{
				error_code: failure.code,
				error_message: failure.message,
				step_id: step.id,
			},
			{
				actor: `worker:${claim.workerId}`,
			},
		);
		markRunFailed(db, runId, claim.workerId, claim.claimEpoch, {
			errorCode: failure.code,
			errorDetail: persistableValue(failure.detail),
			errorMessage: failure.message,
		});
		return true;
	});
	if (!failed) {
		throw new Error(
			`Workflow run "${runId}" lost claim ownership before failing step "${step.id}"`,
		);
	}
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

function markCanceledStep(
	db: DatabaseSync,
	runId: string,
	workerId: string,
	step: StepDefinition,
	stepRunId: string,
): void {
	const failure = buildFailureMetadata(
		step,
		new Error(`Workflow run "${runId}" was canceled during step "${step.id}"`),
	);
	updateStepRunStatus(db, stepRunId, 'failed', {
		errorCode: failure.code,
		errorDetail: persistableValue({
			...failure.detail,
			reason: 'canceled_during_step',
		}),
		errorMessage: failure.message,
		finishedAt: new Date().toISOString(),
	});
	const latestFailureEvent = getLatestEventForStepRun(db, runId, stepRunId, [
		'step_failed',
	]);
	if (!latestFailureEvent) {
		appendEvent(
			db,
			runId,
			'step_failed',
			{
				error_code: failure.code,
				error_message: failure.message,
				reason: 'canceled_during_step',
				step_id: step.id,
			},
			{
				actor: `worker:${workerId}`,
				stepRunId,
			},
		);
	}
}

function replaceStepRunSnapshot(
	stepRuns: ReturnType<typeof listStepRuns>,
	stepRunId: string,
	patch: Partial<ReturnType<typeof listStepRuns>[number]>,
): void {
	const index = stepRuns.findIndex((stepRun) => stepRun.id === stepRunId);
	if (index < 0) {
		return;
	}

	stepRuns[index] = {
		...stepRuns[index],
		...patch,
	};
}

function resumeApprovedManualStep(
	options: ExecuteStepOptions,
): ExecuteStepResult | null {
	if (options.step.kind !== 'manual') {
		return null;
	}

	const waitingStepRun = getWaitingManualStepRun(
		options.db,
		options.runId,
		options.step.id,
	);
	if (!waitingStepRun) {
		return null;
	}

	const approvalEvent = getLatestEventForStepRun(
		options.db,
		options.runId,
		waitingStepRun.id,
		['manual_approved'],
	);
	if (!approvalEvent) {
		return null;
	}

	const approvalOutput = {
		approved_at: approvalEvent.ts,
		approved_by: approvalEvent.actor,
		decision: 'approve',
	};
	const completed = withRunClaim(
		options.db,
		options.runId,
		options.claim,
		() => {
			updateStepRunStatus(options.db, waitingStepRun.id, 'succeeded', {
				finishedAt: approvalEvent.ts,
				output: persistableValue(approvalOutput),
			});
			appendEventInTransaction(
				options.db,
				options.runId,
				'step_succeeded',
				{
					artifact_names: [],
					step_id: options.step.id,
				},
				{
					actor: `worker:${options.claim.workerId}`,
					stepRunId: waitingStepRun.id,
				},
			);
			updateRunCursor(
				options.db,
				options.runId,
				options.claim.workerId,
				options.claim.claimEpoch,
				options.stepIndex + 1,
				options.template.steps[options.stepIndex + 1]?.id ?? null,
			);
			return true;
		},
	);
	if (!completed) {
		throw new Error(
			`Workflow run "${options.runId}" lost claim ownership while resuming manual step "${options.step.id}"`,
		);
	}
	options.state.completedSteps.set(options.step.id, {
		output: approvalOutput,
		status: 'succeeded',
	});
	replaceStepRunSnapshot(options.stepRuns, waitingStepRun.id, {
		finished_at: approvalEvent.ts,
		output_json: safeJsonStringify(persistableValue(approvalOutput)),
		status: 'succeeded',
	});

	const runCanceledDuringStep = abortIfCanceled(
		options.db,
		options.runId,
		options.claim.workerId,
		'canceled_during_step',
	);
	if (runCanceledDuringStep) {
		return {
			canceledRun: runCanceledDuringStep,
			shouldContinue: false,
		};
	}
	return {
		canceledRun: null,
		shouldContinue: true,
	};
}

function resolveStepAbort(
	options: ExecuteStepOptions,
	stepRunId: string,
	stepAbortReason: StepAbortReason | null,
): ExecuteStepResult | null {
	if (!stepAbortReason) {
		return null;
	}
	if (stepAbortReason.type === 'canceled') {
		abortIfCanceled(
			options.db,
			options.runId,
			options.claim.workerId,
			'canceled_during_step',
		);
		markCanceledStep(
			options.db,
			options.runId,
			options.claim.workerId,
			options.step,
			stepRunId,
		);
		return {
			canceledRun: getRun(options.db, options.runId),
			shouldContinue: false,
		};
	}
	if (stepAbortReason.type === 'claim_lost') {
		throw new Error(stepAbortReason.message);
	}
	return null;
}

async function executeStep(
	options: ExecuteStepOptions,
): Promise<ExecuteStepResult> {
	const canceledRun = abortIfCanceled(
		options.db,
		options.runId,
		options.claim.workerId,
		'canceled_before_next_step',
	);
	if (canceledRun) {
		return {
			canceledRun,
			shouldContinue: false,
		};
	}

	const resumedManualStep = resumeApprovedManualStep(options);
	if (resumedManualStep) {
		return resumedManualStep;
	}

	if (shouldSkipStep(options.step, options.state.completedSteps)) {
		const { request, stepAttempt } = prepareStepExecution(
			options.runId,
			options.claim.workerId,
			options.stepIndex,
			options.step,
			options.template,
			options.inputs,
			options.state.artifacts,
			new AbortController().signal,
			options.stepRuns,
		);
		const stepRun = startStepAttempt(
			options.db,
			options.runId,
			options.claim,
			options.step,
			stepAttempt,
			options.stepIndex,
			request,
		);
		if (!stepRun) {
			throw new Error(
				`Workflow run "${options.runId}" lost claim ownership before starting step "${options.step.id}"`,
			);
		}
		const skippedOutput = {
			reason: 'dependency_not_satisfied',
			skipped_by: options.step.depends_on ?? [],
		};
		options.state.completedSteps.set(options.step.id, {
			output: skippedOutput,
			status: 'skipped',
		});
		const skipped = handleSkippedStep(
			options.db,
			options.claim,
			{
				output: skippedOutput,
				runId: options.runId,
				step: options.step,
				stepRun,
				stepRuns: options.stepRuns,
			},
			options.stepIndex + 1,
			options.template.steps[options.stepIndex + 1]?.id ?? null,
		);
		if (!skipped) {
			throw new Error(
				`Workflow run "${options.runId}" lost claim ownership before skipping step "${options.step.id}"`,
			);
		}
		return {
			canceledRun: null,
			shouldContinue: true,
		};
	}

	while (true) {
		const abortMonitor = createStepAbortMonitor(
			options.db,
			options.runId,
			options.claim,
			options.step,
		);
		const { context, request, stepAttempt } = prepareStepExecution(
			options.runId,
			options.claim.workerId,
			options.stepIndex,
			options.step,
			options.template,
			options.inputs,
			options.state.artifacts,
			abortMonitor.signal,
			options.stepRuns,
		);
		const stepRun = startStepAttempt(
			options.db,
			options.runId,
			options.claim,
			options.step,
			stepAttempt,
			options.stepIndex,
			request,
		);
		if (!stepRun) {
			throw new Error(
				`Workflow run "${options.runId}" lost claim ownership before starting step "${options.step.id}"`,
			);
		}

		let result: ExecutorResult;
		try {
			result = await getStepExecutor(options.executors, options.step).execute(
				options.step,
				context,
			);
		} catch (error) {
			abortMonitor.cleanup();
			const abortedStep = resolveStepAbort(
				options,
				stepRun.id,
				abortMonitor.abortReason(),
			);
			if (abortedStep) {
				return abortedStep;
			}
			const failure = buildFailureMetadata(options.step, error);
			if (canRetryStep(options.step, stepAttempt, failure.code)) {
				recordRetryableFailure(
					options.db,
					options.runId,
					options.claim,
					options.step.id,
					stepRun,
					options.stepRuns,
					stepAttempt + 1,
					failure,
				);
				continue;
			}
			markStepFailed(
				options.db,
				options.runId,
				options.claim,
				options.step,
				stepRun.id,
				error,
			);
		}
		abortMonitor.cleanup();
		const abortedStep = resolveStepAbort(
			options,
			stepRun.id,
			abortMonitor.abortReason(),
		);
		if (abortedStep) {
			return abortedStep;
		}

		if (result.status === 'failed') {
			const failure = buildFailureMetadata(
				options.step,
				new Error(`Step "${options.step.id}" returned status failed`),
			);
			if (canRetryStep(options.step, stepAttempt, failure.code)) {
				recordRetryableFailure(
					options.db,
					options.runId,
					options.claim,
					options.step.id,
					stepRun,
					options.stepRuns,
					stepAttempt + 1,
					failure,
					persistableValue(result.outputs) as
						| Record<string, unknown>
						| undefined,
				);
				continue;
			}
			markStepFailed(
				options.db,
				options.runId,
				options.claim,
				options.step,
				stepRun.id,
				new Error(`Step "${options.step.id}" returned status failed`),
				persistableValue(result.outputs) as Record<string, unknown> | undefined,
			);
		}

		if (result.status === 'waiting_manual') {
			const runCanceledDuringStep = abortIfCanceled(
				options.db,
				options.runId,
				options.claim.workerId,
				'canceled_during_step',
			);
			if (runCanceledDuringStep) {
				markCanceledStep(
					options.db,
					options.runId,
					options.claim.workerId,
					options.step,
					stepRun.id,
				);
				return {
					canceledRun: runCanceledDuringStep,
					shouldContinue: false,
				};
			}
			const paused = withRunClaim(
				options.db,
				options.runId,
				options.claim,
				() => {
					appendStepEventsInTransaction(
						options.db,
						options.runId,
						stepRun.id,
						options.claim.workerId,
						result.events,
					);
					updateStepRunStatus(options.db, stepRun.id, 'waiting_manual', {
						finishedAt: new Date().toISOString(),
						output: persistableValue(result.outputs),
					});
					markRunWaitingManual(
						options.db,
						options.runId,
						options.claim.workerId,
						options.claim.claimEpoch,
					);
					return true;
				},
			);
			if (!paused) {
				throw new Error(
					`Workflow run "${options.runId}" lost claim ownership before pausing manual step "${options.step.id}"`,
				);
			}
			return {
				canceledRun: getRun(options.db, options.runId),
				shouldContinue: false,
			};
		}

		if (result.status === 'skipped') {
			const skippedOutput = result.outputs ?? {};
			options.state.completedSteps.set(options.step.id, {
				output: skippedOutput,
				status: 'skipped',
			});
			const skipped = handleSkippedStep(
				options.db,
				options.claim,
				{
					output: skippedOutput,
					runId: options.runId,
					step: options.step,
					stepRun,
					stepRuns: options.stepRuns,
				},
				options.stepIndex + 1,
				options.template.steps[options.stepIndex + 1]?.id ?? null,
			);
			if (!skipped) {
				const canceledAfterLoss = abortIfCanceled(
					options.db,
					options.runId,
					options.claim.workerId,
					'canceled_during_step',
				);
				if (canceledAfterLoss) {
					return {
						canceledRun: canceledAfterLoss,
						shouldContinue: false,
					};
				}
				throw new Error(
					`Workflow run "${options.runId}" lost claim ownership before finalizing skipped step "${options.step.id}"`,
				);
			}
			const runCanceledDuringStep = abortIfCanceled(
				options.db,
				options.runId,
				options.claim.workerId,
				'canceled_during_step',
			);
			if (runCanceledDuringStep) {
				markCanceledStep(
					options.db,
					options.runId,
					options.claim.workerId,
					options.step,
					stepRun.id,
				);
				return {
					canceledRun: runCanceledDuringStep,
					shouldContinue: false,
				};
			}
			return {
				canceledRun: null,
				shouldContinue: true,
			};
		}

		if (!getRunForClaim(options.db, options.runId, options.claim)) {
			const canceledAfterLoss = abortIfCanceled(
				options.db,
				options.runId,
				options.claim.workerId,
				'canceled_during_step',
			);
			if (canceledAfterLoss) {
				markCanceledStep(
					options.db,
					options.runId,
					options.claim.workerId,
					options.step,
					stepRun.id,
				);
				return {
					canceledRun: canceledAfterLoss,
					shouldContinue: false,
				};
			}
			throw new Error(
				`Workflow run "${options.runId}" lost claim ownership before persisting step "${options.step.id}"`,
			);
		}

		const stagedArtifacts = stageArtifacts(
			options.artifactBaseDir,
			options.runId,
			options.step,
			stepAttempt,
			stepRun.id,
			result.artifacts ?? [],
		);
		let storedArtifacts: Record<string, unknown> = {};
		const completed = withRunClaim(
			options.db,
			options.runId,
			options.claim,
			() => {
				storedArtifacts = finalizeArtifacts(options.db, stagedArtifacts);
				appendStepEventsInTransaction(
					options.db,
					options.runId,
					stepRun.id,
					options.claim.workerId,
					result.events,
				);
				updateStepRunStatus(options.db, stepRun.id, 'succeeded', {
					finishedAt: new Date().toISOString(),
					output: persistableValue(result.outputs),
				});
				appendEventInTransaction(
					options.db,
					options.runId,
					'step_succeeded',
					{
						artifact_names: Object.keys(storedArtifacts),
						step_id: options.step.id,
					},
					{
						actor: `worker:${options.claim.workerId}`,
						stepRunId: stepRun.id,
					},
				);
				updateRunCursor(
					options.db,
					options.runId,
					options.claim.workerId,
					options.claim.claimEpoch,
					options.stepIndex + 1,
					options.template.steps[options.stepIndex + 1]?.id ?? null,
				);
				return true;
			},
		);
		if (!completed) {
			cleanupStagedArtifacts(stagedArtifacts);
			const canceledAfterLoss = abortIfCanceled(
				options.db,
				options.runId,
				options.claim.workerId,
				'canceled_during_step',
			);
			if (canceledAfterLoss) {
				return {
					canceledRun: canceledAfterLoss,
					shouldContinue: false,
				};
			}
			throw new Error(
				`Workflow run "${options.runId}" lost claim ownership before completing step "${options.step.id}"`,
			);
		}
		Object.assign(options.state.artifacts, storedArtifacts);
		options.state.completedSteps.set(options.step.id, {
			output: result.outputs,
			status: 'succeeded',
		});
		const runCanceledDuringStep = abortIfCanceled(
			options.db,
			options.runId,
			options.claim.workerId,
			'canceled_during_step',
		);
		if (runCanceledDuringStep) {
			markCanceledStep(
				options.db,
				options.runId,
				options.claim.workerId,
				options.step,
				stepRun.id,
			);
			return {
				canceledRun: runCanceledDuringStep,
				shouldContinue: false,
			};
		}
		options.stepRuns.push({
			...stepRun,
			output_json: safeJsonStringify(persistableValue(result.outputs)),
			status: 'succeeded',
		});
		return {
			canceledRun: null,
			shouldContinue: true,
		};
	}
}

export async function executeRun(
	runId: string,
	claim: RunClaim,
	options: ExecuteRunOptions,
) {
	const rootDir = path.resolve(options.rootDir ?? process.cwd());
	const artifactBaseDir = path.resolve(options.artifactBaseDir ?? rootDir);
	const run = getRun(options.db, runId);
	if (!run) {
		throw new Error(`Workflow run "${runId}" was not found`);
	}
	if (
		run.status !== 'running' ||
		run.claimed_by !== claim.workerId ||
		run.claim_epoch !== claim.claimEpoch
	) {
		throw new Error(
			`Workflow run "${runId}" is not claimed by worker "${claim.workerId}"`,
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
	if (workflow.hash !== run.workflow_hash) {
		throw new Error(
			`Workflow run "${run.id}" cannot execute because its scheduled hash no longer matches the registered workflow`,
		);
	}

	const templatePath = resolvePathWithinBase(
		rootDir,
		workflow.source_path,
		'workflow source_path',
	);
	assertWorkflowTemplateIdentity(
		templatePath,
		run.workflow_hash,
		`Workflow run "${run.id}" cannot execute because the registered workflow source changed after scheduling`,
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
		const step = template.steps[stepIndex];
		if (!step) {
			break;
		}

		const stepResult = await executeStep({
			artifactBaseDir,
			claim,
			db: options.db,
			executors: options.executors,
			inputs,
			runId: run.id,
			state,
			step,
			stepIndex,
			stepRuns,
			template,
		});
		if (stepResult.canceledRun) {
			return stepResult.canceledRun;
		}
		if (!stepResult.shouldContinue) {
			break;
		}
	}

	const workflowResult = resolveWorkflowOutputs(
		template,
		inputs,
		state.artifacts,
	);
	const completedRun = withRunClaim(options.db, run.id, claim, () => {
		appendEventInTransaction(
			options.db,
			run.id,
			'workflow_succeeded',
			{
				result: workflowResult,
			},
			{
				actor: `worker:${claim.workerId}`,
			},
		);
		return markRunSucceeded(
			options.db,
			run.id,
			claim.workerId,
			claim.claimEpoch,
			{
				result: workflowResult,
			},
		);
	});
	if (!completedRun) {
		throw new Error(
			`Workflow run "${run.id}" lost claim ownership before completion`,
		);
	}
	return getRun(options.db, run.id);
}
