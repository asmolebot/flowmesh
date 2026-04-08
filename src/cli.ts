#!/usr/bin/env node

/**
 * flowmesh CLI — generic workflow/inbox automation toolkit.
 */

import { Command } from "commander";
import { registerAllProviders } from "./providers/index.js";
import { listProviders } from "./core/provider.js";
import { emitJson, log } from "./core/emit.js";
import { loadConfig } from "./config/load.js";
import { runTriage } from "./workflows/triage.js";
import { runPilot, type PilotEngine } from "./pipelines/pilot.js";
import { compareTriageResults } from "./pipelines/compare.js";
import { parseLegacyOutput } from "./pipelines/legacy-capture.js";
import type { OutputFormat } from "./core/emit.js";
import type { TriageResult } from "./core/types.js";

registerAllProviders();

const program = new Command();

program
  .name("flowmesh")
  .description("Generic workflow/inbox automation toolkit")
  .version("0.1.0");

// --- providers ---

const providers = program.command("providers").description("Provider operations");

providers
  .command("list")
  .description("List registered provider adapters")
  .action(() => {
    emitJson({ providers: listProviders() });
  });

// --- workflow ---

const workflow = program.command("workflow").description("Run a named workflow");

workflow
  .command("triage")
  .description("Classify recent messages into actionable buckets")
  .option("--provider <name>", "Provider adapter name")
  .option("--account <name>", "Account identifier")
  .option("--source <name>", "Config-defined source/account name")
  .option("--mailbox <name>", "Mailbox/folder name")
  .option("--query <query>", "Provider-specific query string")
  .option("--since <duration>", "Time window (e.g. 2h, 1d)")
  .option("--limit <n>", "Max messages to fetch", parseInt)
  .option("--format <fmt>", "Output format: json or jsonl", "json")
  .option("--json", "Shorthand for --format json")
  .option("--dry-run", "Show planned actions without executing mutations")
  .option("--state-path <path>", "Persist/read notified-message state from this file")
  .option("--include-read", "Include read messages instead of suppressing them")
  .option(
    "--include-previously-notified",
    "Include messages already seen in prior triage runs"
  )
  .option("--config <path>", "Path to config file")
  .action(async (opts) => {
    try {
      const config = await loadConfig(opts.config);
      await runTriage({
        provider: opts.provider,
        account: opts.account,
        source: opts.source,
        mailbox: opts.mailbox,
        query: opts.query,
        since: opts.since,
        limit: opts.limit,
        format: (opts.json ? "json" : opts.format) as OutputFormat,
        dryRun: opts.dryRun,
        statePath: opts.statePath,
        includeRead: opts.includeRead,
        includePreviouslyNotified: opts.includePreviouslyNotified,
        config,
      });
    } catch (err) {
      log(`Error: ${err instanceof Error ? err.message : String(err)}`);
      process.exit(3);
    }
  });

// --- pilot ---

const pilot = program.command("pilot").description("Pilot: run flowmesh alongside legacy and compare");

pilot
  .command("run")
  .description("Run triage with engine selection (flowmesh, legacy, or compare)")
  .option("--engine <engine>", "Engine: flowmesh, legacy, or compare", "compare")
  .option("--provider <name>", "Provider adapter name")
  .option("--account <name>", "Account identifier")
  .option("--source <name>", "Config-defined source/account name")
  .option("--mailbox <name>", "Mailbox/folder name")
  .option("--query <query>", "Provider-specific query string")
  .option("--since <duration>", "Time window (e.g. 2h, 1d)")
  .option("--limit <n>", "Max messages to fetch", parseInt)
  .option("--format <fmt>", "Output format: json or jsonl", "json")
  .option("--json", "Shorthand for --format json")
  .option("--dry-run", "Show planned actions without executing mutations")
  .option("--state-path <path>", "Persist/read notified-message state from this file")
  .option("--include-read", "Include read messages instead of suppressing them")
  .option(
    "--include-previously-notified",
    "Include messages already seen in prior triage runs"
  )
  .option("--config <path>", "Path to config file")
  .option("--legacy-cmd <cmd>", "Legacy command to run (space-separated)")
  .option("--legacy-file <path>", "Path to legacy output JSON file")
  .option("--legacy-timeout <ms>", "Legacy command timeout in ms", parseInt)
  .option("--out <dir>", "Directory to persist timestamped result artifacts (bakeoff mode)")
  .action(async (opts) => {
    try {
      const engine = opts.engine as PilotEngine;
      if (!["flowmesh", "legacy", "compare"].includes(engine)) {
        log(`Invalid engine: ${engine}. Must be flowmesh, legacy, or compare.`);
        process.exit(3);
      }

      await runPilot({
        engine,
        provider: opts.provider,
        account: opts.account,
        source: opts.source,
        mailbox: opts.mailbox,
        query: opts.query,
        since: opts.since,
        limit: opts.limit,
        format: (opts.json ? "json" : opts.format) as OutputFormat,
        dryRun: opts.dryRun,
        statePath: opts.statePath,
        includeRead: opts.includeRead,
        includePreviouslyNotified: opts.includePreviouslyNotified,
        configPath: opts.config,
        legacyCmd: opts.legacyCmd ? opts.legacyCmd.split(" ") : undefined,
        legacyFile: opts.legacyFile,
        legacyTimeout: opts.legacyTimeout,
        outDir: opts.out,
      });
    } catch (err) {
      log(`Error: ${err instanceof Error ? err.message : String(err)}`);
      process.exit(3);
    }
  });

