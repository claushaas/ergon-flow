# Future Role of Artifact Schemas

This directory holds future-facing JSON Schemas for Ergon Flow artifacts.

Today, these files are documentation and design assets only. The current runtime
does not validate step outputs against these schemas during execution.

## Intended Future Function

In a future runtime version, these schemas are expected to become executable
contracts between workflow steps.

That future role would likely include:

- validating artifacts produced by `agent` steps
- rejecting malformed outputs before downstream steps consume them
- making inter-step contracts explicit and machine-checkable
- improving determinism, auditability, and recovery behavior

## Why This Matters

If schemas become runtime-enforced contracts, a workflow can rely on artifacts
with much less ambiguity:

- an analyzer can produce `agent.analysis.v1`
- the runtime can validate that payload before persisting it
- downstream steps can safely consume the artifact shape the schema defines

## Current Limitation

The current runtime persists artifacts and interpolates them, but it does not
enforce JSON Schema validation from this directory yet.
