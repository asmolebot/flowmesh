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
 */
export interface TriageResult {
  timestamp: string;
  source: string;
  totalMessages: number;
  buckets: Record<string, ClassifiedMessage[]>;
  summary: {
    urgent: number;
    replyNeeded: number;
    fyi: number;
    archiveCandidate: number;
    noise: number;
  };
}
