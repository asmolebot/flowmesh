import { describe, it, expect } from "vitest";
import {
  PassthroughClassifier,
  createClassifier,
} from "../../src/core/classify.js";
import type { NormalizedMessage } from "../../src/core/types.js";

const stubMessage: NormalizedMessage = {
  id: "test-1",
  provider: "test",
  account: "default",
  mailbox: "INBOX",
  subject: "Test message",
  from: [{ address: "sender@example.com" }],
  to: [{ address: "recipient@example.com" }],
  cc: [],
  receivedAt: "2026-04-03T12:00:00Z",
  snippet: "This is a test",
  labels: [],
  attachments: [],
  flags: { read: false, starred: false, archived: false },
  refs: { providerId: "test-1" },
  meta: {},
};

describe("PassthroughClassifier", () => {
  it("returns uncategorized for any message", async () => {
    const classifier = new PassthroughClassifier();
    const result = await classifier.classify(stubMessage);

    expect(result.category).toBe("uncategorized");
    expect(result.confidence).toBe(0);
    expect(result.needsResponse).toBe(false);
    expect(result.reason).toContain("No classifier");
  });
});

describe("createClassifier", () => {
  it("creates a passthrough classifier", () => {
    const c = createClassifier({ kind: "passthrough" });
    expect(c).toBeInstanceOf(PassthroughClassifier);
  });

  it("throws for shell without command", () => {
    expect(() =>
      createClassifier({ kind: "shell", command: [] })
    ).toThrow(/command/);
  });

  it("throws for unknown kind", () => {
    expect(() =>
      createClassifier({ kind: "unknown" as any })
    ).toThrow(/Unknown classifier kind/);
  });
});
