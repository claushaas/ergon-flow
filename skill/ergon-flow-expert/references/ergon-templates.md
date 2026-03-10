# Ergon Templates

This file explains the current workflow template contract enforced by the runtime.

Use it when creating, editing, validating, or reviewing workflow YAML.

## Top-Level Structure

Required sections:

- `workflow`
- `steps`

Optional sections:

- `inputs`
- `on_failure`
- `outputs`

Minimal shape:

```yaml
workflow:
  id: example.workflow
  version: 1

steps:
  - id: hello
    kind: exec
    command: printf 'hello\n'
```

## `workflow`

Supported metadata fields:

- `id` required
- `version` required integer
- `description`
- `author`
- `tags`

Conservative guidance:

- keep `id` stable
- bump `version` only when you are intentionally changing the workflow contract
- once a workflow `id@version` is registered in a project database, changing the YAML without bumping `version` will cause scheduling to fail because registered workflow versions are immutable

## `inputs`

`inputs` is a map from input name to input spec.

Supported types:

- `string`
- `number`
- `boolean`
- `object`
- `array`

Supported input fields:

- `type` required
- `description`
- `default`
- `required`

Example:

```yaml
inputs:
  repo_path:
    type: string
    description: "Absolute path to the repository."
    required: true

  notify:
    type: object
    default:
      channel: "stdout"
      target: ""
```

Runtime behavior:

- default values are materialized when the run is created
- unknown inputs are rejected
- missing required inputs are rejected
- values are type-checked before scheduling

## `steps`

`steps` is the ordered list of step definitions.

The current runtime executes steps sequentially in template order.

Each step supports these common fields:

- `id`
- `kind`
- `name`
- `description`
- `depends_on`
- `retry`
- `timeout_ms`

Modeling rule:

- if a step is semantically an agent interaction, use `kind: agent` by default
- do not rewrite agent work as `exec` just because a local CLI exists
- if a local CLI provider must run in a specific repository context, use `agent.cwd` explicitly
- use `exec` only when the step is no longer primarily agentic, or when you need deterministic side effects such as Git commands, file writes, or post-processing

### `depends_on`

`depends_on` is allowed only for earlier steps.

Current limitation:

- no forward references
- no parallel DAG execution

Use `depends_on` for explicit sequencing and skip gating, not for concurrency.

### Timed wait steps

The current runtime supports a native `delay` step with:

- `kind: delay`
- `duration_ms`

Use it when the worker should wait a fixed amount of time before continuing.
`duration_ms` is a positive integer and is not currently interpolated from
`inputs.*`.

### `retry`

Supported fields:

- `max_attempts`
- optional `on`

Example:

```yaml
retry:
  max_attempts: 3
  on:
    - provider_error
```

Conservative guidance:

- use retry only for recoverable failures
- do not retry steps with risky external side effects unless idempotency is clear

### `timeout_ms`

Must be a positive integer.

Use it for:

- long shell commands
- agent calls that should not hang indefinitely

## `on_failure`

`on_failure` is an optional list of steps that run after the workflow is already marked `failed`.

Current support:

- only `notify` steps are supported

Failure context is exposed through:

- `artifacts.failure.code`
- `artifacts.failure.message`
- `artifacts.failure.step_id`
- `artifacts.failure.run_id`
- `artifacts.failure.workflow_id`
- `artifacts.failure.workflow_version`
- `artifacts.failure.detail`

Example:

```yaml
on_failure:
  - id: notify.failure
    kind: notify
    channel: stdout
    message: |
      Workflow failed.
      Step: {{ artifacts.failure.step_id }}
      Error: {{ artifacts.failure.message }}
```

## `outputs`

`outputs` is an optional map from output name to:

- a bare reference, such as `artifacts.review`
- an interpolated string, such as `branch={{ inputs.new_branch }}`

Examples:

```yaml
outputs:
  review: artifacts.review
  branch: inputs.new_branch
  summary: "{{ artifacts.report.title }}"
```

