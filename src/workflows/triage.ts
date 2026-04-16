/**
 * workflow triage — fetch, normalize, classify, and bucket messages.
 *
 * Output: structured JSON with messages grouped into:
 *   urgent, reply-needed, fyi, archive-candidate, noise
 *
 * With --dry-run: also emits a plan of what actions would be taken
 * on archive-candidate and noise messages.
 */

import { getProvider } from "../core/provider.js";
import {
  createClassifier,
  PassthroughClassifier,
  type Classifier,
} from "../core/classify.js";
import { emit, log, type OutputFormat } from "../core/emit.js";
import {
  resolveSource,
  findWorkflowForSource,
  type FlowmeshConfig,
} from "../config/load.js";
import {
  filterMessagesWithState,
  loadTriageState,
  persistTriageState,
} from "../core/triage-state.js";
import type {
  ClassifiedMessage,
  NormalizedMessage,
  PlannedAction,
  TriagePlan,
  TriageResult,
} from "../core/types.js";

export interface TriageOptions {
  provider?: string;
  account?: string;
  source?: string;
  mailbox?: string;
  query?: string;
  since?: string;
  limit?: number;
  format?: OutputFormat;
  dryRun?: boolean;
  statePath?: string;
  includeRead?: boolean;
  includePreviouslyNotified?: boolean;
  markReadNonImportant?: boolean;
  config: FlowmeshConfig;
}

const TRIAGE_BUCKETS = [
  "urgent",
  "reply-needed",
  "fyi",
  "archive-candidate",
  "noise",
] as const;

const DEFAULT_MARK_READ_CATEGORIES = [
  "notification",
  "marketing",
  "newsletter",
] as const;
const DEFAULT_IMPORTANT_PRIORITIES = ["critical", "high"] as const;
const DEFAULT_IMPORTANT_TAGS = ["important"] as const;

interface MarkReadPolicy {
  enabled: boolean;
  categories: Set<string>;
  importantPriorities: Set<string>;
  importantTags: Set<string>;
}

function toLowerSet(
  values: string[] | readonly string[] | undefined,
  fallback: readonly string[]
): Set<string> {
  const source = values && values.length > 0 ? values : fallback;
  return new Set(source.map((v) => v.toLowerCase()));
}

function shouldTreatAsImportant(
  entry: ClassifiedMessage,
  policy: MarkReadPolicy
): boolean {
  if (policy.importantPriorities.has(entry.classification.priority.toLowerCase())) {
    return true;
  }
  if (
    entry.classification.tags.some((tag) => policy.importantTags.has(tag.toLowerCase()))
  ) {
    return true;
  }
  if (entry.message.labels.some((label) => policy.importantTags.has(label.toLowerCase()))) {
    return true;
  }
  return false;
}

function shouldMarkRead(
  entry: ClassifiedMessage,
  policy: MarkReadPolicy
): boolean {
  if (!policy.enabled) return false;
  if (entry.message.flags.read) return false;
  if (!policy.categories.has(entry.classification.category.toLowerCase())) return false;
  return !shouldTreatAsImportant(entry, policy);
}

function bucketForCategory(category: string): string {
  const map: Record<string, string> = {
    urgent: "urgent",
    critical: "urgent",
    "reply-needed": "reply-needed",
    "human-reply-needed": "reply-needed",
    followup: "reply-needed",
    fyi: "fyi",
    informational: "fyi",
    newsletter: "archive-candidate",
    receipt: "archive-candidate",
    "archive-candidate": "archive-candidate",
    automated: "archive-candidate",
    notification: "archive-candidate",
    marketing: "archive-candidate",
    spam: "noise",
    noise: "noise",
    junk: "noise",
  };
  return map[category] ?? "fyi";
}

/**
 * Determine the planned action for a message based on its bucket.
 */
function planAction(bucket: string): "archive" | "trash" | "skip" {
  switch (bucket) {
    case "archive-candidate":
      return "archive";
    case "noise":
      return "trash";
    default:
      return "skip";
  }
}

/**
 * Build a dry-run plan from classified/bucketed messages.
 */
