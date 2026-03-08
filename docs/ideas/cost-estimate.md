# `cost.estimate` Tool Idea

## Problem

Workflows that depend on remote providers can incur real cost, but the runtime
does not currently estimate that cost before execution.

## Proposal

Add a planning tool that estimates token and dollar usage from workflow/model
configuration.

## Input

```json
{
  "workflow": "code.codegen",
  "models": {
    "planner": "deepseek/deepseek-v3.2",
    "reviewer": "moonshotai/kimi-k2.5"
  }
}
```

## Output

```json
{
  "estimated_tokens": 120000,
  "estimated_cost_usd": 0.14,
  "assumptions": [
    "average prompt size",
    "single pass execution"
  ]
}
```

## Notes

- useful, but less deterministic than local validation tools
- depends on current provider pricing metadata