Conservative guidance:

- only reference artifacts that are guaranteed to exist on the successful path
- do not reference speculative fields inside agent output unless the workflow contract ensures them

## Interpolation Rules

Allowed interpolation sources:

- `inputs.<name>`
- `artifacts.<name>`

Unsupported:

- `steps.*`

Interpolation is used in:

- agent prompts
- exec commands
- exec `cwd`
- exec `env` values
- manual messages
- notify `channel`
- notify `target`
- notify `message`
- workflow outputs

Examples:

```yaml
prompt: "Review {{ inputs.repo_path }}"
cwd: "{{ inputs.repo_path }}"
message: "Result: {{ artifacts.tests.exec.stdout }}"
```

Bare references are also supported in outputs:

```yaml
outputs:
  result: artifacts.tests.exec.result
```

### Artifact Names With Dots

Artifact names may contain dots.

Examples:

- `artifacts.tests.exec.stdout`
- `artifacts.deps.scan.stdout`

This is normal for `exec` artifacts.

## Current Contract for Agent Providers

Use these rules conservatively:

- remote providers such as `openrouter` and `ollama` are better suited for prompt -> response flows
- local CLI providers such as `codex`, `claude-code`, and `openclaw` may have hidden workspace side effects
- `agent` steps support `cwd`
- `exec` steps do support `cwd`

Practical implication:

- if the model must act inside a specific repository, set `cwd` explicitly on the `agent` step
- do not assume mentioning `{{ inputs.repo_path }}` in the prompt changes the working directory
- custom args for local CLI providers do not need to re-state the non-interactive defaults in current Ergon Flow:
  - `codex` keeps `exec`
  - `claude-code` keeps `--print`
  - `openclaw` keeps `agent`

### JSON-Shaped Agent Output

The runtime may parse returned text as JSON, but you should not assume that a provider will always return clean JSON just because the prompt asked for it.

Conservative pattern:

1. prompt for strict JSON
2. capture the raw output
3. normalize or parse it in a later `exec` step
4. only then reference individual fields downstream

Avoid this fragile pattern:

```yaml
- id: implement
  kind: agent
  provider: codex
  output:
    name: implementation
    type: json

- id: create_pr
  kind: exec
  env:
    PR_TITLE: "{{ artifacts.implementation.pr_title }}"
```

Prefer this pattern:

```yaml
- id: implement
  kind: agent
  cwd: "{{ inputs.repo_path }}"
  provider: codex
  model: "{{ inputs.codex_model }}"
  output:
    name: implementation
    type: text
  prompt: |
    Return strict JSON with exactly these keys:
    - pr_title

- id: implementation.pr_title
  kind: exec
  env:
    IMPLEMENTATION_JSON: "{{ artifacts.implement.stdout }}"
  command: |
    set -euo pipefail
    node -e '/* parse and emit pr_title */'
```

An `agent` step must use one of the supported providers:

- `openrouter`
- `ollama`
- `codex`
- `claude-code`
- `openclaw`

Practical distinction:

- `openrouter` and `ollama` are model-backed providers
- `codex`, `claude-code`, and `openclaw` are local CLI-style integrations and may cause direct workspace side effects depending on the tool

Conservative modeling rule:

- prefer `agent` for generation, planning, or review
- prefer a later `exec` step for deterministic file writes or shell actions

## Validation Rules

The current loader rejects templates that have:

- duplicate step ids
- invalid `depends_on`
- unsupported providers
- unknown interpolation references
- unsupported interpolation sources
- invalid `timeout_ms`
- malformed top-level sections

## Current Limitations

Do not document or use these as if they already exist.

- no `steps.*` interpolation
- no parallel DAG execution
- no runtime loading of `docs/ideas/agents`
- no runtime schema validation against `docs/ideas/schemas`
- no step kinds like `files.write`, `schema.validate`, or `repo.search`
