# Ergon CLI

This file describes the current operational CLI surface.

## Core Idea

The CLI is responsible for bootstrap, scheduling, inspection, approvals, and cancellation.

It is not the inline workflow executor.

Use `ergon run` to schedule. Use `ergon worker start` to execute.

## Project Initialization

### `ergon init [--root <path>]`

Purpose:

- create `.ergon/`
- copy the embedded workflow library into `.ergon/library/`
- create local config
- configure local SQLite storage at `.ergon/storage/ergon.db`

When to use:

- first-time setup in a repository that will run Ergon Flow locally

Examples:

```bash
ergon init
ergon init --root /path/to/repo
```

Common mistakes:

- expecting stateful commands to work before initialization
- editing `library/workflows` and forgetting that the runtime resolves from `.ergon/library/workflows` in initialized projects

### `ergon library sync [--force] [--root <path>]`

Purpose:

- refresh the managed local library under `.ergon/library/` from the embedded CLI library

When to use:

- after upgrading the CLI
- after wanting to refresh built-in library assets in an initialized repository

Examples:

```bash
ergon library sync
ergon library sync --force
```

Common mistakes:

- assuming `library/workflows` at the repo root is the active runtime library
- using `--force` without realizing it may overwrite managed library files

## Discovery Commands

### `ergon template list`

Purpose:

- list embedded template assets available to initialize or sync

When to use:

- before initialization
- to inspect what the CLI package ships

Example:

```bash
ergon template list
```

Notes:

- this command works before initialization

### `ergon workflow list`

Purpose:

- list registered workflows in the local initialized project

When to use:

- after initialization
- when checking what the current node has registered in local storage

Example:

```bash
ergon workflow list
```

Common mistakes:

- assuming this lists every YAML file in the repo without initialization or registration

## Run Scheduling and Inspection

### `ergon run <workflow_id> [--inputs <json-or-path>]`

Purpose:

- validate a workflow and create a queued run

When to use:

- when you want to schedule execution

Examples:

```bash
ergon run code.bump_deps
ergon run agent.smoke --inputs '{"output_file":".ergon/tmp/out.txt"}'
ergon run code.refactor --inputs ./inputs/refactor.json
```

Common mistakes:

- expecting the workflow to execute immediately without a worker
- passing invalid JSON to `--inputs`
- using a workflow file that exists only in `library/workflows` while the initialized repo is reading from `.ergon/library/workflows`

### `ergon run list [--status <status>] [--workflow <workflow_id>] [--limit <n>] [--offset <n>]`

Purpose:

- list workflow runs from local storage

When to use:

- to find recent runs
- to filter active or manual runs

Examples:

```bash
ergon run list
ergon run list --status running
ergon run list --status waiting_manual
ergon run list --workflow agent.smoke --limit 20
```

Statuses you will see:

- `queued`
- `running`
- `waiting_manual`
- `succeeded`
- `failed`
- `canceled`

### `ergon run status <run_id>`

Purpose:

- inspect one run and its step history

When to use:

- to debug a run
- to locate the current step
- to inspect step failures and persisted outputs

Example:

```bash
ergon run status 899733a6-340b-4a21-9d48-6a03b7a60675
```

Common mistakes:

- forgetting to pass the run id
- reading an old failed run after editing the workflow and expecting it to reflect the new YAML

## Worker Operation

### `ergon worker start [runtime flags]`

Purpose:

- start the worker loop that claims and executes queued runs

When to use:

- whenever you want queued runs to execute

Examples:

```bash
ergon worker start
ergon worker start --max-runs 1
ergon worker start --poll-interval-ms 500 --max-runs 5
```

Supported runtime flags:

- `--artifact-base-dir <path>`
- `--db <path>`
- `--heartbeat-interval-ms <n>`
- `--lease-duration-ms <n>`
- `--lease-renew-interval-ms <n>`
- `--max-poll-interval-ms <n>`
- `--max-runs <n>`
- `--poll-interval-ms <n>`
- `--root-dir <path>`
- `--worker-id <id>`

Worker behavior:

- without `--max-runs`, the worker keeps polling continuously
- it will execute runs already queued and new runs created while it stays active
- stop it manually with `Ctrl+C`
- with `--max-runs`, it exits after processing up to that number of runs

Common mistakes:

- starting a worker and expecting it to exit automatically without `--max-runs`
- forgetting that a run may be blocked on `waiting_manual`

## Manual Decisions

### `ergon approve <run_id> <step_id> --decision approve|reject`

Purpose:

- resolve a `manual` step

When to use:

- when `ergon run status` shows `waiting_manual`

Examples:

```bash
ergon approve <run_id> approve --decision approve
ergon approve <run_id> approve --decision reject
```

Behavior:

- `approve` requeues the run
- `reject` fails the run

Common mistakes:

- using the wrong `step_id`
- approving the run but forgetting to start a worker again afterward

## Cancellation

### `ergon cancel <run_id>`

Purpose:

- request cancellation of a queued, running, or waiting-manual run

When to use:

- when a run should not continue

Example:

```bash
ergon cancel <run_id>
```

Behavior:

- cancellation is persisted in the run state
- in-flight work is aborted through the runtime where supported

## Environment and `.env`

The CLI loads `.env` from the repository root by default.

The effective env file can be changed through `.ergon/config.json` using `env_file`.

Precedence:

1. exported environment variables from the shell
2. values loaded from the project `.env`

Useful provider environment variables:

- `OPENROUTER_API_KEY`
- `OPENROUTER_BASE_URL`
- `OPENROUTER_MODEL`
- `OPENROUTER_APP_NAME`
- `OPENROUTER_SITE_URL`
- `OLLAMA_BASE_URL`
- `OLLAMA_MODEL`
- `CODEX_COMMAND`
- `CODEX_ARGS`
- `CLAUDE_CODE_COMMAND`
- `CLAUDE_CODE_ARGS`
- `OPENCLAW_COMMAND`
- `OPENCLAW_ARGS`
- `ERGON_ROOT_DIR`
- `ERGON_DB_PATH`

## Status Interpretation

Use these statuses conservatively.

- `queued`: scheduled but not currently being executed
- `running`: currently claimed by a worker
- `waiting_manual`: paused on a `manual` step until approval or rejection
- `succeeded`: terminal success
- `failed`: terminal failure
- `canceled`: terminal cancellation

If a run is `queued`, check whether any worker is running. If a run is `waiting_manual`, inspect the current step id and use `ergon approve`.
