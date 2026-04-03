import { describe, it, expect } from "vitest";
import {
  PassthroughClassifier,
  ShellClassifier,
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

describe("ShellClassifier", () => {
  it("runs an echo-based classifier command", async () => {
    const classifier = new ShellClassifier(
      [
        "bash",
        "-c",
        'echo \'{"category":"newsletter","priority":"low","confidence":0.9,"tags":["promo"],"needsResponse":false,"reason":"test"}\'',
      ]
    );
    const result = await classifier.classify(stubMessage);
    expect(result.category).toBe("newsletter");
    expect(result.priority).toBe("low");
    expect(result.confidence).toBe(0.9);
    expect(result.tags).toContain("promo");
  });

  it("validates and provides defaults for partial classifier output", async () => {
    const classifier = new ShellClassifier(
      ["bash", "-c", 'echo \'{"category":"spam"}\'']
    );
    const result = await classifier.classify(stubMessage);
    expect(result.category).toBe("spam");
    expect(result.priority).toBe("medium"); // default
    expect(result.confidence).toBe(0); // default
    expect(result.tags).toEqual([]); // default
    expect(result.reason).toBe(""); // default
  });

  it("falls back to passthrough on error when configured", async () => {
    const classifier = new ShellClassifier(
      ["bash", "-c", "exit 1"],
      { fallbackOnError: true }
    );
    const result = await classifier.classify(stubMessage);
    expect(result.category).toBe("uncategorized");
    expect(result.reason).toContain("No classifier");
  });

  it("throws on error when fallback is not configured", async () => {
    const classifier = new ShellClassifier(["bash", "-c", "exit 1"]);
    await expect(classifier.classify(stubMessage)).rejects.toThrow(
      /Classifier exited with code 1/
    );
  });

  it("throws for invalid JSON output", async () => {
    const classifier = new ShellClassifier(
      ["bash", "-c", "echo 'not json'"]
    );
    await expect(classifier.classify(stubMessage)).rejects.toThrow();
  });

  it("throws for output missing category", async () => {
    const classifier = new ShellClassifier(
      ["bash", "-c", 'echo \'{"priority":"high"}\'']
    );
    await expect(classifier.classify(stubMessage)).rejects.toThrow(
      /category/
    );
  });

  it("receives message JSON on stdin", async () => {
    // Use node to read stdin JSON and echo back a field from it
    const classifier = new ShellClassifier([
      "node",
      "-e",
      `let d="";process.stdin.on("data",c=>d+=c);process.stdin.on("end",()=>{const m=JSON.parse(d);console.log(JSON.stringify({category:m.subject,priority:"medium",confidence:1,tags:[],needsResponse:false,reason:"from stdin"}))})`,
    ]);
    const result = await classifier.classify(stubMessage);
    expect(result.category).toBe("Test message");
    expect(result.reason).toBe("from stdin");
  });
});

describe("createClassifier", () => {
  it("creates a passthrough classifier", () => {
    const c = createClassifier({ kind: "passthrough" });
    expect(c).toBeInstanceOf(PassthroughClassifier);
  });

  it("creates a shell classifier with command", () => {
    const c = createClassifier({
      kind: "shell",
      command: ["echo", "test"],
    });
    expect(c).toBeInstanceOf(ShellClassifier);
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

  it("falls back to passthrough for unimplemented kinds", () => {
    const c = createClassifier({ kind: "rules" });
    expect(c).toBeInstanceOf(PassthroughClassifier);
  });
});
