/**
 * Output formatters — JSON and JSONL to stdout.
 * Logs/warnings go to stderr per CLI contract.
 */

export type OutputFormat = "json" | "jsonl";

export function emitJson(data: unknown): void {
  process.stdout.write(JSON.stringify(data, null, 2) + "\n");
}

export function emitJsonl(items: unknown[]): void {
  for (const item of items) {
    process.stdout.write(JSON.stringify(item) + "\n");
  }
}

export function emit(data: unknown, format: OutputFormat): void {
  if (format === "jsonl" && Array.isArray(data)) {
    emitJsonl(data);
  } else {
    emitJson(data);
  }
}

/** Log to stderr (not stdout) */
export function log(message: string): void {
  process.stderr.write(`[flowmesh] ${message}\n`);
}

/** Warn to stderr */
export function warn(message: string): void {
  process.stderr.write(`[flowmesh] WARN: ${message}\n`);
}
