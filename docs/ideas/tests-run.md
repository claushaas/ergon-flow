# `tests.run` Step Idea

## Problem

`exec` already runs commands, but test feedback is only available as raw
stdout/stderr instead of a normalized runtime contract.

## Proposal

Add a step specialized for validation commands:

```yaml
- id: tests.run
  kind: tests.run
  command: pnpm test
```

## Output

```json
{
  "success": false,
  "command": "pnpm test",
  "failed_tests": [
    "runner retries stale step"
  ],
  "stdout": "...",
  "stderr": "..."
}
```

## Notes

- initial version can wrap `exec`
- later versions can add parser adapters for Vitest, Jest, Pytest, etc.
