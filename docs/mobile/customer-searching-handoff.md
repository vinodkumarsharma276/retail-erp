# Flutter Customer Searching: first feature handoff

## Start here

The user approved this scope on 2026-11-10. **Status (2026-11-10, feature chat):** the register
sync API and the Flutter first release (encrypted cached search/details, online create/edit,
background updates) are implemented, tested and measured on an Android phone with synthetic
data. The checklist below shows what is still open.

Agents must load [AGENTS.md](../../AGENTS.md), the [feature index](../features/README.md),
[Customer Searching](../features/customer-searching.md),
[mobile foundation](../features/mobile-foundation.md), and
[authentication/access](../features/authentication-and-access.md). Run the
[context refresh skill](../../.claude/skills/update-feature-docs/SKILL.md) without asking the user
to manually assemble these documents.

## Approved product scope

- Extend the existing [Flutter foundation](../../apps/mobile-flutter/README.md) at
  `apps/mobile-flutter`; do not recreate it or extend Expo. `apps/mobile` remains intact.
  Flutter is not an npm workspace package.
- Shared foundation already implements real tenant login, secure credentials, session
  restoration/refresh, access/shop controls, theme and placeholder navigation. Reuse its
  `SessionController` / `ApiClient`; first replace the Customer Searching placeholder.
- Android is the first validation target, iOS project files are included, and API access is
  explicitly configured for the LAN. RetailERP name / `com.retailerpai.mobile` ID are settled.
- All authorized tenant roles; eventual full web parity, delivered incrementally.
- First release: tenant/login/session/shop foundations; locally cached Customer Searching,
  entry details, **create and edit** through the existing ERP API while online.
- ERP database/API is authoritative. Google Sheets is import-only, not a live synchronization
  source. No Google OAuth/Sheets polling is needed.
- Device notifications are wanted initially; document and verify real provider/token/delivery
  work separately instead of calling a token-registration stub complete.
- Local register cache should refresh periodically where OS permits, on app foreground/resume,
  and opportunistically when searching. Do not block immediate cached search on the network.

## Confirm before feature implementation

