import type { ErrorCode, StepDefinition } from '@claushaas/ergon-shared';
import { ERROR_CODES } from '@claushaas/ergon-shared';

const ERROR_CODE_SET: ReadonlySet<string> = new Set(ERROR_CODES);

function isKnownErrorCode(value: string): value is ErrorCode {
	return ERROR_CODE_SET.has(value);
}

function assertUnreachable(value: never): never {
	throw new Error(`Unexpected step kind: ${JSON.stringify(value)}`);
}

export function getDefaultFailureCodeForStep(step: StepDefinition): ErrorCode {
	switch (step.kind) {
		case 'agent':
		case 'notify':
			return 'provider_error';
		case 'artifact':
			return 'artifact_failed';
		case 'condition':
			return 'condition_failed';
		case 'delay':
			return 'delay_failed';
		case 'exec':
			return 'exec_failed';
		case 'manual':
			return 'manual_rejected';
		default:
			return assertUnreachable(step);
	}
}

export function getFailureCodeForStep(
	step: StepDefinition,
	error: unknown,
): ErrorCode {
	if (
		error &&
		typeof error === 'object' &&
		'code' in error &&
		typeof (error as { code?: unknown }).code === 'string'
	) {
		const candidate = (error as { code: string }).code;
		if (isKnownErrorCode(candidate)) {
			return candidate;
		}
	}

	return getDefaultFailureCodeForStep(step);
}
