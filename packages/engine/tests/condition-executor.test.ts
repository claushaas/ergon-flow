import type { ConditionStepDefinition } from '@claushaas/ergon-shared';
import { describe, expect, it } from 'vitest';
import { ConditionExecutor } from '../src/executors/condition.js';
import { createExecutionContext } from '../src/executors/index.js';

describe('ConditionExecutor (E4)', () => {
	it('evaluates interpolated truthy values from inputs and artifacts', async () => {
		const executor = new ConditionExecutor();
		const step: ConditionStepDefinition = {
			expression: '{{ artifacts.plan.steps }}',
			id: 'has_plan_steps',
			kind: 'condition',
		};
		const context = createExecutionContext({
			artifacts: {
				plan: {
					steps: [{ id: 'one' }],
				},
			},
			inputs: {},
			run: {
				attempt: 1,
				runId: 'run_1',
				stepIndex: 0,
				workflowId: 'code.refactor',
				workflowVersion: 1,
			},
		});

		const result = await executor.execute(step, context);

		expect(result).toEqual({
			outputs: {
				expression: '[{"id":"one"}]',
				passed: true,
			},
			status: 'succeeded',
		});
	});

	it('evaluates falsy values from empty strings and zero-like literals', async () => {
		const executor = new ConditionExecutor();
		const emptyStep: ConditionStepDefinition = {
			expression: '{{ inputs.update_command }}',
			id: 'update.should',
			kind: 'condition',
		};
		const zeroStep: ConditionStepDefinition = {
			expression: '0',
			id: 'tests.should',
			kind: 'condition',
		};
		const context = createExecutionContext({
			inputs: {
				update_command: '',
			},
			run: {
				attempt: 1,
				runId: 'run_2',
				stepIndex: 1,
				workflowId: 'code.bump_deps',
				workflowVersion: 1,
			},
		});

		const emptyResult = await executor.execute(emptyStep, context);
		const zeroResult = await executor.execute(zeroStep, context);

		expect(emptyResult.outputs).toEqual({
			expression: '',
			passed: false,
		});
		expect(zeroResult.outputs).toEqual({
			expression: '0',
			passed: false,
		});
	});

	it('treats empty arrays and objects as false', async () => {
		const executor = new ConditionExecutor();
		const arrayStep: ConditionStepDefinition = {
			expression: '{{ artifacts.plan.steps }}',
			id: 'empty.array',
			kind: 'condition',
		};
		const objectStep: ConditionStepDefinition = {
			expression: '{{ artifacts.review }}',
			id: 'empty.object',
			kind: 'condition',
		};
		const context = createExecutionContext({
			artifacts: {
				plan: { steps: [] },
				review: {},
			},
			inputs: {},
			run: {
				attempt: 1,
				runId: 'run_3',
				stepIndex: 2,
				workflowId: 'code.refactor',
				workflowVersion: 1,
			},
		});

		const arrayResult = await executor.execute(arrayStep, context);
		const objectResult = await executor.execute(objectStep, context);

		expect(arrayResult.outputs).toEqual({
			expression: '[]',
			passed: false,
		});
		expect(objectResult.outputs).toEqual({
			expression: '{}',
			passed: false,
		});
	});

	it('evaluates non-empty non-JSON string literals as truthy', async () => {
		const executor = new ConditionExecutor();
		const step: ConditionStepDefinition = {
			expression: 'a random string',
			id: 'string.literal',
			kind: 'condition',
		};
		const context = createExecutionContext({
			inputs: {},
			run: {
				attempt: 1,
				runId: 'run_4',
				stepIndex: 3,
				workflowId: 'code.refactor',
				workflowVersion: 1,
			},
		});

		const result = await executor.execute(step, context);

		expect(result.outputs).toEqual({
			expression: 'a random string',
			passed: true,
		});
	});

	it('fails when interpolation references an unknown value', async () => {
		const executor = new ConditionExecutor();
		const step: ConditionStepDefinition = {
			expression: '{{ artifacts.missing }}',
			id: 'missing.ref',
			kind: 'condition',
		};
		const context = createExecutionContext({
			inputs: {},
			run: {
				attempt: 1,
				runId: 'run_5',
				stepIndex: 4,
				workflowId: 'code.refactor',
				workflowVersion: 1,
			},
		});

		await expect(executor.execute(step, context)).rejects.toThrow(
			'unknown interpolation reference "artifacts.missing"',
		);
	});
});