**Confirmed 2026-11-10** — recorded in [Customer Searching → Mobile behavior](../features/customer-searching.md#mobile-behavior-and-differences):
encrypted per-user cache kept until lost access (no offline time limit), per-phone 15/30/60-min
Android background refresh plus foreground triggers, stale banner at interval + 5 min, the
performance targets, idempotent create + version-checked edit, employee defaults unchanged,
notifications deferred to a later slice. Do not reopen these without the owner.

Writes stay online-only for release one: no queued offline mutations, automatic merge,
silent retries of uncertain create requests, or last-writer-wins on device edits. Retain form
input and show an actionable error if a save fails.

## Existing behavior to preserve

- One register entry per bought item; **Account Number**, not ID, may repeat.
- Tenant-wide register reads are intentional; write target shops are authorized separately.
- Match/link customers by normalized name + mobile, not shared mobile alone. Support existing
  customer selection and co-applicant linking.
- Account prefix/next-number suggestions are advisory. Handle duplicate-number 409 with the
  server's suggestion and explicit "Save anyway" (`allowDuplicate`) confirmation.
- Preserve type hierarchy/leaf rules, date-only `yyyy-mm-dd`, nullable imported fields and
  review issues. Do not silently repair imported data or turn absent restricted fields into
  real empty values.
- Current search is case-insensitive substring matching, not fuzzy/AI name search. Name
  similarity helpers serve import/form identity suggestions, not the register query.
- No `sales.view_real` prerequisite for the register. A linked sale is optional and still
  requires its own access. Do not cache finance/installment data as part of this first slice.
- Current employee defaults do not include Customer Searching: a wider intended audience does
  not authorize silently expanding default permissions. Confirm any grants explicitly.

## Required sync design: implemented on the API (2026-11-10)

The contract below is implemented as `GET /api/v1/customer-search/sync` — see
[Customer Searching → Mobile sync contract](../features/customer-searching.md#mobile-sync-contract-get-sync).
A trigger-written change log with transaction-id watermarks replaced the "candidate" wording;
pruning/retention is still open. The original requirements remain the acceptance criteria:

The existing paginated register listing is not a consistent bulk/delta protocol. Do not fetch
all data by increasing page numbers while live writes occur and assume a complete snapshot.
Sorting by purchase date/account number is not a stable change cursor.

1. **Bootstrap:** stable snapshot boundary, deterministic unique ordering, chunk/page tokens,
   dataset/access projection version and completion marker.
2. **Delta:** opaque monotonic cursor over changes, bounded batches, upserts and deletion
   tombstones. Handle edits to old rows, bulk import, shop moves, customer-linked display
   changes, category-path changes and issue/count recomputations that affect cached results.
3. **Atomicity:** mutation and its change event must commit together. Capture every write path
   (create/edit/delete/import/backfill/derived updates), not just the Flutter client.
4. **Consistency:** never lose changes between bootstrap and delta catch-up. Define duplicate
   replay, concurrent updates, cursor expiry/retention and reset-required responses.
5. **Authorization:** scope data to the resolved tenant and permission-filtered projection,
   including nested phones/raw values. Do not use the export permission as a substitute for
   list access. Keep detail-only data behind its own permission.
6. **Client application:** transactionally upsert/delete and advance the cursor; interruption
   must allow safe retry. Preserve the last complete usable cache during bootstrap replacement.
7. **Reset:** tenant/user changes, access revocation or projection changes purge/rebootstrap
   the applicable cache. Stale phone fields must not survive a downgrade.

An opaque database change-log sequence is a candidate, not an already approved schema.
Timestamp-only `updatedAt > lastTime` loses ties and misses hard deletions unless deliberately
augmented; "fetch rows after the last cached record" is insufficient.

## Flutter delivery slices

1. Load and verify the existing Flutter foundation; confirm remaining cache/access decisions.
2. Reuse tenant-aware auth/session/permission/shop infrastructure and extend regression tests.
3. Add tested backend snapshot/delta contracts while preserving web API behavior.
4. Add persistent local register storage and indexed substring-compatible search; refresh with
   single-flight requests, visible last-sync state, retry/backoff and foreground/search triggers.
5. Add details and online create/edit with live helpers and validated errors; reconcile the
   saved record and affected derived records through sync.
6. Wire and verify agreed notification transport (or explicitly report provisioning blockers).
7. Verify end-to-end on a target device; refresh docs and checkpoints; hand back remaining gaps.

## Acceptance checklist

Evidence: [Customer Searching → Verification](../features/customer-searching.md#verification-and-acceptance).

- [x] Shared Flutter shell installed/launched and login form verified on Android; Expo untouched.
- [ ] Live ERP authentication on the configured LAN server and iOS build/device validation.
      (Live login verified against a synthetic-data API over USB `adb reverse`, not LAN; iOS not.)
- [x] Authorized roles can log in and see only permitted capabilities/fields. (Permission-gated
      catalog/buttons; phones absent for a user denied `customers.view_phone`, verified over HTTP.)
- [x] A synthetic approximately 58,000-row bootstrap completes with measured size, RAM/storage,
      search latency and sync duration against agreed budgets (60,000 rows: 55.6 MB, search
      p95 142 ms, download 25 s over USB, 1,000 changes 1.85 s; debug build; RAM not measured).
- [x] Search by name, account, eligible mobile, co-applicant, area/product and required filters
      matches agreed web semantics; old rows edited on web update locally. (Host tests on both
      search paths. The phone UI uses a "Search in" column picker instead of filter chips —
      owner decision 2026-11-10.)
- [x] Hard deletions, imports, duplicate issue changes, customer relinks and category renames
      converge without a full reload or stale derived display (API CS16–CS20 + Flutter tests).
- [x] Crash/restart mid-bootstrap and mid-delta does not lose/duplicate records or advance
      the cursor past unapplied changes (atomic page + token; dropped-page tests).
- [x] Offline search shows cache age; partial/failed refresh is explicit and retains usable data.
- [x] Online create/edit, duplicate 409 confirmation, invalid date/type, forbidden shop and
      server/network errors preserve correct state and user input (widget tests + API tests;
      full create/edit not driven through the phone UI).
- [x] Double taps/uncertain response handling cannot silently create duplicate writes
      (`clientRequestId`, Save disabled while saving).
- [x] Token expiry, disabled feature, permission downgrade, logout and tenant/user switching
      enforce the agreed cache lifecycle and offline authorization policy (kept on sign-out,
      per-user files, deleted on server-confirmed lost access, 410 projection reset).
- [ ] Notifications are actually delivered/tested, or clearly marked blocked/not delivered.
      (Deferred by the owner; not delivered.)
- [x] Web contract regression tests, Flutter tests/static analysis and device smoke checks pass.
- [ ] Android background WorkManager update observed running on a device; release-build and
      Wi-Fi timings; API response compression decision.
- [x] Feature docs, index, source mappings and reviewed checkpoints reflect delivered behavior.

## Copyable next-chat request

> Implement the first Flutter Customer Searching slice using
> `docs/mobile/customer-searching-handoff.md`. This chat owns Customer Searching across API,
> web and Flutter. Load the feature context yourself and follow update-feature-docs.
> Reuse the shared `apps/mobile-flutter` shell, login, API client and session store.
> Confirm remaining cache/access decisions; do not scaffold another app. Preserve Expo,
> keep ERP authoritative, and include cached search/details plus online
> create/edit. Do not claim delta sync or notifications work without verification.
