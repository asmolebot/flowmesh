import { describe, it, expect } from "vitest";
import { readFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { HimalayaAdapter } from "../../src/providers/himalaya.js";
import { GogAdapter } from "../../src/providers/gog.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const rawFixtures = join(__dirname, "..", "fixtures", "provider-raw");

describe("Himalaya adapter normalize", () => {
  const adapter = new HimalayaAdapter();

  it("normalizes a raw himalaya envelope", async () => {
    const raw = JSON.parse(
      await readFile(join(rawFixtures, "himalaya-envelope.json"), "utf-8")
    );
    const msg = adapter.normalize(raw, "work");

    expect(msg.id).toBe("42");
    expect(msg.provider).toBe("himalaya");
    expect(msg.account).toBe("work");
    expect(msg.mailbox).toBe("INBOX");
    expect(msg.subject).toBe("Weekly sync notes");
    expect(msg.from).toEqual([{ address: "sender@example.com" }]);
    expect(msg.to).toEqual([{ address: "recipient@example.com" }]);
    expect(msg.snippet).toContain("notes from today");
    expect(msg.flags.read).toBe(false); // has "new" flag
    expect(msg.refs.providerThreadId).toBe("<msg-42@example.com>");
  });
});

describe("Gog adapter normalize", () => {
  const adapter = new GogAdapter();

  it("normalizes a raw gog message", async () => {
    const raw = JSON.parse(
      await readFile(join(rawFixtures, "gog-message.json"), "utf-8")
    );
    const msg = adapter.normalize(raw, "personal");

    expect(msg.id).toBe("gog-msg-99");
    expect(msg.provider).toBe("gog");
    expect(msg.account).toBe("personal");
    expect(msg.subject).toBe("Invoice #1234");
    expect(msg.from[0].address).toBe("billing@example.com");
    expect(msg.flags.read).toBe(true);
    expect(msg.attachments).toHaveLength(1);
    expect(msg.refs.providerThreadId).toBe("gog-thread-50");
  });
});
