# `repo.context` Tool Idea

## Problem

Agents often build an incomplete mental model of the repository before planning
or patching.

## Proposal

Add an internal tool named `repo.context` that summarizes selected paths before
an `agent` step starts planning.

## Input

```json
{
  "paths": ["packages/engine", "library/workflows"],
  "max_files": 50
}
```

## Output

```json
{
  "files": [
    {
      "path": "packages/engine/src/runner.ts",
      "summary": "Executes workflow runs and persists artifacts.",
      "exports": ["executeRun"]
    }
  ],
  "related_files": [
    "packages/engine/src/worker.ts",
    "packages/storage/src/repo/tasks.ts"
  ]
}
```

## Notes

- implement as a runtime-internal tool, not as a shell-only convention
- use fast local indexing and `rg`
- keep output bounded and deterministic
