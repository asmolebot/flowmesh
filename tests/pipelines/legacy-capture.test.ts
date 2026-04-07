/**
 * Tests for legacy capture — parsing legacy output into TriageResult.
 */

import { describe, it, expect } from "vitest";
import { parseLegacyOutput } from "../../src/pipelines/legacy-capture.js";

describe("parseLegacyOutput", () => {
  it("parses a full TriageResult JSON", () => {
    const input = JSON.stringify({
      schemaVersion: "1",
      timestamp: "2026-04-03T12:00:00Z",
      source: "legacy-src",
      provider: "gog",
      account: "test",
      totalMessages: 2,
      buckets: {
        urgent: [
          {
            message: {
              id: "m1",
              provider: "gog",
              account: "test",
              mailbox: "INBOX",
              subject: "Alert",
              from: [{ address: "a@example.com" }],
              to: [],
              cc: [],
              receivedAt: "2026-04-03T12:00:00Z",
              snippet: "test",
              labels: [],
              attachments: [],
              flags: { read: false, starred: false, archived: false },
              refs: { providerId: "m1" },
              meta: {},
            },
            classification: {
              category: "urgent",
              priority: "high",
              confidence: 0.95,
              tags: [],
              needsResponse: true,
              reason: "urgent keyword",
            },
          },
        ],
        fyi: [
          {
            message: {
              id: "m2",
              provider: "gog",
              account: "test",
              mailbox: "INBOX",
              subject: "Info",
              from: [{ address: "b@example.com" }],
              to: [],
              cc: [],
              receivedAt: "2026-04-03T11:00:00Z",
              snippet: "info",
              labels: [],
              attachments: [],
              flags: { read: false, starred: false, archived: false },
              refs: { providerId: "m2" },
              meta: {},
            },
            classification: {
              category: "fyi",
              priority: "medium",
              confidence: 0.8,
              tags: [],
              needsResponse: false,
              reason: "informational",
            },
          },
        ],
      },
      summary: {
        urgent: 1,
        replyNeeded: 0,
        fyi: 1,
        archiveCandidate: 0,
        noise: 0,
      },
      classifierUsed: "legacy-rules",
    });

    const result = parseLegacyOutput(input);
    expect(result.schemaVersion).toBe("1");
    expect(result.totalMessages).toBe(2);
    expect(result.buckets["urgent"]).toHaveLength(1);
    expect(result.buckets["fyi"]).toHaveLength(1);
  });

  it("wraps an array of ClassifiedMessage objects", () => {
    const items = [
      {
        message: {
          id: "m1",
          provider: "test",
          account: "test",
          mailbox: "INBOX",
          subject: "Test",
          from: [{ address: "a@example.com" }],
          to: [],
          cc: [],
          receivedAt: "2026-04-03T12:00:00Z",
          snippet: "test",
          labels: [],
          attachments: [],
          flags: { read: false, starred: false, archived: false },
          refs: { providerId: "m1" },
          meta: {},
        },
        classification: {
          category: "fyi",
          priority: "medium",
          confidence: 0.5,
          tags: [],
          needsResponse: false,
          reason: "test",
        },
      },
    ];

    const result = parseLegacyOutput(JSON.stringify(items));
    expect(result.schemaVersion).toBe("1");
    expect(result.totalMessages).toBe(1);
    expect(result.classifierUsed).toBe("legacy");
  });

  it("wraps arbitrary JSON as raw output", () => {
    const result = parseLegacyOutput(JSON.stringify({ foo: "bar", count: 42 }));
    expect(result.schemaVersion).toBe("1");
    expect(result.totalMessages).toBe(0);
    expect(result.classifierUsed).toBe("legacy");
  });

  it("throws on empty input", () => {
    expect(() => parseLegacyOutput("")).toThrow("Legacy output is empty");
    expect(() => parseLegacyOutput("   ")).toThrow("Legacy output is empty");
  });

  it("throws on invalid JSON", () => {
    expect(() => parseLegacyOutput("not json")).toThrow("not valid JSON");
  });
});