function buildPlan(
  buckets: Record<string, ClassifiedMessage[]>,
  markReadCandidates: ClassifiedMessage[] = []
): TriagePlan {
  const actions: PlannedAction[] = [];

  for (const [bucket, entries] of Object.entries(buckets)) {
    const action = planAction(bucket);
    if (action === "skip") continue;

    for (const entry of entries) {
      actions.push({
        messageId: entry.message.id,
        threadId: entry.message.threadId,
        subject: entry.message.subject,
        from: entry.message.from[0]?.address ?? "unknown",
        receivedAt: entry.message.receivedAt,
        bucket,
        category: entry.classification.category,
        priority: entry.classification.priority,
        confidence: entry.classification.confidence,
        reason: entry.classification.reason,
        action,
        provider: entry.message.provider,
      });
    }
  }

  for (const entry of markReadCandidates) {
    actions.push({
      messageId: entry.message.id,
      threadId: entry.message.threadId,
      subject: entry.message.subject,
      from: entry.message.from[0]?.address ?? "unknown",
      receivedAt: entry.message.receivedAt,
      bucket: bucketForCategory(entry.classification.category),
      category: entry.classification.category,
      priority: entry.classification.priority,
      confidence: entry.classification.confidence,
      reason: entry.classification.reason,
      action: "read",
      provider: entry.message.provider,
    });
  }

  return {
    dryRun: true,
    actions,
    summary: {
      archive: actions.filter((a) => a.action === "archive").length,
      trash: actions.filter((a) => a.action === "trash").length,
      read: actions.filter((a) => a.action === "read").length,
      skip: 0,
      total: actions.length,
    },
  };
}

