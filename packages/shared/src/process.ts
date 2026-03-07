export interface AbortableChildProcess {
	killed: boolean;
	kill: (signal?: NodeJS.Signals) => boolean;
}

export interface ChildProcessAbortControllerOptions {
	abortMessage: string;
	child: AbortableChildProcess;
	isSettled: () => boolean;
	onAbort: (error: Error) => void;
	setSettled: () => void;
	signal?: AbortSignal;
}

export function createChildProcessAbortController(
	options: ChildProcessAbortControllerOptions,
): {
	cleanupAbort: () => void;
	registerAbort: () => boolean;
} {
	let forceKillTimer: NodeJS.Timeout | undefined;

	const cleanupAbort = () => {
		if (options.signal) {
			options.signal.removeEventListener('abort', abortHandler);
		}
		if (forceKillTimer) {
			clearTimeout(forceKillTimer);
			forceKillTimer = undefined;
		}
	};

	const abortHandler = () => {
		if (options.isSettled()) {
			return;
		}
		options.setSettled();
		options.child.kill('SIGTERM');
		forceKillTimer = setTimeout(() => {
			if (!options.child.killed) {
				options.child.kill('SIGKILL');
			}
		}, 250);
		options.onAbort(
			options.signal?.reason instanceof Error
				? options.signal.reason
				: Object.assign(new Error(options.abortMessage), {
						name: 'AbortError',
					}),
		);
	};

	const registerAbort = () => {
		if (!options.signal) {
			return false;
		}
		if (options.signal.aborted) {
			abortHandler();
			return true;
		}
		options.signal.addEventListener('abort', abortHandler, { once: true });
		return false;
	};

	return {
		cleanupAbort,
		registerAbort,
	};
}
