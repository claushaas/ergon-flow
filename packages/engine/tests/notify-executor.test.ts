import type { NotifyStepDefinition } from '@ergon/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createExecutionContext } from '../src/executors/index.js';
import { NotifyExecutor } from '../src/executors/notify.js';

describe('NotifyExecutor (E6)', () => {
	let logMock: ReturnType<typeof vi.fn>;
	let resolveHostnameMock: ReturnType<typeof vi.fn>;

	beforeEach(() => {
		logMock = vi.fn();
		resolveHostnameMock = vi
			.fn()
			.mockResolvedValue([{ address: '93.184.216.34', family: 4 }]);
	});

	function createTestContext() {
		return createExecutionContext({
			artifacts: {
				summary: {
					status: 'passed',
				},
			},
			inputs: {
				repo: 'ergon-flow',
				webhook_url: 'https://example.test/hooks/notify',
			},
			run: {
				attempt: 1,
				runId: 'run_1',
				stepIndex: 4,
				workflowId: 'code.refactor',
				workflowVersion: 1,
			},
		});
	}

	it('logs stdout notifications with an interpolated message', async () => {
		const executor = new NotifyExecutor({
			log: logMock,
		});
		const step: NotifyStepDefinition = {
			channel: 'stdout',
			id: 'notify.stdout',
			kind: 'notify',
			message: '{{ inputs.repo }} status={{ artifacts.summary.status }}',
		};

		const result = await executor.execute(step, createTestContext());

		expect(logMock).toHaveBeenCalledWith(
			'"[ergon-flow] workflow=code.refactor run=run_1 step=notify.stdout channel=stdout\\nergon-flow status=passed"',
		);
		expect(result).toEqual({
			artifacts: [
				{
					name: 'run.summary',
					type: 'json',
					value: {
						channel: 'stdout',
						message: 'ergon-flow status=passed',
						run_id: 'run_1',
						step_id: 'notify.stdout',
						workflow_id: 'code.refactor',
						workflow_version: 1,
					},
				},
			],
			outputs: {
				channel: 'stdout',
				message: 'ergon-flow status=passed',
				run_id: 'run_1',
				step_id: 'notify.stdout',
				workflow_id: 'code.refactor',
				workflow_version: 1,
			},
			status: 'succeeded',
		});
	});

	it('sends webhook notifications with interpolated message and target', async () => {
		const sendWebhookMock = vi.fn().mockResolvedValue({
			status: 202,
		});
		const executor = new NotifyExecutor({
			log: logMock,
			resolveHostname: resolveHostnameMock,
			sendWebhook: sendWebhookMock,
		});
		const step: NotifyStepDefinition = {
			channel: 'webhook',
			id: 'notify.webhook',
			kind: 'notify',
			message: 'run {{ inputs.repo }}',
			target: '{{ inputs.webhook_url }}',
		};

		const result = await executor.execute(step, createTestContext());

		expect(sendWebhookMock).toHaveBeenCalledWith({
			channel: 'webhook',
			message: 'run ergon-flow',
			runId: 'run_1',
			stepId: 'notify.webhook',
			target: 'https://example.test/hooks/notify',
			workflowId: 'code.refactor',
		});
		expect(result).toEqual({
			artifacts: [
				{
					name: 'run.summary',
					type: 'json',
					value: {
						channel: 'webhook',
						message: 'run ergon-flow',
						run_id: 'run_1',
						step_id: 'notify.webhook',
						target: 'https://example.test/hooks/notify',
						workflow_id: 'code.refactor',
						workflow_version: 1,
					},
				},
			],
			outputs: {
				channel: 'webhook',
				message: 'run ergon-flow',
				run_id: 'run_1',
				status: 202,
				step_id: 'notify.webhook',
				target: 'https://example.test/hooks/notify',
				workflow_id: 'code.refactor',
				workflow_version: 1,
			},
			status: 'succeeded',
		});
		expect(resolveHostnameMock).toHaveBeenCalledWith('example.test', {
			all: true,
			family: 0,
		});
	});

	it('sends openclaw notifications using the configured target', async () => {
		const sendOpenClawMessageMock = vi.fn().mockResolvedValue({
			status: 0,
		});
		const executor = new NotifyExecutor({
			sendOpenClawMessage: sendOpenClawMessageMock,
		});
		const step: NotifyStepDefinition = {
			channel: 'openclaw',
			id: 'notify.openclaw',
			kind: 'notify',
			message: 'run {{ inputs.repo }}',
			target: 'team/{{ inputs.repo }}',
		};

		const result = await executor.execute(step, createTestContext());

		expect(sendOpenClawMessageMock).toHaveBeenCalledWith({
			message: 'run ergon-flow',
			target: 'team/ergon-flow',
		});
		expect(result).toEqual({
			artifacts: [
				{
					name: 'run.summary',
					type: 'json',
					value: {
						channel: 'openclaw',
						message: 'run ergon-flow',
						run_id: 'run_1',
						step_id: 'notify.openclaw',
						target: 'team/ergon-flow',
						workflow_id: 'code.refactor',
						workflow_version: 1,
					},
				},
			],
			outputs: {
				channel: 'openclaw',
				message: 'run ergon-flow',
				run_id: 'run_1',
				status: 0,
				step_id: 'notify.openclaw',
				target: 'team/ergon-flow',
				workflow_id: 'code.refactor',
				workflow_version: 1,
			},
			status: 'succeeded',
		});
	});

	it('uses the configured openclaw command and args for notifications', async () => {
		const spawnMock = vi.fn().mockResolvedValue({
			code: 0,
			signal: null,
			stderr: '',
			stdout: 'ok',
		});
		const executor = new NotifyExecutor({
			openclaw: {
				args: ['--profile', 'ops'],
				command: 'openclaw',
				spawn: spawnMock,
			},
		});
		const step: NotifyStepDefinition = {
			channel: 'openclaw',
			id: 'notify.openclaw',
			kind: 'notify',
			message: 'run {{ inputs.repo }}',
			target: 'team/{{ inputs.repo }}',
		};

		await executor.execute(step, createTestContext());

		expect(spawnMock).toHaveBeenCalledWith({
			args: ['--profile', 'ops', 'message', 'send', 'team/ergon-flow'],
			command: 'openclaw',
			env: undefined,
			input: 'run ergon-flow',
		});
	});

	it('sanitizes stdout messages before logging', async () => {
		const executor = new NotifyExecutor({
			log: logMock,
			resolveHostname: resolveHostnameMock,
		});
		const step: NotifyStepDefinition = {
			channel: 'stdout',
			id: 'notify.stdout',
			kind: 'notify',
			message: 'line 1\nline 2',
		};

		await executor.execute(step, createTestContext());

		expect(logMock).toHaveBeenCalledWith(
			'"[ergon-flow] workflow=code.refactor run=run_1 step=notify.stdout channel=stdout\\nline 1\\nline 2"',
		);
	});

	it('rejects webhook notifications without a target', async () => {
		const executor = new NotifyExecutor({
			log: logMock,
			resolveHostname: resolveHostnameMock,
		});
		const step: NotifyStepDefinition = {
			channel: 'webhook',
			id: 'notify.webhook',
			kind: 'notify',
			message: 'run {{ inputs.repo }}',
		};

		await expect(executor.execute(step, createTestContext())).rejects.toThrow(
			'Notify step "notify.webhook" requires a target',
		);
	});

	it('rejects webhook notifications that use a local or non-https target', async () => {
		const executor = new NotifyExecutor({
			log: logMock,
		});
		const step: NotifyStepDefinition = {
			channel: 'webhook',
			id: 'notify.webhook',
			kind: 'notify',
			message: 'run {{ inputs.repo }}',
			target: 'http://127.0.0.1/internal',
		};

		await expect(executor.execute(step, createTestContext())).rejects.toThrow(
			'Notify webhook target must use https',
		);
	});

	it('rejects webhook notifications that resolve to a local address', async () => {
		resolveHostnameMock.mockResolvedValue([
			{ address: '127.0.0.1', family: 4 },
		]);
		const executor = new NotifyExecutor({
			log: logMock,
			resolveHostname: resolveHostnameMock,
		});
		const step: NotifyStepDefinition = {
			channel: 'webhook',
			id: 'notify.webhook',
			kind: 'notify',
			message: 'run {{ inputs.repo }}',
			target: 'https://example.test/hooks/notify',
		};

		await expect(executor.execute(step, createTestContext())).rejects.toThrow(
			'Notify webhook target must resolve to a public address',
		);
	});

	it('rejects unsupported channels', async () => {
		const executor = new NotifyExecutor({
			log: logMock,
		});
		const step: NotifyStepDefinition = {
			channel: 'slack',
			id: 'notify.slack',
			kind: 'notify',
			message: 'run {{ inputs.repo }}',
			target: 'https://example.test/hooks/notify',
		};

		await expect(executor.execute(step, createTestContext())).rejects.toThrow(
			'Notify step "notify.slack" uses unsupported channel "slack"',
		);
	});

	it('rejects openclaw notifications without a target', async () => {
		const executor = new NotifyExecutor();
		const step: NotifyStepDefinition = {
			channel: 'openclaw',
			id: 'notify.openclaw',
			kind: 'notify',
			message: 'run {{ inputs.repo }}',
		};

		await expect(executor.execute(step, createTestContext())).rejects.toThrow(
			'Notify step "notify.openclaw" requires a target',
		);
	});

	it('rejects notifications with an empty message', async () => {
		const executor = new NotifyExecutor({
			log: logMock,
		});
		const step: NotifyStepDefinition = {
			channel: 'stdout',
			id: 'notify.empty-message',
			kind: 'notify',
			message: '',
		};

		await expect(executor.execute(step, createTestContext())).rejects.toThrow(
			'Notify step "notify.empty-message" did not render a message',
		);
	});
});
