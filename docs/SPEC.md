# Ergon Flow System Specification

## Purpose

Ergon Flow is a deterministic workflow runtime for executing structured units
of work through a persisted queue + worker model.

Conceptually:

```text
intent -> workflow template -> queued run -> worker execution -> artifacts
```

## Runtime Model

Ergon Flow uses an asynchronous model:

1. the CLI validates and schedules a workflow run
2. the run is inserted into `workflow_runs` with status `queued`
3. a worker claims the run with a lease
4. the engine executes workflow steps sequentially
5. step attempts, artifacts and events are persisted
6. the run converges to `succeeded`, `failed`, `waiting_manual` or `canceled`

The CLI does not execute steps directly.

## Core Entities

### Workflow

A workflow is a YAML template stored under the project-local
`.ergon/library/workflows` directory after bootstrap.

The CLI package also ships an embedded library used for:

- `ergon init`
- `ergon library sync`
- `ergon template list` before a project is initialized

It defines:

- workflow metadata
- input contract
- ordered steps
- optional workflow outputs

### Workflow run

A workflow run is one scheduled execution of a workflow template.

State is persisted in `workflow_runs`.

### Step run

A step run is one attempt of one workflow step.

Retries create additional `step_runs` rows with incremented `attempt`.

### Artifact

Artifacts are named outputs produced by steps.

They are:

- written to disk under `.runs/<run_id>/steps/<step_id>/<attempt>/`
- indexed in SQLite under `artifacts`
- restored from successful attempts only

### Event

Events are the append-only audit log for a run.

Each event has a per-run monotonic `seq`.

## Supported Step Kinds

The runtime supports:

- `agent`
- `artifact`
- `condition`
- `exec`
- `manual`
- `notify`

There is no hidden inline step type outside this set.

## Supported Providers

The runtime supports exactly these providers:

- `openrouter`
- `ollama`
- `codex`
- `claude-code`
- `openclaw`

`openai` and `anthropic` are not part of the current runtime contract.

## Determinism Rules

The runtime aims for deterministic state transitions, not deterministic model
content.

Determinism in this release means:

- run and step state lives in SQLite
- artifacts are persisted with metadata and file paths
- events are appended in stable order per run
- a worker may mutate a run only while holding the current claim
- the executed template identity is verified against `workflow_hash`

Non-deterministic provider outputs are still possible, but the runtime records
their request and response payloads after redaction.

## Lifecycle Semantics

### Workflow run lifecycle

Canonical workflow statuses:

- `queued`
- `running`
- `waiting_manual`
- `succeeded`
- `failed`
- `canceled`

Expected flow:

```text
queued -> running -> succeeded
queued -> running -> failed
queued -> running -> waiting_manual -> queued -> running -> succeeded
queued|running|waiting_manual -> canceled
```

### Step run lifecycle

Canonical step statuses:

- `queued`
- `running`
- `succeeded`
- `failed`
- `skipped`
- `waiting_manual`

## Retry Semantics

Retry is configured per step through `retry.max_attempts` and optional
`retry.on`.

The engine retries only recoverable failures that match the configured error
codes.

Retries do not overwrite prior attempts in the database. Each attempt gets its
own `step_runs` row and attempt-local artifact files.

## Recovery Semantics

If a worker lease expires while a run is `running`, another worker may reclaim
the run.

Recovery behavior in `v0.1.1`:

- the stale in-flight step is marked failed
- the engine decides whether that step is retryable
- a retry may continue from the reclaimed worker
- if the step is not retryable, the run fails

## Manual Semantics

`manual` steps pause the run by returning `waiting_manual`.

The CLI may then:

- approve the current manual step and requeue the run
- reject the current manual step and fail the run
- cancel the run while it is waiting

## Cancellation Semantics

Cancellation is supported:

- before the next step begins
- during an in-flight step, through `AbortSignal`

The runtime propagates aborts to:

- local `exec` subprocesses
- provider calls in `agent`
- outbound notify operations

## CLI Semantics

Current CLI commands:

- `init`
- `library sync`
- `template list`
- `workflow list`
- `run`
- `run-status`
- `worker start`
- `approve`
- `cancel`

CLI responsibilities:

- discover the nearest initialized `.ergon` project
- bootstrap project-local state
- refresh the managed local library
- validate templates on the way in
- schedule runs
- inspect persisted state
- submit manual decisions
- submit cancellations

Bootstrap and root-discovery rules:

- if `ERGON_ROOT_DIR` is set, the CLI uses it as the project root
- otherwise, the CLI walks upward from the current working directory until it
  finds `.ergon/`
- if no `.ergon/` exists, the current directory is treated as an uninitialized
  location
- `template list` may read from the embedded package library before init
- `workflow list`, `run`, `run-status`, `worker start`, `approve` and `cancel`
  require `ergon init`

## Explicit Non-Goals for v0.1.1

These are out of scope in the current release:

- parallel DAG execution
- runtime loading of `library/agents`
- runtime schema validation using `library/schemas`
- hidden in-memory workflow state
