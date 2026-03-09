# Future Role of Agent Profiles

This directory holds future-facing agent profile definitions for Ergon Flow.

Today, these files are documentation and design assets only. The current runtime
does not load agent profiles from this directory during workflow execution.

## Intended Future Function

In a future runtime version, these files are expected to become reusable,
declarative agent profiles that workflows can reference by id instead of
repeating provider configuration inside each `agent` step.

That future role would likely include:

- selecting the provider and model
- defining execution capabilities and policies
- centralizing reusable agent settings
- associating an expected output contract for a given agent role

## Why This Matters

If agent profiles become runtime inputs, workflows can stay smaller and more
consistent:

- a workflow can reference a stable agent identity such as `repo-analyzer`
- model/provider changes can be made in one place
- teams can standardize behavior across many workflows

## Current Limitation

The current runtime still requires workflow templates to declare provider/model
details directly on `agent` steps. These files are not enforced or resolved by
the engine yet.
