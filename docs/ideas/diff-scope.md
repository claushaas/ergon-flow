# `diff.scope` Step Idea

## Problem

Agents often modify more files than the plan actually justifies.

## Proposal

Add a step that compares the intended scope with the actual changed files.

```yaml
- id: validate.diff
  kind: diff.scope
  plan: artifacts.plan
```

## Output

```json
{
  "valid": false,
  "unexpected_files": [
    "packages/storage/src/db.ts"
  ],
  "risk_level": "medium"
}
```

## Notes

- useful after patch generation or direct CLI-agent edits
- should inspect git diff, not only declared artifacts
