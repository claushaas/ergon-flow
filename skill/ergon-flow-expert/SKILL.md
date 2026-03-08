---
name: "ergon-flow-expert"
description: "Use when a user wants to use, explain, create, edit, validate, troubleshoot, review, or run Ergon Flow workflows, or needs precise guidance for the `ergon` CLI in a real repository. This skill is for operating the current Ergon Flow runtime as implemented today: queue + worker execution, project-local `.ergon` bootstrap, YAML workflow templates, manual approvals, notifications, and the supported step kinds `agent`, `artifact`, `condition`, `exec`, `manual`, and `notify`. Do not use this skill for generic CI/CD advice, generic YAML authoring, or speculative future Ergon features that are not part of the current runtime contract."
---

# Ergon Flow Expert

Use this skill to turn user requests about Ergon Flow into implementation-faithful guidance and correct workflow changes.

This skill is for people using Ergon Flow in their own repositories. It teaches how to:

- bootstrap and operate the `ergon` CLI
- inspect the local `.ergon` project state
- author valid workflow templates
- choose and compose the current step kinds correctly
- run, inspect, approve, cancel, and troubleshoot workflow runs

## When To Use This Skill

Use this skill when the user asks to:

- explain or operate the `ergon` CLI
- create or edit a workflow template
- validate or troubleshoot a workflow
- model inputs, outputs, artifacts, retries, conditions, manual gates, or notifications
- understand how Ergon Flow behaves in a real repository

Do not use this skill when the task is:

- generic YAML help unrelated to Ergon Flow
- generic CI/CD design not tied to the current Ergon runtime
- speculative design for unsupported step kinds or runtime features, unless the user explicitly asks for future ideas

## Operating Procedure

Follow this sequence.

1. Read the local repo docs first.
   Start with [`docs/SPEC.md`](./references/ergon-overview.md), [`docs/ARCHITECTURE.md`](./references/ergon-overview.md), [`docs/DB_SCHEMA.md`](./references/ergon-overview.md), [`docs/TEMPLATE_SPEC.md`](./references/ergon-templates.md), and [`docs/ROADMAP.md`](./references/ergon-overview.md) in the target repository, not from memory.
2. Confirm whether the repository is initialized.
   Check for `.ergon/`, `.ergon/config.json`, `.ergon/library/workflows`, and `.ergon/storage/ergon.db` before giving operational advice.
3. Inspect existing workflow assets before creating new ones.
   Prefer extending valid local patterns instead of inventing new conventions.
4. Prefer current runtime behavior over aspirational documentation.
   If docs and implementation differ, say so explicitly and choose the more conservative interpretation.
5. Do not invent syntax.
   If a field, step kind, interpolation source, or CLI command is not supported by the current runtime, do not present it as available.
6. Preserve determinism.
   Prefer explicit artifacts, clear step boundaries, deterministic `exec` steps for mutations, and minimal hidden side effects.

## Recommended Working Flow

1. Inspect the repository and locate the Ergon project state.
2. Identify whether the task is CLI usage, workflow authoring, workflow review, or workflow troubleshooting.
3. Read the matching reference file from `references/`.
4. Start from the closest complete example in `assets/`.
5. Adapt the example conservatively to the user repository.
6. Explain how to run it with `ergon run`, `ergon worker start`, and `ergon run status`.
7. Call out any uncertainty, mismatch, or unsupported capability explicitly.

## Reference Map

- Runtime model and limits: [references/ergon-overview.md](./references/ergon-overview.md)
- CLI operations: [references/ergon-cli.md](./references/ergon-cli.md)
- Template authoring: [references/ergon-templates.md](./references/ergon-templates.md)
- Step kinds and composition: [references/ergon-step-types.md](./references/ergon-step-types.md)
- Example selection and usage: [references/ergon-examples.md](./references/ergon-examples.md)
- Troubleshooting: [references/ergon-troubleshooting.md](./references/ergon-troubleshooting.md)

## Example Assets

- Minimal `exec`: [assets/workflow-minimal.yaml](./assets/workflow-minimal.yaml)
- `agent -> exec`: [assets/workflow-agent-exec.yaml](./assets/workflow-agent-exec.yaml)
- Manual approval: [assets/workflow-manual-approval.yaml](./assets/workflow-manual-approval.yaml)
- Condition gate: [assets/workflow-condition.yaml](./assets/workflow-condition.yaml)
- Artifact transform: [assets/workflow-artifact-transform.yaml](./assets/workflow-artifact-transform.yaml)
- Multi-step full example: [assets/workflow-full-example.yaml](./assets/workflow-full-example.yaml)

## Agent Posture

- Read local docs before acting.
- Treat the current runtime contract as the boundary.
- Differentiate clearly between supported behavior, current limitations, and future ideas.
- Prefer examples that can actually run in the user repository.
- Avoid hiding side effects inside agent steps when a later `exec` step would be more deterministic.
