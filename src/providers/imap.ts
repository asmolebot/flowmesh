/**
 * IMAP provider adapter — generic direct mailbox access via imapflow.
 *
 * Connection parameters come from config (host, port, user, pass/authRef).
 * This adapter supports list() and get() against any standard IMAP server.
 *
 * Config shape (in accounts section):
 *   provider: imap
 *   host: imap.example.com
 *   port: 993          # optional, defaults to 993
 *   tls: true          # optional, defaults to true
 *   username: user@example.com
 *   password: ...      # or use authRef for external credential lookup
 */

import { ImapFlow } from "imapflow";
import type {
  FetchMessageObject,
  MessageEnvelopeObject,
  MessageAddressObject,
} from "imapflow";
import type { NormalizedMessage, Address, Attachment } from "../core/types.js";
import type { ListParams, ProviderAdapter } from "../core/provider.js";
import { log } from "../core/emit.js";

/** Structured error from the IMAP adapter. */
export class ImapError extends Error {
  constructor(
    message: string,
    public readonly code: ImapErrorCode,
    public readonly detail?: string
  ) {
    super(message);
    this.name = "ImapError";
  }
}

export type ImapErrorCode =
  | "CONNECTION_FAILED"
  | "AUTH_FAILED"
  | "MAILBOX_NOT_FOUND"
  | "TIMEOUT"
  | "FETCH_ERROR"
  | "NOT_CONFIGURED";

/** IMAP connection config extracted from account config. */
export interface ImapConnectionConfig {
  host: string;
  port?: number;
  tls?: boolean;
  username: string;
  password?: string;
}

/**
 * Extract IMAP connection config from the generic account config record.
 */
export function extractImapConfig(
  accountConfig: Record<string, unknown>
): ImapConnectionConfig {
  const host = accountConfig["host"];
  const username = accountConfig["username"];
  if (typeof host !== "string" || !host) {
    throw new ImapError(
      "IMAP account config missing 'host'",
      "NOT_CONFIGURED"
    );
  }
  if (typeof username !== "string" || !username) {
    throw new ImapError(
      "IMAP account config missing 'username'",
      "NOT_CONFIGURED"
    );
  }
  return {
    host,
    port:
      typeof accountConfig["port"] === "number"
        ? accountConfig["port"]
        : 993,
    tls: accountConfig["tls"] !== false,
    username,
    password:
      typeof accountConfig["password"] === "string"
        ? accountConfig["password"]
        : undefined,
  };
}

/** Convert imapflow MessageAddressObject[] to our Address[]. */
function convertAddresses(addrs?: MessageAddressObject[]): Address[] {
  if (!addrs) return [];
  return addrs
    .filter((a) => a.address)
    .map((a) => ({
      ...(a.name ? { name: a.name } : {}),
      address: a.address!,
    }));
}

/**
 * Convert a FetchMessageObject from imapflow into our NormalizedMessage shape.
 */
export function normalizeImapMessage(
  msg: FetchMessageObject,
  account: string,
  mailbox: string,
  bodyText?: string
): NormalizedMessage {
  const env: MessageEnvelopeObject = msg.envelope ?? {};
  const flags = msg.flags ?? new Set<string>();

  const from = convertAddresses(env.from);
  const to = convertAddresses(env.to);
  const cc = convertAddresses(env.cc);

  const receivedAt = msg.internalDate
    ? new Date(msg.internalDate).toISOString()
    : env.date
      ? new Date(env.date).toISOString()
      : new Date().toISOString();

  // Extract attachments from bodyStructure if available
  const attachments: Attachment[] = [];
  if (msg.bodyStructure) {
    extractAttachments(msg.bodyStructure as unknown as Record<string, unknown>, attachments);
  }

  return {
    id: String(msg.uid),
    provider: "imap",
    account,
    mailbox,
    threadId: env.inReplyTo ?? undefined,
    subject: env.subject ?? "",
    from,
    to,
    cc,
    receivedAt,
    snippet: bodyText?.slice(0, 200) ?? "",
    bodyText: bodyText ?? undefined,
    bodyHtml: null,
    labels: [...flags].map((f) => String(f).toLowerCase()),
    attachments,
    flags: {
      read: flags.has("\\Seen"),
      starred: flags.has("\\Flagged"),
      archived: false, // IMAP doesn't have a native archive flag
    },
    refs: {
      providerId: String(msg.uid),
      providerThreadId: env.messageId ?? undefined,
    },
    meta: {
      seq: msg.seq,
      size: msg.size,
      imapFlags: [...flags],
    },
  };
}

/** Recursively extract attachment info from BODYSTRUCTURE. */
function extractAttachments(
  structure: Record<string, unknown>,
  out: Attachment[]
): void {
  const disposition = structure["disposition"] as string | undefined;
  if (disposition === "attachment" || disposition === "inline") {
    const params = (structure["dispositionParameters"] ??
      structure["parameters"] ??
      {}) as Record<string, string>;
    const filename =
      params["filename"] ?? params["name"] ?? "unnamed";
    const type = structure["type"] as string | undefined;
    const subtype = structure["subtype"] as string | undefined;
    const mimeType = type && subtype ? `${type}/${subtype}` : "application/octet-stream";
    const size = structure["size"] as number | undefined;
    out.push({ filename, mimeType, ...(size != null ? { size } : {}) });
  }
  // Recurse into childNodes
  const children = structure["childNodes"] as Record<string, unknown>[] | undefined;
  if (Array.isArray(children)) {
    for (const child of children) {
      extractAttachments(child, out);
    }
  }
}

