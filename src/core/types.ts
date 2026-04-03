/**
 * Normalized message envelope — the common shape all providers map into.
 * Aligned with docs/normalized-message.schema.json.
 */

export interface Address {
  name?: string;
  address: string;
}

export interface Attachment {
  filename: string;
  mimeType: string;
  size?: number;
}

export interface MessageFlags {
  read: boolean;
  starred: boolean;
  archived: boolean;
}

export interface MessageRefs {
  providerId: string;
  providerThreadId?: string;
}

export interface NormalizedMessage {
  id: string;
  provider: string;
  account: string;
  mailbox: string;
  threadId?: string;
  subject: string;
  from: Address[];
  to: Address[];
  cc: Address[];
  receivedAt: string; // ISO 8601
  snippet: string;
  bodyText?: string;
  bodyHtml?: string | null;
  labels: string[];
  attachments: Attachment[];
  flags: MessageFlags;
  refs: MessageRefs;
  meta: Record<string, unknown>;
}

/**
 * Classifier output shape — produced by any classification hook.
 */
export interface ClassifierResult {
  category: string;
  priority: "critical" | "high" | "medium" | "low" | "none";
  confidence: number;
  tags: string[];
  needsResponse: boolean;
  dueAt?: string | null;
  reason: string;
  meta?: Record<string, unknown>;
}

/**
 * A message enriched with classification data.
 */
export interface ClassifiedMessage {
  message: NormalizedMessage;
  classification: ClassifierResult;
}

/**
 * Triage workflow output — grouped classified messages.
 *
 * The schemaVersion field allows downstream consumers to detect format changes.
 * The provider/account/mailbox metadata enables automation routing.
 */
export interface TriageResult {
  /** Schema version for this output format. Bump on breaking changes. */
  schemaVersion: "1";
  timestamp: string;
  source: string;
  /** Provider that produced the messages. */
  provider: string;
  /** Account used for the pull. */
  account: string;
  totalMessages: number;
  buckets: Record<string, ClassifiedMessage[]>;
  summary: {
    urgent: number;
    replyNeeded: number;
    fyi: number;
    archiveCandidate: number;
    noise: number;
  };
  /** Classifier used (name or "passthrough"). */
  classifierUsed: string;
  /** Dry-run action plan for archive/noise candidates (when --dry-run is used) */
  plan?: TriagePlan;
}

/**
 * Planned action for a single message (dry-run output).
 */
export interface PlannedAction {
  messageId: string;
  threadId?: string;
  subject: string;
  from: string;
  receivedAt: string;
  bucket: string;
  category: string;
  priority: ClassifierResult["priority"];
  confidence: number;
  reason: string;
  action: "archive" | "trash" | "skip";
  /** Provider name for downstream mutation dispatch. */
  provider: string;
}

/**
 * Dry-run plan — structured output describing what triage *would* do.
 */
export interface TriagePlan {
  dryRun: true;
  actions: PlannedAction[];
  summary: {
    archive: number;
    trash: number;
    skip: number;
    total: number;
  };
}
