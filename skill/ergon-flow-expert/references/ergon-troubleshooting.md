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
