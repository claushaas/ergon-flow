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
