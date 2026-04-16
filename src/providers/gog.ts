/**
 * gog provider adapter — wraps the gog CLI for Gmail/Workspace access.
 *
 * Uses `gog gmail messages search` for list() and `gog gmail get` for get().
 * All account/query parameters are passed through from config/CLI args.
 *
 * Hardened for real-world usage:
 *   - Detects missing gog binary (ENOENT)
 *   - Handles non-JSON output (auth prompts, HTML errors)
 *   - Structured error classification for callers
 *   - Timeout and stderr forwarding
 */

import { execFile } from "node:child_process";
import type { NormalizedMessage, Address } from "../core/types.js";
import type {
  ListParams,
  MutateAction,
  MutateResult,
  ProviderAdapter,
} from "../core/provider.js";
import { log } from "../core/emit.js";

/** Shape returned by `gog gmail messages search --json` */
export interface GogSearchResult {
  messages?: GogRawMessage[];
  nextPageToken?: string;
}

/** Single message from gog search output */
export interface GogRawMessage {
  id: string;
  threadId: string;
  date: string; // e.g. "2026-04-03 10:25"
  from: string; // e.g. "Name <email@example.com>"
  subject: string;
  labels: string[];
  body?: string;
  snippet?: string;
}

/** Shape returned by `gog gmail get --json` */
export interface GogGetResult {
  body?: string;
  headers?: {
    from?: string;
    to?: string;
    cc?: string;
    bcc?: string;
    date?: string;
    subject?: string;
  };
  message?: {
    id: string;
    threadId?: string;
    labelIds?: string[];
    internalDate?: string;
    snippet?: string;
    sizeEstimate?: number;
    payload?: {
      headers?: Array<{ name: string; value: string }>;
      parts?: unknown[];
      body?: unknown;
    };
  };
}

/** Structured error from the gog adapter so callers can react programmatically. */
export class GogError extends Error {
  constructor(
    message: string,
    public readonly code: GogErrorCode,
    public readonly detail?: string
  ) {
    super(message);
    this.name = "GogError";
  }
}

export type GogErrorCode =
  | "NOT_INSTALLED"   // gog binary not found on PATH
  | "AUTH_REQUIRED"   // gog output suggests re-authentication
  | "TIMEOUT"         // command exceeded deadline
  | "INVALID_OUTPUT"  // stdout is not valid JSON
  | "COMMAND_FAILED"  // non-zero exit with stderr
  | "EMPTY_RESPONSE"; // no stdout produced

/**
 * Parse "Name <email>" or bare "email" into an Address.
 */
export function parseAddress(raw: string): Address {
  const trimmed = raw.trim();
  const match = trimmed.match(/^(.+?)\s*<(.+?)>$/);
  if (match) {
    return { name: match[1].trim(), address: match[2].trim() };
  }
  return { address: trimmed };
}

/**
 * Parse a comma-separated address list, handling quoted names with commas.
 */
function parseAddressList(raw: string | undefined): Address[] {
  if (!raw || raw.trim() === "") return [];
  // Split on comma-space that is NOT inside angle brackets
  const parts: string[] = [];
  let current = "";
  let depth = 0;
  for (const ch of raw) {
    if (ch === "<") depth++;
    if (ch === ">") depth--;
    if (ch === "," && depth === 0) {
      parts.push(current.trim());
      current = "";
    } else {
      current += ch;
    }
  }
  if (current.trim()) parts.push(current.trim());
  return parts.filter(Boolean).map(parseAddress);
}

/**
 * Convert gog date formats to ISO 8601.
 * Handles: "2026-04-03 10:25" and RFC 2822 "Fri, 03 Apr 2026 17:25:16 +0000 (UTC)"
 */
function parseDate(raw: string): string {
  if (!raw) return new Date().toISOString();
  // Try direct Date parse (works for RFC 2822)
  const d = new Date(raw);
  if (!isNaN(d.getTime())) return d.toISOString();
  // Try "YYYY-MM-DD HH:MM" (gog search format, local time)
  const match = raw.match(/^(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2})$/);
  if (match) {
    return new Date(`${match[1]}T${match[2]}:00`).toISOString();
  }
  return new Date().toISOString();
}

