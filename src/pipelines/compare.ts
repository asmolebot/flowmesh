/**
 * Comparison engine — diffs two TriageResult outputs (flowmesh vs legacy)
 * to produce a structured report showing where they agree and disagree.
 *
 * Messages are matched by id. For each matched pair, we compare bucket
 * and category assignments. Unmatched messages are flagged as
 * flowmesh-only or legacy-only.
 */

import type {
  TriageResult,
  ClassifiedMessage,
  MessageDiff,
  ComparisonSummary,
  ComparisonReport,
} from "../core/types.js";

/**
 * Build a lookup from message id -> { bucket, entry } for a triage result.
 */
function buildIndex(
  result: TriageResult
): Map<string, { bucket: string; entry: ClassifiedMessage }> {
  const index = new Map<string, { bucket: string; entry: ClassifiedMessage }>();
  for (const [bucket, entries] of Object.entries(result.buckets)) {
    for (const entry of entries) {
      index.set(entry.message.id, { bucket, entry });
    }
  }
  return index;
}

/**
 * Compare two triage results and produce a structured diff report.
 */
export function compareTriageResults(
  flowmesh: TriageResult,
  legacy: TriageResult
): ComparisonReport {
  const fmIndex = buildIndex(flowmesh);
  const lgIndex = buildIndex(legacy);

  const allIds = new Set([...fmIndex.keys(), ...lgIndex.keys()]);
  const diffs: MessageDiff[] = [];

  let matched = 0;
  let mismatched = 0;
  let flowmeshOnly = 0;
  let legacyOnly = 0;

  for (const id of allIds) {
    const fm = fmIndex.get(id);
    const lg = lgIndex.get(id);

    const diff: MessageDiff = {
      messageId: id,
      subject: fm?.entry.message.subject ?? lg?.entry.message.subject ?? "",
      from:
        fm?.entry.message.from[0]?.address ??
        lg?.entry.message.from[0]?.address ??
        "unknown",
      match: false,
    };

    if (fm) {
      diff.flowmesh = {
        bucket: fm.bucket,
        category: fm.entry.classification.category,
        priority: fm.entry.classification.priority,
        confidence: fm.entry.classification.confidence,
      };
    }

    if (lg) {
      diff.legacy = {
        bucket: lg.bucket,
        category: lg.entry.classification.category,
        priority: lg.entry.classification.priority,
        confidence: lg.entry.classification.confidence,
      };
    }

    if (fm && lg) {
      diff.match = fm.bucket === lg.bucket;
      if (diff.match) {
        matched++;
      } else {
        mismatched++;
      }
    } else if (fm && !lg) {
      flowmeshOnly++;
    } else {
      legacyOnly++;
    }

    diffs.push(diff);
  }

  // Build bucket-level comparison
  const bucketNames = new Set<string>();
  for (const [b] of Object.entries(flowmesh.buckets)) bucketNames.add(b);
  for (const [b] of Object.entries(legacy.buckets)) bucketNames.add(b);

  const bucketDiffs: Record<string, { flowmesh: number; legacy: number }> = {};
  for (const b of bucketNames) {
    bucketDiffs[b] = {
      flowmesh: flowmesh.buckets[b]?.length ?? 0,
      legacy: legacy.buckets[b]?.length ?? 0,
    };
  }

  const summary: ComparisonSummary = {
    totalFlowmesh: flowmesh.totalMessages,
    totalLegacy: legacy.totalMessages,
    matched,
    mismatched,
    flowmeshOnly,
    legacyOnly,
    bucketDiffs,
  };

  return {
    schemaVersion: "1",
    timestamp: new Date().toISOString(),
    source: flowmesh.source,
    engine: "compare",
    flowmeshClassifier: flowmesh.classifierUsed,
    legacySource: legacy.source,
    summary,
    diffs,
  };
}
