import type {
	AgentResult,
	AgentStepDefinition,
	ClientRequest,
	ExecutionClient,
	Provider,
} from '@ergon/shared';
import { describe, expect, it, vi } from 'vitest';
import { AgentExecutor } from '../src/executors/agent.js';
import { createExecutionContext } from '../src/executors/index.js';

class StubClient implements ExecutionClient {
	public readonly provider: Provider;
	private readonly result: AgentResult;
	private readonly spy: ReturnType<typeof vi.fn>;

	public constructor(
		provider: Provider,
		result: AgentResult,
		spy: ReturnType<typeof vi.fn>,
	) {
		this.provider = provider;
		this.result = result;
		this.spy = spy;
	}

	public async run(request: ClientRequest): Promise<AgentResult> {
		this.spy(request);
		return this.result;
	}
}

describe('AgentExecutor (E2)', () => {
	it('renders the prompt, calls the client and emits an analysis artifact', async () => {
		const runSpy = vi.fn();
		const client = new StubClient(
			'openrouter',
			{
				raw: { id: 'resp_1' },
				text: '{"summary":"repo state","risks":["low"]}',
			},
			runSpy,
		);
		const executor = new AgentExecutor({
			resolveClient: () => client,
		});
		const step: AgentStepDefinition = {
			id: 'analyze',
			kind: 'agent',
			model: 'deepseek/deepseek-v3.2',
			provider: 'openrouter',
			prompt: 'Task {{ inputs.task }} / Existing {{ artifacts.repo.summary }}',
		};
		const context = createExecutionContext({
			artifacts: {
				repo: { summary: 'parser' },
			},
			inputs: {
				task: 'refactor',
			},
			run: {
				attempt: 2,
				runId: 'run_1',
				stepIndex: 0,
				workflowId: 'code.refactor',
				workflowVersion: 1,
			},
		});

		const result = await executor.execute(step, context);

		expect(runSpy).toHaveBeenCalledWith({
			model: 'deepseek/deepseek-v3.2',
			prompt: 'Task "refactor" / Existing "parser"',
			provider: 'openrouter',
		});
		expect(result).toEqual({
			artifacts: [
				{
					name: 'analysis',
					type: 'analysis',
					value: { risks: ['low'], summary: 'repo state' },
				},
			],
			outputs: {
				artifact_name: 'analysis',
				attempt: 2,
				provider: 'openrouter',
				request: {
					model: 'deepseek/deepseek-v3.2',
					prompt: 'Task "refactor" / Existing "parser"',
					provider: 'openrouter',
				},
				response: { id: 'resp_1' },
				text: '{"summary":"repo state","risks":["low"]}',
			},
			status: 'succeeded',
		});
	});

	it('produces a plan artifact for plan steps with structured JSON output', async () => {
		const executor = new AgentExecutor({
			resolveClient: () =>
				new StubClient(
					'openrouter',
					{
						text: '{"steps":[{"id":"one"}]}',
					},
					vi.fn(),
				),
		});
		const step: AgentStepDefinition = {
			id: 'plan',
			kind: 'agent',
			provider: 'openrouter',
			prompt: 'Return a plan',
		};
		const context = createExecutionContext({
			inputs: {},
			run: {
				attempt: 1,
				runId: 'run_2',
				stepIndex: 1,
				workflowId: 'code.refactor',
				workflowVersion: 1,
			},
		});

		const result = await executor.execute(step, context);

		expect(result.artifacts).toEqual([
			{
				name: 'plan',
				type: 'plan',
				value: { steps: [{ id: 'one' }] },
			},
		]);
	});

	it('falls back to text artifacts for non-JSON provider output', async () => {
		const executor = new AgentExecutor({
			resolveClient: () =>
				new StubClient(
					'codex',
					{
						text: 'diff --git a/file.ts b/file.ts',
					},
					vi.fn(),
				),
		});
		const step: AgentStepDefinition = {
			id: 'patch',
			kind: 'agent',
			provider: 'codex',
			prompt: 'Generate diff',
		};
		const context = createExecutionContext({
			inputs: {},
			run: {
				attempt: 1,
				runId: 'run_3',
				stepIndex: 2,
				workflowId: 'code.refactor',
				workflowVersion: 1,
			},
		});

		const result = await executor.execute(step, context);

		expect(result.artifacts).toEqual([
			{
				name: 'patch',
				type: 'text',
				value: 'diff --git a/file.ts b/file.ts',
			},
		]);
	});

	it('fails when the agent step does not render a prompt', async () => {
		const executor = new AgentExecutor({
			resolveClient: () =>
				new StubClient(
					'openrouter',
					{
						text: 'unused',
					},
					vi.fn(),
				),
		});
		const step: AgentStepDefinition = {
			id: 'plan',
			kind: 'agent',
			provider: 'openrouter',
		};
		const context = createExecutionContext({
			inputs: {},
			run: {
				attempt: 1,
				runId: 'run_4',
				stepIndex: 0,
				workflowId: 'code.refactor',
				workflowVersion: 1,
			},
		});

		await expect(executor.execute(step, context)).rejects.toThrow(
			'Agent step "plan" did not render a prompt',
		);
	});
});
