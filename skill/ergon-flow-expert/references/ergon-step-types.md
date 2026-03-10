# Ergon Step Types

This file covers every step kind supported by the current runtime.

Current step kinds:

- `agent`
- `exec`
- `condition`
- `delay`
- `manual`
- `notify`
- `artifact`

## `agent`

### Purpose

Use `agent` to ask a provider to generate text or JSON-like output.

This is the default step kind for model interaction. If a workflow step is conceptually "ask an agent to analyze, plan, review, or generate content", model it as `kind: agent` unless the current runtime forces a narrower workaround.

### When To Use

- analysis
- planning
- review
- text generation
- structured output when the prompt explicitly constrains the format

### When Not To Use

- deterministic file mutation that can be done by shell or a script
- operations that must be reproducible without hidden tool behavior
- situations where a provider-side CLI may mutate the repo implicitly and that would be risky

### Required Fields

- `id`
- `kind: agent`
- `provider`

### Optional Fields

- `model`
- `cwd`
- `agent`
- `prompt`
- `output`
- `strategy`
- common step fields such as `retry`, `timeout_ms`, `depends_on`

### Output Behavior

If `output.name` is set, that becomes the artifact name.

If it is omitted:

- `analyze` defaults to `analysis`
- otherwise the step id becomes the artifact name

Artifact types:

- `analysis`
- `json`
- `plan`
- `text`

The executor attempts JSON parsing of the returned text. If parsing succeeds and no output type is forced, the artifact becomes `json`.

### Providers Supported Today

- `openrouter`
- `ollama`
- `codex`
- `claude-code`
- `openclaw`

Remote vs local:

- remote-style providers: `openrouter`, `ollama`
- local CLI-style providers: `codex`, `claude-code`, `openclaw`

Practical caution:

- local CLI providers may mutate the workspace directly, outside a later `exec` step
- `agent.cwd` is now supported, but it primarily affects local CLI providers
- remote providers still behave like prompt -> response adapters and do not use repository cwd the same way local CLIs do

Conservative rule:

- default to `kind: agent` for model calls
- if a local CLI provider must inspect a specific repository, set `cwd` explicitly instead of relying on the worker process directory
- current Ergon Flow preserves the non-interactive defaults for local CLI providers even when custom args are configured:
  - `codex` keeps `exec`
  - `claude-code` keeps `--print`
  - `openclaw` keeps `agent`
- still prefer `exec` for deterministic Git, file, and publication side effects

### Common Pitfalls

- assuming the provider output will always have a specific JSON shape without validating the prompt contract
- declaring `output.type: json` and then immediately referencing nested fields without proving the provider actually returned parseable JSON
- referencing fields that do not exist, such as `{{ artifacts.review.summary }}` when the artifact is really plain text
- hiding repo mutations inside a local CLI provider when a later `exec` step would be clearer
- packing multiple external side effects into one agent step, such as "change code, run tests, commit, push, reply to reviews, and resolve threads"

### Safer Pattern For Local CLI Providers

If a local CLI provider must work inside a repository and the step is still fundamentally agentic, prefer this pattern:

1. `agent` with explicit `cwd` handles the model reasoning
2. a later `exec` step parses or validates the returned text when structure matters
3. later `exec` steps perform deterministic Git, file, or GitHub operations

Example:

```yaml
- id: codex.plan
  kind: agent
  cwd: "{{ inputs.repo_path }}"
  provider: codex
  model: "{{ inputs.codex_model }}"
  output:
    name: codex.plan
    type: text
  prompt: |
    Return strict JSON with exactly these keys:
    - summary
    - pr_title
    - pr_body

- id: codex.summary
  kind: exec
  env:
    CODEX_JSON: "{{ artifacts.codex.plan }}"
  command: |
    set -euo pipefail
    node -e '
      const raw = (process.env.CODEX_JSON ?? "").trim();
      const match = raw.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
      const normalized = (match ? match[1] : raw).trim();
      const parsed = JSON.parse(normalized);
      if (typeof parsed.summary !== "string") {
        throw new Error("summary is required");
      }
      process.stdout.write(parsed.summary);
    '
```

### Example

```yaml
- id: plan
  kind: agent
  provider: openrouter
  model: deepseek/deepseek-v3.2
  output:
    name: plan
    type: plan
  prompt: |
    Produce a concise implementation plan for {{ inputs.repo_path }}.
```

### Good Composition

- `agent` creates a plan
- `artifact` extracts or renames fields from structured output
- `exec` applies deterministic changes based on the plan
- for local CLI providers, keep `kind: agent` as the default mental model, set `cwd` explicitly when repository context matters, and use later `exec` steps when deterministic parsing or side effects are required

## `exec`

### Purpose

Use `exec` to run a shell command locally.

### When To Use

- deterministic repo mutation
- tests
- build commands
- writing files
- shell-based inspection

### When Not To Use

- tasks that are better expressed as model reasoning or review
- non-deterministic external operations that should be mediated through a provider or explicit notification step

### Required Fields

- `id`
- `kind: exec`
- `command`

### Optional Fields

- `cwd`
- `env`
- common step fields

### Artifact Behavior

`exec` creates these artifacts:

- `<step_id>.stdout`
- `<step_id>.stderr`
- `<step_id>.result`

This makes `exec` a strong choice for downstream interpolation.

### Common Pitfalls

- interpolating a whole shell command through an input and expecting raw shell evaluation
- forgetting that the runtime already quotes interpolated values
- writing fragile shell when a small script would be clearer

### Example

```yaml
- id: tests.exec
  kind: exec
  cwd: "{{ inputs.repo_path }}"
  command: |
    set -euo pipefail
    pnpm typecheck
    pnpm test
```

### Good Composition

