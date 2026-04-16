import { describe, it, expect } from "vitest";
import {
  RulesClassifier,
  DEFAULT_RULES,
  createRulesClassifier,
} from "../../src/core/rules-classifier.js";
import type { ClassificationRule } from "../../src/core/rules-classifier.js";
import type { NormalizedMessage } from "../../src/core/types.js";

function makeMessage(overrides: Partial<NormalizedMessage> = {}): NormalizedMessage {
  return {
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
    labels: ["inbox"],
    attachments: [],
    flags: { read: false, starred: false, archived: false },
    refs: { providerId: "test-1" },
    meta: {},
    ...overrides,
  };
}

describe("RulesClassifier", () => {
  it("matches a simple subject rule", async () => {
    const rules: ClassificationRule[] = [
      {
        name: "test-urgent",
        match: { field: "subject", pattern: "^urgent" },
        result: { category: "urgent", priority: "high", needsResponse: true },
      },
    ];
    const classifier = new RulesClassifier(rules);
    const result = await classifier.classify(
      makeMessage({ subject: "Urgent: servers on fire" })
    );
    expect(result.category).toBe("urgent");
    expect(result.priority).toBe("high");
    expect(result.needsResponse).toBe(true);
    expect(result.confidence).toBe(1.0);
    expect(result.reason).toContain("test-urgent");
  });

  it("returns uncategorized when no rules match", async () => {
    const classifier = new RulesClassifier([
      {
        match: { field: "subject", pattern: "^ZZZZZ$" },
        result: { category: "never" },
      },
    ]);
    const result = await classifier.classify(makeMessage());
    expect(result.category).toBe("uncategorized");
    expect(result.confidence).toBe(0);
  });

  it("uses first matching rule", async () => {
    const rules: ClassificationRule[] = [
      {
        name: "first",
        match: { field: "subject", pattern: "test" },
        result: { category: "first-match" },
      },
      {
        name: "second",
        match: { field: "subject", pattern: "test" },
        result: { category: "second-match" },
      },
    ];
    const classifier = new RulesClassifier(rules);
    const result = await classifier.classify(
      makeMessage({ subject: "Test message" })
    );
    expect(result.category).toBe("first-match");
  });

  it("supports 'all' match mode (default)", async () => {
    const rules: ClassificationRule[] = [
      {
        match: [
          { field: "subject", pattern: "invoice" },
          { field: "from", pattern: "billing" },
        ],
        result: { category: "receipt" },
      },
    ];
    const classifier = new RulesClassifier(rules);

    // Both match
    const r1 = await classifier.classify(
      makeMessage({
        subject: "Invoice #123",
        from: [{ address: "billing@example.com" }],
      })
    );
    expect(r1.category).toBe("receipt");

    // Only subject matches
    const r2 = await classifier.classify(
      makeMessage({
        subject: "Invoice #123",
        from: [{ address: "support@example.com" }],
      })
    );
    expect(r2.category).toBe("uncategorized");
  });

  it("supports 'any' match mode", async () => {
    const rules: ClassificationRule[] = [
      {
        match: [
          { field: "subject", pattern: "newsletter" },
          { field: "labels", pattern: "category_promotions" },
        ],
        matchMode: "any",
        result: { category: "newsletter" },
      },
    ];
    const classifier = new RulesClassifier(rules);

    const result = await classifier.classify(
      makeMessage({ labels: ["inbox", "category_promotions"] })
    );
    expect(result.category).toBe("newsletter");
  });

  it("is case-insensitive by default", async () => {
    const rules: ClassificationRule[] = [
      {
        match: { field: "subject", pattern: "urgent" },
        result: { category: "urgent" },
      },
    ];
    const classifier = new RulesClassifier(rules);
    const result = await classifier.classify(
      makeMessage({ subject: "URGENT: Please respond" })
    );
    expect(result.category).toBe("urgent");
  });

  it("supports case-sensitive matching", async () => {
    const rules: ClassificationRule[] = [
      {
        match: { field: "subject", pattern: "URGENT", caseSensitive: true },
        result: { category: "urgent" },
      },
    ];
    const classifier = new RulesClassifier(rules);

    const r1 = await classifier.classify(
      makeMessage({ subject: "URGENT: fire" })
    );
    expect(r1.category).toBe("urgent");

    const r2 = await classifier.classify(
      makeMessage({ subject: "urgent: not matched" })
    );
    expect(r2.category).toBe("uncategorized");
  });

  it("falls back to substring match on invalid regex", async () => {
    const rules: ClassificationRule[] = [
      {
        match: { field: "subject", pattern: "[invalid(regex" },
        result: { category: "matched" },
      },
    ];
    const classifier = new RulesClassifier(rules);
    const result = await classifier.classify(
      makeMessage({ subject: "contains [invalid(regex here" })
    );
    expect(result.category).toBe("matched");
  });
});

