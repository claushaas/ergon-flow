# Ergon Example Workflows

This file explains the example workflows bundled with this skill.

Use these assets as starting points for user repositories.

## Selection Guide

### `workflow-minimal.yaml`

Use when you need the smallest possible runnable workflow.

Demonstrates:

- `workflow`
- `steps`
- one `exec` step
- one simple `outputs` mapping

Best starting point for:

- first workflow in a repo
- CLI smoke tests

### `workflow-agent-exec.yaml`

Use when the agent should generate content and a deterministic shell step should write or consume it.

Demonstrates:

- `agent`
- `exec`
- `notify`
- `on_failure`

Best starting point for:

- safe content generation
- generated docs or notes
- workflows where you want the model separated from the file write

### `workflow-manual-approval.yaml`

Use when a human must approve the next phase.

Demonstrates:

- `exec`
- `manual`
- post-approval `notify`

Best starting point for:

- controlled rollouts
- gated repo mutations
- operator review flows

### `workflow-condition.yaml`

Use when a later step should run only when an input or prior state is truthy.

Demonstrates:

- `condition`
- dependent `exec`
- output mapping on a simple path

Best starting point for:

- optional steps
- input-gated execution

### `workflow-artifact-transform.yaml`

Use when an upstream artifact needs renaming, field extraction, or merging before later use.

Demonstrates:

- `agent`
- `artifact`
- structured outputs

Best starting point for:

- normalizing agent output
- extracting stable fields
- preparing cleaner workflow outputs

### `workflow-full-example.yaml`

Use when you need a realistic multi-step workflow that mixes the current step kinds safely.

Demonstrates:

- `agent`
- `artifact`
- `condition`
- `delay`
- `exec`
- `manual`
- `notify`
- `on_failure`

Best starting point for:

- end-to-end workflow modeling
- documentation or analysis flows with human approval

## How To Run An Example

The exact command depends on where you copy the asset.

Typical flow:

```bash
cp skill/ergon-flow-expert/assets/workflow-minimal.yaml .ergon/library/workflows/example.workflow.yaml
ergon run example.workflow
ergon worker start --max-runs 1
ergon run status <run_id>
```

If the workflow contains `manual`, the flow becomes:

```bash
ergon run example.manual
ergon worker start --max-runs 1
ergon run status <run_id>
ergon approve <run_id> approve --decision approve
ergon worker start --max-runs 1
ergon run status <run_id>
```

## Customization Guidance

When adapting the example assets:

- keep the `workflow.id` stable only if you intend to replace that workflow
- rename ids and paths to match the user repo
- keep step responsibilities narrow
- only add `agent` where model reasoning is actually needed
- prefer `exec` for deterministic file writes, tests, and repo mutations

## Conservative Notes

- Agent-based examples require provider configuration such as `OPENROUTER_API_KEY`.
- Examples are intentionally current-runtime compatible. They do not rely on future step kinds or runtime schema enforcement.
- If a user repo already contains working workflows, adapt those before importing a new example wholesale.
