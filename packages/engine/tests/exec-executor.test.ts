import type { ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';
import type { ExecStepDefinition } from '@ergon/shared';
import { describe, expect, it, vi } from 'vitest';
import {
	DEFAULT_EXEC_MAX_OUTPUT_BYTES,
	defaultSpawn,
	ExecExecutor,
} from '../src/executors/exec.js';
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
			signal: context.signal,
		});
		expect(result).toEqual({
			artifacts: [
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
						envKeys: ['REPORT_NAME'],
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
				envKeys: ['REPORT_NAME'],
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

	it('uses a non-login shell with only step env in defaultSpawn', async () => {
		const stdout = new EventEmitter();
		const stderr = new EventEmitter();
		const child = new EventEmitter() as ChildProcess;
		child.stdout = stdout as ChildProcess['stdout'];
		child.stderr = stderr as ChildProcess['stderr'];
		const spawnMock = vi.fn().mockReturnValue(child);

		const spawnPromise = defaultSpawn(
			{
				command: 'echo ok',
				cwd: '/workspace/repo',
				env: {
					REPORT_NAME: 'parser',
				},
			},
			spawnMock,
		);

		stdout.emit('data', Buffer.from('ok\n'));
		stderr.emit('data', Buffer.from('warn\n'));
		child.emit('close', 0, null);

		await expect(spawnPromise).resolves.toEqual({
			code: 0,
			signal: null,
			stderr: 'warn\n',
			stdout: 'ok\n',
		});
		const spawnCall = spawnMock.mock.calls[0];
		const spawnOptions = spawnCall?.[2];
		expect(spawnMock).toHaveBeenCalledWith('bash', ['-c', 'echo ok'], {
			cwd: '/workspace/repo',
			env: expect.objectContaining({
				REPORT_NAME: 'parser',
			}),
			stdio: 'pipe',
		});
		expect(spawnOptions).toBeDefined();
		expect(spawnOptions?.env).toEqual(
			expect.objectContaining({
				REPORT_NAME: 'parser',
			}),
		);
		expect(spawnOptions?.env.PATH).toBe(process.env.PATH);
	});

	it('rejects when stdout exceeds the configured output limit', async () => {
		const stdout = new EventEmitter();
		const stderr = new EventEmitter();
		const kill = vi.fn();
		const child = new EventEmitter() as ChildProcess;
		child.kill = kill;
		child.stdout = stdout as ChildProcess['stdout'];
		child.stderr = stderr as ChildProcess['stderr'];
		const spawnMock = vi.fn().mockReturnValue(child);

		const spawnPromise = defaultSpawn(
			{
				command: 'python huge.py',
			},
			spawnMock,
		);

		stdout.emit('data', Buffer.alloc(1024 * 1024 + 1, 'a'));

		await expect(spawnPromise).rejects.toThrow(
			`Exec command stdout exceeded ${DEFAULT_EXEC_MAX_OUTPUT_BYTES} bytes`,
		);
		expect(kill).toHaveBeenCalledWith('SIGTERM');
	});

	it('aborts the child process when the execution signal is canceled', async () => {
		const stdout = new EventEmitter();
		const stderr = new EventEmitter();
		const kill = vi.fn();
		const child = new EventEmitter() as ChildProcess;
		child.kill = kill;
		child.stdout = stdout as ChildProcess['stdout'];
		child.stderr = stderr as ChildProcess['stderr'];
		const spawnMock = vi.fn().mockReturnValue(child);
		const controller = new AbortController();

		const spawnPromise = defaultSpawn(
			{
				command: 'sleep 10',
				signal: controller.signal,
			},
			spawnMock,
		);

		controller.abort();

		await expect(spawnPromise).rejects.toMatchObject({
			name: 'AbortError',
		});
		expect(kill).toHaveBeenCalledWith('SIGTERM');
	});
});
