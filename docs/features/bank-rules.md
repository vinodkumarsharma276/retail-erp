# Bank Statements — Rules & settings

## Purpose and scope

**Rules & settings** (`/bank/rules`) manages registered shop accounts, category rules,
tenant review thresholds, original-file retention and optional API feed controls. It owns
categorization precedence and settings; [Upload](bank-upload.md) owns file extraction,
[Review](bank-review.md) owns anomaly reasons and [Transactions](bank-transactions.md)
owns supplier posting rather than suggestions.

## Implementation status

| Surface | Status | Evidence / limits |
|---|---|---|
| API | Implemented / partial providers | Rules/settings/accounts and feed orchestration exist; Demo provider is available, Federal Bank provider is explicitly not implemented. |
| Web | Implemented | Rule create/delete, thresholds, retention toggle, accounts and feed connect/sync/history controls, conditional on permissions/add-ons. |
| Flutter | Planned only | New approved target with eventual full authorized web parity; credential-management UX needs explicit mobile design. |

Reviewed **2026-11-10**; source-reviewed, **not runtime-certified**. The presence of feed
routes/scheduler/UI does not establish a working real-bank connection.

## Business rules and invariants

- Categorization order: shop-specific user rules, tenant-wide user rules (newest first within
  each), built-in rules, then optional batched AI for remaining distinct narration/direction
  patterns. User-rule hits have confidence 1.
- With no AI or failed categorization AI, unresolved UPI/NEFT/IMPS/RTGS credits fall back to
  Business Income (0.45), debits to Personal Transfers (0.4); other leftovers are Uncategorized
  (0). Fallback source remains `none`, not “AI.” Supplier suggestions run afterward and can
  set Vendor & Supplier Payments when no human/user-rule category overrides it.
- Rule patterns are case-insensitive literal contains or regex. Pattern length 2–200;
  category must be in the server catalog. Invalid regex is rejected. No rule-update endpoint:
  delete/recreate. Deleting a rule does not undo categories already assigned.
- `applyToExisting` defaults true. Creation applies that **new rule** to matching accessible
  existing rows except human-category rows, then reflags affected shops. It is not a complete
  precedence-aware rerun of every older rule; full statement rerun is in [Statements](bank-statements.md).
- Tenant settings default: largeAmount ₹100,000; cashAlertAmount ₹20,000;
  unknownPayeeAmount ₹5,000; minAiConfidence 0.65; baseCurrency INR; keepOriginalFiles false.
  Thresholds must be positive, confidence 0–1, currency length three. Settings updates merge
  recognized keys and reflag all tenant shops with statements.
- Account number strips spaces/dashes then requires 4–20 digits; optional IFSC is uppercased
  and validated. Types: current, savings, overdraft, cash_credit. Active account number cannot
  be registered twice within a tenant. Registration can link same-shop previously unlinked
  statements by last four digits and update their bank labels.
- Account deletion deactivates it; statement links survive. It is not statement deletion or
  an explicit feed disconnect.
- Original retention requires both add-on and tenant opt-in. The toggle affects new uploads,
  not retroactive storage or deletion of previously retained bytes.

## Access, tenancy, and shop scope

Shared [bank access](bank-overview.md) applies: `bank.reconciliation`, `nav.bank` for rail,
`bank.view` for route/read, authenticated tenant and allowed request shops.

- Rule create/delete, settings write and account create/deactivate require `bank.reconcile`.
- Rule listing/deletion is **tenant-wide**, not limited to request shops. A shop-specific
  new rule's shop must be in scope; existing-row application is limited to request shops.
  Tenant-wide rules then affect future imports outside the creator's current shop.
- Settings are tenant-global, and saving triggers tenant-wide reflagging, not just active shop.
  `bank.reconcile` is therefore broader than local row reconciliation.
- Accounts/list and connection management enforce account tenant/shop scope.
- `bank.statement_files` is required to enable `keepOriginalFiles`; disabling is allowed.
- Feed list remains readable with `bank.view` without the feed add-on to show upgrade/readiness.
  Connect/update/disconnect additionally require `bank.api_feeds`, `bank.view` and the existing
  **owner/admin role guard** (`authorize([ADMIN])`, with owner implicit allowance).
  This is an actual role-based exception, not permission-only policy.
- Feed manual sync requires `bank.upload_statement` and `bank.api_feeds`; run history requires
  `bank.view` and the add-on. All retain base bank-feature/auth/shop checks.

## User workflows

