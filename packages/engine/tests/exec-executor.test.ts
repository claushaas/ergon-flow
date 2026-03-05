import type { ExecStepDefinition } from '@ergon/shared';
import { describe, expect, it, vi } from 'vitest';
import { ExecExecutor } from '../src/executors/exec.js';
import { createExecutionContext } from '../src/executors/index.js';

describe('ExecExecutor (E3)', () => {
	it('executes a rendered command and captures stdout, stderr and result artifacts', async () => {
		const spawnMock = vi.fn().mockResolvedValue({
			code: 0,
			signal: null,
			stderr: 'warn\n',
			stdout: 'ok\n',
		});
		const executor = new ExecExecutor({
			spawn: spawnMock,
		});
		const step: ExecStepDefinition = {
			command: 'echo {{ inputs.message }}',
			cwd: '{{ inputs.repo_path }}',
			env: {
				REPORT_NAME: '{{ artifacts.analysis.summary }}',
			},
			id: 'tests_exec',
			kind: 'exec',
		};
		const context = createExecutionContext({
			artifacts: {
				analysis: { summary: 'parser' },
			},
			inputs: {
				message: 'done',
				repo_path: '/workspace/repo',
			},
			run: {
				attempt: 1,
				runId: 'run_1',
				stepIndex: 0,
				workflowId: 'code.refactor',
				workflowVersion: 1,
			},
		});

		const result = await executor.execute(step, context);

		expect(spawnMock).toHaveBeenCalledWith({
			command: "echo 'done'",
			cwd: '/workspace/repo',
			env: {
				REPORT_NAME: 'parser',
			},
		});
		expect(result).toEqual({
			artifacts: [
				{
					name: 'tests_exec',
					type: 'json',
					value: {
						code: 0,
						command: "echo 'done'",
						cwd: '/workspace/repo',
						env: { REPORT_NAME: 'parser' },
						signal: null,
						stderr: 'warn\n',
						stdout: 'ok\n',
					},
				},
				{
					name: 'tests_exec.stdout',
					type: 'text',
					value: 'ok\n',
				},
				{
					name: 'tests_exec.stderr',
					type: 'text',
					value: 'warn\n',
				},
				{
					name: 'tests_exec.result',
					type: 'json',
					value: {
						code: 0,
						command: "echo 'done'",
						cwd: '/workspace/repo',
						env: { REPORT_NAME: 'parser' },
						signal: null,
						stderr: 'warn\n',
						stdout: 'ok\n',
					},
				},
			],
			outputs: {
				code: 0,
				command: "echo 'done'",
				cwd: '/workspace/repo',
				env: { REPORT_NAME: 'parser' },
				signal: null,
				stderr: 'warn\n',
				stdout: 'ok\n',
			},
			status: 'succeeded',
		});
	});

	it('returns failed status when the command exits with a non-zero code', async () => {
		const executor = new ExecExecutor({
			spawn: vi.fn().mockResolvedValue({
				code: 2,
				signal: null,
				stderr: 'boom\n',
				stdout: '',
			}),
		});
		const step: ExecStepDefinition = {
			command: 'exit 2',
			id: 'deps_install',
			kind: 'exec',
		};
		const context = createExecutionContext({
			inputs: {},
			run: {
				attempt: 1,
				runId: 'run_2',
				stepIndex: 1,
				workflowId: 'code.bump_deps',
				workflowVersion: 1,
			},
		});

		const result = await executor.execute(step, context);

		expect(result.status).toBe('failed');
		expect(result.outputs).toMatchObject({
			code: 2,
			stderr: 'boom\n',
		});
	});
});