/** Heuristic: does the gog output look like an auth/login prompt? */
function looksLikeAuthError(text: string): boolean {
  const lower = text.toLowerCase();
  return (
    lower.includes("authorization") ||
    lower.includes("authenticate") ||
    lower.includes("login required") ||
    lower.includes("oauth") ||
    lower.includes("token expired") ||
    lower.includes("credentials")
  );
}

const GOG_TIMEOUT_MS = 60_000;
const GOG_MAX_BUFFER = 10 * 1024 * 1024;

function execGog(args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      "gog",
      args,
      { timeout: GOG_TIMEOUT_MS, maxBuffer: GOG_MAX_BUFFER },
      (err, stdout, stderr) => {
        if (stderr) {
          for (const line of stderr.split("\n").filter(Boolean)) {
            log(`gog: ${line}`);
          }
        }
        if (err) {
          // Detect missing binary
          if ((err as NodeJS.ErrnoException).code === "ENOENT") {
            reject(
              new GogError(
                "gog binary not found on PATH. Install gog or check your $PATH.",
                "NOT_INSTALLED"
              )
            );
            return;
          }
          // Detect timeout
          if (err.killed || err.message?.includes("TIMEOUT")) {
            reject(
              new GogError(
                `gog command timed out after ${GOG_TIMEOUT_MS / 1000}s`,
                "TIMEOUT",
                args.join(" ")
              )
            );
            return;
          }
          // Check for auth issues in stderr or stdout
          const combined = (stderr ?? "") + (stdout ?? "");
          if (looksLikeAuthError(combined)) {
            reject(
              new GogError(
                "gog requires authentication. Run `gog auth` or check credentials.",
                "AUTH_REQUIRED",
                combined.slice(0, 500)
              )
            );
            return;
          }
          reject(
            new GogError(
              `gog command failed (exit): ${err.message}`,
              "COMMAND_FAILED",
              stderr?.slice(0, 500)
            )
          );
          return;
        }
        resolve(stdout);
      }
    );
  });
}

/**
 * Attempt to parse JSON from gog stdout, raising structured errors
 * for non-JSON responses (HTML error pages, auth prompts, empty output).
 */
function parseGogJson<T>(stdout: string, context: string): T {
  const trimmed = stdout.trim();
  if (!trimmed) {
    throw new GogError(
      `gog produced empty output for ${context}`,
      "EMPTY_RESPONSE"
    );
  }
  // Detect HTML (error pages from API gateway, etc.)
  if (trimmed.startsWith("<") || trimmed.startsWith("<!")) {
    throw new GogError(
      `gog returned HTML instead of JSON for ${context} — possible API/proxy error`,
      "INVALID_OUTPUT",
      trimmed.slice(0, 300)
    );
  }

  try {
    return JSON.parse(trimmed) as T;
  } catch {
    // Only classify stdout as an auth problem if it failed JSON parsing.
    // Otherwise normal inbox content like "OAuth application" in a subject line
    // can falsely trip auth detection on valid gog JSON output.
    if (looksLikeAuthError(trimmed)) {
      throw new GogError(
        "gog requires authentication. Run `gog auth` or check credentials.",
        "AUTH_REQUIRED",
        trimmed.slice(0, 300)
      );
    }
    throw new GogError(
      `gog output is not valid JSON for ${context}`,
      "INVALID_OUTPUT",
      trimmed.slice(0, 300)
    );
  }
}

export class GogAdapter implements ProviderAdapter {
  readonly name = "gog";

  async list(params: ListParams): Promise<GogRawMessage[]> {
    const query = params.query ?? "label:inbox";
    const args = ["gmail", "messages", "search", query, "--json", "--no-input"];

    if (params.account) {
      args.push("--account", params.account);
    }
    if (params.limit) {
      args.push("--max", String(params.limit));
    }

    log(`Executing: gog ${args.join(" ")}`);
    const stdout = await execGog(args);

    const parsed = parseGogJson<GogSearchResult>(stdout, "messages search");
    return parsed.messages ?? [];
  }

