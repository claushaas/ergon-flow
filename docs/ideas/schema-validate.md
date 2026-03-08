# `schema.validate` Step Idea

## Problem

The repository already has artifact schemas, but workflow execution still
depends too much on prompt discipline instead of enforced validation.

## Proposal

Add a native step:

```yaml
- id: validate.plan
  kind: schema.validate
  schema: agent.plan.v1
  input: artifacts.plan
```

## Output

```json
{
  "valid": true,
  "schema": "agent.plan.v1",
  "errors": []
}
```

## Notes

- load schemas from `library/schemas`
- fail the workflow when validation fails
- persist validation errors in structured form
