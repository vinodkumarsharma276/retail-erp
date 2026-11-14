# Deployment and release

## Purpose and scope

Supporting capability (no left-rail item): getting RetailERP off the developer PC so the shops can
test it — a hosted API + PostgreSQL, the web app on a reachable HTTPS address, and an installable
Android APK of the [Flutter app](mobile-foundation.md) pointing at that API. It also owns CI/CD,
infrastructure-as-code, environment/secrets configuration, database migration on deploy, backups,
release signing and versioning.

It does **not** own feature behavior. Domain/tenant routing rules live in
[authentication and access](authentication-and-access.md); the SaaS operator console in
[platform administration](platform-administration.md).

## Implementation status

Reviewed 2026-11-14 from source. **Nothing is deployed**; the app runs only on the developer PC.

| Surface | Status | Evidence / limits |
|---|---|---|
| Infrastructure | Scaffolded, never run | [main.bicep](../../infra/azure/main.bicep): App Service B1 (Node 22), PostgreSQL Flexible B1ms, Static Web App (Free), Storage, Key Vault. [deploy.sh](../../infra/azure/deploy.sh) (bash) provisions it, stores JWT secrets in Key Vault, zip-deploys the API. No resource group or Azure resources are known to exist. |
| API packaging | Scaffolded | [Dockerfile](../../apps/api/Dockerfile) multi-stage Node 22 image; runs `prisma migrate deploy` on start. Bicep instead configures a code (zip) deploy with `NODE|22-lts`, so the Dockerfile is unused by the current scripts. |
| Web packaging | Scaffolded | `vite build` output deployed to Static Web Apps by CI. No production `VITE_API_URL`/tenant settings are defined anywhere. |
| CI/CD | **Active on push to `main`** | [ci.yml](../../.github/workflows/ci.yml) typechecks/builds, then on a push to `main` runs `prisma migrate deploy` against `secrets.DATABASE_URL` and deploys to App Service + Static Web Apps. Repository secrets are not known to be configured; root typecheck currently fails (≈130 pre-existing API errors), so the deploy jobs would not run today. |
| Android APK | Debug only | `flutter build apk --debug` with a LAN `API_BASE_URL` works for development. Release build type is **signed with the debug key** ([build.gradle.kts](../../apps/mobile-flutter/android/app/build.gradle.kts)); no keystore, no version policy (`0.1.0+1`). |
| iOS | Not started | Needs macOS/Xcode and an Apple developer account. |

## Business rules and invariants

- Deployment must preserve every invariant in [AGENTS.md](../../AGENTS.md): tenant isolation,
  shop scope, permission checks, dual sale recording. Nothing in hosting may bypass them.
- **Real business data is sensitive** (customer names, mobiles, Aadhaar, finance details). Copying
  the local dev database to a hosted server is a deliberate decision, not a default; seed/test data
  must not be confused with production data. Never commit dumps, secrets or connection strings.
- Schema changes reach a hosted database only through committed Prisma migrations
  (`prisma migrate deploy`), never `migrate dev`/`db push`.
- The API must have real secrets in production: `JWT_SECRET`/`JWT_REFRESH_SECRET` fall back to
  `dev-secret` values when unset ([config](../../apps/api/src/config/index.ts)), which is unsafe.
