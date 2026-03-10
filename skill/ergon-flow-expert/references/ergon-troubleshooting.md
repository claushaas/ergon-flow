# Ergon Troubleshooting

Use this file when a workflow or CLI operation is failing in a real repository.

## Invalid Template Shape

Symptom:

- `ergon run` fails before scheduling
- validation errors mention missing sections, invalid fields, or unsupported providers

Likely causes:

- malformed top-level YAML
- invalid step kind
- duplicate step ids
- invalid `depends_on`

How to inspect:

- read the template in `.ergon/library/workflows/<workflow_id>.yaml`
- compare it to `docs/TEMPLATE_SPEC.md`

Conservative fix:

- reduce the template to a minimal valid form
- add fields back incrementally

## Unknown Interpolation Reference

Symptom:

- error like `unknown interpolation reference "artifacts.review.summary"`

Likely causes:

- the referenced artifact field does not exist
- the artifact is plain text, not an object
- the step was skipped or failed before producing the artifact

How to inspect:

- `ergon run status <run_id>`
- inspect `stepRuns[*].output_json`
- inspect `.runs/<run_id>/steps/<step_id>/<attempt>/`

Conservative fix:

- reference only known fields
- if needed, normalize upstream output with an `artifact` step
- do not assume an agent returned structured JSON unless the prompt and result confirm it
- for CLI providers, prefer an explicit parsing `exec` step before downstream field references

## Workflow Version Is Immutable Once Registered

Symptom:

- `ergon run` fails before scheduling with a message like `Workflow "<id>"@<version> is immutable once registered`

Likely cause:

- the workflow YAML changed after that same `workflow.id` and `workflow.version` were already registered in the project database

How to inspect:

- inspect the workflow file in `.ergon/library/workflows/`
- inspect the registered workflow rows if needed

Conservative fix:

- bump `workflow.version` in the YAML
- schedule a new run against the new version
- do not mutate a registered `id@version` in place

## Run Stuck In `waiting_manual`

Symptom:

- run status is `waiting_manual`
- current step is a `manual` step

Likely cause:

- a human approval is required

How to inspect:

```bash
ergon run status <run_id>
```

Conservative fix:

```bash
ergon approve <run_id> <step_id> --decision approve
ergon worker start --max-runs 1
```

## Worker Running But No Queued Runs Execute

Symptom:

- worker stays active but nothing happens

Likely causes:

- there are no `queued` runs
- the run you are looking at already failed
- the run is waiting on manual approval
- you started the worker with `--max-runs` and it already exited

How to inspect:

```bash
ergon run list
ergon run list --status queued
ergon run list --status waiting_manual
```

Conservative fix:

- create a new run if needed
- approve manual steps if blocked
- restart the worker if it already exited

## Provider Not Configured

Symptom:

- failure like `No client registered for provider "openrouter"`

Likely cause:

- required provider environment variables are missing

How to inspect:

- check `.env`
- inspect the provider configured in the `agent` step

Conservative fix:

- configure the correct provider env vars
- rerun a new workflow after fixing config

## CLI Provider Command Not Found

Symptom:

- a local CLI provider fails at runtime

Likely causes:

- `codex`, `claude`, or `openclaw` is not installed
- custom command path is wrong

How to inspect:

- verify `CODEX_COMMAND`, `CLAUDE_CODE_COMMAND`, or `OPENCLAW_COMMAND`
- run the command directly in the shell

Conservative fix:

- install the missing CLI
- point the config to the right executable
- prefer a remote provider if local CLI availability is uncertain

## Local CLI Provider Acts In The Wrong Repository

Symptom:

- a `codex`, `claude-code`, or `openclaw` step seems to read or modify the wrong repository
- the worker succeeds in one repo but behaves differently when started from another directory

Likely cause:

- the workflow omitted `cwd` on a repository-bound `agent` step
- the local CLI inherited the worker process directory instead of the intended repository path

How to inspect:

- inspect the workflow step kind
- if the step is `agent`, verify that it sets `cwd: "{{ inputs.repo_path }}"`
- verify where `ergon worker start` was launched from

Conservative fix:

- keep the step as `kind: agent` if it is semantically model interaction
- set `cwd: "{{ inputs.repo_path }}"`
- do not rely on mentioning the repo path in the prompt text alone

## Local CLI Provider Falls Back To Interactive Mode

Symptom:

- a `codex`, `claude-code`, or `openclaw` step hangs, prompts unexpectedly, or errors because it is running interactively

Likely cause:

- custom CLI args removed the provider's non-interactive defaults in an older Ergon Flow build
- the installed CLI predates the runtime fix that preserves non-interactive defaults

How to inspect:

- inspect the installed `ergon --version`
- verify the provider command works non-interactively in the shell
- inspect local environment overrides such as `CODEX_ARGS`, `CLAUDE_CODE_ARGS`, and `OPENCLAW_ARGS`

Conservative fix:

- update Ergon Flow to a build that preserves non-interactive defaults for local CLI providers
- keep custom args focused on model or sandbox options, not on replacing the provider subcommand entirely

## Lease Expiry Or Claim Loss

Symptom:

- a run is reclaimed
- a stale worker stops being able to finalize state

Likely cause:

- worker crash
- lease renewal failure
- long-running step exceeded lease window without timely renewal

How to inspect:

- `ergon run status <run_id>`
- check `claimed_by`, `lease_until`, and `claim_epoch`

Conservative fix:

- restart a healthy worker
- ensure long-running steps have reasonable runtime behavior
- use retries only where recovery is safe

## `exec` Step Failing

Symptom:

- run fails at an `exec` step
- `stderr` contains shell or command errors

How to inspect:

```bash
ergon run status <run_id>
```

Look at:

- `stepRuns[*].request_json`
- `stepRuns[*].output_json`
- `artifacts.<step_id>.stderr`
- `artifacts.<step_id>.result`

Conservative fix:

- simplify the shell
- use `set -euo pipefail`
- move large logic into a script if the command becomes fragile

## Missing Artifacts

Symptom:

- downstream step cannot find `artifacts.*`

Likely causes:

- upstream step failed
- upstream step was skipped because of `condition`
- artifact name is wrong
- step output was not actually emitted as an artifact

Conservative fix:

- verify the exact upstream artifact names
- ensure the upstream step can succeed on that path
- do not assume `output_json` implies an artifact exists
- remember that `exec` creates `<step_id>.stdout`, `<step_id>.stderr`, and `<step_id>.result`; those are often safer downstream contracts than free-form agent JSON

## Docs vs Implementation Mismatch

Symptom:

- docs suggest a capability but the runtime rejects it

Conservative response:

- say explicitly that the current runtime is narrower
- use the implementation-faithful behavior
- avoid presenting roadmap items as available today

Good phrasing:

- "The current runtime supports X, not Y."
- "The repository contains this asset, but the runtime does not load it today."

## Retry Or Failure Categorization Problems

Symptom:

- step did not retry as expected
- workflow failed after a single attempt

Likely causes:

- `retry.max_attempts` missing or too low
- `retry.on` does not match the actual error code
- the failure was not considered recoverable

How to inspect:

- inspect `error_code` in the failed `step_run`
- compare it to the `retry.on` list

Conservative fix:

- match `retry.on` to real runtime error codes
- avoid broad retry on steps with external side effects
