# RetailERP Flutter foundation

New Android + iOS client. Application ID / bundle ID: `com.retailerpai.mobile`.
Display name: **RetailERP**; proposed website: `retailerpai.com`. This does not configure a
domain, change existing tenant apexes or provision any hosting. Legacy Expo remains in
[apps/mobile](../mobile/); its npm scripts are unchanged.

## What works

- Explicit tenant login against the existing API, `/auth/me` identity/access validation.
- Encrypted platform credential storage, session restore, coordinated refresh-token rotation
  (shared safely with the background updater: a token rotated by the other isolate is adopted
  instead of signing out), bounded 401 retry, shop selection, logout and visible failure states.
- API/tenant/shop headers, typed error handling (`ApiException.details` / `.code`, `.network`
  for "server not reached"), list envelopes retaining pagination.
- Material 3 light/dark theme, Modules / Account shell, all 18 rail capabilities represented by
  permission/feature-gated entries. No role-name shortcuts.
- Session/access revalidation on foreground and explicit refresh. If the server **cannot be
  reached**, the app continues offline with the last server-confirmed identity (saved in secure
  storage, removed on sign-out) and shows an offline banner; a server refusal still blocks.
- **Customer Searching** (first business feature, [feature doc](../../docs/features/customer-searching.md)):
  encrypted on-device register (SQLCipher, one file + key per tenant/user, kept on sign-out,
  deleted when the server confirms access is gone), download via `GET /customer-search/sync`
  with atomic page application and resumable interruption, local search matching the web's
  rules and filters, entry details (cached, plus online-only creator/import/sale details),
  online create/edit with retry-safe saves, duplicate-number and changed-by-someone-else
  handling, last-updated banner, Account → update interval (15/30/60 min or app open only),
  Android background updates via WorkManager.

Other business screens, offline writes, push delivery and password changes are **not
implemented**. Release signing is set up (below); iOS is untested.

## Run on a LAN-connected Android device

Install Flutter/Dart, Android tools and accept the Android SDK licenses yourself if requested.
The phone and PC must share a reachable network; a phone's `localhost` is not the PC.

1. Start PostgreSQL and the existing ERP API using the root repository instructions. The API
   must listen on a LAN-accessible address; allow the development port in your firewall only
   for trusted networks. Do not expose the database or development API publicly.
2. Find the PC's LAN IP and replace the example address below. `192.0.2.1` is deliberately a
   documentation-only address, **not** a working default.

```powershell
Set-Location apps\mobile-flutter
flutter pub get
flutter devices
flutter run --dart-define=API_BASE_URL=http://192.0.2.1:3001
```

`API_BASE_URL` is mandatory and may include `/api/v1`. There is no implicit localhost, tenant,
username or password. Enter the tenant slug and your existing credentials on the login screen.
Passwords are never persisted or whitespace-trimmed.

Plain HTTP is allowed only in debug builds (Android debug manifest); use trusted LANs for
development. Release/profile builds require HTTPS. No certificate bypass is installed.
Do not pass credentials or API keys through Dart defines.

## iOS

Project files, RetailERP display name, bundle ID, local-network usage description and secure
storage Keychain entitlements are included. Building, signing and testing require macOS/Xcode.
On a Mac use `flutter run` with the same API define, preferably HTTPS. Validate local-network
permission and App Transport Security behavior on the target iOS version before using LAN HTTP.
App Store signing/provisioning is not configured.

## Release APK (shops)

Release builds are signed with the release key kept **outside the repository**
(`%USERPROFILE%\.retailerp\android\key.properties` + `upload-keystore.jks`, or the file named by
`RETAILERP_ANDROID_KEY_PROPERTIES`). Without it a release build fails; debug builds don't need it.

```powershell
Set-Location apps\mobile-flutter
.\tool\create-release-keystore.ps1          # once; back up both files it creates
.\tool\build-release-apk.ps1 -BuildNumber 2 # each release: a higher number every time
```

