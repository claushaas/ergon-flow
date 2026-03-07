import { getCliVersion } from './project.js';

export function getCliHelpText(): string {
	return `Ergon Flow CLI

Install:
  pnpm add -g @ergon/cli

Usage:
  ergon init [--root <path>]
  ergon library sync [--force] [--root <path>]
  ergon template list
  ergon workflow list
  ergon run <workflow_id> [--inputs <json-or-path>]
  ergon run-status <run_id>
  ergon worker start [runtime flags]
  ergon approve <run_id> <step_id> --decision approve|reject
  ergon cancel <run_id>

Bootstrap:
  "ergon init" creates ./.ergon, copies the embedded library into
  ./.ergon/library, and configures local storage at ./.ergon/storage/ergon.db.

Initialization rules:
  "template list", "--help", and "--version" work before initialization.
  Stateful commands require an initialized .ergon project.

Provider configuration:
  ERGON_ROOT_DIR
  ERGON_DB_PATH
  OPENROUTER_API_KEY
  OPENROUTER_BASE_URL
  OPENROUTER_MODEL
  OLLAMA_BASE_URL
  OLLAMA_MODEL
  CODEX_COMMAND
  CODEX_ARGS
  CLAUDE_CODE_COMMAND
  CLAUDE_CODE_ARGS
  OPENCLAW_COMMAND
  OPENCLAW_ARGS`;
}

export function getCliVersionText(): string {
	return getCliVersion();
}