export async function runTriage(options: TriageOptions): Promise<void> {
  const { config, format = "json" } = options;

  // Resolve source -> provider + account (with config-driven defaults)
  let providerName = options.provider;
  let account = options.account ?? "default";
  let defaultQuery: string | undefined;
  let defaultMailbox: string | undefined;
  let configMaxResults: number | undefined;

  if (options.source) {
    const resolved = resolveSource(config, options.source);
    if (resolved) {
      providerName = providerName ?? resolved.config.provider;
      account = resolved.account;
      defaultQuery = resolved.config.defaultQuery;
      defaultMailbox = resolved.config.defaultMailbox;
      if (typeof resolved.config.maxResults === "number") {
        configMaxResults = resolved.config.maxResults;
      }
    } else {
      log(
        `Source "${options.source}" not found in config accounts. ` +
          `Available: ${Object.keys(config.accounts).join(", ") || "(none)"}`
      );
    }
  }

  if (!providerName) {
    throw new Error(
      "No provider specified. Use --provider or --source (matching a configured account)."
    );
  }

  const provider = getProvider(providerName);

  // Resolve classifier from workflow config
  let classifier: Classifier;
  const workflowConfig = options.source
    ? findWorkflowForSource(config, options.source)
    : undefined;
  const classifierName = workflowConfig?.classifier;

  if (classifierName && config.classifiers?.[classifierName]) {
    classifier = createClassifier(config.classifiers[classifierName]);
  } else {
    classifier = new PassthroughClassifier();
  }

  const markReadConfig = workflowConfig?.routing?.markRead;
  const markReadPolicy: MarkReadPolicy = {
    enabled: options.markReadNonImportant === true || markReadConfig?.enabled === true,
    categories: toLowerSet(markReadConfig?.categories, DEFAULT_MARK_READ_CATEGORIES),
    importantPriorities: toLowerSet(
      markReadConfig?.importantPriorities,
      DEFAULT_IMPORTANT_PRIORITIES
    ),
    importantTags: toLowerSet(markReadConfig?.importantTags, DEFAULT_IMPORTANT_TAGS),
  };

  // Pull — merge CLI query with config defaults
  const query = options.query ?? defaultQuery;
  const mailbox = options.mailbox ?? defaultMailbox;
  const limit = options.limit ?? configMaxResults;

  log(`Pulling from ${providerName} (account=${account})...`);
  const rawItems = await provider.list({
    account,
    mailbox,
    query,
    since: options.since,
    limit,
  });

  // Normalize
  const normalizedMessages: NormalizedMessage[] = rawItems.map((raw) =>
    provider.normalize(raw, account)
  );
  log(`Normalized ${normalizedMessages.length} messages`);

  const triageState = await loadTriageState({
    path: options.statePath,
    suppressRead: options.includeRead ? false : true,
    suppressPreviouslyNotified: options.includePreviouslyNotified ? false : true,
  });
  const filtered = filterMessagesWithState(normalizedMessages, triageState);
  const messages = filtered.messages;

  if (filtered.suppressedReadCount > 0) {
    log(`Suppressed ${filtered.suppressedReadCount} read messages`);
  }
  if (filtered.suppressedPreviouslyNotifiedCount > 0) {
    log(
      `Suppressed ${filtered.suppressedPreviouslyNotifiedCount} previously notified messages`
    );
  }

  // Classify + bucket
  const buckets: Record<string, ClassifiedMessage[]> = {};
  for (const b of TRIAGE_BUCKETS) {
    buckets[b] = [];
  }

  const classifiedEntries: ClassifiedMessage[] = [];
  for (const message of messages) {
    const classification = await classifier.classify(message);
    const bucket = bucketForCategory(classification.category);
    const entry: ClassifiedMessage = { message, classification };
    classifiedEntries.push(entry);
    if (!buckets[bucket]) buckets[bucket] = [];
    buckets[bucket].push(entry);
  }

  const markReadCandidates = classifiedEntries.filter((entry) =>
    shouldMarkRead(entry, markReadPolicy)
  );

  const classifierLabel = classifierName ?? "passthrough";

  let markReadAttempted = 0;
  let markReadSucceeded = 0;
  let markReadFailed = 0;

  const result: TriageResult = {
    schemaVersion: "1",
    timestamp: new Date().toISOString(),
    source: options.source ?? `${providerName}/${account}`,
    provider: providerName,
    account,
    totalMessages: messages.length,
    buckets,
    summary: {
      urgent: buckets["urgent"].length,
      replyNeeded: buckets["reply-needed"].length,
      fyi: buckets["fyi"].length,
      archiveCandidate: buckets["archive-candidate"].length,
      noise: buckets["noise"].length,
    },
    state: {
      path: triageState.path,
      suppressRead: triageState.suppressRead,
      suppressedReadCount: filtered.suppressedReadCount,
      suppressPreviouslyNotified: triageState.suppressPreviouslyNotified,
      suppressedPreviouslyNotifiedCount: filtered.suppressedPreviouslyNotifiedCount,
      notifiedMessageIds: messages.map((message) => message.id),
      ...(markReadPolicy.enabled
        ? {
            markReadAttempted,
            markReadSucceeded,
            markReadFailed,
          }
        : {}),
    },
    classifierUsed: classifierLabel,
  };

  // Add dry-run plan if requested
  if (options.dryRun) {
    result.plan = buildPlan(
      buckets,
      markReadPolicy.enabled ? markReadCandidates : []
    );
    log(
      `Dry-run plan: ${result.plan.summary.archive} archive, ${result.plan.summary.trash} trash, ${result.plan.summary.read} mark-read`
    );
  } else {
    if (markReadPolicy.enabled && markReadCandidates.length > 0) {
      if (!provider.mutate) {
        markReadFailed = markReadCandidates.length;
        log(
          `Provider ${providerName} does not support mutate(); skipped ${markReadFailed} mark-read candidate(s)`
        );
      } else {
        for (const entry of markReadCandidates) {
          markReadAttempted += 1;
          const mutateResult = await provider.mutate({
            id: entry.message.id,
            action: "read",
            account: entry.message.account,
          });
          if (mutateResult.success) {
            markReadSucceeded += 1;
          } else {
            markReadFailed += 1;
            log(
              `mark-read failed for ${entry.message.id}: ${mutateResult.error ?? "unknown error"}`
            );
          }
        }
        log(
          `Marked read ${markReadSucceeded}/${markReadCandidates.length} non-important ${
            [...markReadPolicy.categories].join(",")
          } message(s)`
        );
      }
    }

    if (result.state && markReadPolicy.enabled) {
      result.state.markReadAttempted = markReadAttempted;
      result.state.markReadSucceeded = markReadSucceeded;
      result.state.markReadFailed = markReadFailed;
    }

    await persistTriageState(triageState, messages);
  }

  emit(result, format);
}
