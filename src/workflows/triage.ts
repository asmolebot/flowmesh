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
  config: FlowmeshConfig;
}

const TRIAGE_BUCKETS = [
  "urgent",
  "reply-needed",
  "fyi",
  "archive-candidate",
  "noise",
] as const;

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
  buckets: Record<string, ClassifiedMessage[]>
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

  return {
    dryRun: true,
    actions,
    summary: {
      archive: actions.filter((a) => a.action === "archive").length,
      trash: actions.filter((a) => a.action === "trash").length,
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

  if (options.source) {
    const resolved = resolveSource(config, options.source);
    if (resolved) {
      providerName = providerName ?? resolved.config.provider;
      account = resolved.account;
      defaultQuery = resolved.config.defaultQuery;
      defaultMailbox = resolved.config.defaultMailbox;
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

  // Pull — merge CLI query with config defaults
  const query = options.query ?? defaultQuery;
  const mailbox = options.mailbox ?? defaultMailbox;

  log(`Pulling from ${providerName} (account=${account})...`);
  const rawItems = await provider.list({
    account,
    mailbox,
    query,
    since: options.since,
    limit: options.limit,
  });

  // Normalize
  const messages: NormalizedMessage[] = rawItems.map((raw) =>
    provider.normalize(raw, account)
  );
  log(`Normalized ${messages.length} messages`);

  // Classify + bucket
  const buckets: Record<string, ClassifiedMessage[]> = {};
  for (const b of TRIAGE_BUCKETS) {
    buckets[b] = [];
  }

  for (const message of messages) {
    const classification = await classifier.classify(message);
    const bucket = bucketForCategory(classification.category);
    const entry: ClassifiedMessage = { message, classification };
    if (!buckets[bucket]) buckets[bucket] = [];
    buckets[bucket].push(entry);
  }

  const classifierLabel = classifierName ?? "passthrough";

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
    classifierUsed: classifierLabel,
  };

  // Add dry-run plan if requested
  if (options.dryRun) {
    result.plan = buildPlan(buckets);
    log(
      `Dry-run plan: ${result.plan.summary.archive} archive, ${result.plan.summary.trash} trash`
    );
  }

  emit(result, format);
}
