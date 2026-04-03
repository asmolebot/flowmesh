/**
 * Config loader — reads flowmesh YAML config files.
 *
 * Supports source alias resolution: a source name maps to an account entry
 * in config, carrying provider, default query, and other provider-specific options.
 */

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { homedir } from "node:os";
import { parse as parseYaml } from "yaml";
import type { ClassifierConfig } from "../core/classify.js";

export interface AccountConfig {
  provider: string;
  /** Provider-specific default query (e.g. Gmail query syntax) */
  defaultQuery?: string;
  /** Provider-specific default mailbox */
  defaultMailbox?: string;
  [key: string]: unknown;
}

export interface WorkflowConfig {
  source: string;
  classifier?: string;
  routing?: {
    archiveCategories?: string[];
    escalateCategories?: string[];
  };
  [key: string]: unknown;
}

export interface FlowmeshConfig {
  accounts: Record<string, AccountConfig>;
  classifiers?: Record<string, ClassifierConfig>;
  workflows?: Record<string, WorkflowConfig>;
}

/**
 * Resolve a source alias to its account config.
 * Returns the account config and the resolved account key, or undefined if not found.
 */
export function resolveSource(
  config: FlowmeshConfig,
  source: string
): { account: string; config: AccountConfig } | undefined {
  const acct = config.accounts[source];
  if (acct) return { account: source, config: acct };
  return undefined;
}

/**
 * Find the workflow config that references a given source.
 */
export function findWorkflowForSource(
  config: FlowmeshConfig,
  source: string
): WorkflowConfig | undefined {
  if (!config.workflows) return undefined;
  return Object.values(config.workflows).find((w) => w.source === source);
}

const DEFAULT_CONFIG_PATHS = [
  "config.flowmesh.yaml",
  "config.flowmesh.yml",
  ".flowmesh.yaml",
  ".flowmesh.yml",
];

/**
 * XDG-style config paths (checked after local paths).
 */
function xdgConfigPaths(): string[] {
  const xdgHome = process.env["XDG_CONFIG_HOME"] ?? resolve(homedir(), ".config");
  return [
    resolve(xdgHome, "flowmesh", "config.yaml"),
    resolve(xdgHome, "flowmesh", "config.yml"),
  ];
}

export async function loadConfig(
  explicitPath?: string
): Promise<FlowmeshConfig> {
  if (explicitPath) {
    return readConfigFile(explicitPath);
  }

  // Try local paths first, then XDG
  const candidates = [...DEFAULT_CONFIG_PATHS, ...xdgConfigPaths()];
  for (const candidate of candidates) {
    try {
      return await readConfigFile(candidate);
    } catch {
      // try next candidate
    }
  }

  // Return empty config if no file found
  return { accounts: {} };
}

async function readConfigFile(path: string): Promise<FlowmeshConfig> {
  const abs = resolve(path);
  const raw = await readFile(abs, "utf-8");
  const parsed = parseYaml(raw) as FlowmeshConfig;
  if (!parsed || typeof parsed !== "object") {
    throw new Error(`Invalid config file: ${abs}`);
  }
  return {
    ...parsed,
    accounts: parsed.accounts ?? {},
  };
}
