# Ergon Flow — Roadmap

Version: 0.1  
Target release: **v0.0.1**  
Execution model: **Linear (Model B: Queue + Worker)**

---

# 0. Why this roadmap is linear

Yes — it makes sense to execute this roadmap **linearly**.

Ergon Flow has a hard dependency chain:

- the **template language** defines what must be executed
- the **DB schema** defines what must be persisted
- the **worker runtime** defines how runs are executed
- the **CLI** schedules runs and inspects state

So the fastest path is a vertical slice that closes the loop:

```
CLI enqueue → Worker claim/lease → Engine runs 1 step → Persist events/artifacts → CLI inspect
```

Once the loop works end-to-end, new step types and providers become incremental.

---

# 1. Release definition: v0.0.1

v0.0.1 is considered done when the system supports:

## 1.1 Core runtime (Model B)

- `ergon run <workflow>` schedules a run (status `queued`)
- `ergon worker start` claims queued runs using lease semantics
- engine executes steps sequentially
- each step produces:
  - `step_runs` entries
  - `events` entries
  - optional `artifacts`
- run finishes with deterministic status (`succeeded` / `failed` / `waiting_manual` / `canceled`)

## 1.2 Template support

- YAML workflow templates load + validate per `TEMPLATE_SPEC.md`
- interpolation works for `inputs` and basic references (`{{ inputs.* }}` + `{{ artifacts.* }}` at minimum)

## 1.3 Step types supported in v0.0.1

Minimum set for parity with the docs (pragmatic scope):

- `agent`
- `exec`
- `notify`
- `manual`
- `condition`
- `artifact` (minimal operations; may be stubbed to only copy/rename/format JSON)

If needed for schedule, `artifact` can ship as a minimal “passthrough/transform” executor.

## 1.4 Provider adapters supported in v0.0.1

Minimum viable set:

- `openrouter` (ModelClient)
- `ollama` (ModelClient) — optional if time is tight
- `codex` (AgentClient) — optional if time is tight
- `claude-code` (AgentClient) — optional if time is tight
- `openclaw` (AgentClient) — optional

Constraint: adapters may ship with a “single prompt → single response” contract first.

---

# 2. Linear execution plan

The roadmap is organized in **large scopes** executed in order.  
Each scope is split into **phases**, each phase into **grouped steps**.

Order rationale: every scope unlocks the next without backtracking.

---

## Scope A — Repo skeleton and shared foundations - ✅

### Phase A1 — Packages and boundaries - ✅

- Create pnpm workspace structure:
  - `packages/cli`
  - `packages/engine`
  - `packages/clients`
  - `packages/storage`
  - `packages/shared`
- Define import boundaries:
  - CLI depends on Engine + Storage
  - Engine depends on Clients + Storage + Shared
  - Built-in executors live under Engine
  - Clients depend on Shared

### Phase A2 — Shared contracts - ✅

- Define TypeScript types aligned to docs:
  - `WorkflowTemplate`
  - `WorkflowRun`
  - `StepDefinition`
  - `StepRun`
  - `Artifact`
  - `Event`
  - `ExecutionClient` interface
- Define canonical enums:
  - `workflow_run.status`
  - `step_run.status`
- Define error codes (stable categories):
  - `schema_invalid`
  - `provider_error`
  - `exec_failed`
  - `artifact_failed`
  - `condition_failed`
  - `manual_rejected`

### Phase A3 — Local filesystem layout - ✅

- Define `.runs/<run_id>/...` directory rules
- Implement safe path helpers (no traversal)

Deliverable: foundations compile + unit tests run.

---

## Scope B — Storage (SQLite) and migration bootstrap - ✅

### Phase B1 — SQLite bootstrap - ✅

- Implement `packages/storage` with:
  - open DB
  - apply pragmas (WAL, FK, busy_timeout)
  - run migrations
- Write initial migration that matches `DB_SCHEMA.md`:
  - `workflows`, `workflow_runs`, `step_runs`, `artifacts`, `events`, `workers`
  - indexes

### Phase B2 — Storage API (minimal) - ✅

- Implement storage operations used by CLI/Worker:
  - `registerWorkflow(template)`
  - `createRun(workflow_id, inputs)`
  - `getRun(run_id)`
  - `listRuns(filters)`
  - `appendEvent(run_id, type, payload)` with monotonic `seq`
  - `createStepRun(run_id, step_id, attempt, kind)`
  - `updateStepRunStatus(step_run_id, status, ...)`
  - `insertArtifact(run_id, step_run_id, ...)`

### Phase B3 — Claim/lease primitives - ✅

- Implement atomic claim:
  - `claimNextRun(worker_id, lease_duration)`
- Implement lease renewal:
  - `renewLease(run_id, worker_id, lease_duration)`
- Implement run completion update:
  - `markRunSucceeded/Failed/WaitingManual/Canceled`

Deliverable: a storage-only test can enqueue and claim a run safely with two simulated workers.

---

## Scope C — Template loading and validation- ✅

### Phase C1 — YAML loader - ✅

- Load YAML templates from `library/workflows`
- Normalize template structure (`workflow`, `inputs`, `steps`, `outputs`)

### Phase C2 — Schema validation (static) - ✅

- Validate required fields per `TEMPLATE_SPEC.md`
- Validate step ids unique
- Validate `depends_on` references
- Validate provider fields on `agent` steps

### Phase C3 — Interpolation (minimal) - ✅

- Implement interpolation engine with strict rules:
  - allowed sources: `inputs.*`, `artifacts.*`
  - unknown reference → validation error
