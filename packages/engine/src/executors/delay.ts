import type { DelayStepDefinition } from '@claushaas/ergon-shared';
import type { ExecutionContext, Executor, ExecutorResult } from './index.js';

function createAbortError(signal: AbortSignal): Error {
	return signal.reason instanceof Error
		? signal.reason
		: Object.assign(new Error('Delay step aborted'), { name: 'AbortError' });
}

async function waitForDuration(
	durationMs: number,
	signal: AbortSignal,
): Promise<void> {
	if (signal.aborted) {
		throw createAbortError(signal);
	}

	await new Promise<void>((resolve, reject) => {
		const handleAbort = () => {
			clearTimeout(timeoutId);
			signal.removeEventListener('abort', handleAbort);
			reject(createAbortError(signal));
		};

		const timeoutId = setTimeout(() => {
			signal.removeEventListener('abort', handleAbort);
			resolve();
		}, durationMs);

		signal.addEventListener('abort', handleAbort, { once: true });
	});
}

export class DelayExecutor implements Executor<DelayStepDefinition> {
	public readonly kind = 'delay' as const;

	public async execute(
		step: DelayStepDefinition,
		context: ExecutionContext,
	): Promise<ExecutorResult> {
		await waitForDuration(step.duration_ms, context.signal);

		return {
			outputs: {
				duration_ms: step.duration_ms,
			},
			status: 'succeeded',
		};
	}
}