pilot
  .command("compare")
  .description("Compare two triage output files (offline diff)")
  .argument("<flowmesh-file>", "Path to flowmesh triage output JSON")
  .argument("<legacy-file>", "Path to legacy triage output JSON")
  .option("--format <fmt>", "Output format: json or jsonl", "json")
  .option("--json", "Shorthand for --format json")
  .action(async (flowmeshFile: string, legacyFile: string, opts) => {
    try {
      const { readFile } = await import("node:fs/promises");
      const fmRaw = await readFile(flowmeshFile, "utf-8");
      const lgRaw = await readFile(legacyFile, "utf-8");

      let fmResult: TriageResult;
      try {
        fmResult = JSON.parse(fmRaw) as TriageResult;
      } catch {
        log(`Failed to parse flowmesh file: ${flowmeshFile}`);
        process.exit(3);
        return;
      }

      const lgResult = parseLegacyOutput(lgRaw);
      const report = compareTriageResults(fmResult, lgResult);
      const format = (opts.json ? "json" : opts.format) as OutputFormat;
      const { emit } = await import("./core/emit.js");
      emit(report, format);
    } catch (err) {
      log(`Error: ${err instanceof Error ? err.message : String(err)}`);
      process.exit(3);
    }
  });

// --- schema ---

program
  .command("schema")
  .description("Print schema information")
  .argument("<name>", "Schema name (e.g. normalized-message)")
  .action(async (name: string) => {
    if (name === "normalized-message") {
      const { readFile } = await import("node:fs/promises");
      const { fileURLToPath } = await import("node:url");
      const { dirname, join } = await import("node:path");
      const dir = dirname(fileURLToPath(import.meta.url));
      try {
        const schema = await readFile(
          join(dir, "..", "docs", "normalized-message.schema.json"),
          "utf-8"
        );
        process.stdout.write(schema + "\n");
      } catch {
        // Try from project root
        try {
          const schema = await readFile(
            join(process.cwd(), "docs", "normalized-message.schema.json"),
            "utf-8"
          );
          process.stdout.write(schema + "\n");
        } catch {
          log("Schema file not found");
          process.exit(3);
        }
      }
    } else {
      log(`Unknown schema: ${name}`);
      process.exit(3);
    }
  });

// --- doctor ---

program
  .command("doctor")
  .description("Check environment and config health")
  .option("--config <path>", "Path to config file")
  .action(async (opts) => {
    const checks: { name: string; status: string; detail?: string }[] = [];

    // Check Node version
    const nodeVersion = process.version;
    const major = parseInt(nodeVersion.slice(1));
    checks.push({
      name: "node",
      status: major >= 20 ? "ok" : "warn",
      detail: nodeVersion,
    });

    // Check providers
    const providerList = listProviders();
    checks.push({
      name: "providers",
      status: providerList.length > 0 ? "ok" : "warn",
      detail: providerList.join(", "),
    });

    // Check config
    try {
      const config = await loadConfig(opts.config);
      const accountCount = Object.keys(config.accounts).length;
      checks.push({
        name: "config",
        status: accountCount > 0 ? "ok" : "warn",
        detail: `${accountCount} account(s) configured`,
      });
    } catch (err) {
      checks.push({
        name: "config",
        status: "error",
        detail: err instanceof Error ? err.message : String(err),
      });
    }

    emitJson({ checks });
  });

program.parse();
