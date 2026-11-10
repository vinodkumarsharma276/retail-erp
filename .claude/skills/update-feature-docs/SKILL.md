---
name: update-feature-docs
description: 'Maintain RetailERP feature context from current code. Use when starting feature work, updating feature documents, refreshing documentation, checking context drift, finishing a web/API/Flutter change, or preparing a feature-chat handoff. Detect committed and uncommitted changes using reviewed content checkpoints.'
argument-hint: 'Feature ID(s), e.g. customer-searching; or all for a complete source-reviewed refresh'
---

# Update feature documents

## Contract

The agent, not the user, loads and maintains context. Work in this repository; follow
[AGENTS.md](../../../AGENTS.md), the [feature index](../../../docs/features/README.md),
[template](../../../docs/features/_template.md), and
[checkpoint workflow](../../../docs/FEATURE_CONTEXT_WORKFLOW.md).

No background scheduler is provided by this skill. Run at feature-task boundaries and on
request. Do not create a parallel memory specification or claim chats automatically synchronize.

## Procedure

1. Check worktree status without reverting/staging unrelated work. Resolve requested feature
   IDs through [manifest.json](../../../docs/features/manifest.json). For a coding task, load its
   doc and dependency docs before editing. For `all`, cover every rail item and supporting feature.
2. Run `npm run docs:status -- <feature-id>` (or no selector for all). Read
   [checkpoints.json](../../../docs/features/checkpoints.json) for the previous review head and
   hashes. Use Git diffs/history to narrow investigation, but do not assume HEAD captures
   unstaged, staged or untracked changes. Inspect the reported paths; for a dirty historical
   baseline whose text is unavailable, inspect complete relevant current functions/callers.
3. Verify current behavior against actual routes, services, validation, models, guards,
   serializers, screens/hooks and relevant tests. Read existing ADRs/documents as context, not
   proof of implementation. Follow the workflow across surfaces; do not make unsupported claims.
   Do not copy credentials, personal/customer records, logs or exports into documentation.
4. Reconcile the owning feature doc to the exact template headings. Preserve useful detail;
   distinguish implemented, approved/planned, legacy and unverified behavior. Include tenant/shop
   scope, permission prerequisites, field restrictions, failure paths and verification evidence.
   Do not claim tests ran unless they actually ran. Preserve legacy material in a clearly marked
   reference and repair links when moving it.
5. For Flutter, ERP/API is authoritative, Google Sheets is import-only, and the existing Expo
   app is legacy. Full parity is staged and authorization-preserving. First release is
   Customer Searching with cached read/search and online create/edit. Reuse the shared
   `apps/mobile-flutter` foundation (login/session/shell already implemented). Do not present
   missing business screens, delta sync, offline writes or push delivery as implemented.
6. Refresh dependent feature docs and shared guidance only when affected. Update the index for
   readiness/navigation changes. Assign new code roots/tests to the manifest; inspect UNMAPPED
   changes rather than silently ignoring them. Add actual Flutter roots when created.
7. Run `npm run docs:test` after checker changes. Run `npm run docs:check` and inspect errors.
   Before recording a checkpoint, fix missing headings/links/coverage. Source-stale messages
   are expected until review is acknowledged.
8. After reviewing the affected sources and updating docs, run
   `npm run docs:checkpoint -- <feature-id> --reviewed` (multiple IDs supported). For a complete
   reviewed refresh and classification of unmapped changes, use
   `npm run docs:checkpoint -- --all --reviewed`. Never checkpoint just to turn a check green.
9. Run `npm run docs:check` again. Report unrelated stale/unmapped items explicitly if outside
   this task; do not reset their baselines or fix unrelated code. Do not commit unless asked.

## Handoff

Return a short list:

- **Changed:** behavior and documents.
- **Verified:** commands/results or source-inspection-only.
- **Remaining:** concrete gaps and open decisions.
- **Cross-feature impact:** shared contract changes and dependent docs.
- **Next action:** bounded next slice, relevant feature docs and checkpoint status.
