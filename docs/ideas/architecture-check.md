# `architecture.check` Step Idea

## Problem

The repository depends on strict layering, but those rules are currently mostly
documented rather than enforced.

## Proposal

Add a native policy step:

```yaml
- id: architecture.check
  kind: architecture.check
```

## Output

```json
{
  "valid": false,
  "violations": [
    {
      "rule": "library-must-not-import-packages",
      "path": "library/workflows/code.codegen.yaml"
    }
  ]
}
```

## Notes

- enforce layering and import-boundary rules from `AGENTS.md` and docs
- support circular dependency checks as a later extension
