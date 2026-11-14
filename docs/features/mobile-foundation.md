# Mobile foundation

## Purpose and scope

Provide a new Flutter client for every authorized tenant role, with eventual web capability
parity delivered in small releases. This is a supporting capability, not a tenant left-rail item.
The first slice is [Customer Searching](customer-searching.md), not a rewrite of every module.

## Implementation status

Source review and foundation implementation: 2026-11-10. The shared app exists; the first
business feature (Customer Searching) is implemented; other modules are placeholders.

| Surface | Status | Evidence / limits |
|---|---|---|
| API | Existing shared backend | [Fastify app](../../apps/api/src/app.ts); Customer Searching register sync (`GET /customer-search/sync`) exists since 2026-11-10. |
| Web | Existing reference client | [Web app](../../apps/web/src/App.tsx); feature docs describe current behavior and gaps. |
| Flutter | Shared foundation + Customer Searching implemented | [Android+iOS app](../../apps/mobile-flutter/README.md): real tenant login/session refresh, secure storage, offline start with the last confirmed identity, access/shop controls, theme, module placeholders, and [Customer Searching](customer-searching.md#what-the-flutter-client-does-implemented-2026-11-10) (encrypted cache, sync, background updates). Push and other modules remain absent. |

Display name **RetailERP**, application/bundle ID `com.retailerpai.mobile`, intended website
`retailerpai.com`. This records branding direction, not domain availability, trademark clearance,
registration, deployment or a change to the API's configured tenant apexes.

The [existing mobile package](../../apps/mobile/package.json) and
[Expo routes](../../apps/mobile/app/) are a legacy employee collection client. Preserve them;
do not treat them as Flutter, extend them for the new app, or delete them without approval.

## Business rules and invariants

- ERP database/API is the source of truth. Google Sheets is the initial import, not an editable
  second master or a mobile sync source.
- Reuse backend business logic and contracts; Dart cannot directly import TypeScript workspace
  packages. Translate DTOs/formatting with contract tests; do not port accounting engines.
- Intended audience is everyone with appropriate permissions, not unrestricted access.
- Initial writes are online. An offline search cache is not an offline-write queue.
- Never infer freshness from the greatest row number, account number, date or cached record:
  older records can be edited/deleted and account numbers repeat.

## Access, tenancy, and shop scope

Follow [authentication and access](authentication-and-access.md). Tenant identification, JWT
refresh, effective permissions, feature switches, shop selection and field restrictions must
work before displaying register data.

Partition local stores by tenant and user; do not reuse or show another identity's data. Cache
only the authorized projection. Owner decision (2026-11-10): the encrypted cache is **kept** on
sign-out and while offline (no offline time limit); it is deleted only when the server reports
the user lost the feature's access, and re-downloaded when the projection (phone visibility)
changes. Online revalidation cannot instantly revoke an already disconnected device.

## User workflows

1. Select/resolve tenant, log in, load identity/permissions and choose an authorized shop.
2. Initialize an authorized register snapshot and show progress/failure/retry explicitly.
3. Search locally immediately, show last-successful-sync and stale/offline states, and request a
   coalesced refresh when connected. A failed refresh must not erase a valid cache.
4. Open details, create or edit online; refresh server-derived fields after save.
5. Logout clears credentials; the user's encrypted register cache stays for their next sign-in
   (owner decision 2026-11-10) and is never shown to another user.

## API contracts and data

Existing API contracts remain authoritative. Flutter needs secure token storage, a typed HTTP
client, refresh coordination, explicit error handling, and contract fixtures.

These authentication foundations now exist in
[core](../../apps/mobile-flutter/lib/core/): explicit `API_BASE_URL`, `X-Tenant-Slug`, bearer and
`X-Shop-Id` headers; login, `/auth/me`, single-flight rotating refresh, selected-shop persistence,
switch-shop and logout. One encrypted platform storage entry holds API/tenant/token/shop
credentials, never a password or customer data; a second entry holds the last
server-confirmed identity (permissions, flags, shops) for offline start, removed on sign-out.
Changing API URL discards the old session before network access.

Network errors and 5xx are explicit and not automatically retried; `ApiException.network` marks
"server not reached" (the request may or may not have run) and `.details`/`.code` carry the
server's `details` (e.g. 409 `stale`). Protected 401s share one refresh then retry once;
terminal 401/refresh 403 clears the session. Session generation checks and serialized storage
writes prevent an old response/refresh restoring a signed-out identity. The background updater
runs in another isolate with its own client: before rotating, and after a refresh 401/403, the
client re-reads secure storage and adopts a newer stored token instead of signing out; a
rotation finishing after sign-out elsewhere is not saved. Logout tries server revocation,
always clears local credentials, and surfaces revocation/storage failure instead of falsely
claiming success.

Register sync uses a consistent snapshot, incremental upserts, deletion tombstones, opaque
tokens, and reset (410) semantics when access or dataset projection changes — implemented on
the API, see [Customer Searching → Mobile sync contract](customer-searching.md#mobile-sync-contract-get-sync).
Cursor advancement must be atomic with local application on the device.

## Web behavior

Use the web's actual feature behavior as the parity reference, including its limitations.
Do not copy desktop tables/forms literally onto a phone or use screenshots as business rules.
Shared API changes must preserve existing web contracts.

## Mobile behavior and differences

Flutter from scratch, staged toward full parity. First release includes login/access foundations,
cached Customer Searching/details and online create/edit. Import/export, deletes, collection
payments and other features remain later slices unless reprioritized.

The current [app shell](../../apps/mobile-flutter/lib/app/app_shell.dart) provides Modules and
Account destinations. Its [catalog](../../apps/mobile-flutter/lib/features/feature_catalog.dart)
mirrors 18 rail capabilities with feature/permission gates; entries without a Flutter screen show
"Coming soon to the mobile app", not mock business screens. Customer Searching opens its real page.
**Owner decision 2026-11-10:** for now everyone except the `owner` role sees only Customer
Searching and Installments (still subject to their permissions and plan) via
`mobileModulesFor`; the owner sees every module they are allowed. This uses the `role` from
`/auth/me` and only trims the phone's list — it is not authorization; an identity cached before
`role` was stored counts as non-owner until the next online check. The
shell receives platform services (`RegisterServices`: encrypted file opener/remover, sync
setting, background scheduler) from `main.dart`, so widget tests can pass fakes. `mobile_app`
must be enabled for module navigation. Otherwise API effective permissions are used directly, not
reimplemented from role names. Server-side checks remain authoritative; the existing
switch-shop endpoint's legacy role restriction can still return 403.

On start, foreground/resume and explicit refresh, access is revalidated. If the server **cannot
be reached**, the app continues with the last server-confirmed identity and shows an offline
banner (owner decision 2026-11-10: no offline time limit); if the server answers with a
failure, protected UI is blocked until it succeeds, and 401/403 on refresh signs out. While a
re-check is running the current screen stays (so a running register download is not torn
down); only a failed check replaces it with the blocking screen.
LAN development uses an explicit reachable PC API URL; debug allows HTTP, profile/release
requires HTTPS. iOS files exist but must be built and verified on macOS/Xcode.

Notifications are the initial requested device capability. Platform/provider setup, permission
prompts, token registration and real delivery still require implementation and verification;
installing a plugin is not working push. Other device integrations are later.

Periodic sync is best-effort while permitted by the OS, not a guaranteed exact timer in the
background. Also sync on foreground/resume and connected search activity, with debounce,
single-flight requests and retry/backoff. Cadence and staleness rule (per-phone 15/30/60 min,
banner at interval + 5 min) are decided in [Customer Searching](customer-searching.md#mobile-behavior-and-differences).

## Dependencies and cross-feature effects

- [Customer Searching](customer-searching.md): first release and delta-sync ownership.
- [Authentication and access](authentication-and-access.md): identity, authorization and cache scope.
- [Settings](settings.md): shops, categories, roles and lookup dependencies.
- [Notifications](notifications.md): current versus planned notification transport.
- All feature docs remain the eventual parity map; do not add a competing mobile business spec.

## Code and source references

- [Legacy Expo package](../../apps/mobile/package.json) and [routes](../../apps/mobile/app/).
- [Flutter developer/integration guide](../../apps/mobile-flutter/README.md),
  [app entry](../../apps/mobile-flutter/lib/main.dart),
  [API client](../../apps/mobile-flutter/lib/core/api_client.dart),
  [session controller](../../apps/mobile-flutter/lib/core/session_controller.dart),
  [secure store](../../apps/mobile-flutter/lib/core/session_store.dart),
  [login page](../../apps/mobile-flutter/lib/features/auth/login_page.dart),
  [Customer Searching code](../../apps/mobile-flutter/lib/features/customer_search/) and
  [tests](../../apps/mobile-flutter/test/) (foundation at the top level, features in subfolders),
  [on-device measurement](../../apps/mobile-flutter/integration_test/register_perf_test.dart).
- [Web API client](../../apps/web/src/lib/api-client.ts) is a behavioral reference, not Dart code.
- [Shared access rulebook](../../packages/shared-types/src/access.ts).
- [Feature inventory](README.md) and [Flutter Customer Searching handoff](../mobile/customer-searching-handoff.md).

## Verification and acceptance

Foundation verification: `flutter analyze` passed; HTTP/session/storage-adapter/widget tests
passed against synthetic fixtures; Android debug APK built successfully. No live ERP login
was certified because the API/PostgreSQL services were not listening during this task.
The APK was installed on the connected Android device and its foreground activity/process and
RetailERP/tenant/username/password/sign-in accessibility labels were verified; no app startup
exceptions were found in its filtered log. Flutter's installer wait stalled despite a completed
installation, so the app was launched directly through adb. The smoke build used the explicit
documentation-only API address, not a configured production or working LAN server.
iOS build/Keychain and push delivery are not verified on this Windows machine.

2026-11-10 (Customer Searching slice): `flutter analyze` clean and `flutter test` 40 passed,
including offline start with a saved identity, no offline start without one or for another
tenant/unassigned shop, unreachable-vs-refused revalidation, identity saved and removed on
sign-out, a background-rotated refresh token adopted, and a late rotation after sign-out not
saved. On the OPPO CPH2521 (debug build, API over `adb reverse`), the real app signed in to a
synthetic tenant and used Customer Searching; measured timings are in
[Customer Searching → Verification](customer-searching.md#verification-and-acceptance).
Device notes: this phone shows an "Install / Continue installation" prompt for every
USB install, so `flutter run`/`flutter test -d` waits until it is accepted on the phone; the
system Back gesture did not leave a module placeholder during adb testing (the app-bar back
arrow did) — not investigated. `workmanager_android` applies the Kotlin Gradle Plugin, which
Flutter warns will stop building in a future version.
2026-11-14: USB/adb to the OPPO CPH2521 kept dropping mid-install; installing the debug APK from the
phone's browser (served temporarily over the LAN from the dev PC) worked; it installs as an update,
so app data stays (the owner then searched the existing copy).
Feature slices must prove restricted-field exclusion, sync interruption recovery,
update/deletion propagation, offline read behavior and online-write failures, and measure
performance on synthetic data against agreed targets on a real device — serialized size alone
does not establish RAM or index footprint.

## Known gaps and next work

Other business screens, offline writes and Flutter push delivery remain unimplemented.
Android is the first validation target with iOS project files included; both use the same Dart
client. The cache uses SQLCipher-encrypted SQLite (owner decision); cadence and performance
targets are recorded in [Customer Searching](customer-searching.md#mobile-behavior-and-differences);
notification provisioning is deferred. Background WorkManager updates were observed running on the
OPPO phone (2026-11-10/11, see [Customer Searching → Verification](customer-searching.md#verification-and-acceptance));
release-build timings are not measured. There is no in-app update prompt: a phone on an old build keeps
old client rules (2026-11-14: a 2026-11-11 build could not find `MN 1`-format account numbers until the
current build was installed). All-shops aggregate selection and password changes are not
implemented in the foundation. Release signing exists since 2026-11-14: release builds use the
key from `%USERPROFILE%\.retailerp\android\key.properties` and fail without it (debug builds are
unchanged); `tool/build-release-apk.ps1` builds, obfuscates and verifies them, and the app version
is `1.0.0` with strictly increasing build numbers — see
[deployment and release](deployment-and-release.md). The real keystore is not created yet, and
phones with a debug-signed build must uninstall it before the first release build. Preserve Expo
and its npm commands.

## Decisions and review checkpoint

2026-11-10: Flutter replaces Expo as the development direction; all authorized roles, eventual
full parity, incremental releases. ERP-only master; cached Customer Searching with online
create/edit is the first business slice. The coordinator now owns the shared skeleton and real
authentication foundation; feature chats extend it rather than scaffold another application.
Android+iOS project files and LAN configuration were approved, as were the RetailERP name and
`com.retailerpai.mobile` ID.
Reviewed source hashes live in [checkpoints.json](checkpoints.json).