- `agent` drafts content
- `exec` writes files using env vars
- later `notify` reports the path or result

## `condition`

### Purpose

Use `condition` to gate later steps based on truthiness.

### When To Use

- optional update paths
- skip-able verification branches
- input-controlled execution

### When Not To Use

- complex business logic better handled explicitly in template design
- situations where you need rich branching or parallel fan-out, which the current runtime does not support

### Required Fields

- `id`
- `kind: condition`
- `expression`

### Truthiness Model

The expression is interpolated and then coerced.

False cases include:

- empty string
- `false`
- `null`
- `undefined`
- `0`
- empty array
- empty object

Non-empty strings are true unless they parse to one of the false cases above.

### Common Pitfalls

- assuming `condition` creates stable artifacts for later interpolation
- using it as if it were a full branching language

### Example

```yaml
- id: should_publish
  kind: condition
  expression: "{{ inputs.publish }}"

- id: publish
  kind: exec
  depends_on:
    - should_publish
  command: |
    set -euo pipefail
    printf 'publishing\n'
```

### Good Composition

- input flag in `condition`
- dependent `exec` or `notify` step only runs when the condition passes

## `manual`

### Purpose

Use `manual` to pause the workflow for a human decision.

### When To Use

- approval before a risky mutation
- human gate before publish, merge, or external side effects
- explicit audit checkpoints

### When Not To Use

- routine low-risk steps that should be fully automated
- as a substitute for clear validation logic

### Required Fields

- `id`
- `kind: manual`

### Optional Fields

- `message`
- common step fields

### Runtime Behavior

The run transitions to `waiting_manual`.

Resume it with:

```bash
ergon approve <run_id> <step_id> --decision approve
```

Reject it with:

```bash
ergon approve <run_id> <step_id> --decision reject
```

### Common Pitfalls

- forgetting to restart or keep a worker running after approval
- treating `manual` as a notification instead of a real gate

### Example

```yaml
- id: approve
  kind: manual
  message: |
    Review the proposed change set.
    Repo: {{ inputs.repo_path }}
```

### Good Composition

- `agent` summarizes change
- `manual` gates the risky phase
- `exec` or `notify` continues after approval

## `delay`

### Purpose

Use `delay` to make the worker wait for a fixed amount of time before moving to
the next step.

### When To Use

- rate-limited external flows
- timed buffers between side effects
- workflows that need a small deterministic pause without shelling out to
  `sleep`

### When Not To Use

- long waits that would be better modeled outside the worker lifecycle
- dynamic wait values that depend on runtime calculation, because the current
  contract uses a fixed `duration_ms`

### Required Fields

- `id`
- `kind: delay`
- `duration_ms`

### Optional Fields

- common step fields

### Output Behavior

`delay` does not emit artifacts.

Its step output records:

- `duration_ms`

### Common Pitfalls

- assuming `duration_ms` supports interpolation
- using a very long wait when an external scheduler would be more appropriate
- forgetting that `timeout_ms` still applies and can abort the delay early

### Example

```yaml
- id: cool_down
  kind: delay
  duration_ms: 30000
```

### Good Composition

- `notify` before the wait
- `delay`
- `exec` or `notify` after the wait

## `notify`

### Purpose

Use `notify` to emit progress or terminal notifications.

### When To Use

- completion messages
- failure hooks through `on_failure`
- selected operator-facing progress markers

### When Not To Use

- replacing real observability from runs, step runs, and events
- emitting excessive step-by-step chatter that would make notifications part of the business logic

### Required Fields

- `id`
- `kind: notify`
- `channel`
- `message`

### Optional Fields

- `target`
- common step fields

### Supported Channels

- `stdout`
- `webhook`
- `openclaw`

### Constraints

- `webhook` requires a public `https` URL
- `openclaw` requires a non-empty target that does not start with `-`

### Artifact Behavior

`notify` emits `run.summary` as a JSON artifact.

### Common Pitfalls

- assuming `stdout` means an external notification service
- using invalid webhook targets
- referencing artifacts that do not exist on the current path

### Example

```yaml
- id: notify.complete
  kind: notify
  channel: stdout
  message: |
    Workflow completed.
    Output file: {{ inputs.output_file }}
```

### Good Composition

- final success notification
- `on_failure` notification using `artifacts.failure.*`

## `artifact`

### Purpose

Use `artifact` to rename, copy, extract, or merge existing artifacts.

### When To Use

- normalize artifact names
- extract a field from JSON output
- merge multiple JSON object artifacts into one object

### When Not To Use

- writing files to disk
- arbitrary computation better handled by `exec`

### Required Fields

- `id`
- `kind: artifact`
- `input`
- `operation`

### Supported Operations

- `copy`
- `rename:<target>`
- `extract:<fieldPath>[:target]`
- `merge:<artifactA,artifactB,...>[:target]`

Current implementation detail:

- `merge` requires object artifacts
- `artifact` outputs are always JSON artifacts

### Common Pitfalls

- using unsupported operations
- trying to merge non-object artifacts
- assuming `artifact` can materialize files on disk

### Examples

Rename:

```yaml
- id: review.copy
  kind: artifact
  input: review
  operation: rename:final.review
```

Extract:

```yaml
- id: pr_title
  kind: artifact
  input: review
  operation: extract:final_pr_title:pr.title
```

Merge:

```yaml
- id: combined
  kind: artifact
  input: meta
  operation: merge:extra_meta,run_meta:combined.meta
```

## Pitfalls Across Step Types

- Unknown interpolation references fail validation or execution.
- Do not assume an agent artifact has fields unless the prompt and downstream contract make that explicit.
- Local CLI providers may mutate the workspace directly. Prefer `exec` when determinism matters more than convenience.
- The runtime is sequential. Do not design workflows as if later steps can run in parallel.
