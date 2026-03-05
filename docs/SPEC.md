# Ergon Flow — System Specification (SPEC)

---

# 1. Purpose

**Ergon Flow** is a deterministic workflow runtime designed to execute structured units of work (“erga”) through a sequence of defined steps.

The system enables automation of complex technical workflows — especially software engineering tasks — by orchestrating:

- LLM model providers
- external coding agents
- local tools
- deterministic execution logic

Ergon Flow acts as a **meta‑orchestrator** capable of coordinating multiple types of intelligent systems while maintaining auditability, reproducibility, and clear execution semantics.

The core design goal is to transform **intent into executed work** through explicit workflows.

Conceptually:

```
Intent → Workflow → Steps → Execution → Artifacts
```

---

# 2. Name and Philosophical Foundation

The name **Ergon** (ἔργον) originates from Aristotle and means:

> work, task, or function performed.

In Aristotelian philosophy:

- **Telos** — purpose or goal  
- **Ergon** — the work performed to realize that goal  

Ergon Flow therefore represents:

> the structured execution of work toward a defined purpose.

This aligns with the broader STOA ecosystem philosophy where systems exist to support purposeful action.

---

# 3. System Overview

Ergon Flow is composed of five main subsystems:

```
CLI
 ↓
Workflow Engine
 ↓
Step Executors
 ↓
Execution Clients
 ↓
Artifacts + Storage
```

### Components

| Component | Responsibility |
|--------|--------|
CLI | User interface for executing workflows |
Workflow Engine | Coordinates execution of workflows |
Step Executors | Executes individual steps |
Execution Clients | Interface to models or external agents |
Storage | Persists runs, artifacts, and events |

---

# 4. Core Concepts

## Workflow

A **workflow** defines a structured process composed of multiple steps.

Workflows are declared in YAML templates.

Example:

```
workflow:
  id: code.refactor
  steps:
    - analyze
    - plan
    - patch
    - review
```

A workflow represents a repeatable execution pattern.

---

## Step

A **step** is the smallest unit of execution within a workflow.

Step types include:

- `agent`
- `exec`
- `notify`
- `manual`

Example:

```
steps:
  - id: analyze
    kind: agent
```

Steps may produce artifacts.

---

## Artifact

Artifacts are structured outputs produced during execution.

Examples:

- generated patch
- code analysis
- documentation
- plan
- PR text

Artifacts may be consumed by later steps.

---

## Agent

An **agent** is an execution unit capable of performing reasoning or generating output.

Agents may be implemented through:

- LLM model providers
- external coding agents
- agent runtimes

Examples:

- DeepSeek
- Kimi
- Codex
- Claude Code
- OpenClaw

---

## Execution Client

Execution clients are adapters that allow Ergon Flow to interact with different intelligence providers.

Interface concept:

```
ExecutionClient.run(request) → response
```

Types:

### Model Clients

Direct interaction with language models.

Examples:

- OpenRouter
- Ollama
- OpenAI
- Anthropic

### Agent Clients

Integration with external agent systems.

Examples:

- Codex CLI
- Claude Code
- OpenClaw

---

# 5. Provider Abstraction

Ergon Flow intentionally separates **workflow orchestration** from **model or agent execution**.

This allows workflows to combine multiple providers.

Example:

```
analysis → deepseek
planning → kimi
patch → codex
review → claude-code
```

This architecture avoids lock‑in and allows workflows to evolve as model ecosystems change.

---

# 6. Workflow Execution Model

Execution proceeds sequentially through workflow steps.

High level flow:

```
start workflow
 ↓
execute step
 ↓
validate output
 ↓
store artifact
 ↓
next step
```

Failures may trigger retries or halt execution depending on workflow configuration.

---

# 7. Deterministic Design Principles

Ergon Flow prioritizes determinism.

Workflows should be:

- reproducible
- inspectable
- debuggable

Key design principles:

### Explicit State

Workflow progress must be observable.

### Artifact Persistence

All significant outputs are stored.

### Event Logging

Execution produces structured events.

Examples:

- workflow_started
- step_started
- step_succeeded
- step_failed
- step_retry

---

# 8. Execution Strategy

Steps may specify a provider explicitly.

Example:

```
steps:
  - id: patch
    kind: agent
    provider: codex
```

Future versions may support dynamic provider selection based on cost‑benefit strategies.

Initial implementations use explicit routing.

---

# 9. Templates

Workflows are defined using declarative templates.

Templates allow reuse and parameterization.

Example workflow categories:

- code refactoring
- documentation generation
- dependency updates
- hotfix generation
- code review

Templates form a library within the repository.

---

# 10. CLI Interface

The CLI provides the primary interface to the system.

Repository name:

```
ergon-flow
```

CLI binary:

```
ergon
```

Example commands:

```
ergon run workflow
ergon workflow list
ergon template list
ergon worker start
```

