import { describe, it, expect } from "vitest";
import { readFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { GogAdapter, parseAddress } from "../../src/providers/gog.js";
import type { GogRawMessage, GogGetResult } from "../../src/providers/gog.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const rawFixtures = join(__dirname, "..", "fixtures", "provider-raw");

describe("parseAddress", () => {
  it("parses 'Name <email>' format", () => {
    const addr = parseAddress("Jane Smith <jane@example.org>");
    expect(addr).toEqual({ name: "Jane Smith", address: "jane@example.org" });
  });

  it("parses bare email", () => {
    const addr = parseAddress("noreply@example.com");
    expect(addr).toEqual({ address: "noreply@example.com" });
  });

  it("handles extra whitespace", () => {
    const addr = parseAddress("  John Doe  <john@example.com>  ");
    expect(addr).toEqual({ name: "John Doe", address: "john@example.com" });
  });
});

describe("GogAdapter.normalize (search result messages)", () => {
  const adapter = new GogAdapter();

  it("normalizes a real gog search result into NormalizedMessage array", async () => {
    const raw = JSON.parse(
      await readFile(join(rawFixtures, "gog-search-result.json"), "utf-8")
    );

    const messages = (raw.messages as GogRawMessage[]).map((m) =>
      adapter.normalize(m, "test-account")
    );

    expect(messages).toHaveLength(4);

    // First message: unread updates email
    const msg0 = messages[0];
    expect(msg0.id).toBe("abc123def456");
    expect(msg0.provider).toBe("gog");
    expect(msg0.account).toBe("test-account");
    expect(msg0.mailbox).toBe("INBOX");
    expect(msg0.subject).toBe("Your monthly report for April");
    expect(msg0.from).toEqual([
      { name: "Updates Team", address: "updates@example.com" },
    ]);
    expect(msg0.flags.read).toBe(false); // UNREAD label
    expect(msg0.flags.archived).toBe(false); // has INBOX label
    expect(msg0.labels).toContain("inbox");
    expect(msg0.labels).toContain("unread");
    expect(msg0.receivedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);

    // Second message: important, unread
    const msg1 = messages[1];
    expect(msg1.id).toBe("def789ghi012");
    expect(msg1.flags.read).toBe(false);
    expect(msg1.labels).toContain("important");

    // Third message: read (no UNREAD label)
    const msg2 = messages[2];
    expect(msg2.id).toBe("ghi345jkl678");
    expect(msg2.flags.read).toBe(true);

    // Fourth message: archived (no INBOX label)
    const msg3 = messages[3];
    expect(msg3.id).toBe("jkl901mno234");
    expect(msg3.flags.archived).toBe(true);
    expect(msg3.mailbox).not.toBe("INBOX");
  });

  it("handles message with bare email in from field", () => {
    const raw: GogRawMessage = {
      id: "test-bare",
      threadId: "test-bare",
      date: "2026-04-01 12:00",
      from: "noreply@example.com",
      subject: "Automated notification",
      labels: ["INBOX"],
    };
    const msg = adapter.normalize(raw, "test");
    expect(msg.from).toEqual([{ address: "noreply@example.com" }]);
  });

  it("handles missing/empty fields gracefully", () => {
    const raw: GogRawMessage = {
      id: "empty-test",
      threadId: "empty-test",
      date: "",
      from: "",
      subject: "",
      labels: [],
    };
    const msg = adapter.normalize(raw, "test");
    expect(msg.id).toBe("empty-test");
    expect(msg.subject).toBe("");
    expect(msg.receivedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});

describe("GogAdapter.normalizeGetResult", () => {
  const adapter = new GogAdapter();

  it("normalizes a full gog get result", async () => {
    const raw: GogGetResult = JSON.parse(
      await readFile(join(rawFixtures, "gog-get-result.json"), "utf-8")
    );
    const msg = adapter.normalizeGetResult(raw, "test-account");

    expect(msg.id).toBe("def789ghi012");
    expect(msg.provider).toBe("gog");
    expect(msg.account).toBe("test-account");
    expect(msg.subject).toBe("Re: Project timeline discussion");
    expect(msg.from).toEqual([
      { name: "Jane Smith", address: "jane@example.org" },
    ]);
    expect(msg.to).toEqual([{ address: "user@example.com" }]);
    expect(msg.cc).toEqual([{ address: "team@example.com" }]);
    expect(msg.bodyText).toContain("review the attached");
    expect(msg.flags.read).toBe(false); // UNREAD label
    expect(msg.labels).toContain("important");
    expect(msg.receivedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});

describe("GogAdapter backward compat normalize", () => {
  const adapter = new GogAdapter();

  it("still normalizes the old fixture format (M1 compat)", async () => {
    const raw = JSON.parse(
      await readFile(join(rawFixtures, "gog-message.json"), "utf-8")
    );
    const msg = adapter.normalize(raw, "personal");

    expect(msg.id).toBe("gog-msg-99");
    expect(msg.provider).toBe("gog");
    expect(msg.account).toBe("personal");
    expect(msg.subject).toBe("Invoice #1234");
  });
});
