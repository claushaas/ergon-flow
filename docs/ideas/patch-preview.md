# `patch.preview` Step Idea

## Problem

An agent can generate a patch that looks correct but does not actually apply.

## Proposal

Add a native preview step:

```yaml
- id: patch.preview
  kind: patch.preview
  input: artifacts.patch
```

## Output

```json
{
  "applies": true,
  "files_changed": 3,
  "errors": []
}
```

## Notes

- apply the patch in a temporary worktree or disposable repo copy
- do not mutate the primary workspace during preview
- fail early if the patch does not apply cleanly
