import { describe, it, expect } from "vitest";
import { readFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { NormalizedMessage } from "../../src/core/types.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixturesDir = join(__dirname, "..", "fixtures");

describe("NormalizedMessage type", () => {
  it("fixture conforms to NormalizedMessage shape", async () => {
    const raw = await readFile(
      join(fixturesDir, "normalized", "sample-message.json"),
      "utf-8"
    );
    const msg: NormalizedMessage = JSON.parse(raw);

    expect(msg.id).toBe("msg-001");
    expect(msg.provider).toBe("himalaya");
    expect(msg.account).toBe("work");
    expect(msg.subject).toBe("Quarterly review");
    expect(msg.from).toHaveLength(1);
    expect(msg.from[0].address).toBe("alex@example.com");
    expect(msg.flags.read).toBe(false);
    expect(msg.flags.starred).toBe(true);
    expect(msg.attachments).toHaveLength(1);
    expect(msg.attachments[0].filename).toBe("plan.pdf");
    expect(msg.refs.providerId).toBe("abc123");
  });

  it("NormalizedMessage has required fields", () => {
    const msg: NormalizedMessage = {
      id: "test-1",
      provider: "test",
      account: "default",
      mailbox: "INBOX",
      subject: "Test",
      from: [{ address: "a@example.com" }],
      to: [{ address: "b@example.com" }],
      cc: [],
      receivedAt: new Date().toISOString(),
      snippet: "test snippet",
      labels: [],
      attachments: [],
      flags: { read: false, starred: false, archived: false },
      refs: { providerId: "test-1" },
      meta: {},
    };

    expect(msg.id).toBe("test-1");
    expect(msg.provider).toBe("test");
  });
});
