# `dependency.impact` Tool Idea

## Problem

Agents often change a file without understanding which parts of the repo depend
on it.

## Proposal

Add an internal analysis tool:

```json
{
  "files": ["packages/engine/src/runner.ts"]
}
```

## Output

```json
{
  "imported_by": [
    "packages/cli/src/commands/worker.ts",
    "packages/engine/src/worker.ts"
  ],
  "exports_used": [
    "executeRun"
  ]
}
```

## Notes

- build a local import graph
- useful for refactors, hotfixes and risk estimation
