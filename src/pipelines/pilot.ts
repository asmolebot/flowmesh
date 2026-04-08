/**
 * Pilot runner — orchestrates flowmesh triage alongside legacy,
 * with engine selection and comparison output.
 *
 * Engines:
 *   - "flowmesh": run only flowmesh triage (new path)
 *   - "legacy":   run only legacy command/file (old path, fallback)
 *   - "compare":  run both, diff outputs, emit comparison report
 *
 * This is the cron/Lobster-friendly entrypoint for the M3B pilot.
 */

import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { emit, log, warn, type OutputFormat } from "../core/emit.js";
import { loadConfig, type FlowmeshConfig } from "../config/load.js";
import { runTriageCapture } from "./triage-capture.js";
import { captureLegacy, type LegacyCaptureOptions } from "./legacy-capture.js";
import { compareTriageResults } from "./compare.js";
import type { PilotResult, TriageResult } from "../core/types.js";

export type PilotEngine = "flowmesh" | "legacy" | "compare";

export interface PilotOptions {
  engine: PilotEngine;

  // flowmesh triage options
  provider?: string;
  account?: string;
  source?: string;
  mailbox?: string;
  query?: string;
  since?: string;
  limit?: number;
  dryRun?: boolean;
  statePath?: string;
  includeRead?: boolean;
  includePreviouslyNotified?: boolean;

  // legacy options
  legacyCmd?: string[];
  legacyFile?: string;
  legacyTimeout?: number;

  // output
  format?: OutputFormat;
  configPath?: string;

  /** Directory to persist timestamped result artifacts (bakeoff mode). */
  outDir?: string;
}

/**
 * Run the pilot with the selected engine.
 * Returns the PilotResult (also emitted to stdout).
 */
export async function runPilot(options: PilotOptions): Promise<PilotResult> {
  const config = await loadConfig(options.configPath);
  const { engine, format = "json" } = options;

  const result: PilotResult = {
    schemaVersion: "1",
    timestamp: new Date().toISOString(),
    source: options.source ?? `${options.provider ?? "unknown"}/${options.account ?? "default"}`,
    engine,
  };

  if (engine === "flowmesh" || engine === "compare") {
    log("Running flowmesh triage...");
    result.flowmesh = await runFlowmeshLeg(options, config);
  }

  if (engine === "legacy" || engine === "compare") {
    log("Running legacy triage...");
    result.legacy = await runLegacyLeg(options);
  }

  if (engine === "compare" && result.flowmesh && result.legacy) {
    log("Comparing outputs...");
    result.comparison = compareTriageResults(result.flowmesh, result.legacy);
    const s = result.comparison.summary;
    log(
      `Comparison: ${s.matched} matched, ${s.mismatched} mismatched, ` +
        `${s.flowmeshOnly} flowmesh-only, ${s.legacyOnly} legacy-only`
    );
  }

  // Persist to --out directory if specified
  if (options.outDir) {
    await persistResult(options.outDir, result);
  }

  // Emit based on engine
  if (engine === "compare" && result.comparison) {
    emit(result, format);
  } else if (engine === "legacy" && result.legacy) {
    emit(result, format);
  } else if (engine === "flowmesh" && result.flowmesh) {
    emit(result, format);
  } else {
    warn("No output produced");
    emit(result, format);
  }

  return result;
}

/**
 * Save timestamped result artifacts to a directory for bakeoff accumulation.
 * Creates the directory if it doesn't exist.
 *
 * Files written:
 *   <outDir>/pilot-<timestamp>.json          — full PilotResult
 *   <outDir>/comparison-<timestamp>.json      — ComparisonReport (compare only)
 *   <outDir>/flowmesh-<timestamp>.json        — flowmesh TriageResult (if present)
 *   <outDir>/legacy-<timestamp>.json          — legacy TriageResult (if present)
 */
async function persistResult(
  outDir: string,
  result: PilotResult
): Promise<void> {
  await mkdir(outDir, { recursive: true });
  const ts = result.timestamp.replace(/[:.]/g, "-");

  const pilotPath = join(outDir, `pilot-${ts}.json`);
  await writeFile(pilotPath, JSON.stringify(result, null, 2) + "\n");
  log(`Saved: ${pilotPath}`);

  if (result.comparison) {
    const cmpPath = join(outDir, `comparison-${ts}.json`);
    await writeFile(cmpPath, JSON.stringify(result.comparison, null, 2) + "\n");
    log(`Saved: ${cmpPath}`);
  }

  if (result.flowmesh) {
    const fmPath = join(outDir, `flowmesh-${ts}.json`);
    await writeFile(fmPath, JSON.stringify(result.flowmesh, null, 2) + "\n");
    log(`Saved: ${fmPath}`);
  }

  if (result.legacy) {
    const lgPath = join(outDir, `legacy-${ts}.json`);
    await writeFile(lgPath, JSON.stringify(result.legacy, null, 2) + "\n");
    log(`Saved: ${lgPath}`);
  }
}

async function runFlowmeshLeg(
  options: PilotOptions,
  config: FlowmeshConfig
): Promise<TriageResult> {
  return runTriageCapture({
    provider: options.provider,
    account: options.account,
    source: options.source,
    mailbox: options.mailbox,
    query: options.query,
    since: options.since,
    limit: options.limit,
    dryRun: options.dryRun,
    statePath: options.statePath,
    includeRead: options.includeRead,
    includePreviouslyNotified: options.includePreviouslyNotified,
    config,
  });
}

async function runLegacyLeg(options: PilotOptions): Promise<TriageResult> {
  const legacyOpts: LegacyCaptureOptions = {
    command: options.legacyCmd,
    file: options.legacyFile,
    timeout: options.legacyTimeout,
  };
  return captureLegacy(legacyOpts);
}
