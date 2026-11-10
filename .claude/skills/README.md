# Agent skills

Repeatable, on-demand workflows for coding agents. Skills in this folder are discovered by
**Claude Code** and **GitHub Copilot in VS Code** (both read `.claude/skills/`). The folder is
committed; the rest of `.claude/` stays git-ignored.

Project-wide rules live in [AGENTS.md](../../AGENTS.md) — skills hold *task-specific* procedures only.

## Layout

```
.claude/skills/
├── README.md                 # this file
└── <skill-name>/             # lowercase-hyphenated; must equal `name` in SKILL.md
    ├── SKILL.md              # required: frontmatter + procedure (keep < 500 lines)
    ├── references/           # optional: longer docs/templates, loaded only when linked
    ├── scripts/              # optional: executable helpers the procedure runs
    └── assets/               # optional: boilerplate files to copy
```

## SKILL.md template

```markdown
---
name: my-skill
description: 'What it does. Use when <trigger phrases the user is likely to say>.'
argument-hint: 'Optional hint shown for /my-skill'
---

# My skill

## When to use
## Procedure
1. …
## Verify
```

- The `description` is the only thing an agent sees before loading the skill — put trigger
  words in it ("Use when adding…", "Use when debugging…"). Quote it if it contains a colon.
- Link resources with relative paths (`./references/x.md`) and keep them one level deep.
- Every skill should end with a verification step (typecheck/tests/curl) that proves the work.

## Skills

| Skill | Purpose |
|---|---|
| [add-api-module](add-api-module/SKILL.md) | Scaffold a new tenant-safe, permission-guarded Fastify module (+ optional web hook) |
| [update-feature-docs](update-feature-docs/SKILL.md) | Load feature context, review code/doc drift, update feature docs and record content-hash checkpoints for web/API/Flutter handoffs |

## Ideas for next skills

- `add-prisma-migration` — schema change → migration → client regen → seed/backfill.
- `add-permission` — new permission key, role defaults, `sync-permission-catalog`, UI guard.
- `add-web-page` — page + route + `PermissionGuard` + sidebar entry + query hook.
- `run-tests` — start Postgres, run unit/integration suites, triage failures.
- `seed-reset` — reset dev DB, reseed both tenants, set dev passwords.
- `installment-ledger-check` — inspect a ledger with `apps/api/scripts/inspect-ledger.ts`.