- Profile/release Flutter builds require an **HTTPS** API URL (enforced by the app's API config);
  only debug builds allow HTTP.
- ERP is authoritative; Google Sheets remains import-only.

## Access, tenancy, and shop scope

- Tenant resolution ([tenant-resolver.ts](../../apps/api/src/middleware/tenant-resolver.ts)):
  `X-Tenant-Slug` header → first host label under `TENANT_APEX_DOMAINS` (default `retailerp.com`)
  → localhost fallback `BOOTSTRAP_TENANT_SLUG` (default `vn`).
- Web resolves the slug from `VITE_TENANT_SLUG`, localhost default, or host under
  `VITE_TENANT_APEX_DOMAINS` (default `retailerp.com`) ([api-client.ts](../../apps/web/src/lib/api-client.ts)).
  On a host such as `*.azurewebsites.net` without a custom domain, a single-tenant test build needs
  `VITE_TENANT_SLUG`; wildcard tenant subdomains need a real domain and DNS.
- The platform console mounts on an `admin.*` host or with `VITE_FORCE_PLATFORM_ADMIN=true`.
- CORS: `CORS_ORIGIN` (comma-separated exact origins); dev-only `*.localhost` allowances are off
  when `NODE_ENV=production` ([app.ts](../../apps/api/src/app.ts)).
- Intended brand website is `retailerpai.com` (not registered by any task); API/web tenant apex
  defaults still say `retailerp.com`. Changing either is a decision for this feature.
- Shop testers need user accounts with the right roles/permissions on the hosted tenant; hosting
  does not grant access.

## User workflows

Target workflow for shop testing (planned, not implemented):

1. Operator provisions hosting, sets secrets, runs migrations, creates/loads the tenant data.
2. Staff open the web app at an HTTPS address and log in with their tenant account.
3. Staff install the RetailERP APK (sideloaded), which is built with the hosted HTTPS API URL;
   it logs in, caches Customer Searching and keeps it updated in the background.
4. A new build is released by deploying the API/web and distributing an APK with a higher
   version code (installs over the old one when signed with the same key).
5. Rollback: redeploy the previous build; a migration that cannot be reversed needs a backup.

## API contracts and data

- Health checks: `GET /api/health` and `/api/ready` ([app.ts](../../apps/api/src/app.ts)). Bicep's
  App Service `healthCheckPath` is `/health`, which does not exist — fix before relying on it.
- API runtime settings: `DATABASE_URL`, `JWT_SECRET`, `JWT_REFRESH_SECRET`, `API_PORT`, `API_HOST`,
  `CORS_ORIGIN`, `NODE_ENV`, `TENANT_APEX_DOMAINS`, `BOOTSTRAP_TENANT_SLUG`, `ENABLE_SCHEDULER`
  (+ cron settings), `BANK_FEED_SECRET_KEY` (required to store bank-feed credentials),
  `OPENAI_API_KEY`/OCR settings (features disabled when absent). See
  [.env.production.example](../../apps/api/.env.production.example).
- `AZURE_STORAGE_*` settings are provisioned by Bicep but not read by API source today.
- Web build settings: `VITE_API_URL` (without it the web calls `http://<host>:3001/api/v1`, which
  is wrong for a hosted site), `VITE_TENANT_SLUG`, `VITE_TENANT_APEX_DOMAINS`,
  `VITE_PLATFORM_ADMIN_SUBDOMAIN`, `VITE_FORCE_PLATFORM_ADMIN`.
- Flutter build setting: `--dart-define=API_BASE_URL=<https URL>` (mandatory; `/api/v1` optional).

## Web behavior

The web is a static Vite/React SPA (PWA). Hosting must serve `index.html` for client-side routes
and send API calls to `VITE_API_URL`. [DEPLOYMENT_PLAN.md](../DEPLOYMENT_PLAN.md) recommends
serving the SPA and API from one App Service behind Cloudflare (needs `@fastify/static` and a
Dockerfile stage, not implemented); the current Bicep/CI instead use Static Web Apps.

## Mobile behavior and differences

- Shop testing needs an APK built in **release** mode against an HTTPS API, signed with a dedicated
  upload/release keystore kept outside the repository (losing it prevents upgrade installs).
- Distribution for testing is sideloading (USB, file share or link); Play Store/internal testing
  track is a later decision. The test phone shows a "Continue installation" prompt per install.
- Background updates and encrypted cache come from [Customer Searching](customer-searching.md);
  verify them on the release build, since timings differ from debug.
- Notifications are not implemented; no push provider is configured.

## Dependencies and cross-feature effects

- [Authentication and access](authentication-and-access.md): tenant apex, CORS, token lifetime.
- [Mobile foundation](mobile-foundation.md): API URL rules, HTTPS enforcement, app identity.
- [Customer Searching](customer-searching.md): sync log migrations and the first mobile release.
- [Platform administration](platform-administration.md): tenant onboarding on hosted servers.
- [Bank rules](bank-rules.md) / [Installments](installment.md): jobs run only with `ENABLE_SCHEDULER=true`.
- Root typecheck errors block the current CI deploy jobs.

## Code and source references

- Infrastructure: [infra/azure/main.bicep](../../infra/azure/main.bicep),
  [infra/azure/deploy.sh](../../infra/azure/deploy.sh)
- CI/CD: [.github/workflows/ci.yml](../../.github/workflows/ci.yml)
- API image/config: [apps/api/Dockerfile](../../apps/api/Dockerfile),
  [apps/api/.env.production.example](../../apps/api/.env.production.example),
  [apps/api/src/config/index.ts](../../apps/api/src/config/index.ts)
- Web API/tenant config: [apps/web/src/lib/api-client.ts](../../apps/web/src/lib/api-client.ts),
  [apps/web/src/lib/host.ts](../../apps/web/src/lib/host.ts)
- Android release config: [build.gradle.kts](../../apps/mobile-flutter/android/app/build.gradle.kts),
  [pubspec.yaml](../../apps/mobile-flutter/pubspec.yaml),
  [Flutter README](../../apps/mobile-flutter/README.md)
- Hosting options and costs: [DEPLOYMENT_PLAN.md](../DEPLOYMENT_PLAN.md) (April 2026 prices, assumes `retailerp.com`)
- Local database: [docker-compose.yml](../../docker-compose.yml)

## Verification and acceptance

Source inspection only; nothing was deployed or built for release in this review.

Acceptance for the first shop-test release:

- [ ] Hosting target, region, domain/HTTPS address and monthly cost approved.
- [ ] Hosted PostgreSQL migrated with `prisma migrate deploy`; backups enabled and a restore tried.
- [ ] Production secrets set outside the repository; no dev JWT fallback in use.
- [ ] Web loads over HTTPS, logs in to the intended tenant, and calls the hosted API (no `:3001`).
- [ ] CORS allows only the hosted web origin(s); tenant isolation checked with a second tenant/user.
- [ ] Release APK signed with a non-debug key, HTTPS API URL, installs and logs in on the shop phone.
- [ ] Customer Searching cache/background update works against the hosted API on mobile data.
- [ ] Automatic CI deploy on push to `main` either configured deliberately or disabled.
- [ ] Release/rollback steps written into this document.

## Known gaps and next work

- No hosting chosen or provisioned; Bicep, `deploy.sh` (bash, the dev machine is Windows) and CI
  disagree with the recommended single-App-Service plan. Bicep's health probe path is wrong.
- Web has no production API URL/tenant configuration.
- JWT secrets fall back to dev values; `.env.production.example` lacks `TENANT_APEX_DOMAINS`,
  `BOOTSTRAP_TENANT_SLUG`, `ENABLE_SCHEDULER`, `BANK_FEED_SECRET_KEY`.
- Android release signing, versioning and APK distribution are not set up.
- CI deploys on push to `main` without an approval gate; blocked today only by typecheck failures.
- Open decisions: hosting provider/cost; domain (`retailerpai.com` vs provider default host);
  single-tenant test vs wildcard tenants; what data goes to the hosted DB (seed, fresh entry, or a
  copy of local data); who gets accounts; OCR/AI key on the server; scheduler on/off.

## Decisions and review checkpoint

- 2026-11-14: Deployment and release is its own feature, owned by a dedicated chat.
- Earlier: Azure Option A (App Service B1 + PostgreSQL B1ms + Cloudflare) recommended in
  [DEPLOYMENT_PLAN.md](../DEPLOYMENT_PLAN.md); not approved or executed.
- App identity RetailERP / `com.retailerpai.mobile`; intended website `retailerpai.com`
  (registration not done).

The machine-readable source inventory and hashes live in `docs/features/checkpoints.json`.