1. Register a shop account to make statement shop/account resolution reliable.
2. Add contains/regex category rule for one shop or all shops; inspect how many existing rows
   were updated. Delete an unwanted rule, then explicitly recategorize affected statements if needed.
3. Adjust review thresholds and save; expect flags across the tenant to change while human
   review decisions persist. Toggle original-file retention only when entitled.
4. With feed add-on and owner/admin role, connect an eligible provider/account with start date
   and automatic-sync preference. First sync runs immediately; connection can succeed while
   first sync returns an error. Read that error, retry sync, inspect history or pause/disconnect.
5. Use Demo only as demonstration data. Federal is marked unavailable; do not enter credentials
   expecting a production connection to work.

## API contracts and data

Prefix `/api/v1/bank-statements`; success envelope wraps JSON.

| Method | Path | Contract |
|---|---|---|
| GET | `/rules` | Tenant rules with optional shop name, newest first |
| POST | `/rules` | pattern, match_type contains/regex, category, nullable shop_id, applyToExisting; returns rule/applied |
| DELETE | `/rules/:id` | Tenant-filtered removal; does not recategorize existing rows |
| GET | `/settings` | Tenant merged settings |
| PUT | `/settings` | Partial settings merge; entitlement enforced for retention enable |
| GET | `/accounts` | Active scoped accounts plus statement count |
| POST | `/accounts` | shopId, bankName (2–80), accountNumber, optional ifscCode, accountType; returns id/linked |
| DELETE | `/accounts/:id` | Scoped soft deactivation |
| GET | `/feeds` | Entitlement, provider metadata and scoped connections; no credentials returned |
| POST | `/feeds` | bankAccountId, provider, credentials record, startDate YYYY-MM-DD, autoSync default true; 201 id/firstSync |
| PATCH | `/feeds/:id` | Optional autoSync/paused |
| DELETE | `/feeds/:id` | Disconnect; previously imported statements retained |
| POST | `/feeds/:id/sync` | Manual synchronization result |
| GET | `/feeds/:id/runs` | Latest 30 run summaries |

Models: StatementRule, StatementSettings (tenant JSON settings), BankAccount,
BankFeedConnection and BankFeedRun. The analysis account API differs from
[legacy account API](bank-overview.md), including create permission and account types.

Feed orchestration clips historical range to 366 days and rereads a three-day overlap after
the first sync. Existing file/feed transactions are automatically skipped, with no user overlap
prompt. Fresh rows enter the shared categorization/storage/flag pipeline as source `api`,
method `bank-api`. Recent running sync (15 minutes) returns 409. Errors are recorded on runs
and connections; disconnect removes connection/history but preserves imported statements.
Credentials use AES-256-GCM through the feed secrets helper. Credential-bearing providers require
`BANK_FEED_SECRET_KEY` of at least 32 characters; losing/changing it requires re-entering connections.
Demo has no credential fields. Encryption is not a bank-provider readiness claim.

Scheduled runs require `ENABLE_SCHEDULER=true`, the feed add-on, an active account and an
auto-sync connection that is not paused. The job does not separately check `bank.reconciliation`
or a current user's permissions; failed connections can be retried.
Default `BANK_FEED_CRON` is `30 6 * * *`, timezone from `SCHEDULER_TZ` (default Asia/Kolkata).
No delivered morning import is assumed just because the checkbox is selected.

## Web behavior

Accounts card includes account registration/removal and provider controls. Rule form always
submits `applyToExisting=true`; the API can opt out but this screen cannot. Review-policy form
saves the four thresholds, not baseCurrency. Retention card shows locked upgrade messaging
without entitlement. Read-only users see settings/rules without write controls.

Feed UI shows provider readiness, connection status, sync results, pause/auto-sync/disconnect,
and run-history drawer. Owner/admin controls and upload-permission sync are separate.
Queries for rules/accounts/feeds are distinct from transaction invalidation; ensure refreshed
metadata after related mutations. “Every morning” UI copy is conditional on scheduler setup.

## Mobile behavior and differences

Flutter is the new approved target, planned only, eventually full authorized web parity.
Proposed mobile scope includes rule/account inspection and authorized maintenance, thresholds,
retention and feed actions/history. Secure credential entry/storage handling, destructive account
actions and whether to stage sensitive management after read-only release remain design work.
Expo is legacy. No offline policy writes, notifications or background feed execution on-device
is assumed; scheduled feeds are server-side when configured.

## Dependencies and cross-feature effects

