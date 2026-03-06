# TEMPLATE_SPEC

TODO: Fill documentation.

# Ergon Flow — Workflow Template Specification (TEMPLATE_SPEC)

Version: 0.1  
Status: Draft

---

# 1. Purpose

This document defines the **declarative language used to describe workflows in Ergon Flow**.

Workflows are written as **YAML templates** and serve as the primary interface between:

- workflow authors
- the workflow engine
- execution clients
- storage and artifact systems

The template system defines:

- the structure of workflows
- the contract for steps
- how inputs and artifacts flow between steps
- execution strategies and retry policies

The goal is to make workflows:

- **deterministic**
- **inspectable**
- **versionable**
- **reproducible**

---

# 2. Design Principles

The template language follows several principles.

### Deterministic Execution

A workflow definition must fully describe its execution behavior.

No hidden runtime decisions should exist.

---

### Explicit Data Flow

All information passed between steps must occur through:

```
inputs
artifacts
outputs
```

---

### Provider Independence

Templates do not bind workflows to a single model ecosystem.

Instead they reference **providers and execution clients**.

---

### Minimal Syntax

Templates must remain readable and writable by engineers.

Complex orchestration logic belongs in the runtime, not the template language.

---

# 3. File Format

Workflow templates are written in YAML.

Example:

```
workflow:
  id: code.refactor
  version: 1

steps:
  - id: analyze
    kind: agent
    provider: openrouter
    model: deepseek/deepseek-v3.2

  - id: plan
    kind: agent
    provider: openrouter
    model: moonshotai/kimi-k2.5

  - id: patch
    kind: agent
    provider: codex
```

---

# 4. Top-Level Structure

Every template must contain the following sections.

```
workflow
inputs
steps
outputs
```

Example:

```
workflow:
  id: code.refactor
  version: 1
  description: Refactor a codebase safely

inputs:
  repository: string

steps:
  - id: analyze
    kind: agent

outputs:
  patch: artifact.patch
```

---

# 5. Workflow Metadata

The `workflow` section defines metadata.

```
workflow:
  id: string
  version: integer
  description: string
  author: string
  tags: []
```

### Fields

| Field | Required | Description |
|-----|-----|-----|
id | yes | Unique workflow identifier |
version | yes | Version number |
description | no | Human description |
author | no | Template author |
tags | no | Categories |

---

# 6. Inputs

Inputs define parameters provided when a workflow starts.

Example:

```
inputs:
  repository: string
  branch: string
  task: string
```

Supported primitive types:

- string
- number
- boolean
- object
- array

Inputs become available to steps as:

```
{{ inputs.repository }}
```

---

# 7. Steps

Steps define the execution sequence.

```
steps:
  - id: analyze
    kind: agent
```

### Step Properties

| Field | Required | Description |
|------|------|------|
id | yes | Step identifier |
kind | yes | Step type |
name | no | Human readable name |
description | no | Step explanation |
depends_on | no | Dependency list |

Example:

```
steps:
  - id: patch
    kind: agent
    depends_on: [plan]
```

---

# 8. Step Types

Ergon Flow supports several step types.

```
agent
exec
notify
manual
condition
artifact
```

Each type has a specific contract.

---

# 9. Agent Step

Agent steps invoke reasoning systems.

Example:

```
- id: analyze
  kind: agent
  provider: openrouter
  model: deepseek/deepseek-v3.2
```

### Fields

| Field | Required | Description |
|-----|-----|-----|
provider | yes | execution provider |
model | optional | model identifier |
agent | optional | external agent name |
prompt | optional | prompt template |

### Supported Providers

Agent steps may target:

Model providers:

- openrouter
- ollama

External agents:

- codex
- claude-code
- openclaw

Example using Codex:

```
- id: patch
  kind: agent
  provider: codex
```

Example using Claude Code:

```
- id: review
  kind: agent
  provider: claude-code
```

Example using OpenClaw:

```
- id: coder
  kind: agent
  provider: openclaw
```

---

# 10. Exec Step

Exec steps run local commands.

Example:

```
- id: run-tests
  kind: exec
  command: npm test
```

### Fields

| Field | Required |
|------|------|
command | yes |
cwd | optional |
env | optional |

---

# 11. Notify Step

Notify steps send messages to external systems.

Example:

```
- id: notify
  kind: notify
  channel: stdout
  message: "Workflow completed"
```

Supported channels:

- stdout
- webhook
- openclaw

---

# 12. Manual Step

Manual steps pause execution until human approval.

Example:

```
- id: approval
  kind: manual
  message: "Approve patch?"
```

Execution halts until approval.

---

# 13. Condition Step

Condition steps allow conditional branching.

Example:

```
- id: check-tests
  kind: condition
  expression: "{{ artifacts.tests_passed }}"
```

---

# 14. Artifact Step

Artifact steps transform stored artifacts.

Example:

```
- id: format-patch
  kind: artifact
  input: patch
  operation: format
```

---

# 15. Artifacts

Artifacts are structured outputs produced by steps.

Example:

```
artifacts:
  patch:
    type: patch
```

Artifact types may include:

- patch
- plan
- analysis
- text
- json

Artifacts become available to later steps.

---

# 16. Outputs

Outputs define the final workflow results.

Example:

```
outputs:
  patch: artifacts.patch
  branch: inputs.new_branch
```

Runtime contract:

- bare references such as `artifacts.patch` and `inputs.new_branch` are valid
- `{{ ... }}` interpolation is also valid
- output references may drill into object fields, for example
  `artifacts.review.summary`

---

# 17. Retry Strategy

Steps may include retry logic.

Example:

```
retry:
  max_attempts: 3
  on:
    - schema_invalid
    - patch_apply_failed
```

---

# 18. Execution Strategy

Steps may define provider strategies.

Example:

```
strategy:
  ladder:
    - provider: openrouter
      model: deepseek/deepseek-v3.2
    - provider: openrouter
      model: moonshotai/kimi-k2.5
    - provider: codex
```

Initial implementations may ignore advanced strategy fields.

---

# 19. Variable Interpolation

Templates support variable interpolation.

Examples:

```
{{ inputs.repository }}
{{ artifacts.plan }}
{{ artifacts.tests.exec.stdout }}
```

Runtime contract:

- supported sources are `inputs.*` and `artifacts.*`
- references to unknown inputs or artifacts are rejected at validation time
- artifact names may contain dots; the resolver matches the longest artifact
  name first and then drills into nested object fields

---

# 20. Example Full Workflow

```
workflow:
  id: code.refactor
  version: 1

inputs:
  repository: string

steps:

  - id: analyze
    kind: agent
    provider: openrouter
    model: deepseek/deepseek-v3.2

  - id: plan
    kind: agent
    provider: openrouter
    model: moonshotai/kimi-k2.5

  - id: patch
    kind: agent
    provider: codex

  - id: run-tests
    kind: exec
    command: npm test

  - id: review
    kind: agent
    provider: claude-code

outputs:
  patch: artifacts.patch
```

---

# 21. Versioning

Templates must include a version.

This allows safe evolution of workflows.

---

# 22. Validation

Templates are validated before execution.

Validation checks:

- required fields
- step dependencies
- provider configuration
- artifact references

---

# 23. Future Extensions

Future versions may introduce:

- parallel step execution
- dynamic provider scheduling
- conditional graphs
- reusable subworkflows
- plugin step types

---

# End of TEMPLATE SPEC
