/**
 * Rule-based classifier — matches messages against configurable pattern rules.
 *
 * Rules are defined in config, not hardcoded. Each rule specifies:
 *   - field(s) to match against (subject, from, labels, snippet)
 *   - pattern (regex or substring)
 *   - resulting category, priority, tags
 *
 * Rules are evaluated in order; the first match wins.
 * If no rule matches, falls back to "uncategorized".
 *
 * Config shape:
 *   kind: rules
 *   options:
 *     rules:
 *       - match: { field: "subject", pattern: "^(Re|Fwd):" }
 *         result: { category: "reply-needed", priority: "medium" }
 *       - match: { field: "from", pattern: "noreply@" }
 *         result: { category: "automated", priority: "low" }
 */

import type { ClassifierResult, NormalizedMessage } from "./types.js";
import type { Classifier } from "./classify.js";

export interface RuleMatch {
  /** Field to match against. */
  field: "subject" | "from" | "to" | "labels" | "snippet" | "bodyText";
  /** Regex pattern (case-insensitive by default). */
  pattern: string;
  /** If true, match is case-sensitive. Default: false (case-insensitive). */
  caseSensitive?: boolean;
}

export interface RuleResultSpec {
  category: string;
  priority?: ClassifierResult["priority"];
  tags?: string[];
  needsResponse?: boolean;
  reason?: string;
}

export interface ClassificationRule {
  /** Human-readable name for this rule (for logging/debugging). */
  name?: string;
  match: RuleMatch | RuleMatch[];
  /** If multiple match conditions, require all (default) or any. */
  matchMode?: "all" | "any";
  result: RuleResultSpec;
}

/**
 * Extract the string value of a message field for matching.
 */
function getFieldValue(
  message: NormalizedMessage,
  field: RuleMatch["field"]
): string {
  switch (field) {
    case "subject":
      return message.subject;
    case "from":
      return message.from.map((a) => `${a.name ?? ""} ${a.address}`).join(", ");
    case "to":
      return message.to.map((a) => `${a.name ?? ""} ${a.address}`).join(", ");
    case "labels":
      return message.labels.join(", ");
    case "snippet":
      return message.snippet;
    case "bodyText":
      return message.bodyText ?? "";
  }
}

function testMatch(message: NormalizedMessage, match: RuleMatch): boolean {
  const value = getFieldValue(message, match.field);
  const flags = match.caseSensitive ? "" : "i";
  try {
    return new RegExp(match.pattern, flags).test(value);
  } catch {
    // Invalid regex — treat as literal substring match
    return match.caseSensitive
      ? value.includes(match.pattern)
      : value.toLowerCase().includes(match.pattern.toLowerCase());
  }
}

function evaluateRule(
  message: NormalizedMessage,
  rule: ClassificationRule
): boolean {
  const matches = Array.isArray(rule.match) ? rule.match : [rule.match];
  const mode = rule.matchMode ?? "all";
  return mode === "all"
    ? matches.every((m) => testMatch(message, m))
    : matches.some((m) => testMatch(message, m));
}

/**
 * Rule-based classifier. Evaluates rules in order; first match wins.
 */
export class RulesClassifier implements Classifier {
  constructor(private rules: ClassificationRule[]) {}

  async classify(message: NormalizedMessage): Promise<ClassifierResult> {
    for (const rule of this.rules) {
      if (evaluateRule(message, rule)) {
        return {
          category: rule.result.category,
          priority: rule.result.priority ?? "medium",
          confidence: 1.0, // rule-based = deterministic
          tags: rule.result.tags ?? [],
          needsResponse: rule.result.needsResponse ?? false,
          dueAt: null,
          reason: rule.result.reason ?? `Matched rule: ${rule.name ?? "unnamed"}`,
        };
      }
    }
    // No rule matched
    return {
      category: "uncategorized",
      priority: "medium",
      confidence: 0,
      tags: [],
      needsResponse: false,
      dueAt: null,
      reason: "No classification rule matched",
    };
  }
}

