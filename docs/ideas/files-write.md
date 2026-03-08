# `files.write` Step Idea

## Problem

Today, a workflow can already materialize multiple files by combining:

1. an `agent` step that produces a structured artifact
2. an `exec` step that parses that artifact and writes files to disk

Example intermediate artifact:

```json
{
  "files": [
    {
      "path": "packages/foo/package.json",
      "content": "{ \"name\": \"foo\" }\n"
    },
    {
      "path": "packages/foo/src/index.ts",
      "content": "export const value = 1;\n"
    }
  ]
}
```

This works, but it has important limitations.

## Current Limitation

Using `exec` as the materialization layer is possible, but not ideal:

- the workflow must embed shell or script logic just to write files
- large JSON payloads are awkward to pass through interpolation or env vars
- quoting and escaping become fragile
- file writes are hidden inside opaque shell code instead of a first-class step
- validation of `path` and `content` shape happens late, inside ad hoc script logic
- observability is worse because the runtime sees only "one shell command ran"

In practice, `agent -> exec` is powerful enough for an MVP, but it is not the
best long-term contract for deterministic multi-file generation.

## Proposed Step

Add a native step kind:

```yaml
- id: write.files
  kind: files.write
  input: artifacts.codegen
```

Expected artifact shape:

```json
{
  "files": [
    {
      "path": "packages/foo/package.json",
      "content": "{ \"name\": \"foo\" }\n"
    },
    {
      "path": "packages/foo/src/index.ts",
      "content": "export const value = 1;\n"
    }
  ]
}
```

## Expected Runtime Behavior

`files.write` should:

- accept a structured artifact as input
- validate that the artifact contains a `files` array
- require each entry to have:
  - `path`
  - `content`
- reject path traversal and unsafe absolute paths
- create parent directories as needed
- write files deterministically in declared order
- persist a structured output summary

Example output summary:

```json
{
  "written": [
    "packages/foo/package.json",
    "packages/foo/src/index.ts"
  ],
  "count": 2
}
```

## Why This Is Better

Compared with `exec`, `files.write` would give the runtime:

- an explicit contract for multi-file materialization
- better validation before disk writes
- better observability of which files were written
- better portability across providers
- less workflow boilerplate

It also keeps the architecture cleaner:

- `agent` produces structured intent
- `files.write` materializes that intent
- `exec` remains focused on commands and tooling, not generic file synthesis

## Recommended Scope

Start small:

- support text file writes only
- overwrite existing files deterministically
- reject binary payloads
- reject unsafe paths

Future extensions could include:

- `mode`
- `executable`
- `if_exists`
- `delete_missing`
- directory-level write plans

## Summary

The current runtime can already generate many files through `agent -> exec`.
The limitation is not capability, but ergonomics and contract quality.

`files.write` would turn a fragile pattern into a first-class deterministic
primitive.
