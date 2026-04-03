import { describe, it, expect } from "vitest";
import {
  resolveSource,
  findWorkflowForSource,
} from "../../src/config/load.js";
import type { FlowmeshConfig } from "../../src/config/load.js";

const config: FlowmeshConfig = {
  accounts: {
    "personal-gmail": {
      provider: "gog",
      defaultQuery: "label:inbox",
      defaultMailbox: "INBOX",
    },
    "work-imap": {
      provider: "imap",
      host: "imap.example.com",
      port: 993,
    },
  },
  classifiers: {
    default: { kind: "passthrough" },
  },
  workflows: {
    "triage-default": {
      source: "personal-gmail",
      classifier: "default",
      routing: {
        archiveCategories: ["newsletter", "receipt"],
        escalateCategories: ["urgent"],
      },
    },
  },
};

describe("resolveSource", () => {
  it("resolves a known source to its account config", () => {
    const result = resolveSource(config, "personal-gmail");
    expect(result).toBeDefined();
    expect(result!.account).toBe("personal-gmail");
    expect(result!.config.provider).toBe("gog");
    expect(result!.config.defaultQuery).toBe("label:inbox");
  });

  it("returns undefined for unknown source", () => {
    const result = resolveSource(config, "nonexistent");
    expect(result).toBeUndefined();
  });
});

describe("findWorkflowForSource", () => {
  it("finds workflow config for a source", () => {
    const wf = findWorkflowForSource(config, "personal-gmail");
    expect(wf).toBeDefined();
    expect(wf!.classifier).toBe("default");
    expect(wf!.routing?.archiveCategories).toContain("newsletter");
  });

  it("returns undefined for source with no workflow", () => {
    const wf = findWorkflowForSource(config, "work-imap");
    expect(wf).toBeUndefined();
  });

  it("returns undefined when no workflows defined", () => {
    const wf = findWorkflowForSource({ accounts: {} }, "anything");
    expect(wf).toBeUndefined();
  });
});
