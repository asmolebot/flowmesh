/**
 * Provider adapter contract.
 *
 * Every provider implements at minimum: list + normalize.
 * get/mutate/send are optional capabilities.
 */

import type { NormalizedMessage } from "./types.js";

export interface ListParams {
  account: string;
  mailbox?: string;
  query?: string;
  since?: string;
  limit?: number;
}

export interface MutateAction {
  id: string;
  action: "archive" | "trash" | "star" | "unstar" | "read" | "unread" | "label" | "unlabel" | "move";
  target?: string; // label name, folder, etc.
  account?: string;
}

export interface MutateResult {
  id: string;
  action: string;
  success: boolean;
  error?: string;
}

/**
 * Minimum provider adapter contract.
 */
export interface ProviderAdapter {
  readonly name: string;

  /** Enumerate messages/items from a source. */
  list(params: ListParams): Promise<unknown[]>;

  /** Fetch one full item by provider-native ID. */
  get?(id: string, account: string): Promise<unknown>;

  /** Convert a raw provider item into a normalized message. */
  normalize(raw: unknown, account: string): NormalizedMessage;

  /** Apply a mutation (archive, label, move, etc.). */
  mutate?(action: MutateAction): Promise<MutateResult>;
}

/**
 * Provider registry — maps provider names to adapter instances.
 */
const registry = new Map<string, ProviderAdapter>();

export function registerProvider(adapter: ProviderAdapter): void {
  registry.set(adapter.name, adapter);
}

export function getProvider(name: string): ProviderAdapter {
  const adapter = registry.get(name);
  if (!adapter) {
    const known = [...registry.keys()].join(", ");
    throw new Error(
      `Unknown provider "${name}". Registered providers: ${known || "(none)"}`
    );
  }
  return adapter;
}

export function listProviders(): string[] {
  return [...registry.keys()].sort();
}
