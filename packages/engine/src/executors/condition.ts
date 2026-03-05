import type { ConditionStepDefinition } from '@ergon/shared';
import { interpolateTemplateString } from '../templating/index.js';
import type { ExecutionContext, Executor, ExecutorResult } from './index.js';

function coerceConditionValue(value: unknown): boolean {
	if (typeof value === 'boolean') {
		return value;
	}
	if (typeof value === 'number') {
		return value !== 0;
	}
	if (typeof value === 'string') {
		const normalized = value.trim();
		if (!normalized) {
			return false;
		}
		if (normalized === 'true') {
			return true;
		}
		if (
			normalized === 'false' ||
			normalized === 'null' ||
			normalized === 'undefined'
		) {
			return false;
		}
		try {
			return coerceConditionValue(JSON.parse(normalized));
		} catch {
			return true;
		}
	}
	if (Array.isArray(value)) {
		return value.length > 0;
	}
	if (value && typeof value === 'object') {
		return Object.keys(value).length > 0;
	}
	return false;
}

export class ConditionExecutor implements Executor<ConditionStepDefinition> {
	public readonly kind = 'condition' as const;

	public async execute(
		step: ConditionStepDefinition,
		context: ExecutionContext,
	): Promise<ExecutorResult> {
		const expression = interpolateTemplateString(step.expression, {
			artifacts: context.artifacts,
			inputs: context.inputs,
		});
		const passed = coerceConditionValue(expression);

		return {
			outputs: {
				expression,
				passed,
			},
			status: 'succeeded',
		};
	}
}
