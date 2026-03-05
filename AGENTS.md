# AGENTS.md — Ergon Flow

This document defines how AI agents should collaborate on the **Ergon Flow** repository.

Ergon Flow is a **workflow runtime for orchestrating coding agents**. The system executes deterministic workflows composed of steps such as:

- analysis
- planning
- code generation
- patch generation
- PR creation
- review
- notifications

Agents working on this repository are expected to follow the architectural contracts defined in the `/docs` directory and the schema contracts defined in `/library/schemas`.

This document is intentionally explicit so agents can operate safely and predictably.

---

# 1. Scope & Precedence

Scope: this file applies to the **entire repository**.

Precedence order:

1. Direct user instructions
2. This `AGENTS.md`
3. Other documentation

If instructions conflict with the repository architecture, the agent should:

- follow the repository
- explain the divergence

---

# 2. Core Development Philosophy

Ergon Flow prioritizes **determinism, observability, and reproducibility**.

Agents modifying this repository must follow these principles.

### Deterministic execution

Workflow steps must produce structured outputs validated by JSON schemas.

Examples:

```
agent.analysis.v1
agent.plan.v1
agent.patch.v1
agent.pr.v1
```

Agents must **never bypass schemas**.

### Explicit contracts

Communication between workflow steps must happen through **artifacts defined by schemas**.

Implicit assumptions are not allowed.

### Small diffs

Prefer minimal changes targeting root cause.

Avoid large refactors unless explicitly requested.

### Reproducibility

All workflow state must be persisted through the runtime database.

Never introduce behavior that depends on hidden state.

---

# 3. Repository Overview

The repository is structured around four core layers.

```
/docs
  Architecture and design documents

/library
  Declarative definitions used by workflows

  agents/
  Agent profiles

  schemas/
  Artifact schemas

  workflows/
  Built‑in workflow templates

/packages
  Implementation code

  cli
  workflow engine
  executors
  storage
  clients
```

Agents should **never mix responsibilities across layers**.

---

# 4. Agent Profiles

Agent definitions live in:

```
library/agents/
```

Each agent is declarative and defines:

```
id
provider
model
capabilities
settings
execution policy
output schema
```

Example agents:

```
repo-analyzer
repo-planner
coder
pr-writer
reviewer
```

Agent definitions must remain **simple configuration files**.

Do not embed logic inside them.

---

# 5. Artifact Schemas

All artifacts produced by workflows must follow schemas defined in:

```
library/schemas/
```

Examples:

```
agent.analysis.v1.json
agent.plan.v1.json
agent.patch.v1.json
agent.pr.v1.json
```

Schemas define the **contracts between workflow steps**.

Agents implementing new functionality must:

1. create or update schemas
2. document them
3. validate outputs against them

Never introduce implicit formats.

---

# 6. Workflows

Workflow templates live in:

```
library/workflows/
```

Examples:

```
code.refactor.yaml
code.codegen.yaml
code.hotfix.yaml
code.docs_update.yaml
code.bump_deps.yaml
```

Workflows are **declarative DAG‑like structures** describing ordered steps.

Typical workflow pipeline:

```
repo-analyzer
   ↓
repo-planner
   ↓
coder
   ↓
pr-writer
   ↓
reviewer
   ↓
notify
```

Agents should preserve this architecture unless explicitly redesigning workflows.

---

# 7. Runtime Architecture

Ergon Flow implements a **worker runtime architecture inspired by Temporal**.

Execution flow:

```
CLI
  ↓
Workflow Run Created
  ↓
Worker claims run
  ↓
Workflow Engine executes steps
  ↓
Step Executors call agents/tools
  ↓
Artifacts persisted
```

Workers must be:

- stateless
- restartable
- deterministic

All state lives in the database.

---

# 8. Worker Safety Rules

Agents modifying the runtime must preserve:

### Idempotency

Steps must be safely retryable.

### Lease‑based execution

Workers must claim runs using a lease system.

### Failure recovery

Workers must recover from crashes without corrupting state.

---

# 9. Coding Guidelines

Language: **TypeScript**.

Preferred patterns:

- functional style
- named exports
- early returns
- minimal abstractions

Avoid:

- unnecessary classes
- implicit global state
- hidden side effects

---

# 10. Tooling

The repository prefers **minimal tooling**.

Formatting and linting should use:

```
Biome
```

Do not introduce Prettier or ESLint unless explicitly required.

---

# 11. Testing Expectations

Agents implementing runtime logic should ensure:

- deterministic behavior
- schema validation
- correct workflow step transitions

Critical areas:

- workflow engine
- worker scheduling
- step execution
- artifact persistence

---

# 12. Making Changes Safely

When modifying the system:

1. Identify affected schemas
2. Identify affected executors
3. Identify affected workflows
4. Update documentation if architecture changes

Changes must remain **compatible with existing workflows** unless explicitly breaking.

---

# 13. When Facing Ambiguity

If two implementations are possible:

1. present options
2. explain tradeoffs
3. recommend one

Proceed automatically **only when the change is safe**.

For risky changes, request confirmation.

---

# 14. What Agents Should NOT Do

Agents must not:

- bypass schemas
- introduce hidden state
- change workflow semantics silently
- introduce new infrastructure without justification

All architectural changes must be documented.

---

# 15. Goal of This Repository

Ergon Flow exists to make **AI‑driven software development reproducible**.

The system transforms:

```
intent → workflow → execution → artifacts
```

into deterministic runs that can be audited, replayed, and improved.

Agents contributing to this repository must preserve this goal.

---

End of AGENTS.md
