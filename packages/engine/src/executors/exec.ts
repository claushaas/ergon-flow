import { spawn as nodeSpawn } from 'node:child_process';
import type { ExecStepDefinition } from '@ergon/shared';
import { interpolateTemplateString, renderStepRequestPayload } from '../templating/index.js';
import type { ExecutionContext, Executor, ExecutorResult } from './index.js';

export const DEFAULT_EXEC_MAX_OUTPUT_BYTES = 1024 * 1024;

export interface ExecSpawnResult {
	code: number | null;
	signal: NodeJS.Signals | null;
	stderr: string;
	stdout: string;
}

export type ExecSpawn = (options: {
	command: string;
	cwd?: string;
	env?: Record<string, string>;
}) => Promise<ExecSpawnResult>;

export interface ExecExecutorOptions {
	spawn?: ExecSpawn;
}

function createOutputLimitError(stream: 'stderr' | 'stdout'): Error {
	return new Error(
		`Exec command ${stream} exceeded ${DEFAULT_EXEC_MAX_OUTPUT_BYTES} bytes`,
	);
}

function decodeOutput(chunks: Buffer[]): string {
	return Buffer.concat(chunks).toString('utf8');
}

function normalizeChunk(chunk: string | Buffer): Buffer {
	return Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
}

export async function defaultSpawn(options: {
	command: string;
	cwd?: string;
	env?: Record<string, string>;
},
	spawnImpl: typeof nodeSpawn = nodeSpawn,
): Promise<ExecSpawnResult> {
	return await new Promise<ExecSpawnResult>((resolve, reject) => {
		const child = spawnImpl('bash', ['-c', options.command], {
			cwd: options.cwd,
			env: options.env ? { ...options.env } : {},
			stdio: 'pipe',
		});
		const stdoutChunks: Buffer[] = [];
		const stderrChunks: Buffer[] = [];
		let stdoutBytes = 0;
		let stderrBytes = 0;
		let settled = false;

		const fail = (error: Error) => {
			if (settled) {
				return;
			}
			settled = true;
			child.kill('SIGTERM');
			reject(error);
		};

		child.stdout.on('data', (chunk) => {
			const normalized = normalizeChunk(chunk);
			stdoutBytes += normalized.byteLength;
			if (stdoutBytes > DEFAULT_EXEC_MAX_OUTPUT_BYTES) {
				fail(createOutputLimitError('stdout'));
				return;
			}
			stdoutChunks.push(normalized);
		});
		child.stderr.on('data', (chunk) => {
			const normalized = normalizeChunk(chunk);
			stderrBytes += normalized.byteLength;
			if (stderrBytes > DEFAULT_EXEC_MAX_OUTPUT_BYTES) {
				fail(createOutputLimitError('stderr'));
				return;
			}
			stderrChunks.push(normalized);
		});
		child.on('error', fail);
		child.on('close', (code, signal) => {
			if (settled) {
				return;
			}
			settled = true;
			resolve({
				code,
				signal,
				stderr: decodeOutput(stderrChunks),
				stdout: decodeOutput(stdoutChunks),
			});
		});
	});
}

export class ExecExecutor implements Executor<ExecStepDefinition> {
	public readonly kind = 'exec' as const;
	private readonly spawn: ExecSpawn;

	public constructor(options: ExecExecutorOptions = {}) {
		this.spawn = options.spawn ?? defaultSpawn;
	}

	public async execute(
		step: ExecStepDefinition,
		context: ExecutionContext,
	): Promise<ExecutorResult> {
		const payload = renderStepRequestPayload(step, {
			artifacts: context.artifacts,
			inputs: context.inputs,
		});
		if (!payload.command) {
			throw new Error(`Exec step "${step.id}" did not render a command`);
		}

		const cwd = step.cwd
			? interpolateTemplateString(step.cwd, {
					artifacts: context.artifacts,
					inputs: context.inputs,
				})
			: undefined;
		const env = step.env
			? Object.fromEntries(
					Object.entries(step.env).map(([key, value]) => [
						key,
						interpolateTemplateString(value, {
							artifacts: context.artifacts,
							inputs: context.inputs,
						}),
					]),
				)
			: undefined;
		const result = await this.spawn({
			command: payload.command,
			cwd,
			env,
		});
		const envKeys = env ? Object.keys(env).sort() : [];
		const normalizedResult = {
			code: result.code,
			command: payload.command,
			cwd,
			envKeys,
			signal: result.signal,
			stderr: result.stderr,
			stdout: result.stdout,
		};

		return {
			artifacts: [
				{
					name: `${step.id}.stdout`,
					type: 'text',
					value: result.stdout,
				},
				{
					name: `${step.id}.stderr`,
					type: 'text',
					value: result.stderr,
				},
				{
					name: `${step.id}.result`,
					type: 'json',
					value: normalizedResult,
				},
			],
			outputs: normalizedResult,
			status: result.code === 0 ? 'succeeded' : 'failed',
		};
	}
}
