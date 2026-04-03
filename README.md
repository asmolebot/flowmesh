# flowmesh

A generic workflow/inbox automation toolkit for message sources, classification, and action pipelines.

`flowmesh` is designed to sit between messy provider APIs and higher-level automation/orchestration.
It is intentionally **not** tied to any specific personal inbox, hardcoded address, or one-off naming scheme.

## Goals

- Wrap multiple inbox/message providers behind small composable commands
- Normalize provider-specific payloads into one stable JSON shape
- Make classification, routing, and action steps pluggable
- Work cleanly with cron, Lobster-style pipelines, shell scripts, and orchestrators
- Keep provider-specific addresses, accounts, folders, labels, and identities in config/args rather than code

## Non-goals

- Monolithic personal assistant logic
- Hardcoded mailbox names, email addresses, or user-specific categories
- Giant all-in-one daemon as the first step

## Suggested Repo Shape

```text
flowmesh/
  README.md
  docs/
    architecture.md
    cli.md
    workflows.md
    config.md
    normalized-message.schema.json
  bin/
    flowmesh
  src/
    core/
      types.ts
      normalize.ts
      classify.ts
      filters.ts
      emit.ts
    providers/
      apple-mail/
      himalaya/
      gog/
      imap/
      mcp/
    workflows/
      triage.ts
      digest.ts
      followup.ts
      archive.ts
      extract.ts
    pipelines/
      lobster/
        inbox-pull.ts
        inbox-triage.ts
        followup-scan.ts
    formatters/
      json.ts
      jsonl.ts
      markdown.ts
    config/
      load.ts
      resolve.ts
  examples/
    config.flowmesh.yaml
    prompts/
      classify-system.txt
      summarize-digest.txt
  tests/
    fixtures/
      normalized/
      provider-raw/
```

## Core Design

### 1. Provider adapters
Each provider implements a small contract, for example:

- `list` → enumerate messages/items
- `get` → fetch one full item
- `watch` → optional long-poll/webhook bridge later
- `send` → optional outbound action later
- `mutate` → archive/tag/move/reply state changes

Adapters should be thin wrappers around existing tools:

- Apple Mail → AppleScript/JXA wrapper
- Himalaya → CLI wrapper
- gog → workspace CLI wrapper for Gmail/Drive/Calendar ecosystems
- IMAP → generic direct mailbox adapter
- MCP → generic remote tool adapter for inbox-like sources

### 2. Normalized message envelope
Everything should map into one common JSON shape before downstream logic runs.

Example:

```json
{
  "id": "provider-native-id",
  "provider": "himalaya",
  "account": "work",
  "mailbox": "INBOX",
  "threadId": "optional-thread-id",
  "subject": "Quarterly review",
  "from": [{ "name": "Alex", "address": "alex@example.com" }],
  "to": [{ "name": "Ops", "address": "ops@example.com" }],
  "cc": [],
  "receivedAt": "2026-04-03T14:00:00Z",
  "snippet": "Can you review the attached plan...",
  "bodyText": "...",
  "bodyHtml": null,
  "labels": ["inbox", "important"],
  "attachments": [
    { "filename": "plan.pdf", "mimeType": "application/pdf", "size": 48192 }
  ],
  "flags": {
    "read": false,
    "starred": true,
    "archived": false
  },
  "refs": {
    "providerId": "abc123",
    "providerThreadId": "th-456"
  },
  "meta": {
    "rawSource": "provider-specific extras allowed here"
  }
}
```

Provider quirks stay inside `meta` or adapter-specific refs, not in workflow logic.

### 3. Classification hooks
Classification should be a separate stage, not tangled into provider fetching.

Hook points:

- rule-based local filters
- external LLM classifier
- MCP tool classifier
- shell command hook

Expected classifier output:

```json
{
  "category": "followup",
  "priority": "high",
  "confidence": 0.91,
  "tags": ["customer", "deadline"],
  "needsResponse": true,
  "dueAt": null,
  "reason": "Direct request with deadline language"
}
```

### 4. Lobster pipeline entrypoints
Keep first-class pipeline commands that behave well in shells and schedulers:

- read JSON in / write JSON out
- support JSONL for batch pipelines
- support deterministic exit codes
- avoid chatty logs unless `--verbose`

Examples:

