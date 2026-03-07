# Ergon Flow

Ergon Flow is a deterministic workflow runtime for orchestrating coding
workflows.

The repository currently ships:

- a CLI (`ergon`)
- a queue + worker runtime
- a SQLite-backed storage layer
- built-in step executors
- provider/client adapters
- a built-in workflow library under `library/workflows`

The runtime is designed around auditability:

- every run is persisted in SQLite
- every step attempt is recorded in `step_runs`
- every artifact is stored on disk and indexed in SQLite
- every significant transition is appended to `events`

## What v0.0.1 Includes

The current release scope is pragmatic and explicit:

- sequential workflow execution
- lease-based worker claiming with `claim_epoch` fencing
- crash recovery for expired in-flight leases
- manual approval and rejection
- cancellation before and during step execution
- per-attempt artifact storage
- built-in workflows validated in CI and covered by E2E tests

Supported step kinds:

- `agent`
- `artifact`
- `condition`
- `exec`
- `manual`
- `notify`

Supported providers:

- `openrouter`
- `ollama`
- `codex`
- `claude-code`
- `openclaw`

## What v0.0.1 Does Not Include

These repository assets exist, but they are not enforced by the runtime yet:

- `library/agents/`
- `library/schemas/`

The current runtime does not load agent profiles from `library/agents` and does
not validate agent artifacts against `library/schemas` during execution.

The current engine is also intentionally limited to sequential execution. It is
not a parallel DAG scheduler.

## Quickstart

Install dependencies and run the full local gate:

```bash
pnpm install
pnpm biome
pnpm typecheck
pnpm build
pnpm test
```

Smoke the compiled CLI end to end:

```bash
pnpm smoke:cli
```

List bundled templates and workflows:

```bash
node packages/cli/dist/main.js template list
node packages/cli/dist/main.js workflow list
```

## Running a Real Worker

The worker does not execute steps inline from the CLI. The flow is:

```text
ergon run <workflow> -> workflow_runs.status = queued
ergon worker start   -> claim + execute
ergon run-status     -> inspect persisted state
```

Built-in workflows such as `code.refactor` and `code.hotfix` require provider
configuration for their `agent` steps and pause on a manual gate before the
final `notify` step.

Relevant environment variables:

- `ERGON_ROOT_DIR`
- `ERGON_DB_PATH`
- `OPENROUTER_API_KEY`
- `OPENROUTER_BASE_URL`
- `OPENROUTER_MODEL`
- `OLLAMA_BASE_URL`
- `OLLAMA_MODEL`
- `CODEX_COMMAND`
- `CODEX_ARGS`
- `CLAUDE_CODE_COMMAND`
- `CLAUDE_CODE_ARGS`
- `OPENCLAW_COMMAND`
- `OPENCLAW_ARGS`

## CLI Surface

Current commands:

- `ergon template list`
- `ergon workflow list`
- `ergon run <workflow_id> [--inputs <json-or-path>]`
- `ergon run-status <run_id>`
- `ergon worker start [runtime flags]`
- `ergon approve <run_id> <step_id> --decision approve|reject`
- `ergon cancel <run_id>`

## Storage Layout

Run state lives in SQLite.

Artifacts live on disk under:

```text
.runs/<run_id>/
  artifacts/
  steps/<step_id>/<attempt>/
```

The runtime persists attempt-local files under `steps/<step_id>/<attempt>/` and
stores relative file paths in the `artifacts` table.

## Canonical Docs

The repository treats these documents as source of truth:

- `docs/ROADMAP.md`
- `docs/SPEC.md`
- `docs/ARCHITECTURE.md`
- `docs/DB_SCHEMA.md`
- `docs/TEMPLATE_SPEC.md`

## Release Readiness

The repository is now intended to be testable by a user in practice without
hidden setup beyond provider credentials for workflows that use `agent` steps.
