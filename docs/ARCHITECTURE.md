# Ergon Flow — Architecture

Version: 0.2
Status: Draft

---

# 1. Purpose of This Document

This document defines the **implementation architecture** of the Ergon Flow runtime.

It translates the conceptual model defined in `SPEC.md` into concrete software components and execution behavior.

This document describes:

- runtime structure
- worker execution model
- system modules
- data flow
- integration boundaries
- storage responsibilities

This document focuses on **how the system is implemented**, not why it exists.

Conceptual behavior is defined in:

- `SPEC.md`
- `TEMPLATE_SPEC.md`

---

# 2. Architectural Model

Ergon Flow uses a **Worker Runtime architecture (Model B)**.

Workflow execution occurs through a **queue + worker system** rather than inline execution.

Execution is separated into two phases:

1. **Scheduling** (CLI)
2. **Execution** (Workers)

High‑level architecture:

```
User
 ↓
CLI
 ↓
Run Queue (DB)
 ↓
Worker
 ↓
Workflow Engine
 ↓
Step Executors
 ↓
Execution Clients
 ↓
Artifacts + Storage
```

This architecture enables:

- asynchronous execution
- crash recovery
- parallel workers
- deterministic execution tracking

---

# 3. Runtime Components

The system consists of the following runtime modules.

| Component | Responsibility |
|-----------|---------------|
CLI | User interface for scheduling and inspecting runs |
Run Queue | Persistent queue of pending workflow runs |
Worker Runtime | Process that claims and executes runs |
Workflow Engine | Coordinates step execution |
Step Executors | Implement step behavior |
Execution Clients | Integrate with models or agents |
Storage | Persist runs, artifacts, and events |

Each component has a strict responsibility boundary.

---

# 4. CLI Layer

The CLI is the primary entry point for users.

Binary name:

```
ergon
```

Key commands:

```
ergon run <workflow>
ergon run-status <run_id>
ergon workflow list
ergon template list
ergon worker start
```

### CLI Responsibilities

The CLI is responsible for:

- loading workflow templates
- validating template structure
- creating workflow runs
- inserting runs into the queue
- inspecting run state

Important design principle:

```
run = schedule execution
worker = perform execution
```

The CLI **never executes workflow steps directly**.

---

# 5. Run Queue

The **Run Queue** stores pending workflow runs.

It is implemented using the primary storage database (SQLite initially).

Queue state is represented through the `workflow_runs` table.

Example fields:

```
id
workflow_id
status
claimed_by
lease_until
created_at
updated_at
```

Run states include:

```
queued
running
waiting_manual
succeeded
failed
canceled
```

Workers continuously poll the queue for runs in the `queued` state.

---

# 6. Worker Runtime

Workers are responsible for executing workflow runs.

Workers are started via:

```
ergon worker start
```

A worker runs a continuous loop:

```
while true:
  run = claim_next_run()
  if run:
    execute_run(run)
  else:
    sleep
```

Workers are stateless processes.

All workflow state is stored in the database.

This allows:

- safe restarts
- multiple workers
- crash recovery

---

# 7. Run Claiming (Lease Mechanism)

To prevent multiple workers executing the same run, Ergon Flow uses a **lease‑based claiming mechanism**.

Each run includes:

```
claimed_by
lease_until
```

Claim procedure:

1. worker selects a queued run
2. worker atomically updates the run
3. worker sets:

```
status = running
claimed_by = worker_id
lease_until = now + lease_duration
```

If a worker crashes, the lease eventually expires and another worker may reclaim the run.

This ensures **fault tolerance without distributed locking systems**.

---

# 8. Workflow Engine

The Workflow Engine is responsible for executing the logic of a workflow run.

Input:

```
run_id
```

Responsibilities:

- load workflow template
- resolve workflow inputs
- determine next step
- execute steps sequentially
- persist artifacts
- record events

Conceptual execution loop:

