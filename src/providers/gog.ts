/**
 * gog provider adapter — wraps the gog CLI for Gmail/Workspace access.
 *
 * This is a stub that demonstrates the contract.
 * Real implementation will exec `gog` CLI commands and parse output.
 */

import type { NormalizedMessage } from "../core/types.js";
import type { ListParams, ProviderAdapter } from "../core/provider.js";
import { warn } from "../core/emit.js";

export class GogAdapter implements ProviderAdapter {
  readonly name = "gog";

  async list(params: ListParams): Promise<unknown[]> {
    warn(
      `gog.list stub called (account=${params.account}, query=${params.query ?? "none"})`
    );
    // Real implementation: exec gog CLI and parse JSON output
    return [];
  }

  async get(id: string, account: string): Promise<unknown> {
    warn(`gog.get stub called (id=${id}, account=${account})`);
    return {};
  }

  normalize(raw: unknown, account: string): NormalizedMessage {
    const r = raw as Record<string, unknown>;
    return {
      id: String(r["id"] ?? ""),
      provider: "gog",
      account,
      mailbox: String(r["mailbox"] ?? "INBOX"),
      threadId: r["threadId"] as string | undefined,
      subject: String(r["subject"] ?? ""),
      from: Array.isArray(r["from"]) ? r["from"] : [],
      to: Array.isArray(r["to"]) ? r["to"] : [],
      cc: Array.isArray(r["cc"]) ? r["cc"] : [],
      receivedAt: String(r["receivedAt"] ?? new Date().toISOString()),
      snippet: String(r["snippet"] ?? ""),
      bodyText: r["bodyText"] as string | undefined,
      bodyHtml: r["bodyHtml"] as string | null | undefined,
      labels: Array.isArray(r["labels"]) ? r["labels"] : [],
      attachments: Array.isArray(r["attachments"]) ? r["attachments"] : [],
      flags: {
        read: Boolean(r["read"]),
        starred: Boolean(r["starred"]),
        archived: Boolean(r["archived"]),
      },
      refs: {
        providerId: String(r["id"] ?? ""),
        providerThreadId: r["threadId"] as string | undefined,
      },
      meta: { rawSource: r },
    };
  }
}