The build script uses `https://api.retailerpai.com`, obfuscates Dart code (symbols kept beside
the APK in `%USERPROFILE%\.retailerp\android\releases`), refuses debug-signed output and prints the
APK SHA-256. Phones with a debug build must uninstall it before the first release build. Full
release and rollback steps: [deployment and release](../../docs/features/deployment-and-release.md).

## Validate

```powershell
dart format --output=none --set-exit-if-changed lib test integration_test
flutter analyze
flutter test
flutter build apk --debug --dart-define=API_BASE_URL=http://192.0.2.1:3001
```

Tests use synthetic API responses, not real customer data or live credentials. A passed mocked
login test is not a certified live ERP login. The API/database must be available to perform that
end-to-end test. iOS Keychain/device behavior must be tested separately on a Mac.
Host tests use `sqflite_common_ffi` (unencrypted, in memory); the phone uses SQLCipher.

### Measuring the register on a phone

[integration_test/register_perf_test.dart](integration_test/register_perf_test.dart) downloads
the register from a server holding **synthetic** data, then times search and change application
on the encrypted copy and prints `PERF_RESULT {...}`. Never point it at real customer data.
Over USB, `adb reverse tcp:3101 tcp:3101` lets the phone reach a PC API at
`http://127.0.0.1:3101` (USB timings are not Wi-Fi timings). Credentials go in
`--dart-define=PERF_TENANT/PERF_USER/PERF_PASSWORD` at run time; never commit them.
A phone that was pointed at a synthetic server keeps that encrypted copy (sign-out keeps it by
design): afterwards uninstall the app (`adb uninstall com.retailerpai.mobile`; `pm clear` is
refused on some phones) and reinstall a build pointed at the real server, so nobody mistakes
made-up rows for the business's register.

## Feature-chat integration contract

Read [AGENTS.md](../../AGENTS.md), the [feature index](../../docs/features/README.md), the owning
feature document, and [mobile foundation](../../docs/features/mobile-foundation.md).

| Location | Ownership |
|---|---|
| [lib/app](lib/app/) | Application lifecycle gate, theme and authenticated shell |
| [lib/core](lib/core/) | API configuration/client, session DTOs, secure store and session controller |
| [lib/features/auth](lib/features/auth/) | Working login form |
| [lib/features/customer_search](lib/features/customer_search/) | Customer Searching: encrypted register store, sync, background updates, screens |
| [feature_catalog.dart](lib/features/feature_catalog.dart) | Feature IDs, labels, permission/feature visibility |
| [test](test/) | Synthetic HTTP, session, storage-adapter and widget regression tests |

Add a feature under `lib/features/<feature_name>/`. Replace only that entry's shell placeholder
with its real page; add a small page dispatch function when the first feature needs it. Reuse
the current `SessionController` and `ApiClient` rather than making another `MaterialApp`,
token store, login flow, HTTP interceptor or parallel feature catalog.

`api.request(...)` unwraps object data. `api.requestEnvelope(...)` preserves the full successful
response, including array `data` and `pagination`; use it for paginated register queries. Pass
relative endpoints such as `customer-search?page=1`, never absolute URLs. Network errors/5xx are
not automatically retried; mutations with uncertain outcomes need a deliberate policy.

Server `/auth/me` permissions are authoritative, including feature/prerequisite filtering.
`mobile_app` must be enabled for module navigation. API checks remain mandatory regardless of UI.
Shop switching uses `shop.switch` in UI; existing API legacy role restrictions can still return
403 and are surfaced rather than bypassed. All-shops aggregate selection is not implemented.

Before adding customer persistence to another feature, follow the Customer Searching pattern:
identity-partitioned encrypted storage, server-confirmed lost-access cleanup and projection
resets. There is still no offline write queue.

First feature: [Customer Searching handoff](../../docs/mobile/customer-searching-handoff.md).
Update affected feature docs/source mappings and run the documentation checkpoint workflow after
each meaningful slice. Flutter lives outside npm workspaces; npm typecheck/build does not
validate Dart.