  async get(id: string, account: string): Promise<GogGetResult> {
    const args = ["gmail", "get", id, "--json", "--no-input"];
    if (account) {
      args.push("--account", account);
    }

    log(`Executing: gog ${args.join(" ")}`);
    const stdout = await execGog(args);
    return parseGogJson<GogGetResult>(stdout, `get ${id}`);
  }

  async mutate(action: MutateAction): Promise<MutateResult> {
    const id = action.id?.trim();
    if (!id) {
      return {
        id: action.id,
        action: action.action,
        success: false,
        error: "Missing message id",
      };
    }

    const args = ["gmail"];
    switch (action.action) {
      case "read":
        args.push("mark-read", id);
        break;
      case "unread":
        args.push("unread", id);
        break;
      case "archive":
        args.push("archive", id);
        break;
      case "trash":
        args.push("trash", id);
        break;
      default:
        return {
          id,
          action: action.action,
          success: false,
          error: `Unsupported gog mutate action: ${action.action}`,
        };
    }

    args.push("--json", "--no-input");
    if (action.account) {
      args.push("--account", action.account);
    }

    try {
      log(`Executing: gog ${args.join(" ")}`);
      await execGog(args);
      return {
        id,
        action: action.action,
        success: true,
      };
    } catch (err) {
      return {
        id,
        action: action.action,
        success: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  normalize(raw: unknown, account: string): NormalizedMessage {
    const r = raw as GogRawMessage;
    const labels = (r.labels ?? []).map((l) => l.toLowerCase());
    const isRead = !labels.includes("unread");
    const isStarred = labels.includes("starred");
    const isArchived = !labels.includes("inbox");

    return {
      id: String(r.id ?? ""),
      provider: "gog",
      account,
      mailbox: labels.includes("inbox") ? "INBOX" : labels[0] ?? "unknown",
      threadId: r.threadId,
      subject: String(r.subject ?? ""),
      from: r.from ? [parseAddress(r.from)] : [],
      to: [],
      cc: [],
      receivedAt: parseDate(r.date),
      snippet: String(r.snippet ?? r.body?.slice(0, 200) ?? ""),
      bodyText: r.body,
      bodyHtml: null,
      labels,
      attachments: [],
      flags: {
        read: isRead,
        starred: isStarred,
        archived: isArchived,
      },
      refs: {
        providerId: String(r.id ?? ""),
        providerThreadId: r.threadId,
      },
      meta: { rawSource: r },
    };
  }

  /**
   * Normalize a full message from `gog gmail get --json`.
   */
  normalizeGetResult(raw: GogGetResult, account: string): NormalizedMessage {
    const msg = raw.message ?? ({} as NonNullable<GogGetResult["message"]>);
    const headers = raw.headers ?? {};
    const labels = (msg.labelIds ?? []).map((l: string) => l.toLowerCase());
    const isRead = !labels.includes("unread");
    const isStarred = labels.includes("starred");
    const isArchived = !labels.includes("inbox");

    const receivedAt = msg.internalDate
      ? new Date(Number(msg.internalDate)).toISOString()
      : parseDate(headers.date ?? "");

    return {
      id: String(msg.id ?? ""),
      provider: "gog",
      account,
      mailbox: labels.includes("inbox") ? "INBOX" : labels[0] ?? "unknown",
      threadId: (msg as Record<string, unknown>).threadId as string | undefined,
      subject: String(headers.subject ?? ""),
      from: parseAddressList(headers.from),
      to: parseAddressList(headers.to),
      cc: parseAddressList(headers.cc),
      receivedAt,
      snippet: String(msg.snippet ?? raw.body?.slice(0, 200) ?? ""),
      bodyText: raw.body,
      bodyHtml: null,
      labels,
      attachments: [],
      flags: {
        read: isRead,
        starred: isStarred,
        archived: isArchived,
      },
      refs: {
        providerId: String(msg.id ?? ""),
        providerThreadId: (msg as Record<string, unknown>).threadId as string | undefined,
      },
      meta: { rawSource: raw },
    };
  }
}
