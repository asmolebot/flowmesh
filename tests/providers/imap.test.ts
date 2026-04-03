import { describe, it, expect } from "vitest";
import { readFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { ImapAdapter, ImapError, extractImapConfig, normalizeImapMessage } from "../../src/providers/imap.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const rawFixtures = join(__dirname, "..", "fixtures", "provider-raw");

describe("ImapAdapter.normalize (plain object / fixture)", () => {
  const adapter = new ImapAdapter();

  it("normalizes a raw IMAP envelope fixture into NormalizedMessage", async () => {
    const raw = JSON.parse(
      await readFile(join(rawFixtures, "imap-envelope.json"), "utf-8")
    );
    const msg = adapter.normalize(raw, "work-imap");

    expect(msg.id).toBe("1547");
    expect(msg.provider).toBe("imap");
    expect(msg.account).toBe("work-imap");
    expect(msg.mailbox).toBe("INBOX");
    expect(msg.subject).toBe("Q2 budget review attached");
    expect(msg.from).toEqual([
      { name: "Finance Team", address: "finance@example.com" },
    ]);
    expect(msg.to).toEqual([{ address: "user@example.com" }]);
    expect(msg.cc).toEqual([
      { name: "CFO Office", address: "cfo@example.com" },
    ]);
    expect(msg.flags.read).toBe(true); // seen=true
    expect(msg.flags.starred).toBe(false);
    expect(msg.bodyText).toContain("Q2 budget proposal");
    expect(msg.attachments).toHaveLength(1);
    expect(msg.attachments[0].filename).toBe("q2-budget.xlsx");
    expect(msg.refs.providerThreadId).toBe("<budget-review-q2@example.com>");
    expect(msg.receivedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("handles minimal IMAP envelope", () => {
    const msg = adapter.normalize(
      { uid: 100, subject: "Test", from: [], to: [] },
      "test"
    );
    expect(msg.id).toBe("100");
    expect(msg.provider).toBe("imap");
    expect(msg.subject).toBe("Test");
    expect(msg.flags.read).toBe(false);
  });
});

describe("normalizeImapMessage (imapflow FetchMessageObject shape)", () => {
  it("normalizes a mock FetchMessageObject", () => {
    // Simulate what imapflow returns
    const fetchObj = {
      seq: 42,
      uid: 1234,
      flags: new Set(["\\Seen", "\\Flagged"]),
      envelope: {
        date: new Date("2026-04-03T12:00:00Z"),
        subject: "Test IMAP fetch",
        messageId: "<test-msg@example.com>",
        from: [{ name: "Sender", address: "sender@example.com" }],
        to: [{ address: "recipient@example.com" }],
        cc: [],
        inReplyTo: "<parent@example.com>",
      },
      internalDate: new Date("2026-04-03T12:00:00Z"),
      size: 2048,
    };

    const msg = normalizeImapMessage(fetchObj as any, "test-account", "INBOX");

    expect(msg.id).toBe("1234");
    expect(msg.provider).toBe("imap");
    expect(msg.account).toBe("test-account");
    expect(msg.mailbox).toBe("INBOX");
    expect(msg.subject).toBe("Test IMAP fetch");
    expect(msg.from).toEqual([{ name: "Sender", address: "sender@example.com" }]);
    expect(msg.to).toEqual([{ address: "recipient@example.com" }]);
    expect(msg.flags.read).toBe(true); // \\Seen
    expect(msg.flags.starred).toBe(true); // \\Flagged
    expect(msg.threadId).toBe("<parent@example.com>");
    expect(msg.refs.providerThreadId).toBe("<test-msg@example.com>");
    expect(msg.meta).toEqual({
      seq: 42,
      size: 2048,
      imapFlags: ["\\Seen", "\\Flagged"],
    });
  });

  it("handles missing envelope gracefully", () => {
    const fetchObj = {
      seq: 1,
      uid: 999,
      flags: new Set<string>(),
    };
    const msg = normalizeImapMessage(fetchObj as any, "test", "Drafts");
    expect(msg.id).toBe("999");
    expect(msg.subject).toBe("");
    expect(msg.from).toEqual([]);
    expect(msg.mailbox).toBe("Drafts");
    expect(msg.flags.read).toBe(false);
  });
});

describe("extractImapConfig", () => {
  it("extracts valid config", () => {
    const cfg = extractImapConfig({
      host: "imap.example.com",
      port: 993,
      username: "user@example.com",
      password: "secret",
      tls: true,
    });
    expect(cfg.host).toBe("imap.example.com");
    expect(cfg.port).toBe(993);
    expect(cfg.username).toBe("user@example.com");
    expect(cfg.password).toBe("secret");
    expect(cfg.tls).toBe(true);
  });

  it("uses defaults for port and tls", () => {
    const cfg = extractImapConfig({
      host: "mail.example.org",
      username: "alice@example.org",
    });
    expect(cfg.port).toBe(993);
    expect(cfg.tls).toBe(true);
  });

  it("throws for missing host", () => {
    expect(() =>
      extractImapConfig({ username: "user@example.com" })
    ).toThrow(ImapError);
  });

  it("throws for missing username", () => {
    expect(() =>
      extractImapConfig({ host: "imap.example.com" })
    ).toThrow(ImapError);
  });
});
