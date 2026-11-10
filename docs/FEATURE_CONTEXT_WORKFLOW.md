# Keeping feature context current

## Ownership of each layer

| Layer | Agent responsibility | Update trigger |
|---|---|---|
| [AGENTS.md](../AGENTS.md) | Read automatically; maintain shared invariants and context-loading procedure | Shared architecture, commands or conventions change |
| [Feature index](features/README.md) | Map left-rail items, supporting capabilities, and release direction | Menu, feature ownership, or mobile readiness changes |
| [Feature documents](features/README.md) | Read relevant docs before coding; reconcile against code afterward | A meaningful implementation, bug fix, decision, or handoff |
| [ADRs](adr/) | Preserve rationale and explicitly supersede decisions | Cross-feature or architectural decision |
| [Review checkpoints](features/checkpoints.json) | Record hashes of reviewed sources, not guesses about progress | After source review and documentation validation |
| Coordinator chat | Resolve shared priorities and dependencies; produce bounded feature handoffs | Starting/finishing a slice or discovering a cross-feature decision |
| Feature chat | Implement, test, refresh context and report remaining work | Each meaningful slice; always before handoff |
| Agent memory | Remember short durable conventions only | A verified reusable convention changes, not task progress |

The user does **not** need to read these documents manually or remember to paste them into each
chat. The agent follows the repository guidance. Chats do not synchronize automatically;
repository files are the handoff contract.

## Update skill

Use [update-feature-docs](../.claude/skills/update-feature-docs/SKILL.md), normally as
`/update-feature-docs customer-searching`. A new session may need to reload/discover workspace
skills before the slash command appears. The agent can always read that skill directly.

Run the skill at task start to find relevant drift, after a meaningful change, before a
commit/handoff, or when explicitly asked for a periodic refresh. This is **event-driven**, not
a timer: an idle chat cannot wake itself periodically. An actual scheduled task or CI agent
would be a separate opt-in facility; none is silently installed here.

## Commands

From the repository root:

```powershell
npm run docs:status
npm run docs:status -- customer-searching
npm run docs:check
npm run docs:test
npm run docs:checkpoint -- customer-searching --reviewed
```

`status` reports drift without failing the shell. `check` fails for stale/missing docs, missing
standard headings, broken local links, uncovered left-rail routes, or changed unmapped source.
`docs:test` tests the checker itself, not the ERP.

`checkpoint` requires explicit IDs (or `--all`) and `--reviewed`. It records the current
source hashes, document hash, review time and Git HEAD. It does not execute tests, certify
correctness, commit changes, or prove an agent really performed the review.

The [Feature context CI workflow](../.github/workflows/feature-context.yml) runs checker tests and
the documentation check on pushes to main/develop and pull requests to main. It needs no npm
install and does not deploy anything. It detects drift; an agent must review and refresh it.
Branch protection enforcement is a separate repository setting, not configured by this task.

## How checkpoints work

[manifest.json](features/manifest.json) maps feature IDs to documents, rail routes, owned source
paths and shared inputs. The checker inventories Git-tracked and nonignored untracked source,
hashing current working-tree text (CRLF normalized to LF so Windows and Linux agree). This detects:

- Commits since the previous review.
- Staged and unstaged edits, even when the previous review included uncommitted work.
- New and deleted files; renames appear as removal plus addition.
- Changes to shared access, schema, API middleware, routing and UI layout.
- Referenced decision/handoff documents.
- Edited feature documents that have not yet been checkpointed.

The baseline is content-based, not "the last commit was reviewed." Hashes contain no source
contents. If a reviewed version was uncommitted, its exact text may not be recoverable from Git;
inspect the current file and full relevant behavior rather than claiming a precise old diff.
Capture a normal Git commit when a durable historical textual baseline is needed.

Shared inputs deliberately invalidate multiple features. Review the impact; if behavior is
unchanged, record that conclusion and refresh the affected checkpoints. Do not gratuitously
rewrite every document. A newly added module outside the mapping appears as **UNMAPPED**; assign
it to a feature or explicitly classify it as infrastructure. A full reviewed checkpoint
(`npm run docs:checkpoint -- --all --reviewed`) advances the unmapped-code inventory baseline;
a partial checkpoint must not hide unrelated changes.

When adding Flutter files, add their real source roots to both the mobile-foundation and owning
feature entries. The shared foundation now exists in `apps/mobile-flutter`; reuse its app shell,
API/session infrastructure and feature catalog rather than scaffolding a new app per feature.
The inventory includes Dart, Kotlin/Gradle, Swift and native project/manifest/entitlement files.
Keep the legacy Expo app intact until an explicit retirement task.

## Review and handoff contract

1. Load shared rules, index, relevant docs and dependency docs.
2. Run status; inspect changed implementations and necessary callers/tests. Code wins for what
   exists; approved requirements win for what should be built. Make discrepancies explicit.
3. Implement and verify the requested outcome. Docs-only reviews must not claim tests ran.
4. Update documents using the [template](features/_template.md), preserving important existing
   business detail. Keep legacy behavior outside the current reference and link it.
5. Update navigation/source mappings and the index if needed; run documentation checks.
6. Only after review, checkpoint the affected features, then rerun the check. Source hashes are
   change detection, not a replacement for tests or permission/privacy review.
7. Return: **changed / verified / remaining / cross-feature impact / next action**.

Never put credentials, customer records, exported sheets or production payloads in docs,
checkpoints, memory, or handoffs.
