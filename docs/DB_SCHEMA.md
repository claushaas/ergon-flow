# Ergon Flow DB Schema

Version: `0.2`

This document describes the actual SQLite schema and the invariants the runtime
depends on today.

The canonical DDL lives in:

- `packages/storage/src/migrations/0001_init.sql`
- `packages/storage/src/migrations/0002_indexes.sql`
- `packages/storage/src/migrations/0003_claim_epoch_backfill.sql`

## Pragmas

Storage opens SQLite with:

```sql
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;
PRAGMA foreign_keys = ON;
PRAGMA busy_timeout = 5000;
```

## Filesystem Layout

SQLite stores run state and artifact metadata.

Artifact files live under:

```text
.runs/<run_id>/
  steps/<step_id>/<attempt>/
```

The current runtime writes concrete artifact files under
`steps/<step_id>/<attempt>/` and stores relative file paths in `artifacts.path`.

## Tables

### `workflows`

Purpose:

- registered workflow catalog for the local node

Primary key:

- `(id, version)`

Important columns:

- `id`
- `version`
- `description`
- `source_path`
- `hash`
- `created_at`
- `updated_at`

Invariant:

- once `(id, version)` is registered, `hash` and `source_path` are immutable

### `workers`

Purpose:

- worker identity and heartbeat visibility

Important columns:

- `id`
- `hostname`
- `pid`
- `started_at`
- `last_beat_at`
- `meta_json`

### `workflow_runs`

Purpose:

- queue row + execution state for a workflow run

Primary key:

- `id`

Important columns:

- `workflow_id`
- `workflow_version`
- `workflow_hash`
- `status`
- `priority`
- `scheduled_at`
- `claimed_by`
- `lease_until`
- `claim_epoch`
- `attempt`
- `current_step_id`
- `current_step_index`
- `inputs_json`
- `context_json`
- `result_json`
- `error_code`
- `error_message`
- `error_detail_json`
- `started_at`
- `finished_at`
- `created_at`
- `updated_at`

Foreign key:

- `(workflow_id, workflow_version) -> workflows(id, version)`

Canonical statuses:

- `queued`
- `running`
- `waiting_manual`
- `succeeded`
- `failed`
- `canceled`

Critical invariants:

- `workflow_hash` is the scheduled template identity for the run
- `claim_epoch` starts at `0` and increments on each successful claim
- only the current `(claimed_by, claim_epoch)` pair may finalize fenced run
  mutations
- `status = running` implies an active claim

### `step_runs`

Purpose:

- per-step, per-attempt execution history

Primary key:

- `id`

Unique key:

- `(run_id, step_id, attempt)`

Important columns:

- `run_id`
- `step_id`
- `step_kind`
- `status`
- `attempt`
- `depends_on_json`
- `request_json`
- `response_json`
- `output_json`
- `error_code`
- `error_message`
- `error_detail_json`
- `started_at`
- `finished_at`
- `created_at`
- `updated_at`

Canonical statuses:

- `queued`
- `running`
- `succeeded`
- `failed`
- `skipped`
- `waiting_manual`

### `artifacts`

Purpose:

- artifact metadata and pointers to files on disk

Important columns:

- `id`
- `run_id`
- `step_run_id`
- `name`
- `type`
- `mime`
- `path`
- `size_bytes`
- `sha256`
- `meta_json`
- `created_at`

Key semantic fields in `meta_json`:

- `step_id`
- `attempt`

### `events`

Purpose:

- append-only audit log for a run

Primary key:

- `id`

Unique key:

- `(run_id, seq)`

Important columns:

- `run_id`
- `step_run_id`
- `type`
- `ts`
- `actor`
- `seq`
- `payload_json`
- `created_at`

Canonical event types:

- `lease_renewed`
- `manual_approved`
- `manual_rejected`
- `manual_waiting`
- `step_failed`
- `step_retry`
- `step_scheduled`
- `step_skipped`
- `step_started`
- `step_succeeded`
- `workflow_canceled`
- `workflow_failed`
- `workflow_scheduled`
- `workflow_started`
- `workflow_succeeded`

Invariant:

- `seq` is monotonic per `run_id`

## Indexes

The current indexed paths are:

- `workflow_runs(status, priority DESC, scheduled_at)`
- `workflow_runs(status, lease_until)`
- `workflow_runs(workflow_id, workflow_version)`
- `artifacts(run_id, name)`
- `events(type, ts)`

## Transaction Rules

### Run scheduling

`createRun(...)` inserts the `workflow_runs` row and appends
`workflow_scheduled` in the same transaction.

### Event allocation

`appendEvent(...)` uses an `IMMEDIATE` transaction and allocates the next
`seq` from the current maximum for that run.

### Claiming

`claimNextRun(...)` is atomic and may reclaim:

- `queued` runs
- `running` runs whose lease expired

Successful claim increments `claim_epoch`.

### Fenced run completion

`markRunSucceeded`, `markRunFailed`, `markRunWaitingManual`, `markRunCanceled`
and `updateRunCursor` require the current worker id and `claim_epoch`.

## Recovery Rules

Recovery depends on persisted state only.

The worker reconstructs state from:

- `workflow_runs`
- `step_runs`
- successful artifacts on disk
- the current workflow template identified by `workflow_hash`

If a workflow file changed after scheduling, the run is rejected instead of
executing a drifted template.