/**
 * A set of sensible default rules that work generically across providers.
 * These rules use common email patterns, not personal/domain-specific logic.
 *
 * Intended as a baseline when no custom rules are configured.
 */
export const DEFAULT_RULES: ClassificationRule[] = [
  {
    name: "urgent-keywords",
    match: { field: "subject", pattern: "^urgent[:\\s]|\\bASAP\\b|\\bemergency\\b" },
    result: {
      category: "urgent",
      priority: "high",
      tags: ["urgent", "important"],
      needsResponse: true,
      reason: "Subject contains urgency indicators",
    },
  },
  {
    name: "direct-reply-request",
    match: {
      field: "snippet",
      pattern:
        "please reply|could you.*respond|let me know|your thoughts\\??|can you confirm",
    },
    result: {
      category: "reply-needed",
      priority: "medium",
      tags: ["action-requested"],
      needsResponse: true,
      reason: "Message body suggests a response is expected",
    },
  },
  {
    name: "security-notification-important",
    match: {
      field: "subject",
      pattern:
        "logged into your account|new login|security alert|fraud alert|unusual activity|password reset|verification code|\\bmfa\\b|two[- ]factor|\\b2fa\\b|\\botp\\b",
    },
    result: {
      category: "notification",
      priority: "critical",
      tags: ["notification", "security", "important"],
      reason: "Security/account access alert",
    },
  },
  {
    name: "tax-irs-important",
    match: [
      {
        field: "subject",
        pattern:
          "\\birs\\b|internal revenue service|tax notice|tax return|tax transcript|state tax|department of revenue|franchise tax board|cp\\d{2,4}|1099|w-2",
      },
      {
        field: "from",
        pattern:
          "\\birs\\b|@irs\\.gov|@azdor\\.gov|@az\\.gov|@ftb\\.ca\\.gov|@ca\\.gov|department of revenue|franchise tax board",
      },
    ],
    matchMode: "any",
    result: {
      category: "notification",
      priority: "high",
      tags: ["notification", "tax", "government", "important"],
      reason: "Tax or IRS/government revenue communication",
    },
  },
  {
    name: "government-agency-important",
    match: [
      {
        field: "subject",
        pattern:
          "\\bazmvd\\b|\\bdmv\\b|motor vehicle division|department of motor vehicles|state of arizona|state of california|official notice|compliance notice|citation|registration renewal",
      },
      {
        field: "from",
        pattern:
          "@az\\.gov|@ca\\.gov|\\.gov>|\\bgov\\b|azmvd|dmv|motor vehicle division|state of arizona|state of california",
      },
    ],
    matchMode: "any",
    result: {
      category: "notification",
      priority: "high",
      tags: ["notification", "government", "important"],
      reason: "Official government agency communication",
    },
  },
  {
    name: "school-attendance-important",
    match: {
      field: "subject",
      pattern:
        "checked out of school|attendance alert|absence notice|absent today|tardy|pickup alert|dismissal alert",
    },
    result: {
      category: "notification",
      priority: "high",
      tags: ["notification", "school", "important"],
      reason: "School attendance or dismissal alert",
    },
  },
  {
    name: "school-newsletter-important",
    match: [
      { field: "subject", pattern: "newsletter" },
      {
        field: "subject",
        pattern:
          "school|academy|district|lutheran|country day|elementary|middle school|high school",
      },
    ],
    result: {
      category: "newsletter",
      priority: "high",
      tags: ["newsletter", "school", "important"],
      reason: "School newsletter likely requires review",
    },
  },
  {
    name: "financial-statement-important",
    match: {
      field: "subject",
      pattern:
        "monthly statement|statement available|account statement|your statement is ready",
    },
    result: {
      category: "newsletter",
      priority: "high",
      tags: ["newsletter", "financial", "important"],
      reason: "Account statement should be reviewed",
    },
  },
  {
    name: "financial-account-alert-important",
    match: {
      field: "subject",
      pattern:
        "payment due|past due|overdraft|insufficient funds|account alert|large purchase|charge alert|transaction alert|payment reminder",
    },
    result: {
      category: "notification",
      priority: "high",
      tags: ["notification", "financial", "important"],
      reason: "Important account or payment alert",
    },
  },
  {
    name: "shipment-delivery-important",
    match: [
      {
        field: "from",
        pattern: "ups|fedex|usps|amazon|ontrac|dhl",
      },
      {
        field: "subject",
        pattern:
          "shipment|tracking|out for delivery|arriving today|arrives today|delivered|delivery update|delivery exception|package",
      },
    ],
    result: {
      category: "notification",
      priority: "high",
      tags: ["notification", "shipping", "important"],
      reason: "Shipment or delivery status update",
    },
  },
  {
    name: "social-notification-noise",
    match: [
      { field: "from", pattern: "linkedin|facebook|instagram|twitter|x\\.com" },
      {
        field: "subject",
        pattern: "someone mentioned you|weekly summary|new follower|people are talking",
      },
    ],
    matchMode: "any",
    result: {
      category: "notification",
      priority: "low",
      tags: ["notification", "social"],
      reason: "Low-priority social platform notification",
    },
  },
  {
    name: "amazon-marketing-noise",
    match: [
      { field: "from", pattern: "amazon" },
      {
        field: "subject",
        pattern:
          "\\bsale\\b|deals? for you|recommendation|new arrivals|prime day|limited time|coupon|save \\\d+%",
      },
    ],
    result: {
      category: "marketing",
      priority: "low",
      tags: ["marketing", "noise"],
      reason: "Amazon promotional content",
    },
  },
  {
    name: "promotions-label-marketing",
    match: { field: "labels", pattern: "category_promotions" },
    result: {
      category: "marketing",
      priority: "low",
      tags: ["marketing"],
      reason: "Provider categorized as promotions",
    },
  },
  {
    name: "marketing-keywords",
    match: {
      field: "subject",
      pattern:
        "\\b\\d{1,3}%\\b|limited time|special offer|promo(?:tion)?|\\bsale\\b|\\bdeal\\b|discount|max plans?|upgrade now",
    },
    result: {
      category: "marketing",
      priority: "low",
      tags: ["marketing"],
      reason: "Subject contains promotional language",
    },
  },
  {
    name: "newsletter-digest",
    match: [
      { field: "labels", pattern: "category_updates" },
      {
        field: "subject",
        pattern: "weekly digest|daily digest|weekly summary|newsletter|monthly newsletter",
      },
    ],
    matchMode: "any",
    result: {
      category: "newsletter",
      priority: "low",
      tags: ["newsletter"],
      reason: "Digest/newsletter content",
    },
  },
  {
    name: "notification-service",
    match: {
      field: "from",
      pattern: "notification|alert|digest@|updates@|mailer-daemon",
    },
    result: {
      category: "notification",
      priority: "low",
      tags: ["notification"],
      reason: "Sender pattern suggests automated notification",
    },
  },
  {
    name: "receipt-order",
    match: {
      field: "subject",
      pattern: "receipt|invoice|order confirm|order #|payment|transaction",
    },
    result: {
      category: "receipt",
      priority: "low",
      tags: ["receipt", "financial"],
      reason: "Subject suggests a receipt or order confirmation",
    },
  },
  {
    name: "noreply-automated",
    match: { field: "from", pattern: "noreply@|no-reply@|donotreply@" },
    result: {
      category: "automated",
      priority: "low",
      tags: ["automated"],
      reason: "Sender is a noreply address",
    },
  },
  {
    name: "calendar-event",
    match: {
      field: "subject",
      pattern: "invitation:|accepted:|declined:|updated:|canceled:",
    },
    result: {
      category: "notification",
      priority: "low",
      tags: ["calendar"],
      reason: "Calendar event notification",
    },
  },
];

/**
 * Create a RulesClassifier from config options.
 * If no rules are provided, uses DEFAULT_RULES.
 */
export function createRulesClassifier(
  options?: Record<string, unknown>
): RulesClassifier {
  const rules = (options?.["rules"] as ClassificationRule[] | undefined) ?? DEFAULT_RULES;
  return new RulesClassifier(rules);
}
