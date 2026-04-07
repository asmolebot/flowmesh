/**
 * Legacy capture — runs an external command (the old triage system)
 * and parses its output into a TriageResult-compatible shape.
 *
 * The legacy command should produce JSON on stdout. It can be:
 *   1. A TriageResult-shaped object (used as-is)
 *   2. A flat array of classified messages (wrapped into a TriageResult)
 *   3. Any JSON — stored as-is under a "raw" bucket for comparison
 *
 * This adapter also supports reading from a file (--legacy-file) for
 * offline comparison without re-running the legacy system.
 */

import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { log, warn } from "../core/emit.js";
import type { TriageResult, ClassifiedMessage } from "../core/types.js";

export interface LegacyCaptureOptions {
  /** Shell command + args to run the legacy triage system */
  command?: string[];
  /** Path to a file containing legacy output JSON */
  file?: string;
  /** Timeout in milliseconds (default: 120000) */
  timeout?: number;
}

/**
 * Capture legacy triage output from a shell command or file.
 */
export async function captureLegacy(
  options: LegacyCaptureOptions
): Promise<TriageResult> {
  let raw: string;

  if (options.file) {
    log(`Reading legacy output from file: ${options.file}`);
    raw = await readFile(options.file, "utf-8");
  } else if (options.command && options.command.length > 0) {
    raw = await runLegacyCommand(options.command, options.timeout ?? 120_000);
  } else {
    throw new Error(
      "Legacy capture requires either --legacy-cmd or --legacy-file"
    );
  }

  return parseLegacyOutput(raw);
}

function runLegacyCommand(
  command: string[],
  timeout: number
): Promise<string> {
  const [bin, ...args] = command;
  log(`Running legacy command: ${command.join(" ")}`);

  return new Promise((resolve, reject) => {
    execFile(
      bin,
      args,
      { timeout, maxBuffer: 10 * 1024 * 1024, shell: true },
      (err, stdout, stderr) => {
        if (stderr) {
          for (const line of stderr.split("\n").filter(Boolean)) {
            log(`[legacy] ${line}`);
          }
        }
        if (err) {
          reject(
            new Error(
              `Legacy command failed: ${err.message}${stderr ? `\nstderr: ${stderr.slice(0, 500)}` : ""}`
            )
          );
          return;
        }
        resolve(stdout);
      }
    );
  });
}

/**
 * Parse legacy output into a TriageResult.
 * Accepts:
 *   - Full TriageResult JSON (has schemaVersion + buckets)
 *   - Array of ClassifiedMessage objects
 *   - Arbitrary JSON (wrapped into raw bucket)
 */
export function parseLegacyOutput(raw: string): TriageResult {
  const trimmed = raw.trim();
  if (!trimmed) {
    throw new Error("Legacy output is empty");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    throw new Error(
      `Legacy output is not valid JSON (first 200 chars): ${trimmed.slice(0, 200)}`
    );
  }

  // Case 1: Full TriageResult shape
  if (isTriageResult(parsed)) {
    return parsed;
  }

  // Case 2: Array of classified messages
  if (Array.isArray(parsed) && parsed.length > 0 && isClassifiedMessage(parsed[0])) {
    return wrapClassifiedMessages(parsed as ClassifiedMessage[]);
  }

  // Case 3: Arbitrary JSON — wrap as raw
  warn("Legacy output is not a recognized triage format; wrapping as raw");
  return wrapRawOutput(parsed);
}

function isTriageResult(obj: unknown): obj is TriageResult {
  if (!obj || typeof obj !== "object") return false;
  const o = obj as Record<string, unknown>;
  return (
    o.schemaVersion === "1" &&
    typeof o.buckets === "object" &&
    o.buckets !== null &&
    typeof o.totalMessages === "number"
  );
}

function isClassifiedMessage(obj: unknown): obj is ClassifiedMessage {
  if (!obj || typeof obj !== "object") return false;
  const o = obj as Record<string, unknown>;
  return (
    typeof o.message === "object" &&
    o.message !== null &&
    typeof o.classification === "object" &&
    o.classification !== null
  );
}

function wrapClassifiedMessages(items: ClassifiedMessage[]): TriageResult {
  const buckets: Record<string, ClassifiedMessage[]> = {
    urgent: [],
    "reply-needed": [],
    fyi: [],
    "archive-candidate": [],
    noise: [],
  };

  for (const item of items) {
    const cat = item.classification.category;
    const bucket = buckets[cat] ? cat : "fyi";
    if (!buckets[bucket]) buckets[bucket] = [];
    buckets[bucket].push(item);
  }

  return {
    schemaVersion: "1",
    timestamp: new Date().toISOString(),
    source: "legacy",
    provider: "legacy",
    account: "legacy",
    totalMessages: items.length,
    buckets,
    summary: {
      urgent: buckets["urgent"]?.length ?? 0,
      replyNeeded: buckets["reply-needed"]?.length ?? 0,
      fyi: buckets["fyi"]?.length ?? 0,
      archiveCandidate: buckets["archive-candidate"]?.length ?? 0,
      noise: buckets["noise"]?.length ?? 0,
    },
    classifierUsed: "legacy",
  };
}

function wrapRawOutput(data: unknown): TriageResult {
  return {
    schemaVersion: "1",
    timestamp: new Date().toISOString(),
    source: "legacy",
    provider: "legacy",
    account: "legacy",
    totalMessages: 0,
    buckets: { raw: [] },
    summary: { urgent: 0, replyNeeded: 0, fyi: 0, archiveCandidate: 0, noise: 0 },
    classifierUsed: "legacy",
    // Stash the raw output in meta via plan field abuse — downstream can inspect
    // We use a type assertion here since this is a compatibility shim
    ...(data ? { meta: { legacyRaw: data } } : {}),
  } as TriageResult;
}
