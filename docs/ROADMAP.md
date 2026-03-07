# Ergon Flow Roadmap

Version: `0.1`

This document is no longer an aspirational checklist. It is the release-status
ledger for `v0.1.1`.

## Release Target

`v0.1.1` is the first globally installable release of the queue + worker
runtime.

The release is considered ready when all of the following are true:

- the compiled CLI starts and can schedule a run
- the CLI can be installed globally and exposed as `ergon`
- `ergon init` bootstraps a project-local `.ergon/`
- the worker can claim and complete at least one run end to end
- state transitions are fenced by the current claim
- built-in workflows copied into `.ergon/library/workflows` validate and
  execute in E2E tests
- canonical docs match the implementation

## Status Summary

| Area | Status | Notes |
| --- | --- | --- |
| P0 Release and boundaries | Done | CLI packaging, runtime boundaries, workflow library path, CI smoke checks |
| P0 Global CLI bootstrap | Done | `ergon init`, upward `.ergon` discovery, project-local embedded library |
| P0 Determinism and execution safety | Done | `claim_epoch`, template identity verification, fenced run mutations |
| P0 Template contract | Done | strict interpolation, materialized input defaults, supported-provider validation |
| P1 Artifacts, recovery, cancellation | Done | per-attempt artifacts, restore from successful attempts only, timeout and abort support |
| P1/P2 Tests and documentation | Done | compiled CLI smoke, built-in workflow E2E, canonical docs rewritten |

## Scope Closed in v0.1.1

### Foundations

Done:

- workspace packages and import boundaries
- shared runtime enums and contracts
- safe filesystem path helpers

### Storage

Done:

- SQLite bootstrap with pragmas and migrations
- `workflows`, `workflow_runs`, `step_runs`, `artifacts`, `events`, `workers`
- monotonic `events.seq` per run
- lease claim, renew and reclaim
- `claim_epoch` fencing

### Templates

Done:

- loading from `.ergon/library/workflows` in initialized projects
- embedded library fallback for `template list` before bootstrap
- structural and semantic validation
- strict interpolation from `inputs.*` and `artifacts.*`
- workflow input default materialization
- bare output references such as `artifacts.patch`

### Runtime

Done:

- sequential engine loop
- executors for `agent`, `artifact`, `condition`, `exec`, `manual`, `notify`
- retry support on recoverable step failures
- cancel before next step and during step execution
- manual approval and rejection
- recovery from expired leases

### Tooling and release

Done:

- compiled CLI smoke in CI
- built-in workflow validation in CI
- built-in workflow E2E coverage
- rewritten canonical docs

## Deferred Beyond v0.1.1

The following items are intentionally out of scope for this release:

- parallel DAG execution
- loading agent profiles from `library/agents`
- validating runtime artifacts against `library/schemas`
- OpenAI and Anthropic provider adapters
- richer operator tooling beyond the current CLI

## Notes for Users

The repository contains `library/agents` and `library/schemas`, but these are
currently repository assets rather than enforced runtime inputs. That is a
deliberate limitation of `v0.1.1`, not a hidden incomplete implementation.
