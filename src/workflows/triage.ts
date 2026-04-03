/**
 * workflow triage — fetch, normalize, classify, and bucket messages.
 *
 * Output: structured JSON with messages grouped into:
 *   urgent, reply-needed, fyi, archive-candidate, noise
 */

import { getProvider } from "../core/provider.js";
import {
  createClassifier,
  PassthroughClassifier,
  type Classifier,
} from "../core/classify.js";
import { emit, log, type OutputFormat } from "../core/emit.js";
import type { FlowmeshConfig } from "../config/load.js";
import type {
  ClassifiedMessage,
  NormalizedMessage,
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
    spam: "noise",
    noise: "noise",
    junk: "noise",
  };
  return map[category] ?? "fyi";
}

export async function runTriage(options: TriageOptions): Promise<void> {
  const {
    config,
    format = "json",
  } = options;

  // Resolve source -> provider + account
  let providerName = options.provider;
  let account = options.account ?? "default";

  if (options.source && config.accounts[options.source]) {
    const acct = config.accounts[options.source];
    providerName = acct.provider;
    account = options.source;
  }

  if (!providerName) {
    throw new Error(
      "No provider specified. Use --provider or --source (matching a configured account)."
    );
  }

  const provider = getProvider(providerName);

  // Resolve classifier
  let classifier: Classifier;
  const workflowConfig = Object.values(config.workflows ?? {}).find(
    (w) => w.source === options.source
  );
  const classifierName = workflowConfig?.classifier;
  if (classifierName && config.classifiers?.[classifierName]) {
    classifier = createClassifier(config.classifiers[classifierName]);
  } else {
    classifier = new PassthroughClassifier();
  }

  // Pull
  log(`Pulling from ${providerName} (account=${account})...`);
  const rawItems = await provider.list({
    account,
    mailbox: options.mailbox,
    query: options.query,
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

  const result: TriageResult = {
    timestamp: new Date().toISOString(),
    source: options.source ?? `${providerName}/${account}`,
    totalMessages: messages.length,
    buckets,
    summary: {
      urgent: buckets["urgent"].length,
      replyNeeded: buckets["reply-needed"].length,
      fyi: buckets["fyi"].length,
      archiveCandidate: buckets["archive-candidate"].length,
      noise: buckets["noise"].length,
    },
  };

  emit(result, format);
}
