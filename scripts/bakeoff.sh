#!/usr/bin/env bash
#
# bakeoff.sh — Run flowmesh vs legacy email triage comparison on a loop.
#
# Runs `flowmesh pilot run --engine compare` at a configurable interval,
# accumulating timestamped results in an output directory.
#
# Usage:
#   ./scripts/bakeoff.sh --source personal-gmail \
#     --legacy-cmd "your-legacy-script --json" \
#     [--interval 15m] [--out ./bakeoff-results] [--runs 12]
#
# Defaults:
#   --interval  15m                (run every 15 minutes)
#   --out       ./bakeoff-results  (artifact directory)
#   --runs      0                  (0 = run until Ctrl-C)
#
# All extra flags are passed through to `flowmesh pilot run`.

set -euo pipefail

INTERVAL="15m"
OUT_DIR="./bakeoff-results"
MAX_RUNS=0
PASSTHROUGH_ARGS=()

while [[ $# -gt 0 ]]; do
  case "$1" in
    --interval) INTERVAL="$2"; shift 2 ;;
    --out)      OUT_DIR="$2";  shift 2 ;;
    --runs)     MAX_RUNS="$2"; shift 2 ;;
    *)          PASSTHROUGH_ARGS+=("$1"); shift ;;
  esac
done

# Convert interval to seconds
interval_to_seconds() {
  local val="$1"
  case "$val" in
    *m) echo $(( ${val%m} * 60 )) ;;
    *h) echo $(( ${val%h} * 3600 )) ;;
    *s) echo "${val%s}" ;;
    *)  echo "$val" ;;
  esac
}

SLEEP_SEC=$(interval_to_seconds "$INTERVAL")
SCRIPT_DIR="$(cd "$(dirname "$0")/.." && pwd)"

echo "=== Flowmesh Bakeoff ==="
echo "  Interval:  ${INTERVAL} (${SLEEP_SEC}s)"
echo "  Output:    ${OUT_DIR}"
echo "  Max runs:  ${MAX_RUNS:-unlimited}"
echo "  Extra:     ${PASSTHROUGH_ARGS[*]:-<none>}"
echo ""

run_count=0
while true; do
  run_count=$((run_count + 1))
  echo "[$(date -Iseconds)] Run #${run_count}..."

  npx --no tsx "${SCRIPT_DIR}/src/cli.ts" pilot run \
    --engine compare \
    --out "$OUT_DIR" \
    --json \
    "${PASSTHROUGH_ARGS[@]}" \
    2>&1 | while IFS= read -r line; do echo "  $line"; done

  echo "[$(date -Iseconds)] Run #${run_count} complete. Results in ${OUT_DIR}/"
  echo ""

  if [[ "$MAX_RUNS" -gt 0 && "$run_count" -ge "$MAX_RUNS" ]]; then
    echo "Completed ${MAX_RUNS} runs. Done."
    break
  fi

  echo "Sleeping ${INTERVAL} until next run... (Ctrl-C to stop)"
  sleep "$SLEEP_SEC"
done
