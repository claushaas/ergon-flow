# Ergon Flow Workflow Template Specification

Version: `0.2`

This document describes the workflow template contract enforced by the current
runtime.

Templates are shipped in the CLI package as an embedded library and are copied
into `./.ergon/library/workflows` by `ergon init`. Initialized projects always
resolve templates from `./.ergon/library/workflows`.

## Top-Level Shape

Required sections:

- `workflow`
- `steps`

Optional sections:

- `inputs`
- `outputs`

Example:

```yaml
workflow:
  id: code.refactor
  version: 1
  description: Refactor a codebase safely

inputs:
  repo_path:
    type: string

steps:
  - id: analyze
    kind: agent
    provider: openrouter
    prompt: "Analyze {{ inputs.repo_path }}"

outputs:
  review: artifacts.review
```

## Workflow Metadata

Supported fields in `workflow`:

- `id` (required)
- `version` (required integer)
- `description`
- `author`
- `tags`

## Inputs

`inputs` is a map of input names to input specs.

Supported input types:

- `string`
- `number`
- `boolean`
- `object`
- `array`

Each input spec supports:

- `type` (required)
- `description`
- `default`
- `required`

Runtime behavior:

- defaults are materialized when the run is scheduled
- unknown inputs are rejected
- missing required inputs are rejected
- input values are type-checked before `createRun(...)`

## Step Ordering

Workflows execute sequentially in template order.

`depends_on` is allowed, but only for already-declared earlier steps. The
current runtime does not support forward references or parallel DAG execution.

## Common Step Fields

Every step supports:

- `id`
- `kind`
- `name`
- `description`
- `depends_on`
- `retry`
- `timeout_ms`

`timeout_ms` must be a positive integer.

`retry` supports:

- `max_attempts`
- optional `on` list of error codes

## Supported Step Kinds

### `agent`

Required fields:

- `id`
- `kind: agent`
- `provider`

Optional fields:

- `model`
- `agent`
- `prompt`
- `output`
- `strategy`

Supported providers:

- `openrouter`
- `ollama`
- `codex`
- `claude-code`
- `openclaw`

`output` supports:

- `name`
- `type`

Supported output types:

- `analysis`
- `json`
- `plan`
- `text`

### `exec`

Required fields:

- `id`
- `kind: exec`
- `command`

Optional fields:

- `cwd`
- `env`

The runtime captures:

- `<step_id>.stdout`
- `<step_id>.stderr`
- `<step_id>.result`

### `condition`

Required fields:

- `id`
- `kind: condition`
- `expression`

The expression is rendered through interpolation and then coerced by truthiness:

- empty string -> false
- `false`, `null`, `undefined`, `0` -> false
- non-empty string -> true
- JSON arrays/objects -> false only when empty

When false, dependents are skipped by the engine.

### `manual`

Required fields:

- `id`
- `kind: manual`

Optional fields:

- `message`

`message` is interpolated before the run is parked in `waiting_manual`.

### `notify`

Required fields:

- `id`
- `kind: notify`
- `channel`
- `message`

Optional fields:

- `target`

Supported channels:

- `stdout`
- `webhook`
- `openclaw`

`channel`, `target` and `message` are interpolated.

Runtime constraints:

- `webhook` requires a public `https` URL
- `openclaw` requires a non-empty target that does not start with `-`

### `artifact`

Required fields:

- `id`
- `kind: artifact`
- `input`
- `operation`

Supported operations:

- `copy`
- `rename:<target>`
- `extract:<fieldPath>[:target]`
- `merge:<artifactA,artifactB,...>[:target]`

## Interpolation Contract

Allowed sources:

- `inputs.<name>`
- `artifacts.<name>`

The runtime intentionally does not support `steps.*` references.

Interpolation is used in:

- agent prompts
- exec commands, cwd and env values
- manual messages
- notify channel, target and message
- workflow outputs

Unknown references are rejected during validation.

Artifact names may contain `.` and are resolved accordingly, for example:

- `artifacts.tests.exec.stdout`
- `artifacts.deps.scan.stdout`

## Workflow Outputs

`outputs` is an optional map of names to references or interpolated strings.

Supported forms:

- `artifacts.review`
- `inputs.new_branch`
- `{{ artifacts.review.pr_title }}`
- `branch={{ inputs.new_branch }}`

Bare references to `artifacts.*` and `inputs.*` are supported directly.

## Validation Rules

The loader rejects templates that have:

- duplicate step ids
- invalid `depends_on` references
- unsupported providers
- unsupported interpolation sources
- semantic references to unknown inputs or artifacts
- invalid `timeout_ms`
- malformed top-level sections

## Current Limitations

These are deliberate in `v0.1.2`:

- no `steps.*` interpolation
- no parallel DAG scheduling
- no runtime loading of `library/agents`
- no runtime schema validation against `library/schemas`