---

# 11. Storage Model

Execution data is persisted in a local database (initially SQLite).

Core entities include:

- workflows
- workflow_runs
- steps
- step_runs
- artifacts
- events

The storage layer enables auditability and debugging.

---

# 12. Non‑Goals

Ergon Flow deliberately excludes several responsibilities.

Non‑goals include:

- replacing CI systems
- distributed job scheduling
- long‑running background orchestration
- hosting full autonomous agent platforms

The system focuses strictly on deterministic workflow execution.

---

# 13. Design Philosophy

Ergon Flow follows several guiding principles.

### Simplicity

The system should remain understandable and maintainable.

### Provider Agnosticism

Execution should work across multiple model ecosystems.

### Determinism First

Reproducibility takes priority over autonomous behavior.

### Incremental Complexity

Advanced features such as adaptive scheduling are deferred until sufficient telemetry exists.

---

# 14. Initial Scope

The first implementation will include:

- workflow template system
- workflow runtime
- step execution engine
- provider adapters
- CLI interface
- SQLite storage

Future versions may expand into:

- parallel workers
- cost‑aware scheduling
- telemetry‑based provider selection
- distributed execution

---

# 15. Open Questions

The following design questions remain open:

- exact schema for workflow templates
- artifact storage format
- plugin system for providers
- parallel execution model
- authentication model for remote providers

These will be addressed in later specification documents.

---

# End of SPEC

# Ergon Flow — System Specification (SPEC)

Version: 0.2  
Status: Draft

---

# 1. Introduction

## 1.1 Purpose

This document defines the **system‑level specification** of **Ergon Flow**, a deterministic workflow runtime designed to execute structured units of work through declarative workflows.

The purpose of this specification is to describe:

- system goals
- core abstractions
- execution model
- runtime architecture constraints
- lifecycle semantics

This document defines **what the system is and how it behaves**, but not implementation details.

Implementation specifics are defined in:

- `ARCHITECTURE.md`
- `DB_SCHEMA.md`
- `TEMPLATE_SPEC.md`

---

## 1.2 Scope

Ergon Flow provides a deterministic runtime for executing **technical workflows**, especially those involving:

- software engineering tasks
- AI‑assisted development
- automated refactoring
- documentation generation
- CI‑adjacent developer workflows

The system orchestrates multiple execution systems while maintaining **traceable, reproducible execution**.

---

## 1.3 Definitions

| Term | Definition |
|-----|------------|
Workflow | Declarative definition of a multi‑step execution process |
Run | A concrete execution instance of a workflow |
Step | A unit of execution within a workflow |
Artifact | Structured output produced during execution |
Worker | Runtime process that executes workflow runs |
Execution Client | Adapter that interacts with external execution systems |

---

# 2. Philosophical Foundation

The name **Ergon** (ἔργον) originates from Aristotelian philosophy and means:

> work, function, or task performed.

Within Aristotle's framework:

- **Telos** represents purpose
- **Ergon** represents the work that realizes that purpose

Ergon Flow embodies the concept of:

> structured execution of purposeful work.

Within the broader STOA ecosystem, Ergon Flow acts as a **mechanism for transforming intention into executed action**.

Conceptually:

```
Intent → Workflow → Run → Steps → Execution → Artifacts
```

---

# 3. System Overview

Ergon Flow is a deterministic workflow runtime composed of the following logical subsystems:

```
CLI
 ↓
Run Queue
 ↓
Workers
 ↓
Workflow Engine
 ↓
Step Executors
 ↓
Execution Clients
 ↓
Artifacts + Storage
```

| Subsystem | Responsibility |
|----------|----------------|
CLI | User interface for scheduling workflows |
Run Queue | Stores pending workflow runs |
Workers | Claim and execute workflow runs |
Workflow Engine | Coordinates execution of steps |
Step Executors | Execute step types |
Execution Clients | Interface to models and agents |
Storage | Persist runs, artifacts and events |

---

# 4. Core System Concepts

## 4.1 Workflow

A **workflow** defines a structured process composed of ordered steps.

Workflows are defined declaratively using YAML templates.

Example:

```
workflow:
  id: code.refactor

steps:
  - analyze
  - plan
  - patch
  - review
```

A workflow represents a **repeatable unit of work**.

---

## 4.2 Workflow Run

A **workflow run** represents a single execution of a workflow.

Each run contains:

- workflow identifier
- run status
- execution state
- produced artifacts

Runs are persisted and fully observable.

---

## 4.3 Step

A **step** is the smallest executable unit inside a workflow.

Common step types include:

- `agent`
- `exec`
- `notify`
- `manual`
- `condition`

Example:

```
- id: analyze
  kind: agent
```

Steps may produce artifacts that feed subsequent steps.

---

## 4.4 Artifact

Artifacts are structured outputs generated during execution.

Examples:

