/**
 * IMAP provider adapter — generic direct mailbox access.
 *
 * This is a stub that demonstrates the contract.
 * Real implementation will use an IMAP library or CLI wrapper.
 */

import type { NormalizedMessage } from "../core/types.js";
import type { ListParams, ProviderAdapter } from "../core/provider.js";
import { warn } from "../core/emit.js";

export class ImapAdapter implements ProviderAdapter {
  readonly name = "imap";

  async list(params: ListParams): Promise<unknown[]> {
    warn(
      `imap.list stub called (account=${params.account}, mailbox=${params.mailbox ?? "INBOX"})`
    );
    // Real implementation: connect to IMAP server, fetch envelope list
    return [];
  }

  async get(id: string, account: string): Promise<unknown> {
    warn(`imap.get stub called (id=${id}, account=${account})`);
    return {};
  }

  normalize(raw: unknown, account: string): NormalizedMessage {
    const r = raw as Record<string, unknown>;
    return {
      id: String(r["uid"] ?? r["id"] ?? ""),
      provider: "imap",
      account,
      mailbox: String(r["mailbox"] ?? "INBOX"),
      subject: String(r["subject"] ?? ""),
      from: Array.isArray(r["from"]) ? r["from"] : [],
      to: Array.isArray(r["to"]) ? r["to"] : [],
      cc: Array.isArray(r["cc"]) ? r["cc"] : [],
      receivedAt: String(r["date"] ?? new Date().toISOString()),
      snippet: String(r["snippet"] ?? ""),
      bodyText: r["bodyText"] as string | undefined,
      bodyHtml: r["bodyHtml"] as string | null | undefined,
      labels: [],
      attachments: Array.isArray(r["attachments"]) ? r["attachments"] : [],
      flags: {
        read: Boolean(r["seen"]),
        starred: Boolean(r["flagged"]),
        archived: false,
      },
      refs: {
        providerId: String(r["uid"] ?? r["id"] ?? ""),
        providerThreadId: r["messageId"] as string | undefined,
      },
      meta: { rawSource: r },
    };
  }
}
