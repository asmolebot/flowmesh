# AGENTS.md — flowmesh

## Purpose
flowmesh is a generic workflow/inbox automation toolkit.
It must stay provider-agnostic and automation-safe.

## Guardrails
- Do not hardcode personal email addresses, mailbox names, label names, domains, or people-specific routing terms in source code.
- Put provider/account specifics in config, CLI args, fixtures, or examples only.
- Prefer structured JSON/JSONL stdout and human logs on stderr.
- Mutating actions must support `--dry-run` first.
- Provider adapters should stay thin; business logic belongs in core/workflow layers.
- Tests should use fixtures/sanitized samples, never real inbox dumps or secrets.
- Do not commit real credentials, tokens, live mailbox paths, or user-specific config.

## Initial milestone target
Milestone 1 should deliver:
- project scaffold
- normalized schema + TypeScript types
- provider contract
- first adapters stubs (`gog`, `imap`, `himalaya`)
- `workflow triage` skeleton with JSON output
- CI + CodeRabbit config stubs

## Non-goals for early milestones
- no giant daemon
- no full mutation/apply engine before planning/dry-run exists
- no provider-specific heuristics embedded in adapter code
- no Apple Mail or MCP implementation until base contracts are solid