- [Upload](bank-upload.md) needs registered accounts and shares storage/categorization with feeds.
  [Review](bank-review.md) consumes settings/recomputed flags; [Statements](bank-statements.md)
  provides rerun/original-file access; [Overview](bank-overview.md) and
  [Transactions](bank-transactions.md) consume resulting categories.
- Supplier name matching also uses the distributor name-adjudication helper; AI availability
  and failure policy must remain aligned, without turning suggestions into automatic payments.
- Tenant-global rules/settings are cross-shop operations. Add new settings/categories/permissions
  jointly in engine validation, UI, shared access catalog, defaults and regression tests.
- Account deactivation/feed lifecycle and last-four linking need coordinated decisions before
  claiming an account is disconnected or historical links are unambiguous.

## Code and source references

- [Routes](../../apps/api/src/modules/bank-statements/bank-statements.routes.ts),
  [service](../../apps/api/src/modules/bank-statements/bank-statements.service.ts),
  [validation](../../apps/api/src/modules/bank-statements/bank-statements.validation.ts),
  [settings/defaults](../../apps/api/src/modules/bank-statements/engine/db.ts),
  [category engine](../../apps/api/src/modules/bank-statements/engine/categorize/engine.ts),
  [built-in/user rules](../../apps/api/src/modules/bank-statements/engine/categorize/rules.ts),
  [supplier suggestions](../../apps/api/src/modules/bank-statements/engine/categorize/suppliers.ts).
- [Feed controller](../../apps/api/src/modules/bank-statements/feeds/feeds.controller.ts),
  [feed service](../../apps/api/src/modules/bank-statements/feeds/feeds.service.ts),
  [secrets](../../apps/api/src/modules/bank-statements/feeds/secrets.ts),
  [Demo provider](../../apps/api/src/modules/bank-statements/feeds/providers/demo.ts),
  [Federal stub](../../apps/api/src/modules/bank-statements/feeds/providers/federal.ts),
  [scheduler](../../apps/api/src/jobs/bank-feeds-scheduler.ts).
- [Rules screen](../../apps/web/src/pages/bank/BankRulesPage.tsx),
  [accounts card](../../apps/web/src/pages/bank/components/BankAccountsCard.tsx),
  [feed UI](../../apps/web/src/pages/bank/components/BankFeedControls.tsx),
  [API adapter](../../apps/web/src/pages/bank/lib/api.ts),
  [feature catalog](../../packages/shared-types/src/features.ts); [context](../CONTEXT.md).

## Verification and acceptance

Source inspection only; no connection, AI call, scheduler run, tests or DB writes performed.
Existing [supplier-match unit tests](../../apps/api/tests/unit/bank-supplier-match.test.ts)
and [upload integration tests](../../apps/api/tests/integration/bank-statement-upload.test.ts)
cover adjacent behavior, not production feed connectivity or the full rule/settings matrix.

Acceptance: precedence/new-rule backfill versus full rerun; regex errors; manual-category
preservation; tenant-global versus shop-local permissions; threshold reflagging; entitlement
on/off; ambiguous last-four links; deactivate/connect behavior; Demo labeling; Federal refusal;
first-sync failure, duplicate sync, overlap skipping and scheduler-disabled state.

## Known gaps and next work

- Federal's `ready=false` provider throws FeedNotReadyError; endpoint/auth/paging/mTLS contract
  awaits the bank's onboarding specification. Only Demo is ready in the provider registry.
- Rule list/delete and settings are tenant-global under `bank.reconcile`; define/accept that
  authority rather than describing them as purely shop-scoped.
- Immediate new-rule application can override a more specific existing user rule, whereas
  full rerun uses documented precedence. Align backfill behavior or explain the difference.
- Account deactivation leaves feed records but excludes them from scheduled runs; manual sync
  lookup does not separately reject inactive accounts. Define the intended lifecycle consistently.
- Scheduled feed entitlement checks the add-on but not the base bank feature, unlike request
  routes. Align feature-off behavior before certifying automatic import policy.
- Regex syntax validation does not establish performance safety for every user pattern.
- No rule edit endpoint or automatic undo on deletion; no base-currency control on this screen,
  and no FX conversion implemented in the analytics.

## Decisions and review checkpoint

Checkpoint **2026-11-10**, source-reviewed, not runtime-certified. Distinguish implemented
feed orchestration/Demo from unimplemented real Federal integration. Flutter is approved/planned
with eventual full authorized web parity, not delivered settings or background behavior.
No checkpoint inventory/hashes were changed by this task.
