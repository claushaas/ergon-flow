# `workflow.visualize` Tool Idea

## Problem

Workflow debugging is harder than it should be because the runtime has no
explicit graph visualization primitive.

## Proposal

Add a tool that converts a workflow template into a normalized graph.

## Input

```json
{
  "workflow_id": "code.bump_deps"
}
```

## Output

```json
{
  "nodes": [
    { "id": "plan", "kind": "agent" },
    { "id": "notify", "kind": "notify" }
  ],
  "edges": [
    { "from": "plan", "to": "notify" }
  ]
}
```

## Notes

- useful for docs, debugging and future UI work
- lower priority than validation and patch tooling
