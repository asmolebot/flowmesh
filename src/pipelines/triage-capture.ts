/**
 * Triage capture — runs the flowmesh triage workflow and returns
 * the TriageResult as a value (instead of emitting to stdout).
 *
 * This is the bridge between the existing triage workflow and the
 * pilot runner, which needs the result as data for comparison.
 */

import { getProvider } from "../core/provider.js";
import {
  createClassifier,
  PassthroughClassifier,
  type Classifier,
} from "../core/classify.js";
import { log } from "../core/emit.js";
import {
  resolveSource,
  findWorkflowForSource,
  type FlowmeshConfig,
} from "../config/load.js";
import type {
  ClassifiedMessage,
  NormalizedMessage,
  TriageResult,
} from "../core/types.js";

export interface TriageCaptureOptions {
  provider?: string;
  account?: string;
  source?: string;
  mailbox?: string;
  query?: string;
  since?: string;
  limit?: number;
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
 * Run triage and return the result as data (no stdout emission).
 */
export async function runTriageCapture(
  options: TriageCaptureOptions
): Promise<TriageResult> {
  const { config } = options;

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

  const messages: NormalizedMessage[] = rawItems.map((raw) =>
    provider.normalize(raw, account)
  );
  log(`Normalized ${messages.length} messages`);

  const buckets: Record<string, ClassifiedMessage[]> = {};
  for (const b of TRIAGE_BUCKETS) {
    buckets[b] = [];
  }

  for (const message of messages) {
    const classification = await classifier.classify(message);
    const bucket = bucketForCategory(classification.category);
    if (!buckets[bucket]) buckets[bucket] = [];
    buckets[bucket].push({ message, classification });
  }

  const classifierLabel = classifierName ?? "passthrough";

  return {
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
}
