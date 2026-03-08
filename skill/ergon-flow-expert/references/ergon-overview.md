# Ergon Flow Overview

This file explains the current runtime model for users operating Ergon Flow in their own repositories.

## Mental Model

Ergon Flow is a deterministic queue + worker runtime.

Conceptually:

```text
template -> run -> step runs -> artifacts -> events
```

The workflow template is declarative YAML. A run is one scheduled execution of that template. Each step attempt becomes a `step_run`. Steps may produce artifacts, and the runtime appends events for auditability.

## What `ergon run` Does

`ergon run <workflow_id>` schedules a workflow run.

It does not execute the steps inline.

Scheduling performs these high-level actions:

- resolves the local `.ergon` project
- loads and validates the workflow template
- registers the workflow in the local catalog
- materializes default inputs
- inserts a row into `workflow_runs` with status `queued`

## What `ergon worker start` Does

`ergon worker start` is the actual executor process.

The worker:

- polls SQLite for claimable runs
- claims one run with a lease
- executes the workflow sequentially
- renews its lease while the run is active
- persists step history, artifacts, and events
- continues polling until stopped, unless bounded by `--max-runs`

This separation matters. If you only run `ergon run`, nothing executes until a worker picks up the queued run.

## Queue, Lease, and Worker Model

The worker model is lease-based.

Important persisted fields in `workflow_runs`:

- `claimed_by`
- `lease_until`
- `claim_epoch`
- `current_step_id`
- `current_step_index`

The lease exists so another worker can recover a run if the original worker dies or loses the lease.

The runtime uses claim fencing. Only the current claim holder may finalize fenced run mutations.

## Sequential Execution Only

The current runtime executes steps sequentially in template order.

`depends_on` exists, but only as a backward reference check and skip gate. It does not enable parallel DAG scheduling.

Current limitation:

- no parallel DAG execution

## What Is Persisted

SQLite stores metadata and state.

Important tables:

- `workflows`
- `workers`
- `workflow_runs`
- `step_runs`
- `artifacts`
- `events`

Filesystem persistence also exists:

```text
.ergon/
  config.json
  storage/ergon.db
  library/

.runs/<run_id>/
  steps/<step_id>/<attempt>/
```

Artifacts are indexed in SQLite and written to disk under `.runs/`.

## Artifacts and Events

Artifacts are named step outputs that later steps can reference through `artifacts.*`.

Examples:

- `artifacts.analysis`
- `artifacts.tests.exec.stdout`
- `artifacts.review`

Events are the append-only audit log for the run. They are useful for reconstructing execution history and manual actions.

## Current Runtime Boundaries

The current runtime supports these step kinds:

- `agent`
- `artifact`
- `condition`
- `delay`
- `exec`
- `manual`
- `notify`

The current runtime supports these providers:

- `openrouter`
- `ollama`
- `codex`
- `claude-code`
- `openclaw`

Not part of the current runtime contract:

- parallel DAG scheduling
- runtime loading of `library/agents`
- runtime validation against `library/schemas`
- OpenAI or Anthropic provider adapters

## Current Limitations You Must Respect

These points are explicit in the current docs and implementation.

- Execution is sequential.
- `library/agents` exists in the repo but is not loaded by the runtime today.
- `library/schemas` exists in the repo but is not enforced by the runtime today.
- `on_failure` exists, but only `notify` steps are supported there.

## End-To-End Narrative

This is the normal lifecycle of a run.

1. The user initializes the repository with `ergon init`.
2. The user schedules a workflow with `ergon run code.some_workflow`.
3. The CLI validates the template and inserts a `queued` row into `workflow_runs`.
4. A worker started by `ergon worker start` claims the run and marks it `running`.
5. The engine executes step 1, writes its `step_run`, and persists artifacts from successful attempts.
6. The engine continues through later steps sequentially.
7. If a `manual` step is reached, the run becomes `waiting_manual`.
8. The user resumes it with `ergon approve <run_id> <step_id> --decision approve`.
9. The run is requeued and a worker resumes remaining steps.
10. The workflow ends in `succeeded`, `failed`, or `canceled`.

## Conservative Guidance

When helping a user, prefer statements like:

- "the current runtime supports"
- "the current implementation persists"
- "the current limitation is"

Avoid implying future roadmap items already exist.
