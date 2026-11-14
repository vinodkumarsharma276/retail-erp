# App chat orchestrator

The coordinator's working notes: how RetailERP chats are organised, the decisions that apply
across features, the current cross-feature state, and the prompts to start, resume or hand off
a chat. Agents maintain this file; the user does not need to edit it by hand.

Refresh it with `/update-feature-docs orchestrator` (or ask the coordinator chat to "update the
app chat orchestrator"). Feature-level detail belongs in the [feature documents](features/README.md),
rationale in [ADRs](adr/), and the maintenance rules in the
[feature context workflow](FEATURE_CONTEXT_WORKFLOW.md) — link to them rather than copying.

## How the chats are organised

| Chat | Owns | Does not own |
|---|---|---|
| **Coordinator** (this document) | Cross-feature priorities, shared architecture (auth, tenancy, permissions, sync pattern, Flutter foundation), dependency ordering, bounded handoffs, this file | Feature business logic beyond what a shared contract requires |
| **Feature chat** (one per left-rail item or supporting capability) | Its API, web and Flutter workflow end to end; its feature doc, source mapping and checkpoint | Shared contracts without telling the coordinator; other features' files |

- Repository files are the only handoff between chats. Chats do not see each other's history,
  so an important decision only "exists" once it is written into a feature doc, ADR or here.
- Feature IDs and owned sources are in [manifest.json](features/manifest.json); the
  left rail maps to features through the [feature index](features/README.md).
- Two chats editing code at the same time need separate git worktrees. Shared files (Prisma
  schema, `packages/shared-types`, middleware, the Flutter `lib/core` and `lib/app`) are changed
  in one chat at a time, and the change is reported back here.
- Agent memory holds only short durable conventions; progress lives in versioned docs.

## Durable product decisions

| Decision | Source |
|---|---|
| Mobile client is **Flutter, written from scratch**, for every authorized tenant role. The Expo app in `apps/mobile` is legacy: keep it, do not extend it, do not delete it without approval. | User decision; [mobile foundation](features/mobile-foundation.md) |
| Target is **full web parity, released a few features at a time**. Parity never widens access: each user sees only what their permissions and the tenant plan allow. | User decision |
| **ERP database/API is the source of truth.** Google Sheets is only the initial import, never a sync master. | User decision; [Customer Searching](features/customer-searching.md) |
| Cached features keep a local copy and pull changes on a schedule and when the user searches: snapshot, then deltas **including edits, deletions and access changes**, not just new rows. Offline reads do not imply offline writes. | User decision; [handoff](mobile/customer-searching-handoff.md) |
| First device capability is **notifications**; others come later. | User decision; [notifications](features/notifications.md) |
| App identity: display name **RetailERP**, Android application ID / iOS bundle ID **`com.retailerpai.mobile`**, website **retailerpai.com** (owned, GoDaddy registration; DNS moving to Cloudflare). Tenant apex default is now `retailerpai.com`. | User decision; [Flutter README](../apps/mobile-flutter/README.md) |
| Every mobile feature reuses the one app in `apps/mobile-flutter` (shell, login, session store, API client, feature catalog). Feature chats never scaffold another app or auth flow. | [Flutter README](../apps/mobile-flutter/README.md) |
| Hosting: web on **Cloudflare Pages** (`vn.`/`admin.retailerpai.com`), API + PostgreSQL on a portable **Docker VM** (`api.retailerpai.com`, Oracle Always Free in India first), not the employer Azure subscription. Hosted DB starts as a copy of local data; only tenant `vn` live. Nothing provisioned yet. | User decision; [deployment and release](features/deployment-and-release.md) |
| Local only: nothing is deployed. Android is validated first; iOS needs a Mac. | [AGENTS.md](../AGENTS.md) |

## Current state

As of 2026-11-14. The [feature index](features/README.md) is authoritative per feature.

| Area | State |
|---|---|
| Feature docs | 23 docs (18 left-rail items + 5 supporting capabilities) in the standard shape, with source-hash checkpoints and a docs CI check |
| Web | Almost complete; per-feature gaps are listed in each feature doc |
| Flutter foundation | Implemented: real tenant login, token refresh, secure session store, offline start, shop switching, permission/plan-gated module shell, theme, tests; Android build and device launch verified |
| Flutter Customer Searching | First release implemented and Android-verified: encrypted cache, snapshot + delta + tombstone sync, background updates, online create/edit. Not release-ready (see open items) |
| Other Flutter modules | Placeholders only ("Coming soon to the mobile app") |
| Deployment | Not deployed. Phase 1 done and verified locally: portable Docker VM stack, production config guard, gated CI/CD, Pages config, Android release signing ([deployment and release](features/deployment-and-release.md)). Phase 2 (accounts, server, data copy, first release) waits on the owner |

## Open cross-feature items

- Choose the **next Flutter business module**; it should copy Customer Searching's
  cache/sync pattern where it caches data.
- **Notifications**: provider/transport, permission prompts, token registration and real delivery
  are not implemented.
- **iOS**: build, Keychain and device behaviour unverified (needs macOS/Xcode).
- **Release readiness**: Phase 2 of [deployment and release](features/deployment-and-release.md)
  (Cloudflare/Oracle/GitHub setup, data copy with the owner's account list, first release, APK on
  the phone) needs the owner and explicit approval at each step.
- Customer Searching leftovers: background run timings on Wi-Fi/release builds (compression is
  now handled by the hosted proxy; see its [handoff](mobile/customer-searching-handoff.md)).
- `movePayment` passes stale arguments to `distributeOverpayment`, so moved excess is not
  redistributed ([installments](features/installment.md)) — needs an owner decision.
- `auth/switch-shop` still checks role names although shop scoping uses the `shop.switch`
  permission ([authentication and access](features/authentication-and-access.md)).
- Default employee roles do not get Customer Searching; mobile audience is not a permission grant.
- Pre-existing noise: the web ESLint config failure. (`npx turbo typecheck` is clean since
  2026-11-14 and is enforced by CI — keep it clean.)
- Docs CI detects drift but branch protection is not configured.

## When to run the update skill

`/update-feature-docs <feature-id>` is event-driven; an idle chat never wakes itself.

| Moment | Who | Command |
|---|---|---|
| Starting or resuming a feature chat | Feature chat | `/update-feature-docs <feature-id>` (load + report drift) |
| After a meaningful, verified slice (endpoint, screen, sync change, decision) | Feature chat | `/update-feature-docs <feature-id>` |
| Before leaving a chat or committing | Feature chat | `/update-feature-docs <feature-id>` + handoff |
| A shared contract changed, or periodically (e.g. weekly) | Coordinator | `/update-feature-docs orchestrator`, then `npm run docs:status` |

## Prompts

Replace `<feature>` with the feature ID from [manifest.json](features/manifest.json) (for example
`customer-searching`, `installment`, `sales`).

### Start a fresh feature chat

> You own the `<feature>` feature of RetailERP across API, web and Flutter. Load the context
> yourself: AGENTS.md, docs/APP_CHAT_ORCHESTRATOR.md, the feature index, docs/features/<feature>.md
> and its dependency docs, then run `/update-feature-docs <feature>` and report drift.
> For Flutter, reuse apps/mobile-flutter (shell, login, API client, session store, feature
> catalog); do not scaffold another app.
> Current task: <one bounded outcome>. Confirm open decisions before building. After each
> verified slice, update the feature doc and checkpoint; end with changed / verified /
> remaining / cross-feature impact / next action.

### Bring an existing feature chat into this workflow

> From now on, keep this feature's context in the repository, not in this chat. Run
> `/update-feature-docs <feature>`. Compare docs/features/<feature>.md with what we decided and
> built in this chat; write any decision, constraint or gap that exists only in this
> conversation into the feature doc (or an ADR if it is cross-feature). Do not change code.
> Then checkpoint and give the handoff summary.

### Continue an existing feature chat into its Flutter slice

> Continue this `<feature>` chat across API, web and Flutter. Reconcile this thread's decisions
> with the current feature doc and code, and read docs/APP_CHAT_ORCHESTRATOR.md. Reuse the
> shared Flutter shell, login, API client and session store in apps/mobile-flutter — do not
> scaffold another app. If the feature caches data, follow Customer Searching's sync pattern.
> Current task: <bounded Flutter slice>. Confirm remaining cache/sync/access decisions first,
> preserve existing web behaviour, and update the doc and checkpoint after each verified slice.

### Start the deployment and release chat

> You own the `deployment-and-release` feature of RetailERP. Load the context yourself:
> AGENTS.md, docs/APP_CHAT_ORCHESTRATOR.md, docs/features/deployment-and-release.md and its
> dependency docs (authentication-and-access, mobile-foundation, customer-searching,
> platform-administration), then run `/update-feature-docs deployment-and-release`.
> Goal: let the shops test RetailERP — the web app on a hosted HTTPS address with a hosted API and
> PostgreSQL, and a release-signed Android APK pointing at that API.
> Before creating any cloud resource or spending money, ask me to decide: hosting provider and
> monthly budget, domain (retailerpai.com or the provider's default address), which tenant(s) and
> what data go to the hosted database (seed, fresh, or a copy of local data — it contains
> customer personal data), who gets test accounts, and whether CI should deploy automatically on
> push to main. Do not deploy, migrate a hosted database, or push to main without my approval.
> Keep the release keystore and secrets out of the repository. Fix the deployment gaps listed in
> the doc as part of this work, keep the local dev setup working, and write the release and
> rollback steps into the feature doc. Update the doc and checkpoint after each verified slice.

### Before leaving a feature chat

> Run `/update-feature-docs <feature>`: review what changed, update the feature doc and any
> affected dependency docs, checkpoint, run `npm run docs:check`, and give the handoff summary.
> List anything the coordinator must know (shared contract changes, new open decisions).

### Coordinator refresh

> Act as the RetailERP coordinator. Run `/update-feature-docs orchestrator`: check
> `npm run docs:status`, read recent feature-doc changes and handoffs, then update
> docs/APP_CHAT_ORCHESTRATOR.md (current state, open cross-feature items, decision log).
> Flag conflicting decisions between features and propose the next bounded slice for each
> active feature chat. Do not change feature code.

### Fresh-chat checklist

1. Pick one feature ID and one bounded outcome; if another chat edits code at the same time,
   create a git worktree for it.
2. Paste the "Start a fresh feature chat" prompt. The agent loads all context itself.
3. Answer the decisions it raises; it records them in the feature doc.
4. At each verified slice and before leaving, it runs the update skill and checkpoints.
5. Bring cross-feature changes to the coordinator chat with the "Coordinator refresh" prompt.

## Decision log

Newest first. One line per cross-feature decision; feature-only decisions go in the feature doc.
Dates are when the change landed in a commit (or the edit date for uncommitted work).

| Date | Decision |
|---|---|
| 2026-11-14 | Hosting decided (Cloudflare Pages + portable Docker VM, `retailerpai.com`, tenant apex default changed); CI typecheck made clean and deploys gated by `DEPLOY_ENABLED`; Android release signing outside the repo. |
| 2026-11-14 | Deployment and release split into its own feature doc and chat; shop testing (hosted web/API + release APK) is its first goal. |
| 2026-11-14 | This orchestrator document created; refreshed through the update skill's `orchestrator` mode. |
| 2026-11-10 | Customer Searching Flutter first release implemented on the shared foundation (encrypted cache, sync log with tombstones). |
| 2026-11-10 | Shared Flutter foundation built: Android + iOS projects, real login/refresh, permission-gated shell. Identity RetailERP / `com.retailerpai.mobile`. |
| 2026-11-10 | Feature-doc system: one doc per left-rail item, source-hash checkpoints, `update-feature-docs` skill, docs CI. |
| 2026-11-10 | Flutter replaces Expo as mobile direction; audience all authorized roles; staged full parity; ERP authoritative; notifications first. |
