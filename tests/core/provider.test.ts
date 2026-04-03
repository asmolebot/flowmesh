import { describe, it, expect, beforeEach } from "vitest";
import {
  registerProvider,
  getProvider,
  listProviders,
} from "../../src/core/provider.js";
import { registerAllProviders } from "../../src/providers/index.js";

describe("Provider registry", () => {
  beforeEach(() => {
    // Register all built-in providers for tests
    registerAllProviders();
  });

  it("lists registered providers", () => {
    const providers = listProviders();
    expect(providers).toContain("gog");
    expect(providers).toContain("imap");
    expect(providers).toContain("himalaya");
  });

  it("retrieves a registered provider", () => {
    const gog = getProvider("gog");
    expect(gog.name).toBe("gog");
  });

  it("throws on unknown provider", () => {
    expect(() => getProvider("nonexistent")).toThrow(/Unknown provider/);
  });

  it("registers a custom provider", () => {
    registerProvider({
      name: "custom-test",
      async list() { return []; },
      normalize(raw, account) {
        return {
          id: "x", provider: "custom-test", account, mailbox: "INBOX",
          subject: "", from: [], to: [], cc: [],
          receivedAt: new Date().toISOString(), snippet: "",
          labels: [], attachments: [],
          flags: { read: false, starred: false, archived: false },
          refs: { providerId: "x" }, meta: {},
        };
      },
    });
    expect(listProviders()).toContain("custom-test");
  });
});
