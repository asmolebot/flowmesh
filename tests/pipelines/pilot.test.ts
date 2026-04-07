/**
 * Tests for the pilot runner — engine selection and orchestration.
 */

import { readdir, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { runPilot } from "../../src/pipelines/pilot.js";
import { registerProvider } from "../../src/core/provider.js";
import type { ProviderAdapter, ListParams } from "../../src/core/provider.js";
import type { NormalizedMessage } from "../../src/core/types.js";

function captureStdout(): { getOutput: () => string; restore: () => void } {
  let captured = "";
  const mock = vi
    .spyOn(process.stdout, "write")
    .mockImplementation((chunk) => {
      captured += String(chunk);
      return true;
    });
  return {
    getOutput: () => captured,
    restore: () => mock.mockRestore(),
  };
}

function suppressStderr(): () => void {
  const mock = vi
    .spyOn(process.stderr, "write")
    .mockImplementation(() => true);
  return () => mock.mockRestore();
}

function makeMessage(id: string, subject: string): NormalizedMessage {
  return {
    id,
    provider: "pilot-mock",
    account: "default",
    mailbox: "INBOX",
    subject,
    from: [{ address: "sender@example.com" }],
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

const mockMessages = [
  makeMessage("p1", "Pilot test message 1"),
  makeMessage("p2", "Pilot test message 2"),
];

const mockProvider: ProviderAdapter = {
  name: "pilot-mock",
  async list(_params: ListParams) {
    return mockMessages;
  },
  normalize(raw: unknown) {
    return raw as NormalizedMessage;
  },
};

describe("runPilot", () => {
  beforeEach(() => {
    registerProvider(mockProvider);
  });

  it("runs flowmesh-only engine and returns PilotResult", async () => {
    const captured = captureStdout();
    const restoreErr = suppressStderr();
    try {
      const result = await runPilot({
        engine: "flowmesh",
        provider: "pilot-mock",
        account: "default",
        format: "json",
      });

      expect(result.engine).toBe("flowmesh");
      expect(result.flowmesh).toBeDefined();
      expect(result.flowmesh!.totalMessages).toBe(2);
      expect(result.legacy).toBeUndefined();
      expect(result.comparison).toBeUndefined();

      // Should also emit to stdout
      const output = JSON.parse(captured.getOutput());
      expect(output.engine).toBe("flowmesh");
    } finally {
      captured.restore();
      restoreErr();
    }
  });

  it("runs legacy-only engine from file", async () => {
    const { writeFile, unlink } = await import("node:fs/promises");
    const { join } = await import("node:path");
    const tmpFile = join("/tmp", `flowmesh-pilot-test-${Date.now()}.json`);

    const legacyData = {
      schemaVersion: "1",
      timestamp: "2026-04-03T12:00:00Z",
      source: "legacy",
      provider: "legacy-provider",
      account: "legacy",
      totalMessages: 1,
      buckets: {
        fyi: [
          {
            message: makeMessage("legacy-1", "Legacy message"),
            classification: {
              category: "fyi",
              priority: "medium",
              confidence: 0.5,
              tags: [],
              needsResponse: false,
              reason: "legacy classifier",
            },
          },
        ],
      },
      summary: { urgent: 0, replyNeeded: 0, fyi: 1, archiveCandidate: 0, noise: 0 },
      classifierUsed: "legacy",
    };

    await writeFile(tmpFile, JSON.stringify(legacyData));
    const captured = captureStdout();
    const restoreErr = suppressStderr();
    try {
      const result = await runPilot({
        engine: "legacy",
        legacyFile: tmpFile,
        format: "json",
      });

      expect(result.engine).toBe("legacy");
      expect(result.legacy).toBeDefined();
      expect(result.legacy!.totalMessages).toBe(1);
      expect(result.flowmesh).toBeUndefined();
      expect(result.comparison).toBeUndefined();
    } finally {
      captured.restore();
      restoreErr();
      await unlink(tmpFile).catch(() => {});
    }
  });

  it("persists timestamped artifacts when --out is specified", async () => {
    const outDir = `/tmp/flowmesh-bakeoff-test-${Date.now()}`;
    const captured = captureStdout();
    const restoreErr = suppressStderr();
    try {
      const result = await runPilot({
        engine: "flowmesh",
        provider: "pilot-mock",
        account: "default",
        format: "json",
        outDir,
      });

      // Check files were written
      const files = await readdir(outDir);
      const pilotFiles = files.filter((f) => f.startsWith("pilot-"));
      const fmFiles = files.filter((f) => f.startsWith("flowmesh-"));
      expect(pilotFiles).toHaveLength(1);
      expect(fmFiles).toHaveLength(1);

      // Verify content
      const pilotContent = JSON.parse(
        await readFile(join(outDir, pilotFiles[0]), "utf-8")
      );
      expect(pilotContent.engine).toBe("flowmesh");
      expect(pilotContent.flowmesh.totalMessages).toBe(2);
    } finally {
      captured.restore();
      restoreErr();
      await rm(outDir, { recursive: true, force: true });
    }
  });

  it("runs compare engine and produces comparison", async () => {
    const { writeFile, unlink } = await import("node:fs/promises");
    const tmpFile = `/tmp/flowmesh-pilot-compare-${Date.now()}.json`;

    // Legacy has the same messages but in different buckets
    const legacyData = {
      schemaVersion: "1",
      timestamp: "2026-04-03T12:00:00Z",
      source: "legacy",
      provider: "legacy-provider",
      account: "legacy",
      totalMessages: 2,
      buckets: {
        urgent: [
          {
            message: makeMessage("p1", "Pilot test message 1"),
            classification: {
              category: "urgent",
              priority: "high",
              confidence: 0.8,
              tags: [],
              needsResponse: true,
              reason: "legacy urgent",
            },
          },
        ],
        fyi: [
          {
            message: makeMessage("p2", "Pilot test message 2"),
            classification: {
              category: "fyi",
              priority: "medium",
              confidence: 0.6,
              tags: [],
              needsResponse: false,
              reason: "legacy fyi",
            },
          },
        ],
      },
      summary: { urgent: 1, replyNeeded: 0, fyi: 1, archiveCandidate: 0, noise: 0 },
      classifierUsed: "legacy",
    };

    await writeFile(tmpFile, JSON.stringify(legacyData));
    const captured = captureStdout();
    const restoreErr = suppressStderr();
    try {
      const result = await runPilot({
        engine: "compare",
        provider: "pilot-mock",
        account: "default",
        legacyFile: tmpFile,
        format: "json",
      });

      expect(result.engine).toBe("compare");
      expect(result.flowmesh).toBeDefined();
      expect(result.legacy).toBeDefined();
      expect(result.comparison).toBeDefined();
      expect(result.comparison!.summary.totalFlowmesh).toBe(2);
      expect(result.comparison!.summary.totalLegacy).toBe(2);

      // p1: flowmesh=fyi (passthrough), legacy=urgent → mismatch
      // p2: flowmesh=fyi (passthrough), legacy=fyi → match
      expect(result.comparison!.summary.matched).toBe(1);
      expect(result.comparison!.summary.mismatched).toBe(1);
    } finally {
      captured.restore();
      restoreErr();
      await unlink(tmpFile).catch(() => {});
    }
  });
});
