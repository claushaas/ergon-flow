# DB_SCHEMA

TODO: Fill documentation.

# Ergon Flow — DB Schema (SQLite)

Version: 0.1  
Status: Draft

---

# 1. Purpose

This document specifies the **SQLite schema** for Ergon Flow.

The schema is designed for the **Worker Runtime (Model B)** described in `SPEC.md` and `ARCHITECTURE.md`:

- `ergon run` schedules a workflow run by inserting it into the run queue
- `ergon worker start` claims queued runs and executes them
- all state transitions are persisted for auditability and crash recovery

This schema is inspired by patterns from job runners and workflow engines (e.g., lease-based claiming, event logs, attempt tracking), adapted for a single-node SQLite-first runtime.

---

# 2. Design Goals

The schema must support:

- **Deterministic replay**: all significant transitions are recorded
- **Crash recovery**: workers can resume runs after interruption
- **Concurrency safety**: multiple workers can claim runs without duplication
- **Attempt tracking**: retries are first-class, with per-attempt outputs
- **Artifact traceability**: every artifact is attributable to a step run attempt
- **Auditability**: event log acts as append-only source of truth

---

# 3. Storage Layout

Ergon Flow stores:

1. **Run state** in SQLite (tables below)
2. **Artifacts on disk** under:

```
.runs/<run_id>/
  artifacts/
  steps/<step_id>/<attempt>/
```

SQLite stores artifact metadata and file paths.

---

# 4. Primary Entities

Core entities:

- `workflows` — catalog of workflow templates known to the system
- `workflow_runs` — run queue + run state (Model B)
- `step_runs` — execution record of each workflow step, per attempt
- `artifacts` — metadata for stored artifacts
- `events` — append-only event log

Optional (recommended):

- `workers` — worker heartbeats and identity
- `locks` — advisory locks (rarely needed if lease mechanism is used correctly)

---

# 5. Status Enums (Canonical)

These values must match `SPEC.md`.

## 5.1 workflow_runs.status

- `queued` — waiting for worker
- `running` — worker executing steps
- `waiting_manual` — paused awaiting approval
- `succeeded` — completed
- `failed` — terminal failure
- `canceled` — user canceled

## 5.2 step_runs.status

- `queued`
- `running`
- `succeeded`
- `failed`
- `skipped`
- `waiting_manual`

---

# 6. Time and IDs

- `*_at` timestamps are stored as **ISO-8601 UTC strings**.
- IDs are **text** (ULID or UUID recommended).
- JSON columns are stored as `TEXT` containing JSON.

---

# 7. Schema (DDL)

## 7.1 Pragmas

Recommended defaults:

```sql
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;
PRAGMA foreign_keys = ON;
PRAGMA busy_timeout = 5000;
```

---

## 7.2 workflows

Catalog of workflow templates available on this node.

```sql
CREATE TABLE IF NOT EXISTS workflows (
  id            TEXT PRIMARY KEY,           -- e.g. "code.refactor"
  version       INTEGER NOT NULL,            -- template version
  description   TEXT,
  source_path   TEXT NOT NULL,               -- path to YAML template file
  hash          TEXT NOT NULL,               -- content hash for immutability
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL,
  UNIQUE(id, version)
);
```

Notes:
- `hash` prevents silent template drift: once a run starts, it must reference an immutable template hash/version.

---

## 7.3 workers (recommended)

Tracks active workers and heartbeats for operational visibility.

```sql
CREATE TABLE IF NOT EXISTS workers (
  id            TEXT PRIMARY KEY,            -- worker_id (stable across restarts if desired)
  hostname      TEXT,
  pid           INTEGER,
  started_at    TEXT NOT NULL,
  last_beat_at  TEXT NOT NULL,
  meta_json     TEXT                          -- JSON: versions, capabilities
);
```

Workers should update `last_beat_at` periodically.

---

## 7.4 workflow_runs (run queue + run state)

This table is the **run queue** for Model B.

