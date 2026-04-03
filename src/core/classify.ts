/**
 * Classifier hook contract.
 *
 * Classifiers accept normalized messages (JSON on stdin)
 * and return ClassifierResult (JSON on stdout).
 *
 * Supported backends:
 *   - shell: external command (stdin/stdout JSON)
 *   - rules: local rules file (future)
 *   - llm: LLM wrapper (future)
 *   - mcp: MCP tool (future)
 *
 * For now, we provide a passthrough stub and a shell executor.
 */

import { spawn } from "node:child_process";
import type { ClassifierResult, NormalizedMessage } from "./types.js";

export interface ClassifierConfig {
  kind: "shell" | "rules" | "llm" | "mcp" | "passthrough";
  command?: string[];
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
 * Shell classifier — invokes an external command, passing the normalized
 * message as JSON on stdin, expecting ClassifierResult JSON on stdout.
 */
export class ShellClassifier implements Classifier {
  constructor(private command: string[]) {
    if (command.length === 0) {
      throw new Error("Shell classifier requires a non-empty command array");
    }
  }

  async classify(message: NormalizedMessage): Promise<ClassifierResult> {
    const input = JSON.stringify(message);
    const [cmd, ...args] = this.command;

    return new Promise((resolve, reject) => {
      const child = spawn(cmd, args, { timeout: 30_000 });
      let stdout = "";
      let stderr = "";

      child.stdout.on("data", (chunk: Buffer) => { stdout += chunk.toString(); });
      child.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });

      child.on("error", reject);
      child.on("close", (code) => {
        if (code !== 0) {
          reject(new Error(`Classifier exited with code ${code}: ${stderr}`));
          return;
        }
        try {
          resolve(JSON.parse(stdout) as ClassifierResult);
        } catch {
          reject(new Error(`Failed to parse classifier output: ${stdout}`));
        }
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
      return new ShellClassifier(config.command);
    case "passthrough":
      return new PassthroughClassifier();
    case "rules":
    case "llm":
    case "mcp":
      // Future backends — fall through to passthrough for now
      console.error(
        `[flowmesh] classifier kind "${config.kind}" not yet implemented, using passthrough`
      );
      return new PassthroughClassifier();
    default:
      throw new Error(`Unknown classifier kind: ${config.kind}`);
  }
}
