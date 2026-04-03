import { describe, it, expect, vi, beforeEach } from "vitest";
import { runTriage } from "../../src/workflows/triage.js";
import { registerProvider } from "../../src/core/provider.js";
import type { ProviderAdapter, ListParams } from "../../src/core/provider.js";
import type { NormalizedMessage } from "../../src/core/types.js";
import type { FlowmeshConfig } from "../../src/config/load.js";

// Capture stdout writes for assertion
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

// Suppress stderr (log/warn) during tests
function suppressStderr(): () => void {
  const mock = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
  return () => mock.mockRestore();
}

function makeMessage(overrides: Partial<NormalizedMessage> = {}): NormalizedMessage {
  return {
    id: "test-1",
    provider: "mock",
    account: "default",
    mailbox: "INBOX",
    subject: "Test message",
    from: [{ address: "sender@example.com" }],
    to: [{ address: "recipient@example.com" }],
    cc: [],
    receivedAt: "2026-04-03T12:00:00Z",
    snippet: "This is a test",
    labels: ["inbox"],
    attachments: [],
    flags: { read: false, starred: false, archived: false },
    refs: { providerId: "test-1" },
    meta: {},
    ...overrides,
  };
}

const mockMessages: NormalizedMessage[] = [
  makeMessage({ id: "m1", subject: "Urgent: server down" }),
  makeMessage({ id: "m2", subject: "Weekly newsletter" }),
  makeMessage({ id: "m3", subject: "Meeting notes" }),
];

const mockProvider: ProviderAdapter = {
  name: "mock",
  async list(_params: ListParams) {
    return mockMessages;
  },
  normalize(raw: unknown, account: string) {
    return raw as NormalizedMessage;
  },
};

const emptyConfig: FlowmeshConfig = { accounts: {} };

const configWithSource: FlowmeshConfig = {
  accounts: {
    "test-source": {
      provider: "mock",
      defaultQuery: "label:inbox newer_than:1d",
    },
  },
  classifiers: {
    test: {
      kind: "passthrough",
    },
  },
  workflows: {
    "triage-test": {
      source: "test-source",
      classifier: "test",
    },
  },
};

describe("runTriage", () => {
  beforeEach(() => {
    registerProvider(mockProvider);
  });

  it("throws when no provider is specified", async () => {
    await expect(
      runTriage({ config: emptyConfig })
    ).rejects.toThrow(/No provider/);
  });

  it("produces structured triage output with buckets", async () => {
    const captured = captureStdout();
    const restore = suppressStderr();
    try {
      await runTriage({
        provider: "mock",
        account: "default",
        config: emptyConfig,
        format: "json",
      });
      const result = JSON.parse(captured.getOutput());
      expect(result.totalMessages).toBe(3);
      expect(result.buckets).toBeDefined();
      expect(result.summary).toBeDefined();
      // With passthrough classifier, all go to "fyi" (uncategorized -> fyi)
      expect(result.summary.fyi).toBe(3);
    } finally {
      captured.restore();
      restore();
    }
  });

  it("resolves source from config", async () => {
    const captured = captureStdout();
    const restore = suppressStderr();
    try {
      await runTriage({
        source: "test-source",
        config: configWithSource,
        format: "json",
      });
      const result = JSON.parse(captured.getOutput());
      expect(result.source).toBe("test-source");
      expect(result.totalMessages).toBe(3);
    } finally {
      captured.restore();
      restore();
    }
  });

  it("includes dry-run plan when --dry-run is set", async () => {
    const captured = captureStdout();
    const restore = suppressStderr();
    try {
      await runTriage({
        provider: "mock",
        account: "default",
        config: emptyConfig,
        format: "json",
        dryRun: true,
      });
      const result = JSON.parse(captured.getOutput());
      expect(result.plan).toBeDefined();
      expect(result.plan.dryRun).toBe(true);
      expect(result.plan.actions).toBeInstanceOf(Array);
      expect(result.plan.summary).toBeDefined();
    } finally {
      captured.restore();
      restore();
    }
  });

  it("does not include plan when --dry-run is not set", async () => {
    const captured = captureStdout();
    const restore = suppressStderr();
    try {
      await runTriage({
        provider: "mock",
        account: "default",
        config: emptyConfig,
        format: "json",
      });
      const result = JSON.parse(captured.getOutput());
      expect(result.plan).toBeUndefined();
    } finally {
      captured.restore();
      restore();
    }
  });
});