- source code patches
- analysis reports
- generated documentation
- pull request descriptions

Artifacts form the **data flow layer** between workflow steps.

---

## 4.5 Agent

An **agent** is an execution unit capable of reasoning or generating outputs.

Agents may be implemented through:

- language model providers
- coding agents
- external agent runtimes

Examples include:

- DeepSeek
- Kimi
- Codex
- Claude Code
- OpenClaw

---

## 4.6 Execution Client

Execution clients provide a normalized interface for interacting with external systems.

Conceptual interface:

```
ExecutionClient.run(request) → response
```

Execution clients may target:

### Model Clients

Direct LLM providers.

Examples:

- OpenRouter
- Ollama
- OpenAI
- Anthropic

### Agent Clients

External coding agent systems.

Examples:

- Codex CLI
- Claude Code
- OpenClaw

---

# 5. Provider Abstraction

Ergon Flow deliberately separates **workflow orchestration** from **execution providers**.

This architecture enables workflows to combine multiple systems.

Example:

```
analysis → deepseek
planning → kimi
patch → codex
review → claude-code
```

Provider abstraction ensures the runtime remains **agnostic to model ecosystems**.

---

# 6. Workflow Execution Model (Worker Runtime)

Ergon Flow uses an **asynchronous worker‑based execution model**.

Workflow execution occurs in two stages:

### 1 — Scheduling

The CLI schedules a workflow run by inserting it into the run queue.

```
ergon run <workflow>
```

This command does **not execute the workflow immediately**.

Instead it creates a `workflow_run` entry with status:

```
queued
```

---

### 2 — Worker Execution

Worker processes continuously poll the run queue.

```
ergon worker start
```

Workers claim queued runs and execute them.

Execution flow:

```
CLI
 ↓
enqueue workflow_run
 ↓
Worker claims run
 ↓
Workflow Engine executes steps
 ↓
Artifacts stored
 ↓
Run completed
```

---

# 7. Run Lifecycle

Workflow runs transition through the following states:

| Status | Meaning |
|------|--------|
queued | waiting for worker |
running | worker executing steps |
waiting_manual | paused awaiting approval |
succeeded | execution completed |
failed | execution failed |
canceled | execution canceled |

This lifecycle enables deterministic state tracking.

---

# 8. Step Lifecycle

Each step execution produces a step run.

Step states:

| Status | Meaning |
|------|--------|
queued | awaiting execution |
running | currently executing |
succeeded | completed successfully |
failed | execution failed |
skipped | not executed due to condition |
waiting_manual | awaiting human input |

Step transitions are recorded as events.

---

# 9. Deterministic Execution Principles

Ergon Flow prioritizes deterministic behavior.

Key guarantees:

### Explicit State

All workflow progress is stored in persistent state.

### Artifact Persistence

Outputs from steps are stored for inspection and reuse.

### Event Logging

All state transitions generate events.

Example events:

- workflow_started
- step_started
- step_succeeded
- step_failed
- step_retry

This enables debugging and reproducibility.

---

# 10. Templates

Workflows are defined using declarative templates.

Templates describe:

- workflow metadata
- step definitions
- artifact flows

Templates form a reusable workflow library within the repository.

Template syntax is defined in:

```
TEMPLATE_SPEC.md
```

---

# 11. CLI Interface

The CLI provides the primary interface to Ergon Flow.

Repository name:

```
ergon-flow
```

Binary name:

```
ergon
```

Primary commands:

```
ergon run <workflow>
ergon workflow list
ergon template list
ergon run-status <id>
ergon worker start
```

Important semantic distinction:

```
run = schedule execution
worker = perform execution
```

---

# 12. Storage Model

Execution state is persisted in a database.

Initial implementation uses **SQLite**.

Core entities:

- workflows
- workflow_runs
- steps
- step_runs
- artifacts
- events

Storage enables:

- audit trails
- debugging
- deterministic replay

---

# 13. Non‑Goals

Ergon Flow intentionally avoids the following responsibilities:

- replacing CI/CD systems
- distributed orchestration infrastructure
- fully autonomous agent platforms

The system focuses strictly on **deterministic execution of structured workflows**.

---

# 14. Design Principles

### Simplicity

The system should remain understandable and maintainable.

### Provider Agnosticism

Execution should work across multiple model ecosystems.

### Determinism First

Reproducibility takes priority over autonomy.

### Incremental Complexity

Advanced features (adaptive scheduling, distributed workers) will only be introduced when justified by usage.

---

# 15. Initial Implementation Scope

The first version of Ergon Flow includes:

- workflow template system
- worker runtime
- step execution engine
- provider adapters
- CLI interface
- SQLite storage

---

# 16. Future Evolution

Future versions may introduce:

- parallel step execution
- distributed worker pools
- cost‑aware model scheduling
- telemetry‑driven provider selection

These features are intentionally deferred.

---

# End of SPEC