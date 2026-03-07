# Ergon Flow

Ergon Flow is a deterministic workflow runtime for orchestrating agentic workflows.

The repository currently ships:

- a CLI (`ergon`)
- a queue + worker runtime
- a SQLite-backed storage layer
- built-in step executors
- provider/client adapters
- an embedded workflow library that `ergon init` copies into
  `./.ergon/library`

The runtime is designed around auditability:

- every run is persisted in SQLite
- every step attempt is recorded in `step_runs`
- every artifact is stored on disk and indexed in SQLite
- every significant transition is appended to `events`

## What v0.1.2 Includes

The current release scope is pragmatic and explicit:

- sequential workflow execution
- lease-based worker claiming with `claim_epoch` fencing
- crash recovery for expired in-flight leases
- manual approval and rejection
- cancellation before and during step execution
- per-attempt artifact storage
- explicit project bootstrap with `ergon init`
- project-local workflow assets under `./.ergon/library`
- explicit library refresh through `ergon library sync`
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

## What v0.1.2 Does Not Include

These repository assets exist, but they are not enforced by the runtime yet:

- `library/agents/`
- `library/schemas/`

The current runtime does not load agent profiles from `library/agents` and does
not validate agent artifacts against `library/schemas` during execution.

The current engine is also intentionally limited to sequential execution. It is
not a parallel DAG scheduler.

## Quickstart

Supported public runtime:

- Node.js `>=22`

Install the CLI globally:

```bash
pnpm add -g @claushaas/ergon-cli
```

Bootstrap a project-local Ergon workspace:

```bash
cd /path/to/your/repo
ergon init
ergon --help
ergon --version
```

This creates:

```text
.ergon/
  config.json
  storage/
  library/
```

The embedded `library/` bundled with the CLI is copied into
`./.ergon/library/`. After initialization, the CLI resolves workflows from the
nearest ancestor `.ergon/library/workflows`.

For repository development, run the full local gate:

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

List bundled templates and then register workflows inside an initialized project:

```bash
ergon template list
ergon workflow list
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

Provider prerequisites:

- `openrouter`: requires `OPENROUTER_API_KEY`
- `ollama`: requires a reachable Ollama instance
- `codex`: requires a local `codex` command or explicit `CODEX_COMMAND`
- `claude-code`: requires a local `claude-code` command or explicit
  `CLAUDE_CODE_COMMAND`
- `openclaw`: requires a local `openclaw` command or explicit
  `OPENCLAW_COMMAND`

## CLI Surface

Current commands:

- `ergon init [--root <path>]`
- `ergon library sync [--force] [--root <path>]`
- `ergon template list`
- `ergon workflow list`
- `ergon run <workflow_id> [--inputs <json-or-path>]`
- `ergon run-status <run_id>`
- `ergon worker start [runtime flags]`
- `ergon approve <run_id> <step_id> --decision approve|reject`
- `ergon cancel <run_id>`

Stateful commands (`workflow list`, `run`, `run-status`, `worker start`,
`approve`, `cancel`) require an initialized project. `template list` can run
before init by reading from the embedded package library without mutating the
filesystem.

## Storage Layout

Project state lives under `./.ergon/`.

The default SQLite location is:

```text
.ergon/storage/ergon.db
```

Artifacts live on disk under:

```text
.runs/<run_id>/
  steps/<step_id>/<attempt>/
```

The runtime persists concrete artifact files under
`steps/<step_id>/<attempt>/` and stores their relative file paths in the
`artifacts` table. The `artifacts` table is metadata in SQLite, not a second
run-level directory containing the current artifact files.

## Canonical Docs

The repository treats these documents as source of truth:

- `docs/ROADMAP.md`
- `docs/SPEC.md`
- `docs/ARCHITECTURE.md`
- `docs/DB_SCHEMA.md`
- `docs/TEMPLATE_SPEC.md`
- `docs/RELEASE.md`

## Release Flow

Public releases are cut from `main` using Git tags such as `v0.1.2`.

Before tagging a release:

```bash
pnpm biome
pnpm typecheck
pnpm build
pnpm test
pnpm pack:validate
pnpm smoke:cli
pnpm smoke:global-install
```

The publish workflow validates the tag version, verifies the tarballs, and then
publishes `@claushaas/ergon-shared`, `@claushaas/ergon-clients`, `@claushaas/ergon-storage`,
`@claushaas/ergon-engine`, and `@claushaas/ergon-cli` in dependency order.

## Release Readiness

The repository is now intended to be testable by a user in practice without
hidden setup beyond provider credentials for workflows that use `agent` steps.
