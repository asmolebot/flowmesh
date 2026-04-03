# CLI Proposal

## Philosophy

- one command = one layer of the pipeline
- structured output first
- shell-friendly composition
- no provider-specific personal assumptions

## Command surface

### Discovery
- `flowmesh providers list`
- `flowmesh schema print normalized-message`
- `flowmesh doctor`

### Raw/provider operations
- `flowmesh pull`
- `flowmesh get`
- `flowmesh mutate`

### Pipeline operations
- `flowmesh normalize`
- `flowmesh classify`
- `flowmesh route`
- `flowmesh workflow <name>`

## Example shapes

### Pull
```bash
flowmesh pull --provider himalaya --account work --mailbox Inbox --limit 20 --format jsonl
```

### Normalize
```bash
flowmesh pull --provider gog --account personal --query 'label:inbox newer_than:1d' --format jsonl \
  | flowmesh normalize --input jsonl --output jsonl
```

### Classify
```bash
flowmesh normalize --input jsonl --output jsonl < raw.jsonl \
  | flowmesh classify --profile default --output jsonl
```

### Workflow
```bash
flowmesh workflow triage --source personal-gmail --since 2h --json
```

## Output rules

- stdout: machine-readable output only
- stderr: logs and warnings
- exit 0: success
- exit 2: partial/provider issue with usable output
- exit 3: validation/config error
- exit 4: mutation failed

## Important args/config split

Provider-specific values must be passed via flags or config:

- account names
- mailbox/folder names
- identities/addresses
- label names
- provider query syntax
- auth references

Those should never be hardcoded into workflow logic.