```sql
CREATE TABLE IF NOT EXISTS workflow_runs (
  id                 TEXT PRIMARY KEY,       -- run_id
  workflow_id         TEXT NOT NULL,          -- workflows.id
  workflow_version    INTEGER NOT NULL,
  workflow_hash       TEXT NOT NULL,          -- immutable template hash at scheduling time

  status             TEXT NOT NULL,           -- queued|running|waiting_manual|succeeded|failed|canceled

  -- Scheduling / priority
  priority           INTEGER NOT NULL DEFAULT 0,
  scheduled_at       TEXT NOT NULL,           -- when inserted to queue

  -- Worker claiming (lease mechanism)
  claimed_by         TEXT,                    -- workers.id
  lease_until        TEXT,                    -- UTC time; expired leases can be reclaimed
  attempt            INTEGER NOT NULL DEFAULT 0, -- run-level attempt (rare; mostly for catastrophic restarts)

  -- Execution cursor (resume support)
  current_step_id    TEXT,                    -- step id currently executing or next to execute
  current_step_index INTEGER NOT NULL DEFAULT 0,

  -- Inputs / context
  inputs_json        TEXT NOT NULL,           -- JSON of resolved inputs
  context_json       TEXT,                    -- JSON: repo, branch, env, etc.

  -- Results / errors
  result_json        TEXT,                    -- JSON: outputs summary
  error_code         TEXT,                    -- stable error category
  error_message      TEXT,                    -- short human message
  error_detail_json  TEXT,                    -- JSON: stack, provider errors, etc.

  -- Timestamps
  started_at         TEXT,
  finished_at        TEXT,
  created_at         TEXT NOT NULL,
  updated_at         TEXT NOT NULL,

  FOREIGN KEY (workflow_id) REFERENCES workflows(id)
);
```

### Invariants
- When `status = queued`, `claimed_by` and `lease_until` SHOULD be NULL (or lease expired).
- When `status = running`, `claimed_by` MUST be set and `lease_until` MUST be in the future.
- `workflow_hash` and `workflow_version` MUST match an entry in `workflows`.

---

## 7.5 step_runs (per-step execution records)

Tracks each step execution, including retries.

```sql
CREATE TABLE IF NOT EXISTS step_runs (
  id                 TEXT PRIMARY KEY,       -- step_run_id
  run_id             TEXT NOT NULL,           -- workflow_runs.id
  step_id            TEXT NOT NULL,           -- template step id
  step_kind          TEXT NOT NULL,           -- agent|exec|notify|manual|condition|artifact
  status             TEXT NOT NULL,           -- queued|running|... (see SPEC)
  attempt            INTEGER NOT NULL DEFAULT 1, -- 1..N

  -- Dependency/cursor helpers
  depends_on_json    TEXT,                    -- JSON array of step ids (optional)
  started_at         TEXT,
  finished_at        TEXT,

  -- Executor request/response (for audit and debugging)
  request_json       TEXT,                    -- JSON: rendered prompt, command, provider config
  response_json      TEXT,                    -- JSON: raw provider response or executor output

  -- Structured outputs (normalized)
  output_json        TEXT,                    -- JSON: normalized output payload (schema-aligned)
  error_code         TEXT,
  error_message      TEXT,
  error_detail_json  TEXT,

  created_at         TEXT NOT NULL,
  updated_at         TEXT NOT NULL,

  FOREIGN KEY (run_id) REFERENCES workflow_runs(id) ON DELETE CASCADE,
  UNIQUE(run_id, step_id, attempt)
);
```

Notes:
- `attempt` is per-step, independent of run attempt.
- `request_json` should contain enough data to reproduce the call, excluding secrets.

---

## 7.6 artifacts (metadata + filesystem pointers)

Artifacts are stored on disk; SQLite stores metadata.

```sql
CREATE TABLE IF NOT EXISTS artifacts (
  id                 TEXT PRIMARY KEY,       -- artifact_id
  run_id             TEXT NOT NULL,
  step_run_id        TEXT NOT NULL,

  name               TEXT NOT NULL,           -- e.g. "patch", "plan", "analysis"
  type               TEXT NOT NULL,           -- patch|plan|analysis|text|json|binary
  mime               TEXT,                    -- optional MIME type

  path               TEXT NOT NULL,           -- filesystem path under .runs/<run_id>/
  size_bytes         INTEGER,
  sha256             TEXT,                    -- optional integrity hash

  meta_json          TEXT,                    -- JSON: schema version, tool info, etc.

  created_at         TEXT NOT NULL,

  FOREIGN KEY (run_id) REFERENCES workflow_runs(id) ON DELETE CASCADE,
  FOREIGN KEY (step_run_id) REFERENCES step_runs(id) ON DELETE CASCADE
);
```

Recommendation:
- store normalized outputs as JSON artifacts even when provider returned text, for later indexing.

---

## 7.7 events (append-only log)

Events are the **source of truth** for what happened during execution.