```bash
flowmesh pull --provider himalaya --account work --mailbox INBOX --format jsonl \
  | flowmesh normalize --input jsonl --output jsonl \
  | flowmesh classify --profile default --output jsonl \
  | flowmesh route --workflow triage --output json

flowmesh workflow triage --provider gog --account personal --query 'label:inbox newer_than:2d' --json
```

## Provider-specific terms belong in config/args, not code

This is the big anti-footgun.

Bad:

- hardcoding `chris@...`
- hardcoding `Brain`, `VIP`, `Receipts`, or other personal folder names into logic
- baking provider-specific mailbox names into workflow code

Good:

- `--account personal`
- `--mailbox INBOX`
- `--source receipts-mail`
- `profiles.default.includeLabels=['important']`
- `routing.rules[]` in config

Example config:

```yaml
accounts:
  personal-gmail:
    provider: gog
    identity: personal
    selectors:
      defaultQuery: "label:inbox"

  work-imap:
    provider: imap
    host: imap.example.com
    port: 993
    authRef: op://mail/work-imap

workflows:
  triage-default:
    source: personal-gmail
    classifier: default-llm
    archiveOn:
      - newsletters
      - receipts
    escalateOn:
      - urgent
      - human-reply-needed
```

## CLI Surface Proposal

### Core commands

- `flowmesh providers list`
- `flowmesh pull`
- `flowmesh get`
- `flowmesh normalize`
- `flowmesh classify`
- `flowmesh route`
- `flowmesh mutate`
- `flowmesh workflow <name>`
- `flowmesh schema print normalized-message`
- `flowmesh doctor`

### Typical flags

- `--provider`
- `--account`
- `--source`
- `--mailbox`
- `--query`
- `--since`
- `--limit`
- `--config`
- `--profile`
- `--format json|jsonl|table`
- `--json`
- `--verbose`

### Command examples

```bash
flowmesh pull --provider apple-mail --account local --mailbox INBOX --limit 25 --json
flowmesh pull --provider himalaya --account work --mailbox Inbox --format jsonl
flowmesh classify --profile default < messages.jsonl
flowmesh workflow digest --source personal-gmail --since 24h --json
flowmesh mutate --source work-imap --id 123 --action archive
```

## First 5 workflows to build

### 1. `workflow triage`
Fetch recent messages, normalize them, classify them, and emit actionable buckets.

Output:
- urgent
- reply-needed
- FYI
- archive-candidate
- spam/noise

### 2. `workflow digest`
Produce a structured summary for the last N hours/day.

Output JSON should include:
- important threads
- pending replies
- top senders
- suggested next actions

### 3. `workflow followup`
Find messages that likely need a response or are waiting on someone.

Heuristics:
- unanswered direct questions
- commitments with dates
- stale threads without closure

### 4. `workflow receipts`
Find receipt/order/statement-like messages and emit extracted fields.

Useful for:
- bookkeeping
- archival
- expense pipelines

### 5. `workflow archive`
Bulk archive low-value or already-processed messages based on rules/classifier results.

Must support:
- `--dry-run`
- machine-readable planned actions
- optional provider mutation step

## Cron / orchestrator friendliness

Design every workflow so it can run safely from cron:

- no interactive prompts by default
- explicit `--json` / `--format jsonl`
- stable exit codes
- `--dry-run` for mutating workflows
- one command can do one thing well
- stderr for logs, stdout for machine output

Example cron-safe usage:

```bash
flowmesh workflow triage --source personal-gmail --since 2h --json > /var/tmp/triage.json
flowmesh workflow followup --source work-imap --since 7d --json | jq '.items[] | select(.priority=="high")'
```

## Practical MVP

Build the first milestone around three adapters and one normalized schema:

1. `himalaya`
2. `gog` (for Gmail-like fetch/query flows)
3. `imap`

Then add:

4. `apple-mail`
5. `mcp`

Why: Himalaya/IMAP/Gmail cover the broadest generic cases first. Apple Mail and MCP can slot in once the contracts are proven.

## Next implementation steps

1. Define `normalized-message.schema.json`
2. Implement provider interface and adapter test fixtures
3. Build `pull`, `normalize`, and `workflow triage`
4. Add classifier hook contract (`stdin/stdout JSON` friendly)
5. Add `mutate --dry-run` and action planning output
6. Add example configs for gog, himalaya, and IMAP

## Status

This folder is currently a design scaffold only.
No heavy implementation has been added yet.
