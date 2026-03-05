import type { ExecStepDefinition, ManualStepDefinition } from '@ergon/shared';
import { describe, expect, it } from 'vitest';
import {
	createExecutionContext,
	type ExecutionContext,
	type Executor,
	ExecutorRegistry,
	type ExecutorResult,
} from '../src/executors/index.js';

class StubExecExecutor implements Executor<ExecStepDefinition> {
	public readonly kind = 'exec' as const;

	public async execute(
		step: ExecStepDefinition,
		context: ExecutionContext,
	): Promise<ExecutorResult> {
		return {
			artifacts: [
				{
					name: 'exec.stdout',
					type: 'text',
					value: `ran ${step.command} for ${String(context.inputs.repo_path)}`,
				},
			],
			outputs: {
				command: step.command,
				runId: context.run.runId,
			},
			status: 'succeeded',
		};
	}
}

class StubManualExecutor implements Executor<ManualStepDefinition> {
	public readonly kind = 'manual' as const;

	public async execute(
		_step: ManualStepDefinition,
		_context: ExecutionContext,
	): Promise<ExecutorResult> {
		return {
			status: 'waiting_manual',
		};
	}
}

describe('executor framework (E1)', () => {
	it('creates an execution context with inputs, artifact lookup and run metadata', () => {
		const context = createExecutionContext({
			artifacts: {
				analysis: { summary: 'ready' },
			},
			inputs: {
				repo_path: '/tmp/repo',
			},
			run: {
				attempt: 2,
				runId: 'run_123',
				stepIndex: 1,
				workerId: 'worker_a',
				workflowId: 'code.refactor',
				workflowVersion: 3,
			},
		});

		expect(context.inputs).toEqual({ repo_path: '/tmp/repo' });
		expect(context.run).toEqual({
			attempt: 2,
			runId: 'run_123',
			stepIndex: 1,
			workerId: 'worker_a',
			workflowId: 'code.refactor',
			workflowVersion: 3,
		});
		expect(context.hasArtifact('analysis')).toBe(true);
		expect(context.getArtifact('analysis')).toEqual({ summary: 'ready' });
		expect(Object.isFrozen(context.artifacts)).toBe(true);
		expect(Object.isFrozen(context.inputs)).toBe(true);
		expect(Object.isFrozen(context.run)).toBe(true);
		expect(() => context.getRequiredArtifact('missing')).toThrow(
			'Artifact "missing" was not found in execution context',
		);
	});

	it('registers and resolves executors by step kind', async () => {
		const registry = new ExecutorRegistry([
			new StubExecExecutor(),
			new StubManualExecutor(),
		]);
		const step: ExecStepDefinition = {
			command: 'pnpm test',
			id: 'step.exec',
			kind: 'exec',
		};
		const context = createExecutionContext({
			inputs: { repo_path: '/workspace/repo' },
			run: {
				attempt: 1,
				runId: 'run_456',
				stepIndex: 0,
				workflowId: 'code.refactor',
				workflowVersion: 1,
			},
		});

		expect(registry.has('exec')).toBe(true);
		expect(registry.has('notify')).toBe(false);

		const result = await registry.get(step.kind).execute(step, context);

		expect(result).toEqual({
			artifacts: [
				{
					name: 'exec.stdout',
					type: 'text',
					value: 'ran pnpm test for /workspace/repo',
				},
			],
			outputs: {
				command: 'pnpm test',
				runId: 'run_456',
			},
			status: 'succeeded',
		});
	});

	it('rejects duplicate registrations and missing executors', () => {
		const registry = new ExecutorRegistry();

		registry.register(new StubExecExecutor());

		expect(() => registry.register(new StubExecExecutor())).toThrow(
			'Executor already registered for step kind "exec"',
		);
		expect(() => registry.get('notify')).toThrow(
			'No executor registered for step kind "notify"',
		);
	});
});