describe("DEFAULT_RULES", () => {
  const classifier = new RulesClassifier(DEFAULT_RULES);

  it("classifies noreply sender as automated", async () => {
    const result = await classifier.classify(
      makeMessage({ from: [{ address: "noreply@service.example.com" }] })
    );
    expect(result.category).toBe("automated");
    expect(result.priority).toBe("low");
  });

  it("classifies provider promotion labels as marketing", async () => {
    const result = await classifier.classify(
      makeMessage({ labels: ["inbox", "category_promotions"] })
    );
    expect(result.category).toBe("marketing");
  });

  it("classifies receipt-like subjects", async () => {
    const result = await classifier.classify(
      makeMessage({ subject: "Your order confirmation #12345" })
    );
    expect(result.category).toBe("receipt");
  });

  it("classifies urgent subjects", async () => {
    const result = await classifier.classify(
      makeMessage({ subject: "Urgent: deploy needed ASAP" })
    );
    expect(result.category).toBe("urgent");
    expect(result.priority).toBe("high");
    expect(result.needsResponse).toBe(true);
  });

  it("classifies reply-needed from snippet", async () => {
    const result = await classifier.classify(
      makeMessage({ snippet: "Could you respond with your thoughts?" })
    );
    expect(result.category).toBe("reply-needed");
    expect(result.needsResponse).toBe(true);
  });

  it("classifies calendar invitations", async () => {
    const result = await classifier.classify(
      makeMessage({ subject: "Invitation: Team standup @ Wed Apr 9" })
    );
    expect(result.category).toBe("notification");
    expect(result.tags).toContain("calendar");
  });

  it("classifies security alerts as critical notifications", async () => {
    const result = await classifier.classify(
      makeMessage({ subject: "Bank - Someone logged into your account" })
    );
    expect(result.category).toBe("notification");
    expect(result.priority).toBe("critical");
    expect(result.tags).toContain("important");
  });

  it("classifies monthly statements as important newsletters", async () => {
    const result = await classifier.classify(
      makeMessage({ subject: "Your monthly statement is ready" })
    );
    expect(result.category).toBe("newsletter");
    expect(result.priority).toBe("high");
    expect(result.tags).toContain("important");
  });

  it("classifies tax or IRS notices as important notifications", async () => {
    const result = await classifier.classify(
      makeMessage({
        subject: "IRS CP2000 tax notice available",
        from: [{ address: "notifications@irs.gov" }],
      })
    );
    expect(result.category).toBe("notification");
    expect(result.priority).toBe("high");
    expect(result.tags).toContain("tax");
    expect(result.tags).toContain("important");
  });

  it("classifies government agency notices as important notifications", async () => {
    const result = await classifier.classify(
      makeMessage({
        subject: "AZMVD registration renewal notice",
        from: [{ address: "noreply@az.gov" }],
      })
    );
    expect(result.category).toBe("notification");
    expect(result.priority).toBe("high");
    expect(result.tags).toContain("government");
    expect(result.tags).toContain("important");
  });

  it("classifies shipment updates as important notifications", async () => {
    const result = await classifier.classify(
      makeMessage({
        subject: "UPS: Out for delivery today",
        from: [{ address: "updates@ups.com" }],
      })
    );
    expect(result.category).toBe("notification");
    expect(result.priority).toBe("high");
    expect(result.tags).toContain("shipping");
    expect(result.tags).toContain("important");
  });

  it("classifies Amazon promo emails as low-priority marketing", async () => {
    const result = await classifier.classify(
      makeMessage({
        subject: "Amazon: Sale on accessories, save 50%",
        from: [{ address: "store-news@amazon.com" }],
      })
    );
    expect(result.category).toBe("marketing");
    expect(result.priority).toBe("low");
    expect(result.tags).toContain("noise");
  });

  it("returns uncategorized for plain message", async () => {
    const result = await classifier.classify(
      makeMessage({
        subject: "Quick question about the project",
        from: [{ name: "Alice", address: "alice@example.com" }],
        snippet: "Hi, I had a quick question about the timeline.",
        labels: ["inbox"],
      })
    );
    expect(result.category).toBe("uncategorized");
  });
});

describe("createRulesClassifier", () => {
  it("uses DEFAULT_RULES when no options provided", async () => {
    const classifier = createRulesClassifier();
    const result = await classifier.classify(
      makeMessage({ from: [{ address: "noreply@example.com" }] })
    );
    expect(result.category).toBe("automated");
  });

  it("uses custom rules from options", async () => {
    const classifier = createRulesClassifier({
      rules: [
        {
          match: { field: "subject", pattern: "custom" },
          result: { category: "custom-category" },
        },
      ],
    });
    const result = await classifier.classify(
      makeMessage({ subject: "custom rule test" })
    );
    expect(result.category).toBe("custom-category");
  });
});
