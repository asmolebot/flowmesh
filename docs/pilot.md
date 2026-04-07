# Pilot — Cron/Lobster Integration (M3B)

## Overview

The pilot lets you run flowmesh triage alongside your existing (legacy) inbox triage system,
compare the outputs side-by-side, and switch between engines.

## Engine modes

| Engine      | What it does                                           |
|-------------|--------------------------------------------------------|
| `flowmesh`  | Runs only the new flowmesh triage path                 |
| `legacy`    | Runs only the legacy command/file (fallback)           |
| `compare`   | Runs both, diffs outputs, emits comparison report      |

## CLI commands

### `flowmesh pilot run`

Run triage with engine selection.

```bash
# Compare mode — run both, see differences
flowmesh pilot run --engine compare \
  --source personal-gmail \
  --legacy-cmd "your-legacy-script --json" \
  --json

# Flowmesh only (new path)
flowmesh pilot run --engine flowmesh \
  --source personal-gmail --json

# Legacy only (fallback to old system)
flowmesh pilot run --engine legacy \
  --legacy-file /tmp/legacy-output.json --json
```

### `flowmesh pilot compare`

Offline comparison of two saved triage output files.

```bash
flowmesh pilot compare flowmesh-out.json legacy-out.json --json
```

## Legacy capture

The legacy adapter can capture output from:

1. **Shell command** (`--legacy-cmd`): runs any command that produces JSON on stdout.
   The command should output a TriageResult, an array of ClassifiedMessage objects,
   or any JSON (wrapped as raw).

2. **File** (`--legacy-file`): reads a JSON file containing legacy output.

## Comparison report

The comparison report includes:

- **summary**: total counts, matched/mismatched/exclusive message counts
- **bucketDiffs**: per-bucket count comparison (flowmesh vs legacy)
- **diffs**: per-message detail showing each system's bucket/category/priority

## Cron usage

```bash
# Save flowmesh output
flowmesh workflow triage --source personal-gmail --json > /tmp/flowmesh-triage.json

# Save legacy output
your-legacy-script --json > /tmp/legacy-triage.json

# Compare offline
flowmesh pilot compare /tmp/flowmesh-triage.json /tmp/legacy-triage.json --json \
  > /tmp/pilot-comparison.json
```

Or in one shot:

```bash
flowmesh pilot run --engine compare \
  --source personal-gmail \
  --legacy-cmd "your-legacy-script --json" \
  --json > /tmp/pilot-result.json
```

## Bakeoff mode (side-by-side comparison over hours)

Use `--out <dir>` to accumulate timestamped artifacts across multiple runs.
Each run saves separate files for the full result, comparison report, and
individual flowmesh/legacy outputs.

### Quick start (single run)

```bash
flowmesh pilot run --engine compare \
  --source personal-gmail \
  --legacy-cmd "your-legacy-script --json" \
  --out ./bakeoff-results \
  --json
```

This creates `./bakeoff-results/` with files like:
```
pilot-2026-04-06T14-30-00-000Z.json        # full PilotResult
comparison-2026-04-06T14-30-00-000Z.json    # ComparisonReport only
flowmesh-2026-04-06T14-30-00-000Z.json      # flowmesh TriageResult
legacy-2026-04-06T14-30-00-000Z.json        # legacy TriageResult
```

### Multi-hour bakeoff (repeated runs)

Use the bakeoff script to run compare on a loop:

```bash
# Every 15 minutes, 4 hours (16 runs), saving to ./bakeoff-results
./scripts/bakeoff.sh \
  --source personal-gmail \
  --legacy-cmd "your-legacy-script --json" \
  --interval 15m --runs 16 --out ./bakeoff-results

# Or run indefinitely until Ctrl-C
./scripts/bakeoff.sh \
  --source personal-gmail \
  --legacy-cmd "your-legacy-script --json"
```

### Using a legacy file instead of a command

If the legacy system already writes output to a file:

```bash
flowmesh pilot run --engine compare \
  --source personal-gmail \
  --legacy-file /path/to/legacy-output.json \
  --out ./bakeoff-results --json
```

### Reviewing accumulated results

```bash
# Quick summary of all comparisons
for f in ./bakeoff-results/comparison-*.json; do
  echo "=== $(basename $f) ==="
  jq '.summary | {matched, mismatched, flowmeshOnly, legacyOnly}' "$f"
done
```

## Switching from legacy to flowmesh

1. Start with `--engine compare` to build confidence
2. Review comparison reports for mismatches
3. Tune classifier rules or config as needed
4. Switch to `--engine flowmesh` when satisfied
5. Keep `--engine legacy` available as explicit fallback

## Example config

See `examples/pilot.flowmesh.yaml` for a complete example.