- Render per-step request payloads (prompt/command/message)

Deliverable: CLI can `template list` and validate templates.

---

## Scope D — Execution Clients (adapters) - ✅

### Phase D1 — Client registry - ✅

- Implement `ClientRegistry`:
  - `get(provider)`
  - validates provider config

### Phase D2 — OpenRouter ModelClient (v0) - ✅

- Implement minimal request/response:
  - text-in → text-out
  - optional JSON mode if needed
- Normalize into a common `AgentResult` structure

### Phase D3 — Optional adapters (as time permits) - ✅

- `ollama` (same interface)
- `openclaw` (spawn `openclaw agent ...`)
- `codex` (spawn `codex ...`)
- `claude-code` (spawn `claude ...`)

Deliverable: a harness test can call OpenRouter adapter and persist response.

---

## Scope E — Executors (step types) - ✅

### Phase E1 — Executor framework - ✅

- Implement `Executor` interface:
  - `execute(step, ctx) → { outputs, artifacts, status }`
- Provide `ExecutionContext`:
  - resolved inputs
  - artifact lookup
  - run metadata

### Phase E2 — agent executor - ✅

- Render prompt + provider request
- Call client
- Produce artifact(s):
  - `analysis` / `plan` / `text` / `json` (as configured)
- Handle retry policy (record attempt)

### Phase E3 — exec executor - ✅

- Execute local command (controlled env)
- Capture stdout/stderr/exit code
- Produce artifacts:
  - `exec.stdout`, `exec.stderr`, `exec.result`

### Phase E4 — condition executor - ✅

- Evaluate expression (minimal):
  - boolean over known values (inputs/artifacts)
- Mark downstream steps as `skipped` when false

### Phase E5 — manual executor - ✅

- Transition run to `waiting_manual`
- Persist event `manual_waiting`
- Stop execution loop cleanly

### Phase E6 — notify executor - ✅

- Minimal notifier: stdout + optional webhook
- Optional: OpenClaw `openclaw message send ...` integration later

### Phase E7 — artifact executor (minimal) - ✅

- Minimal operations:
  - rename/copy JSON
  - extract field
  - merge JSON

Deliverable: engine can execute a workflow with `agent + exec + condition + manual + notify`.

---

## Scope F — Workflow Engine (sequential runner) - ✅

### Phase F1 — Engine core loop - ✅

- `executeRun(run_id, worker_id)`
- Load run + workflow template
- Determine next step using:
  - cursor fields (`current_step_index`)
  - `step_runs` history
- For each step:
  - create step_run
  - mark running
  - execute via executor
  - persist artifacts
  - mark succeeded/failed/skipped/waiting_manual
  - append events
  - advance cursor

### Phase F2 — Retry handling - ✅

- Per-step retry (attempt increments)
- Failure categorization
- Stop on terminal errors

### Phase F3 — Cancellation check - ✅

- Before each step, check run status
- Abort cleanly if `canceled`

Deliverable: a single run is fully replayable from DB state.

---

## Scope G — Worker Runtime - ✅

### Phase G1 — Worker loop - ✅

- `ergon worker start`
- Register/update worker heartbeat
- Poll queue with backoff
- Claim run atomically
- Execute run through engine
- Renew lease periodically during long runs

### Phase G2 — Crash recovery semantics - ✅

- Reclaim runs with expired lease
- If a step_run is `running` under expired lease:
  - mark attempt as failed
  - retry step according to policy

Deliverable: kill -9 worker mid-run, restart worker, run resumes deterministically.

---

## Scope H — CLI (user-facing commands) - ✅

### Phase H1 — Core commands - ✅

- `ergon template list`
- `ergon workflow list`
- `ergon run <workflow> --inputs <json|file>`
- `ergon run-status <run_id>`

### Phase H2 — Manual approvals - ✅

- `ergon approve <run_id> <step_id> --decision approve|reject`
- Persist approval as event
- Transition run back to `queued` (or continue execution) depending on decision

### Phase H3 — Cancellation - ✅

- `ergon cancel <run_id>`

Deliverable: complete user flow from scheduling to approval to completion.

---

## Scope I — Notifying “PR ready” (v0.0.1 requirement) - ✅

### Phase I1 — Local notification - ✅

- Always emit a `notify` step at end of templates:
  - prints a stable message to stdout
  - writes a `run.summary` artifact

### Phase I2 — Optional channel notification - ✅

- If `openclaw` is configured, allow:
  - `openclaw message send ...` as the notify backend

Deliverable: at workflow end, user receives a notification to review/merge PR.

---

# 3. Exit criteria checklist for v0.0.1

v0.0.1 is done when:

- [ ] A template can be loaded and validated from `library/workflows`
- [ ] `ergon run` enqueues a run (`workflow_runs.status=queued`)
- [ ] Worker claims runs using lease semantics
- [ ] Engine executes at least `agent` and `exec` end-to-end
- [ ] Events are appended with monotonic per-run `seq`
- [ ] Artifacts are written to `.runs/<run_id>/artifacts/` and registered in DB
- [ ] Manual step pauses run (`waiting_manual`) and can be resumed via CLI approval
- [ ] Notify step fires at the end
- [ ] Crash recovery works for expired leases

---

# 4. Explicit deferrals (not in v0.0.1)

- dynamic model scheduling / ladder execution
- distributed workers across multiple machines
- rich UI / TUI
- content-addressed artifact storage (beyond optional sha256)
- advanced conditional graphs (beyond sequential + skip)

---

# End of ROADMAP
