# Architecture

## Thesis

`flowmesh` should behave like a thin, composable automation layer:

1. **Provider adapters** fetch/mutate source-specific data
2. **Normalizers** convert raw provider objects into stable common envelopes
3. **Classifiers/hooks** enrich items with routing metadata
4. **Workflows** orchestrate common end-to-end tasks
5. **Pipelines** expose shell/cron/Lobster-friendly entrypoints

## Layered model

```text
provider -> raw item -> normalizer -> normalized item -> classifier -> routed action/workflow output
```

## Provider adapter contract

Minimum capabilities:

- `list(params) -> raw items[]`
- `get(id) -> raw item`
- `normalize(raw) -> normalized item`

Optional capabilities:

- `mutate(action, target)`
- `send(payload)`
- `watch(cursor)`

Adapters should avoid embedding business logic.
They translate provider APIs, mailbox names, labels, and auth conventions into a common internal shape.

## Normalized envelope principles

- preserve common fields at top level
- keep raw/provider-specific details under `meta` and `refs`
- include enough data for downstream classification without needing a second fetch when practical
- support JSON Schema validation

## Classification hook model

Support multiple classifier backends behind one contract:

- local rules file
- shell executable
- LLM wrapper
- MCP tool

Classifier input:
- normalized item JSON

Classifier output:
- category
- tags
- priority
- needsResponse
- reason
- arbitrary custom fields under `meta`

## Workflow model

A workflow is a declarative pipeline with:

- source selection
- normalization
- optional enrichment/classification
- action planning
- optional mutation

Suggested phases:

- `pull`
- `normalize`
- `classify`
- `plan`
- `apply`
- `emit`

## Lobster-style entrypoints

Keep a few top-level workflows as opinionated wrappers around the lower-level commands.
These should be stable and automation-friendly rather than deeply magical.

Examples:
- `workflow triage`
- `workflow digest`
- `workflow followup`
