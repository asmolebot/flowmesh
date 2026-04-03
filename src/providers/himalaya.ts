/**
 * Himalaya provider adapter — wraps the himalaya CLI.
 *
 * This is a stub that demonstrates the contract.
 * Real implementation will exec `himalaya` commands and parse output.
 */

import type { NormalizedMessage } from "../core/types.js";
import type { ListParams, ProviderAdapter } from "../core/provider.js";
import { warn } from "../core/emit.js";

export class HimalayaAdapter implements ProviderAdapter {
  readonly name = "himalaya";

  async list(params: ListParams): Promise<unknown[]> {
    warn(
      `himalaya.list stub called (account=${params.account}, mailbox=${params.mailbox ?? "INBOX"})`
    );
    // Real implementation: exec himalaya CLI and parse JSON output
    return [];
  }

  async get(id: string, account: string): Promise<unknown> {
    warn(`himalaya.get stub called (id=${id}, account=${account})`);
    return {};
  }

  normalize(raw: unknown, account: string): NormalizedMessage {
    const r = raw as Record<string, unknown>;
    return {
      id: String(r["id"] ?? ""),
      provider: "himalaya",
      account,
      mailbox: String(r["folder"] ?? "INBOX"),
      threadId: r["threadId"] as string | undefined,
      subject: String(r["subject"] ?? ""),
      from: normalizeHimalayaAddresses(r["from"]),
      to: normalizeHimalayaAddresses(r["to"]),
      cc: normalizeHimalayaAddresses(r["cc"]),
      receivedAt: String(r["date"] ?? new Date().toISOString()),
      snippet: String(r["preview"] ?? r["snippet"] ?? ""),
      bodyText: r["body"] as string | undefined,
      bodyHtml: r["bodyHtml"] as string | null | undefined,
      labels: Array.isArray(r["flags"]) ? r["flags"] : [],
      attachments: Array.isArray(r["attachments"]) ? r["attachments"] : [],
      flags: {
        read: !arrayIncludes(r["flags"], "new"),
        starred: arrayIncludes(r["flags"], "flagged"),
        archived: false,
      },
      refs: {
        providerId: String(r["id"] ?? ""),
        providerThreadId: r["messageId"] as string | undefined,
      },
      meta: { rawSource: r },
    };
  }
}

function normalizeHimalayaAddresses(
  value: unknown
): { name?: string; address: string }[] {
  if (!value) return [];
  if (typeof value === "string") {
    return [{ address: value }];
  }
  if (Array.isArray(value)) {
    return value.map((v) =>
      typeof v === "string" ? { address: v } : (v as { name?: string; address: string })
    );
  }
  return [];
}

function arrayIncludes(value: unknown, item: string): boolean {
  return Array.isArray(value) && value.includes(item);
}
