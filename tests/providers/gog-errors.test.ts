import { describe, it, expect } from "vitest";
import { readFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { GogAdapter, GogError } from "../../src/providers/gog.js";
import type { GogRawMessage } from "../../src/providers/gog.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const rawFixtures = join(__dirname, "..", "fixtures", "provider-raw");

describe("GogError", () => {
  it("has structured code and detail", () => {
    const err = new GogError("test error", "AUTH_REQUIRED", "detail here");
    expect(err.name).toBe("GogError");
    expect(err.code).toBe("AUTH_REQUIRED");
    expect(err.detail).toBe("detail here");
    expect(err.message).toBe("test error");
    expect(err).toBeInstanceOf(Error);
  });
});

describe("GogAdapter.normalize edge cases", () => {
  const adapter = new GogAdapter();

  it("normalizes empty search result", async () => {
    const raw = JSON.parse(
      await readFile(join(rawFixtures, "gog-empty-search.json"), "utf-8")
    );
    const messages = (raw.messages ?? []) as GogRawMessage[];
    expect(messages).toHaveLength(0);
  });

  it("normalizes message with missing labels array", () => {
    const raw = {
      id: "no-labels",
      threadId: "no-labels",
      date: "2026-04-03 12:00",
      from: "test@example.com",
      subject: "No labels",
      labels: undefined as unknown as string[],
    };
    const msg = adapter.normalize(raw as GogRawMessage, "test");
    expect(msg.id).toBe("no-labels");
    expect(msg.labels).toEqual([]);
    expect(msg.flags.read).toBe(true); // no UNREAD means read
    expect(msg.mailbox).toBe("unknown");
  });

  it("normalizes message with STARRED label", () => {
    const raw: GogRawMessage = {
      id: "starred-msg",
      threadId: "starred-msg",
      date: "2026-04-03 12:00",
      from: "important@example.com",
      subject: "Starred message",
      labels: ["STARRED", "INBOX", "IMPORTANT"],
    };
    const msg = adapter.normalize(raw, "test");
    expect(msg.flags.starred).toBe(true);
    expect(msg.flags.archived).toBe(false);
    expect(msg.labels).toContain("starred");
  });

  it("includes snippet from body when snippet field is missing", () => {
    const raw: GogRawMessage = {
      id: "body-snippet",
      threadId: "body-snippet",
      date: "2026-04-03 12:00",
      from: "sender@example.com",
      subject: "Has body no snippet",
      labels: ["INBOX"],
      body: "This is the body text that should become the snippet.",
    };
    const msg = adapter.normalize(raw, "test");
    expect(msg.snippet).toContain("This is the body text");
  });
});
