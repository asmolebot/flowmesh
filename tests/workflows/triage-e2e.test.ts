/**
 * End-to-end fixture test: raw provider output -> normalize -> classify -> triage output.
 *
 * Uses the rules classifier with DEFAULT_RULES against realistic fixtures.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { runTriage } from "../../src/workflows/triage.js";
import { registerProvider } from "../../src/core/provider.js";
import type { ProviderAdapter, ListParams } from "../../src/core/provider.js";
import type { NormalizedMessage, TriageResult } from "../../src/core/types.js";
import type { FlowmeshConfig } from "../../src/config/load.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixtureDir = join(__dirname, "..", "fixtures");

function captureStdout(): { getOutput: () => string; restore: () => void } {
  let captured = "";
  const mock = vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
    captured += String(chunk);
    return true;
  });
  return {
    getOutput: () => captured,
    restore: () => mock.mockRestore(),
  };
}

function suppressStderr(): () => void {
  const mock = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
  return () => mock.mockRestore();
}

describe("triage end-to-end with rules classifier", () => {
  let messages: NormalizedMessage[];

  beforeEach(async () => {
    messages = JSON.parse(
      await readFile(
        join(fixtureDir, "normalized", "classified-messages.json"),
        "utf-8"
      )
    );
    const mockProvider: ProviderAdapter = {
      name: "fixture-provider",
      async list(_params: ListParams) {
        return messages;
      },
      normalize(raw: unknown) {
        return raw as NormalizedMessage;
      },
    };
    registerProvider(mockProvider);
  });

  it("classifies fixture messages into correct buckets using rules", async () => {
    const config: FlowmeshConfig = {
      accounts: {
        "test-source": { provider: "fixture-provider" },
      },
      classifiers: {
        "default-rules": { kind: "rules" },
      },
      workflows: {
        "triage-e2e": {
          source: "test-source",
          classifier: "default-rules",
        },
      },
    };

    const captured = captureStdout();
    const restoreErr = suppressStderr();
    try {
      await runTriage({
        source: "test-source",
        config,
        format: "json",
      });

      const result: TriageResult = JSON.parse(captured.getOutput());

      // Schema version present
      expect(result.schemaVersion).toBe("1");
      expect(result.provider).toBe("fixture-provider");
      expect(result.account).toBe("test-source");
      expect(result.classifierUsed).toBe("default-rules");
      expect(result.totalMessages).toBe(5);

      // Collect all classifications for debugging
      const allEntries = Object.values(result.buckets).flat();
      const categories = allEntries.map((e) => ({
        subject: e.message.subject,
        category: e.classification.category,
        bucket: Object.entries(result.buckets).find(([_, entries]) =>
          entries.includes(e)
        )?.[0],
      }));

      // At least some messages should not be "uncategorized"
      const classified = allEntries.filter(
        (e) => e.classification.category !== "uncategorized"
      );
      expect(classified.length).toBeGreaterThanOrEqual(3);

      // Newsletter/noreply should be in archive-candidate
      expect(result.summary.archiveCandidate).toBeGreaterThanOrEqual(1);

      // Check that buckets have non-trivial distribution (not all in one bucket)
      const nonEmptyBuckets = Object.values(result.buckets).filter(
        (b) => b.length > 0
      );
      expect(nonEmptyBuckets.length).toBeGreaterThanOrEqual(2);

      // Verify bucket contents have correct shape
      for (const [_bucket, entries] of Object.entries(result.buckets)) {
        for (const entry of entries) {
          expect(entry.message).toBeDefined();
          expect(entry.classification).toBeDefined();
          expect(entry.classification.category).toBeTruthy();
          expect(typeof entry.classification.confidence).toBe("number");
        }
      }
    } finally {
      captured.restore();
      restoreErr();
    }
  });

  it("produces valid dry-run plan with new fields", async () => {
    const config: FlowmeshConfig = {
      accounts: {
        "test-source": { provider: "fixture-provider" },
      },
      classifiers: {
        "default-rules": { kind: "rules" },
      },
      workflows: {
        "triage-e2e": {
          source: "test-source",
          classifier: "default-rules",
        },
      },
    };

    const captured = captureStdout();
    const restoreErr = suppressStderr();
    try {
      await runTriage({
        source: "test-source",
        config,
        format: "json",
        dryRun: true,
      });

      const result: TriageResult = JSON.parse(captured.getOutput());

      expect(result.plan).toBeDefined();
      expect(result.plan!.dryRun).toBe(true);

      // Verify plan actions have all required fields
      for (const action of result.plan!.actions) {
        expect(action.messageId).toBeTruthy();
        expect(action.action).toMatch(/^(archive|trash|read|skip)$/);
        expect(action.provider).toBe("gog"); // fixture messages are gog
        expect(action.priority).toBeTruthy();
        expect(typeof action.confidence).toBe("number");
        expect(action.bucket).toBeTruthy();
        expect(action.category).toBeTruthy();
      }

      // Summary should be consistent
      const plan = result.plan!;
      expect(plan.summary.total).toBe(plan.actions.length);
      expect(plan.summary.archive + plan.summary.trash + plan.summary.read).toBe(
        plan.summary.total
      );
    } finally {
      captured.restore();
      restoreErr();
    }
  });
});

describe("triage end-to-end: gog raw -> normalize -> triage", () => {
  let rawMessages: unknown[];

  beforeEach(async () => {
    const { GogAdapter } = await import("../../src/providers/gog.js");
    const searchResult = JSON.parse(
      await readFile(
        join(fixtureDir, "provider-raw", "gog-search-result.json"),
        "utf-8"
      )
    );
    rawMessages = searchResult.messages;
    const gogAdapter = new GogAdapter();
    // Wrap it as a provider that returns raw messages directly
    const provider: ProviderAdapter = {
      name: "gog-fixture",
      async list() {
        return rawMessages;
      },
      normalize(raw: unknown, account: string) {
        return gogAdapter.normalize(raw, account);
      },
    };
    registerProvider(provider);
  });

  it("runs full pipeline from raw gog output through triage", async () => {
    const config: FlowmeshConfig = {
      accounts: {
        "gog-test": { provider: "gog-fixture" },
      },
      classifiers: {
        rules: { kind: "rules" },
      },
      workflows: {
        triage: {
          source: "gog-test",
          classifier: "rules",
        },
      },
    };

    const captured = captureStdout();
    const restoreErr = suppressStderr();
    try {
      await runTriage({
        source: "gog-test",
        config,
        format: "json",
        dryRun: true,
      });

      const result: TriageResult = JSON.parse(captured.getOutput());
      expect(result.totalMessages).toBe(4);
      expect(result.schemaVersion).toBe("1");
      expect(result.provider).toBe("gog-fixture");

      // The newsletter (CATEGORY_PROMOTIONS) should classify as newsletter
      // The noreply notification should classify as automated/notification
      // Verify at least some classification happened
      const allClassifications = Object.values(result.buckets)
        .flat()
        .map((e) => e.classification.category);
      expect(allClassifications.length).toBe(4);

      // Dry-run plan should be present
      expect(result.plan).toBeDefined();
      expect(result.plan!.dryRun).toBe(true);
    } finally {
      captured.restore();
      restoreErr();
    }
  });
});

describe("triage end-to-end: imap raw -> normalize -> triage", () => {
  beforeEach(async () => {
    const { ImapAdapter } = await import("../../src/providers/imap.js");
    const imapRaw = JSON.parse(
      await readFile(
        join(fixtureDir, "provider-raw", "imap-envelope.json"),
        "utf-8"
      )
    );
    const imapAdapter = new ImapAdapter();
    const provider: ProviderAdapter = {
      name: "imap-fixture",
      async list() {
        return [imapRaw];
      },
      normalize(raw: unknown, account: string) {
        return imapAdapter.normalize(raw, account);
      },
    };
    registerProvider(provider);
  });

  it("runs full pipeline from raw IMAP output through triage", async () => {
    const config: FlowmeshConfig = {
      accounts: {
        "imap-test": { provider: "imap-fixture" },
      },
      classifiers: {
        rules: { kind: "rules" },
      },
      workflows: {
        triage: {
          source: "imap-test",
          classifier: "rules",
        },
      },
    };

    const captured = captureStdout();
    const restoreErr = suppressStderr();
    try {
      await runTriage({
        source: "imap-test",
        config,
        format: "json",
      });

      const result: TriageResult = JSON.parse(captured.getOutput());
      expect(result.totalMessages).toBe(1);
      expect(result.provider).toBe("imap-fixture");

      // The IMAP fixture message has "please review...confirm by Friday" in snippet
      // This should match the reply-needed rule
      const allEntries = Object.values(result.buckets).flat();
      expect(allEntries).toHaveLength(1);
      const entry = allEntries[0];
      expect(entry.message.provider).toBe("imap");
      expect(entry.classification.category).toBeTruthy();
    } finally {
      captured.restore();
      restoreErr();
    }
  });
});
