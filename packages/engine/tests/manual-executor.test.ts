import type { ManualStepDefinition } from '@ergon/shared';
import { beforeEach, describe, expect, it } from 'vitest';
import { createExecutionContext } from '../src/executors/index.js';
import { ManualExecutor } from '../src/executors/manual.js';

describe('ManualExecutor (E5)', () => {
	let executor: ManualExecutor;

	beforeEach(() => {
		executor = new ManualExecutor();
	});

	function createTestContext(runId: string, stepIndex: number) {
		return createExecutionContext({
			inputs: {},
			run: {
				attempt: 1,
				runId,
				stepIndex,
				workflowId: 'deploy.production',
				workflowVersion: 1,
			},
		});
	}

	it('transitions the step to waiting_manual and emits a manual_waiting event', async () => {
		const step: ManualStepDefinition = {
			id: 'manual.review',
			kind: 'manual',
			message: 'Approve deployment to production',
		};
		const context = createTestContext('run_1', 2);

		const result = await executor.execute(step, context);

		expect(result).toEqual({
			events: [
				{
					payload: {
						message: 'Approve deployment to production',
						runId: 'run_1',
						stepId: 'manual.review',
					},
					type: 'manual_waiting',
				},
			],
			status: 'waiting_manual',
		});
	});

	it('omits an empty message from the output payload', async () => {
		const step: ManualStepDefinition = {
			id: 'manual.review',
			kind: 'manual',
			message: '   ',
		};
		const context = createTestContext('run_2', 3);

		const result = await executor.execute(step, context);

		expect(result).toEqual({
			events: [
				{
					payload: {
						runId: 'run_2',
						stepId: 'manual.review',
					},
					type: 'manual_waiting',
				},
			],
			status: 'waiting_manual',
		});
	});
});
