import type { Provider } from './enums.js';

// ─── Request ─────────────────────────────────────────────────────────────────

export interface ChatMessage {
	content: string;
	role: 'assistant' | 'system' | 'user';
}

export interface ClientRequest {
	json_mode?: boolean;
	messages?: ChatMessage[];
	model?: string;
	prompt?: string;
	provider: Provider;
}

// ─── Result ──────────────────────────────────────────────────────────────────

export interface AgentResult {
	raw?: unknown;
	text: string;
}

// ─── Interface ───────────────────────────────────────────────────────────────

/**
 * Common interface for all execution clients (model clients and agent clients).
 * Matches SPEC.md § 4.6 and ARCHITECTURE.md § 10.
 */
export interface ExecutionClient {
	readonly provider: Provider;
	run(request: ClientRequest): Promise<AgentResult>;
}
