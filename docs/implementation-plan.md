# flowmesh — Implementation Plan

## Review of current inbox/email surface area

### Existing jobs / heartbeats
- Cron inbox triage currently mixes Gmail (`gog`), iCloud IMAP via MCPorter (`zerolib-email`), and Apple Mail on `asmo.local` in one prompt-heavy agent turn.
- Heartbeat mail check currently uses only Apple Mail on `asmo.local` and still contains person-specific logic/action routing.
- Current cron triage has already shown fragility:
  - prompt-level orchestration is too complex
  - source-specific logic is entangled with classification and notification policy
  - Apple Mail node failures can poison the whole run

### Existing provider/tooling coverage to preserve
- `gog` for Gmail search/list flows
- MCPorter with `zerolib-email` for generic IMAP/iCloud-style access
- Apple Mail local query script on `asmo.local`
- likely future `himalaya` support for generic CLI mailbox workflows

## MVP scope (Milestone 1)
Build the smallest reusable slice that proves the architecture:

1. TypeScript CLI scaffold
2. normalized message schema + TS types
3. provider contract (`list`, `get?`, `normalize`, optional `mutate`)
4. provider stubs:
   - `gog`
   - `imap`
   - `himalaya`
5. workflow:
   - `workflow triage`
6. classifier hook contract:
   - shell command stdin/stdout JSON stub
7. CI + CodeRabbit scaffolding

Milestone 1 explicitly does **not** need to fully implement:
- Apple Mail
- MCP adapter
- live mutations beyond planning/dry-run
- person-specific rules

## Implementation sequence

### Phase 0 — repo hygiene
- own git repo
- public GitHub origin
- CI stub
- CodeRabbit config
- AGENTS.md guardrails

### Phase 1 — core contracts
- package.json / tsconfig / src layout
- normalized message schema JSON
- TS types derived/aligned to schema
- provider interface + registry
- output utilities (`json`, `jsonl`)

### Phase 2 — workflow shell
- `flowmesh workflow triage`
- config loading
- source/provider selection
- structured output shape for grouped results
- `--dry-run` semantics where relevant

### Phase 3 — initial adapters
- `gog` wrapper (likely CLI exec wrapper)
- `imap` stub/adapter contract
- `himalaya` stub/adapter contract

### Phase 4 — fixture tests
- fixture-based normalization tests
- workflow smoke tests

## Claude implementation brief
Claude should implement Milestone 1 only:
- scaffold a clean TS CLI
- build contracts and triage workflow skeleton
- keep adapters minimal and generic
- use fixtures/examples instead of real live mailbox config
- avoid wiring personal addresses, queries, labels, or heuristics into code
- leave Apple Mail + MCP for Milestone 2 after contracts stabilize