```
load run
load workflow

for each step:
  create step_run
  execute step
  persist artifacts
  record events

complete run
```

The engine itself contains **no external integrations**.

All integrations occur through Step Executors.

---

# 9. Step Executors

Step Executors implement the behavior of specific step types.

Supported step types:

```
agent
exec
notify
manual
condition
artifact
```

Each step type has a dedicated executor module.

| Step Type | Executor |
|-----------|----------|
agent | AgentExecutor |
exec | ExecExecutor |
notify | NotifyExecutor |
manual | ManualExecutor |
condition | ConditionExecutor |
artifact | ArtifactExecutor |

Executors are responsible for:

- validating step configuration
- invoking execution clients
- returning structured outputs

Executors **never write directly to the database**.

The Workflow Engine persists all results.

---

# 10. Execution Clients

Execution Clients provide adapters to external systems.

Interface concept:

```
ExecutionClient.run(request) → response
```

Execution clients normalize interaction with:

- model providers
- coding agents
- external runtimes

---

# 11. Model Clients

Model Clients interact with LLM providers.

Supported examples:

- OpenRouter
- Ollama
- OpenAI
- Anthropic

Example usage in workflows:

```
analysis → deepseek
planning → kimi
```

Each client handles:

- request formatting
- authentication
- response normalization

---

# 12. Agent Clients

Agent Clients integrate with external coding agents.

Examples:

- Codex CLI
- Claude Code
- OpenClaw

Agent Clients typically execute external processes.

Example interaction:

```
spawn process
send prompt
capture output
return structured result
```

---

# 13. OpenClaw Integration

OpenClaw may be used as an execution provider.

Integration occurs through the OpenClaw CLI.

Example invocation:

```
openclaw agent --agent coder --message "generate patch"
```

The response is captured and converted into artifacts.

This allows Ergon Flow to orchestrate OpenClaw agents without depending on the OpenClaw runtime architecture.

---

# 14. Artifact System

Artifacts represent outputs produced during execution.

Examples:

- analysis
- execution plans
- patches
- generated documentation

Artifacts serve two roles:

1. data passed between steps
2. persistent audit records

Artifacts are stored in:

```
.runs/<run_id>/artifacts/
```

Each artifact is associated with a specific step run.

---

# 15. Storage Layer

All execution state is stored in a database.

Initial implementation uses **SQLite**.

Core entities:

```
workflows
workflow_runs
steps
step_runs
artifacts
events
```

Events include:

- workflow_started
- step_started
- step_succeeded
- step_failed
- step_retry

The storage layer enables:

- debugging
- replay
- observability

---

# 16. Execution Flow

Complete system execution flow:

```
User
 ↓
ergon run <workflow>
 ↓
Insert workflow_run (queued)
 ↓
Worker claims run
 ↓
Workflow Engine executes steps
 ↓
Step Executors invoke clients
 ↓
Artifacts stored
 ↓
Run completed
```

Every stage generates events recorded in storage.

---

# 17. Fault Tolerance

The worker architecture provides basic fault tolerance.

Failure scenarios supported:

- worker crash
- system restart
- partial execution

Recovery is possible because:

- run state is persisted
- step runs are recorded
- leases expire

Workers can resume execution using stored run state.

---

# 18. Monorepo Structure

The repository is structured as a pnpm monorepo.

Example structure:

```
/packages
  cli
  engine
  executors
  clients
  storage

/templates

/docs
```

This structure isolates responsibilities across modules.

---

# 19. Implementation Language

The initial implementation uses **TypeScript**.

Reasons:

- strong Node ecosystem
- excellent CLI tooling
- good type safety
- compatibility with existing agent tooling

---

# 20. Architectural Principles

Ergon Flow architecture emphasizes:

- deterministic execution
- provider abstraction
- explicit state
- modular design

The system transforms:

```
intent → workflow → run → steps → artifacts
```

into observable and reproducible execution.

---

# End of ARCHITECTURE
