# Config Notes

## Principle

All user- or org-specific details live in config, not in code.

Examples:
- email addresses
- account aliases
- folder names
- label names
- recipient identities
- auth references
- classifier profiles
- routing rules

## Example

```yaml
accounts:
  personal-gmail:
    provider: gog
    identity: personal
    queryDefaults:
      inbox: 'label:inbox'

  work-himalaya:
    provider: himalaya
    account: work
    mailboxDefaults:
      triage: Inbox

  team-imap:
    provider: imap
    host: imap.example.com
    port: 993
    username: ops@example.com
    authRef: op://mail/team-imap

classifiers:
  default:
    kind: shell
    command: ['scripts/classify-default.sh']

workflows:
  triage-default:
    source: personal-gmail
    classifier: default
    routing:
      archiveCategories: ['newsletter', 'receipt']
      escalateCategories: ['urgent', 'reply-needed']
```

## Why this matters

This keeps the repo generic and reusable.
Changing the operator, mailbox layout, or provider account should require config edits, not source edits.
