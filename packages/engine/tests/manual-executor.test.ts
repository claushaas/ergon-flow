import type { ManualStepDefinition } from '@ergon/shared';
import { describe, expect, it } from 'vitest';
import { createExecutionContext } from '../src/executors/index.js';
import { ManualExecutor } from '../src/executors/manual.js';

describe('ManualExecutor (E5)', () => {
	it('transitions the step to waiting_manual and emits a manual_waiting event', async () => {
		const executor = new ManualExecutor();
		const step: ManualStepDefinition = {
			id: 'manual.review',
			kind: 'manual',
			message: 'Approve deployment to production',
		};
		const context = createExecutionContext({
			inputs: {},
			run: {
				attempt: 1,
				runId: 'run_1',
				stepIndex: 2,
				workflowId: 'deploy.production',
				workflowVersion: 1,
			},
		});

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
			outputs: {
				message: 'Approve deployment to production',
				runId: 'run_1',
				stepId: 'manual.review',
			},
			status: 'waiting_manual',
		});
	});

	it('omits an empty message from the output payload', async () => {
		const executor = new ManualExecutor();
		const step: ManualStepDefinition = {
			id: 'manual.review',
			kind: 'manual',
			message: '   ',
		};
		const context = createExecutionContext({
			inputs: {},
			run: {
				attempt: 1,
				runId: 'run_2',
				stepIndex: 3,
				workflowId: 'deploy.production',
				workflowVersion: 1,
			},
		});

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
			outputs: {
				runId: 'run_2',
				stepId: 'manual.review',
			},
			status: 'waiting_manual',
		});
	});
});
