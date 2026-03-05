import type { ErrorCode } from './enums.js';

/** Structured error type used across the Ergon Flow runtime. */
export interface ErgonError {
	code: ErrorCode;
	detail?: unknown;
	message: string;
}
