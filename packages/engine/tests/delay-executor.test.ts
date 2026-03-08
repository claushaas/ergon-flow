import type { DelayStepDefinition } from '@claushaas/ergon-shared';
import { describe, expect, it } from 'vitest';
import { DelayExecutor } from '../src/executors/delay.js';
import { createExecutionContext } from '../src/executors/index.js';

describe('DelayExecutor (E6)', () => {
	it('waits for the configured duration and succeeds', async () => {
		const executor = new DelayExecutor();
		const step: DelayStepDefinition = {
			duration_ms: 10,
			id: 'pause',
			kind: 'delay',
		};
		const startedAt = Date.now();
		const context = createExecutionContext({
			inputs: {},
			run: {
				attempt: 1,
				runId: 'run_1',
				stepIndex: 0,
				workflowId: 'workflow.delay',
				workflowVersion: 1,
			},
		});

		const result = await executor.execute(step, context);
		const elapsed = Date.now() - startedAt;

		expect(elapsed).toBeGreaterThanOrEqual(5);
		expect(result).toEqual({
			outputs: {
				duration_ms: 10,
			},
			status: 'succeeded',
		});
	});

	it('aborts when the execution signal is canceled', async () => {
		const executor = new DelayExecutor();
		const step: DelayStepDefinition = {
			duration_ms: 50,
			id: 'pause',
			kind: 'delay',
		};
		const controller = new AbortController();
		const context = createExecutionContext({
			inputs: {},
			run: {
				attempt: 1,
				runId: 'run_2',
				stepIndex: 1,
				workflowId: 'workflow.delay',
				workflowVersion: 1,
			},
			signal: controller.signal,
		});

		setTimeout(() => controller.abort(new Error('stop waiting')), 5);

		await expect(executor.execute(step, context)).rejects.toThrow(
			'stop waiting',
		);
	});
});
