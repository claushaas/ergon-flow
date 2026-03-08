# `repo.search` Step Idea

## Problem

LLMs are weak at navigating large codebases without precise search support.

## Proposal

Add a native step:

```yaml
- id: search.runtime
  kind: repo.search
  query: "workflow runner"
  limit: 10
```

## Output

```json
{
  "matches": [
    {
      "path": "packages/engine/src/runner.ts",
      "line": 42,
      "preview": "export async function executeRun(...)"
    }
  ],
  "query": "workflow runner"
}
```

## Notes

- use `rg` under the hood
- persist structured results as artifacts
- useful before `agent` planning and review steps
