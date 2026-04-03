/**
 * Classifier hook contract.
 *
 * Classifiers accept normalized messages and return ClassifierResult.
 *
 * Supported backends:
 *   - passthrough: no-op, assigns "uncategorized" (default fallback)
 *   - shell: external command (JSON on stdin, ClassifierResult JSON on stdout)
 *   - rules: local rules file (future)
 *   - llm: LLM wrapper (future)
 *   - mcp: MCP tool (future)
 *
 * The shell classifier contract:
 *   Input (stdin):  JSON object — a NormalizedMessage
 *   Output (stdout): JSON object — a ClassifierResult
 *   Exit code 0: success
 *   Exit code non-0: classifier error (falls back to passthrough if configured)
 *
 * Expected ClassifierResult shape:
 *   { category, priority, confidence, tags, needsResponse, dueAt?, reason, meta? }
 */

import { spawn } from "node:child_process";
import type { ClassifierResult, NormalizedMessage } from "./types.js";
import { warn } from "./emit.js";

export interface ClassifierConfig {
  kind: "shell" | "rules" | "llm" | "mcp" | "passthrough";
  command?: string[];
  /** If true, fall back to passthrough on classifier errors instead of throwing */
  fallbackOnError?: boolean;
  options?: Record<string, unknown>;
}

export interface Classifier {
  classify(message: NormalizedMessage): Promise<ClassifierResult>;
}

/**
 * Default passthrough classifier — assigns "uncategorized" to everything.
 * Useful as a no-op fallback when no classifier is configured.
 */
export class PassthroughClassifier implements Classifier {
  async classify(_message: NormalizedMessage): Promise<ClassifierResult> {
    return {
      category: "uncategorized",
      priority: "medium",
      confidence: 0,
      tags: [],
      needsResponse: false,
      dueAt: null,
      reason: "No classifier configured",
    };
  }
}

/**
 * Validate that an object looks like a ClassifierResult.
 * Returns the object cast to ClassifierResult if valid, throws otherwise.
 */
function validateClassifierResult(obj: unknown): ClassifierResult {
  if (!obj || typeof obj !== "object") {
    throw new Error("Classifier output is not an object");
  }
  const r = obj as Record<string, unknown>;
  if (typeof r["category"] !== "string") {
    throw new Error("Classifier output missing 'category' string field");
  }
  // Provide defaults for optional fields to be lenient
  return {
    category: r["category"] as string,
    priority: (r["priority"] as ClassifierResult["priority"]) ?? "medium",
    confidence: typeof r["confidence"] === "number" ? r["confidence"] : 0,
    tags: Array.isArray(r["tags"]) ? r["tags"] : [],
    needsResponse: Boolean(r["needsResponse"]),
    dueAt: (r["dueAt"] as string | null) ?? null,
    reason: typeof r["reason"] === "string" ? r["reason"] : "",
    meta: (r["meta"] as Record<string, unknown>) ?? undefined,
  };
}

/**
 * Shell classifier — invokes an external command, passing the normalized
 * message as JSON on stdin, expecting ClassifierResult JSON on stdout.
 */
export class ShellClassifier implements Classifier {
  private fallbackOnError: boolean;

  constructor(
    private command: string[],
    options?: { fallbackOnError?: boolean }
  ) {
    if (command.length === 0) {
      throw new Error("Shell classifier requires a non-empty command array");
    }
    this.fallbackOnError = options?.fallbackOnError ?? false;
  }

  async classify(message: NormalizedMessage): Promise<ClassifierResult> {
    const input = JSON.stringify(message);
    const [cmd, ...args] = this.command;

    try {
      const raw = await this.exec(cmd, args, input);
      const parsed = JSON.parse(raw);
      return validateClassifierResult(parsed);
    } catch (err) {
      if (this.fallbackOnError) {
        warn(
          `Shell classifier failed, using passthrough: ${err instanceof Error ? err.message : String(err)}`
        );
        return new PassthroughClassifier().classify(message);
      }
      throw err;
    }
  }

  private exec(cmd: string, args: string[], input: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const child = spawn(cmd, args, { timeout: 30_000 });
      let stdout = "";
      let stderr = "";

      child.stdout.on("data", (chunk: Buffer) => {
        stdout += chunk.toString();
      });
      child.stderr.on("data", (chunk: Buffer) => {
        stderr += chunk.toString();
      });

      child.on("error", reject);
      child.on("close", (code) => {
        if (code !== 0) {
          reject(
            new Error(`Classifier exited with code ${code}: ${stderr}`)
          );
          return;
        }
        resolve(stdout);
      });

      child.stdin.on("error", () => {
        // Ignore EPIPE — the child may have exited before reading all input
      });
      child.stdin.write(input);
      child.stdin.end();
    });
  }
}

/**
 * Create a classifier from config.
 */
export function createClassifier(config: ClassifierConfig): Classifier {
  switch (config.kind) {
    case "shell":
      if (!config.command || config.command.length === 0) {
        throw new Error("Shell classifier requires a 'command' array");
      }
      return new ShellClassifier(config.command, {
        fallbackOnError: config.fallbackOnError,
      });
    case "passthrough":
      return new PassthroughClassifier();
    case "rules":
    case "llm":
    case "mcp":
      // Future backends — fall through to passthrough for now
      warn(
        `Classifier kind "${config.kind}" not yet implemented, using passthrough`
      );
      return new PassthroughClassifier();
    default:
      throw new Error(`Unknown classifier kind: ${config.kind}`);
  }
}