const IMAP_TIMEOUT_MS = 30_000;

export class ImapAdapter implements ProviderAdapter {
  readonly name = "imap";

  /**
   * Connection config — set via setConnectionConfig() before calling list/get,
   * or passed through the account config at runtime.
   */
  private connectionConfig?: ImapConnectionConfig;

  /** Allow pre-setting connection config (useful for testing). */
  setConnectionConfig(config: ImapConnectionConfig): void {
    this.connectionConfig = config;
  }

  private async createClient(
    accountConfig?: Record<string, unknown>
  ): Promise<ImapFlow> {
    const cfg =
      this.connectionConfig ??
      (accountConfig ? extractImapConfig(accountConfig) : null);
    if (!cfg) {
      throw new ImapError(
        "IMAP connection not configured. Provide host/username in account config.",
        "NOT_CONFIGURED"
      );
    }

    const client = new ImapFlow({
      host: cfg.host,
      port: cfg.port ?? 993,
      secure: cfg.tls !== false,
      auth: {
        user: cfg.username,
        pass: cfg.password ?? "",
      },
      logger: false, // suppress internal imapflow logs
    });

    try {
      await Promise.race([
        client.connect(),
        new Promise<never>((_, reject) =>
          setTimeout(
            () => reject(new ImapError("IMAP connection timed out", "TIMEOUT")),
            IMAP_TIMEOUT_MS
          )
        ),
      ]);
    } catch (err) {
      if (err instanceof ImapError) throw err;
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.toLowerCase().includes("auth") || msg.toLowerCase().includes("login")) {
        throw new ImapError(
          `IMAP authentication failed: ${msg}`,
          "AUTH_FAILED",
          msg
        );
      }
      throw new ImapError(
        `IMAP connection failed: ${msg}`,
        "CONNECTION_FAILED",
        msg
      );
    }

    return client;
  }

  async list(
    params: ListParams,
    accountConfig?: Record<string, unknown>
  ): Promise<FetchMessageObject[]> {
    const mailbox = params.mailbox ?? "INBOX";
    log(`imap: connecting to fetch from ${mailbox} (account=${params.account})`);

    const client = await this.createClient(accountConfig);
    const results: FetchMessageObject[] = [];

    try {
      const lock = await client.getMailboxLock(mailbox);
      try {
        const limit = params.limit ?? 50;
        // Fetch the most recent N messages by sequence number
        const total =
          typeof client.mailbox === "object" && client.mailbox
            ? (client.mailbox as { exists?: number }).exists ?? 0
            : 0;
        const start = Math.max(1, total - limit + 1);
        const range = `${start}:*`;

        for await (const msg of client.fetch(range, {
          uid: true,
          flags: true,
          envelope: true,
          internalDate: true,
          bodyStructure: true,
          size: true,
        })) {
          results.push(msg);
        }
      } finally {
        lock.release();
      }
    } catch (err) {
      if (err instanceof ImapError) throw err;
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("Mailbox") || msg.includes("not found") || msg.includes("does not exist")) {
        throw new ImapError(
          `Mailbox "${mailbox}" not found`,
          "MAILBOX_NOT_FOUND",
          msg
        );
      }
      throw new ImapError(`IMAP fetch failed: ${msg}`, "FETCH_ERROR", msg);
    } finally {
      try {
        await client.logout();
      } catch {
        // ignore logout errors
      }
    }

    log(`imap: fetched ${results.length} messages from ${mailbox}`);
    return results;
  }

  async get(
    id: string,
    account: string,
    accountConfig?: Record<string, unknown>
  ): Promise<FetchMessageObject | null> {
    const client = await this.createClient(accountConfig);

    try {
      const lock = await client.getMailboxLock("INBOX");
      try {
        const msg = await client.fetchOne(id, {
          uid: true,
          flags: true,
          envelope: true,
          internalDate: true,
          bodyStructure: true,
          size: true,
          source: true,
        });
        return msg || null;
      } finally {
        lock.release();
      }
    } finally {
      try {
        await client.logout();
      } catch {
        // ignore
      }
    }
  }

  normalize(raw: unknown, account: string): NormalizedMessage {
    // Detect a real imapflow FetchMessageObject: has uid + seq + flags as Set
    if (
      raw &&
      typeof raw === "object" &&
      "uid" in (raw as object) &&
      "seq" in (raw as object) &&
      (raw as Record<string, unknown>)["flags"] instanceof Set
    ) {
      return normalizeImapMessage(
        raw as FetchMessageObject,
        account,
        "INBOX"
      );
    }
    // Fallback: plain object normalization (for fixtures / legacy stubs / external tools)
    return normalizePlainObject(raw, account);
  }
}

/**
 * Fallback normalizer for plain-object IMAP data (fixtures, external tools).
 * Accepts a generic record with common IMAP envelope fields.
 */
function normalizePlainObject(
  raw: unknown,
  account: string
): NormalizedMessage {
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
    labels: Array.isArray(r["flags"])
      ? (r["flags"] as string[]).map((f) => String(f).toLowerCase())
      : [],
    attachments: Array.isArray(r["attachments"]) ? r["attachments"] : [],
    flags: {
      read: Boolean(r["seen"] ?? r["read"]),
      starred: Boolean(r["flagged"] ?? r["starred"]),
      archived: false,
    },
    refs: {
      providerId: String(r["uid"] ?? r["id"] ?? ""),
      providerThreadId: r["messageId"] as string | undefined,
    },
    meta: { rawSource: r },
  };
}
