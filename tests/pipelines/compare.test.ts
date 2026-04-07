/**
 * Tests for the comparison engine — diffing two TriageResult outputs.
 */

import { describe, it, expect } from "vitest";
import { compareTriageResults } from "../../src/pipelines/compare.js";
import type {
  TriageResult,
  NormalizedMessage,
  ClassifierResult,
} from "../../src/core/types.js";

function makeMessage(
  id: string,
  subject: string,
  from = "sender@example.com"
): NormalizedMessage {
  return {
    id,
    provider: "mock",
    account: "default",
    mailbox: "INBOX",
    subject,
    from: [{ address: from }],
    to: [{ address: "me@example.com" }],
    cc: [],
    receivedAt: "2026-04-03T12:00:00Z",
    snippet: subject,
    labels: [],
    attachments: [],
    flags: { read: false, starred: false, archived: false },
    refs: { providerId: id },
    meta: {},
  };
}

function makeClassification(
  category: string,
  priority: ClassifierResult["priority"] = "medium",
  confidence = 0.9
): ClassifierResult {
  return {
    category,
    priority,
    confidence,
    tags: [],
    needsResponse: false,
    reason: `classified as ${category}`,
  };
}

function makeTriageResult(
  buckets: Record<
    string,
    Array<{ message: NormalizedMessage; classification: ClassifierResult }>
  >,
  source = "test-source",
  classifier = "rules"
): TriageResult {
  let total = 0;
  for (const entries of Object.values(buckets)) total += entries.length;
  return {
    schemaVersion: "1",
    timestamp: "2026-04-03T12:00:00Z",
    source,
    provider: "mock",
    account: "default",
    totalMessages: total,
    buckets,
    summary: {
      urgent: buckets["urgent"]?.length ?? 0,
      replyNeeded: buckets["reply-needed"]?.length ?? 0,
      fyi: buckets["fyi"]?.length ?? 0,
      archiveCandidate: buckets["archive-candidate"]?.length ?? 0,
      noise: buckets["noise"]?.length ?? 0,
    },
    classifierUsed: classifier,
  };
}

describe("compareTriageResults", () => {
  it("reports perfect match when both results are identical", () => {
    const msg = makeMessage("m1", "Hello");
    const cls = makeClassification("fyi");
    const a = makeTriageResult({ fyi: [{ message: msg, classification: cls }] });
    const b = makeTriageResult(
      { fyi: [{ message: msg, classification: cls }] },
      "legacy-source",
      "legacy"
    );

    const report = compareTriageResults(a, b);
    expect(report.summary.matched).toBe(1);
    expect(report.summary.mismatched).toBe(0);
    expect(report.summary.flowmeshOnly).toBe(0);
    expect(report.summary.legacyOnly).toBe(0);
    expect(report.diffs).toHaveLength(1);
    expect(report.diffs[0].match).toBe(true);
  });

  it("reports mismatch when same message is in different buckets", () => {
    const msg = makeMessage("m1", "Server alert");
    const a = makeTriageResult({
      urgent: [{ message: msg, classification: makeClassification("urgent", "high") }],
    });
    const b = makeTriageResult({
      fyi: [{ message: msg, classification: makeClassification("fyi") }],
    });

    const report = compareTriageResults(a, b);
    expect(report.summary.matched).toBe(0);
    expect(report.summary.mismatched).toBe(1);
    expect(report.diffs[0].match).toBe(false);
    expect(report.diffs[0].flowmesh?.bucket).toBe("urgent");
    expect(report.diffs[0].legacy?.bucket).toBe("fyi");
  });

  it("reports flowmesh-only and legacy-only messages", () => {
    const m1 = makeMessage("m1", "Only in flowmesh");
    const m2 = makeMessage("m2", "Only in legacy");
    const cls = makeClassification("fyi");
    const a = makeTriageResult({ fyi: [{ message: m1, classification: cls }] });
    const b = makeTriageResult({ fyi: [{ message: m2, classification: cls }] });

    const report = compareTriageResults(a, b);
    expect(report.summary.flowmeshOnly).toBe(1);
    expect(report.summary.legacyOnly).toBe(1);
    expect(report.summary.matched).toBe(0);
    expect(report.summary.mismatched).toBe(0);
    expect(report.diffs).toHaveLength(2);
  });

  it("handles empty results gracefully", () => {
    const a = makeTriageResult({});
    const b = makeTriageResult({});

    const report = compareTriageResults(a, b);
    expect(report.summary.matched).toBe(0);
    expect(report.summary.mismatched).toBe(0);
    expect(report.summary.totalFlowmesh).toBe(0);
    expect(report.summary.totalLegacy).toBe(0);
    expect(report.diffs).toHaveLength(0);
  });

  it("produces bucket-level diffs", () => {
    const m1 = makeMessage("m1", "Newsletter");
    const m2 = makeMessage("m2", "Urgent alert");
    const a = makeTriageResult({
      "archive-candidate": [
        { message: m1, classification: makeClassification("newsletter", "low") },
      ],
      urgent: [
        { message: m2, classification: makeClassification("urgent", "high") },
      ],
    });
    const b = makeTriageResult({
      fyi: [
        { message: m1, classification: makeClassification("fyi") },
        { message: m2, classification: makeClassification("fyi") },
      ],
    });

    const report = compareTriageResults(a, b);
    expect(report.summary.bucketDiffs["archive-candidate"]).toEqual({
      flowmesh: 1,
      legacy: 0,
    });
    expect(report.summary.bucketDiffs["urgent"]).toEqual({
      flowmesh: 1,
      legacy: 0,
    });
    expect(report.summary.bucketDiffs["fyi"]).toEqual({
      flowmesh: 0,
      legacy: 2,
    });
  });

  it("includes schemaVersion and engine in report", () => {
    const a = makeTriageResult({}, "my-source", "rules");
    const b = makeTriageResult({}, "legacy", "legacy");

    const report = compareTriageResults(a, b);
    expect(report.schemaVersion).toBe("1");
    expect(report.engine).toBe("compare");
    expect(report.flowmeshClassifier).toBe("rules");
    expect(report.legacySource).toBe("legacy");
    expect(report.source).toBe("my-source");
  });

  it("handles mixed scenario: some matched, some mismatched, some exclusive", () => {
    const m1 = makeMessage("m1", "Shared matched");
    const m2 = makeMessage("m2", "Shared mismatched");
    const m3 = makeMessage("m3", "Flowmesh only");
    const m4 = makeMessage("m4", "Legacy only");

    const cls = makeClassification("fyi");
    const a = makeTriageResult({
      fyi: [
        { message: m1, classification: cls },
        { message: m3, classification: cls },
      ],
      urgent: [
        { message: m2, classification: makeClassification("urgent", "high") },
      ],
    });
    const b = makeTriageResult({
      fyi: [
        { message: m1, classification: cls },
        { message: m2, classification: cls },
        { message: m4, classification: cls },
      ],
    });

    const report = compareTriageResults(a, b);
    expect(report.summary.matched).toBe(1); // m1
    expect(report.summary.mismatched).toBe(1); // m2
    expect(report.summary.flowmeshOnly).toBe(1); // m3
    expect(report.summary.legacyOnly).toBe(1); // m4
    expect(report.diffs).toHaveLength(4);
  });
});
