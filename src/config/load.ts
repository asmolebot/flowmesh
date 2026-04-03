/**
 * Config loader — reads flowmesh YAML config files.
 */

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parse as parseYaml } from "yaml";
import type { ClassifierConfig } from "../core/classify.js";

export interface AccountConfig {
  provider: string;
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

const DEFAULT_CONFIG_PATHS = [
  "config.flowmesh.yaml",
  "config.flowmesh.yml",
  ".flowmesh.yaml",
  ".flowmesh.yml",
];

export async function loadConfig(
  explicitPath?: string
): Promise<FlowmeshConfig> {
  if (explicitPath) {
    return readConfigFile(explicitPath);
  }

  for (const candidate of DEFAULT_CONFIG_PATHS) {
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
