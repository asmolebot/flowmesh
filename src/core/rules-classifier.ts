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
    name: "unsubscribe-newsletter",
    match: [
      { field: "labels", pattern: "category_promotions|category_updates" },
    ],
    matchMode: "any",
    result: {
      category: "newsletter",
      priority: "low",
      tags: ["newsletter"],
      reason: "Message categorized as promotion/update by provider",
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
      pattern:
        "receipt|invoice|order confirm|order #|payment|statement|transaction",
    },
    result: {
      category: "receipt",
      priority: "low",
      tags: ["receipt", "financial"],
      reason: "Subject suggests a receipt or order confirmation",
    },
  },
  {
    name: "urgent-keywords",
    match: { field: "subject", pattern: "^urgent[:\\s]|\\bASAP\\b|\\bemergency\\b" },
    result: {
      category: "urgent",
      priority: "high",
      tags: ["urgent"],
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
    name: "calendar-event",
    match: { field: "subject", pattern: "invitation:|accepted:|declined:|updated:|canceled:" },
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