```sql
CREATE TABLE IF NOT EXISTS events (
  id                 TEXT PRIMARY KEY,       -- event_id (ULID recommended for ordering)
  run_id             TEXT NOT NULL,
  step_run_id        TEXT,                    -- optional

  type               TEXT NOT NULL,           -- workflow_started|step_started|...
  ts                 TEXT NOT NULL,           -- UTC timestamp

  actor              TEXT NOT NULL,           -- "cli" | "worker:<id>" | "system"
  seq                INTEGER NOT NULL,        -- monotonic per-run sequence number

  payload_json       TEXT,                    -- JSON: event details
  created_at         TEXT NOT NULL,

  FOREIGN KEY (run_id) REFERENCES workflow_runs(id) ON DELETE CASCADE,
  FOREIGN KEY (step_run_id) REFERENCES step_runs(id) ON DELETE SET NULL,
  UNIQUE(run_id, seq)
);
```

Notes:
- `seq` is per-run and must be allocated transactionally to guarantee ordering.
- Prefer ULIDs for `events.id` so `ORDER BY id` approximates chronological order.

---

# 8. Indexes (Performance)

SQLite needs explicit indexes for queue polling and run inspection.

```sql
-- Queue polling
CREATE INDEX IF NOT EXISTS idx_workflow_runs_queue
  ON workflow_runs(status, priority DESC, scheduled_at);

-- Lease reclaim
CREATE INDEX IF NOT EXISTS idx_workflow_runs_lease
  ON workflow_runs(status, lease_until);

-- Lookup by workflow
CREATE INDEX IF NOT EXISTS idx_workflow_runs_workflow
  ON workflow_runs(workflow_id, workflow_version);

-- Step runs by run
CREATE INDEX IF NOT EXISTS idx_step_runs_run
  ON step_runs(run_id, step_id, attempt);

-- Artifacts by run
CREATE INDEX IF NOT EXISTS idx_artifacts_run
  ON artifacts(run_id, name);

-- Events by run
CREATE INDEX IF NOT EXISTS idx_events_run
  ON events(run_id, seq);

-- Events by type (optional)
CREATE INDEX IF NOT EXISTS idx_events_type
  ON events(type, ts);
```

---

# 9. Critical Transactions

This section defines the **atomic operations** required for correctness.

## 9.1 Scheduling a Run (CLI)

Scheduling must insert:

1. workflow_runs row (status = queued)
2. events row (workflow_scheduled)

In one transaction.

---

## 9.2 Claiming a Run (Worker)

Claiming must be atomic.

Pseudo-transaction:

```sql
BEGIN;

-- choose a candidate run
SELECT id
FROM workflow_runs
WHERE status = 'queued'
  AND (lease_until IS NULL OR lease_until < :now)
ORDER BY priority DESC, scheduled_at ASC
LIMIT 1;

-- claim it
UPDATE workflow_runs
SET status = 'running',
    claimed_by = :worker_id,
    lease_until = :lease_until,
    started_at = COALESCE(started_at, :now),
    updated_at = :now
WHERE id = :run_id
  AND status = 'queued'
  AND (lease_until IS NULL OR lease_until < :now);

-- verify update count == 1

COMMIT;
```

If update count != 1, another worker won; retry.

---

## 9.3 Lease Renewal (Worker Heartbeat)

Workers should periodically extend lease while executing.

```sql
UPDATE workflow_runs
SET lease_until = :lease_until,
    updated_at = :now
WHERE id = :run_id
  AND claimed_by = :worker_id
  AND status = 'running';
```

---

## 9.4 Step Start / Finish (Engine)

Each step attempt should be recorded as:

- insert step_runs (queued)
- event step_scheduled
- update step_runs status running + event step_started
- persist outputs + event step_succeeded/failed
- update workflow_runs current_step cursor

All of this should happen through transactions to keep state consistent.

---

# 10. Resume Semantics

Resume is enabled by:

- `workflow_runs.current_step_index`
- `workflow_runs.current_step_id`
- existing `step_runs` rows

On worker restart, the engine should:

1. load run
2. load steps from template
3. find the first step not in `succeeded|skipped`
4. continue from there

If a step_run is `running` but lease expired, treat it as failed-attempt and retry according to template policy.

---

# 11. Manual Steps

When a manual step is encountered:

- mark step_run status = `waiting_manual`
- mark workflow_run status = `waiting_manual`
- emit event(s)

A separate CLI command (future) can approve:

```
ergon approve <run_id> <step_id> --decision approve|reject
```

Approvals should be stored as events with payload including actor identity.

---

# 12. Cancellation

Cancellation is modeled as:

- set workflow_run status = `canceled`
- emit event `workflow_canceled`

Workers should check cancellation state between steps and before executing long-running operations.

---

# 13. Open Questions (for later)

- Should workflows/templates be persisted fully in DB, or only referenced by hash/path?
- Should artifacts support content-addressed storage by default?
- Should step_runs store a compacted/hashed request_json to reduce DB size?
- Should we add a `run_tags` table for searching and grouping runs?

---

# End of DB_SCHEMA