# Ergon Flow Architecture

Version: `0.3`

## Purpose

This document describes the concrete implementation boundaries of the current
runtime.

It is intentionally narrower than `SPEC.md`: it explains how the repository is
actually structured today.

## Top-Level Shape

```text
CLI
  -> Storage (schedule / inspect / decisions)
  -> Worker
       -> Engine
            -> Executors
                 -> Clients / local process / filesystem staging
            -> Storage (state transitions, events, artifact metadata)
```

## Repository Layers

### `packages/cli`

Responsibilities:

- parse CLI arguments
- load local configuration from env
- validate and schedule workflows
- inspect runs
- submit manual decisions
- submit cancellation requests

The CLI never executes a workflow step directly.

### `packages/engine`

Responsibilities:

- run the worker loop
- claim work from storage
- load and validate workflow templates
- coordinate sequential step execution
- enforce claim fencing during state mutation
- stage artifact files before metadata finalization

Built-in executors live here.

### `packages/storage`

Responsibilities:

- open SQLite with pragmas and migrations
- expose storage APIs for runs, steps, artifacts, events and workers
- own transactional state mutation

The storage layer is the single source of truth for persisted run state.

### `packages/clients`

Responsibilities:

- adapt supported providers to the `ExecutionClient` interface
- validate provider configuration

Clients do not persist state directly.

### `packages/shared`

Responsibilities:

- canonical enums
- shared types
- shared process-abort helpers

## Worker Model

Workers are stateless processes. A worker loop:

1. polls storage for a claimable run
2. atomically claims one run
3. executes that run
4. renews the lease while work is in progress
5. repeats until `maxRuns` or external stop

All durable state lives in SQLite and the run filesystem.

## Claim and Fencing Model

Each claim is identified by:

- `claimed_by`
- `lease_until`
- `claim_epoch`

`claim_epoch` increments whenever a run is reclaimed.

Critical run mutations are fenced against the current claim, so a stale worker
cannot legally transition the run after another worker has taken ownership.

## Template Identity

Runs store the scheduled `workflow_hash`.

At execution time, the engine:

1. loads the registered workflow row by `(workflow_id, workflow_version)`
2. verifies that the registered hash still matches the run hash
3. hashes the template file on disk
4. rejects execution if the file changed after scheduling

This prevents silent template drift.

## Execution Boundaries

### Engine vs executors

Executors are responsible for step-local behavior only:

- render inputs
- call local tools or clients
- return outputs, artifacts and executor-local events

Executors do not update `workflow_runs` or `step_runs` directly.

The engine owns:

- step scheduling
- retries
- skip semantics
- manual pause handling
- cancellation checks
- final run resolution

### Engine vs storage

The engine stages artifact files on disk, but storage still owns durable
metadata writes.

The intended order is:

1. executor returns artifact values
2. engine stages files under the attempt directory
3. fenced transaction finalizes step state and inserts artifact metadata

### Executors vs clients

`agent` delegates provider calls to `ExecutionClient`.

`notify` performs stdout, webhook or OpenClaw delivery directly inside the
executor because that step is an external side effect, not a model request.

## Recovery Model

Recovery is driven entirely from persisted state:

- `workflow_runs.current_step_id`
- `workflow_runs.current_step_index`
- `workflow_runs.attempt`
- `step_runs`
- `artifacts`
- `events`

When a lease expires during a running step, the next worker reconstructs the
state from SQLite and successful artifacts on disk.

## Manual and Cancel Paths

`manual` steps park the run in `waiting_manual`.

The approval path is:

```text
waiting_manual -> approve -> queued -> worker resumes remaining steps
```

The rejection path is:

```text
waiting_manual -> reject -> failed
```

Cancellation is allowed from:

- `queued`
- `running`
- `waiting_manual`

## Current Architectural Limits

These limits are deliberate in `v0.0.1`:

- execution is sequential, not parallel DAG scheduling
- `library/agents` is not loaded by the runtime
- `library/schemas` is not enforced at runtime
- provider creation is limited to the supported adapter set in `packages/clients`
