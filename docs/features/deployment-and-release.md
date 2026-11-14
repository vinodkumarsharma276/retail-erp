# Deployment and release

## Purpose and scope

Supporting capability (no left-rail item): getting RetailERP off the developer PC so the shops can
test it — a hosted API + PostgreSQL, the web app on an HTTPS address, and a release-signed Android
APK of the [Flutter app](mobile-foundation.md) pointing at that API. It owns CI/CD,
infrastructure-as-code, production configuration and secrets handling, database migration on
deploy, backups/restore, release signing, versioning, and the release/rollback procedure.

It does **not** own feature behavior. Tenant routing rules live in
[authentication and access](authentication-and-access.md); tenant onboarding in
[platform administration](platform-administration.md).

## Implementation status

Reviewed 2026-11-14 from source and local verification. **Nothing is deployed yet**: no cloud
account, server, DNS record or hosted database exists. Phase 1 (everything that can be built and
tested on the PC) is done; Phase 2 (accounts, server, data copy, first release) needs the owner.

| Surface | Status | Evidence / limits |
|---|---|---|
| Hosting design | Approved, not provisioned | Web on Cloudflare Pages; API + PostgreSQL 16 + Caddy on one Linux VM with Docker ([infra/vm](../../infra/vm/)); target Oracle Cloud Always Free (India region). Same stack runs unchanged on any paid VM. |
| API build/image | Implemented, verified locally | [build.mjs](../../apps/api/scripts/build.mjs) bundles the API (inlines the TS-only `@retailerp/*` packages) to `dist/index.js`. [Dockerfile](../../apps/api/Dockerfile): Node 22 slim, non-root, `tini`, `/api/ready` health check, Prisma CLI + migrations included, **no migrate-on-start**. Builds amd64 locally; arm64 is built by CI on an arm runner. |
| Production config | Implemented, unit-tested | API refuses to start with `NODE_ENV=production` when JWT secrets are missing/short/dev/equal, `DATABASE_URL` missing, or `CORS_ORIGIN` empty/non-https ([config](../../apps/api/src/config/index.ts), [index.ts](../../apps/api/src/index.ts)). `TRUST_PROXY`, `RATE_LIMIT_MAX`. `GET /api/ready` checks the database. |
| Server stack | Implemented, verified in a sandbox | [compose.yml](../../infra/vm/compose.yml) (DB on an internal network, never published), [Caddyfile](../../infra/vm/Caddyfile) (Let's Encrypt, zstd/gzip, 60 MB bodies, HSTS), [bootstrap.sh](../../infra/vm/bootstrap.sh), [deploy.sh](../../infra/vm/deploy.sh), [backup.sh](../../infra/vm/backup.sh), [restore.sh](../../infra/vm/restore.sh), [ci-deploy.sh](../../infra/vm/ci-deploy.sh), [stack.sh](../../infra/vm/stack.sh). `bootstrap.sh` itself is only lint-checked (needs a real Ubuntu VM). |
| Web | Implemented, production build verified | One build serves `vn.retailerpai.com` (tenant from host) and `admin.retailerpai.com` (platform console). [_redirects](../../apps/web/public/_redirects), [_headers](../../apps/web/public/_headers), [.env.production.example](../../apps/web/.env.production.example). PWA precache limit raised to 4 MiB (the 2.2 MB main bundle failed the production build before). |
| CI/CD | Implemented, lint-checked, not run on GitHub | [ci.yml](../../.github/workflows/ci.yml): `check` (typecheck, API unit+integration tests, build) on push/PR; deploy jobs only when variable `DEPLOY_ENABLED=true`. Azure deploy jobs removed. |
| Android APK | Implemented, verified locally | Release builds sign only with a key outside the repo and **fail** without it (debug unchanged) ([build.gradle.kts](../../apps/mobile-flutter/android/app/build.gradle.kts)). [create-release-keystore.ps1](../../apps/mobile-flutter/tool/create-release-keystore.ps1), [build-release-apk.ps1](../../apps/mobile-flutter/tool/build-release-apk.ps1). App version `1.0.0`. Real keystore not created yet (owner). |
| Azure scaffolding | Legacy, unused | [infra/azure](../../infra/azure/) and [staticwebapp.config.json](../../apps/web/staticwebapp.config.json) kept for reference only (Bicep health path corrected to `/api/ready`). [DEPLOYMENT_PLAN.md](../DEPLOYMENT_PLAN.md) is superseded. |
| iOS | Not started | Needs macOS/Xcode and an Apple developer account. |

## Business rules and invariants

- Deployment preserves every invariant in [AGENTS.md](../../AGENTS.md): tenant isolation, shop
  scope, permission checks, field stripping, dual sale recording. Hosting adds no bypass.
- **Real business data is sensitive.** Approved: the hosted database starts as a copy of the local
  database (real data only). Dumps are made outside the repository, moved over SSH, deleted after
  verification, and never committed. `.gitignore`/`.dockerignore` refuse `*.env`, `*.dump`,
  `*.jks`, `key.properties`, `backups/`.
- Schema changes reach a hosted database only through committed migrations, applied by
  `deploy.sh` (`prisma migrate deploy` in a one-off container) **after** a pre-deploy backup.
  Migrations are forward-only; schema rollback = restore that backup.
- The API never starts in production with development secrets (see Implementation status).
- `ENABLE_SCHEDULER=true` on exactly **one** API instance (cron runs in-process). Do not scale out
  without moving the jobs.
- `BANK_FEED_SECRET_KEY` encrypts stored bank credentials; changing it means re-entering every
  connection. The local `.env` had no key, so the local database holds no stored credentials and
  the server's generated key is safe to use.
- Every released APK is signed with the same release key; losing it forces every phone to
  uninstall (losing its offline register copy). Build numbers only increase.
- Flutter profile/release builds require an **https** API URL; only debug allows HTTP.
- ERP is authoritative; Google Sheets remains import-only.

## Access, tenancy, and shop scope

- Hosted addresses: `vn.retailerpai.com` (tenant `vn` web), `admin.retailerpai.com` (platform
  console), `api.retailerpai.com` (API). The web and app send `X-Tenant-Slug`, so the API host
  needs no tenant subdomain. Tenant apex default is now `retailerpai.com` in API and web
  (`TENANT_APEX_DOMAINS` / `VITE_TENANT_APEX_DOMAINS` still override).
- Platform onboarding refuses slugs used by the deployment (`admin`, `api`, `www`, `app`, `mail`,
  `static`, `status`) in API validation and the onboarding form.
- Only tenant `vn` is live; `star` (demo) is copied but **suspended** (the resolver answers 403).
- CORS: exact origins `https://vn.retailerpai.com,https://admin.retailerpai.com`; dev
  `localhost`/LAN origins are rejected in production (verified).
- Rate limit is per client IP (`TRUST_PROXY=1` behind Caddy so the real IP is used); default 300/min
  in production because a shop's devices share one IP.
- Test accounts: the owner supplies the list of users and roles. Every other copied user is
  disabled, every kept user gets a new password (local dev passwords such as `1234` must not reach
  the server), and copied refresh tokens are deleted. Hosting grants no access by itself.

## User workflows

### One-time setup (owner, guided; nothing here is done yet)

1. **Cloudflare (free)**: create an account, *Add a site* `retailerpai.com` (Free plan). Cloudflare
   shows two nameservers. **GoDaddy** → My Products → retailerpai.com → DNS → Nameservers →
   *Change* → *I'll use my own nameservers* → enter both → save. The domain stays registered and
   billed at GoDaddy; only DNS answers move. Wait until Cloudflare shows *Active*.
2. **Oracle Cloud**: sign up (card needed for identity), home region **India West (Mumbai)** or
   **India South (Hyderabad)** — it cannot be changed later. Upgrade to *Pay As You Go* (Always Free
   shapes stay free; idle free-tier instances are otherwise reclaimed) and add a ₹ budget alert.
3. **VM**: Compute → Instance → Ubuntu 24.04, shape `VM.Standard.A1.Flex` (e.g. 2 OCPU / 12 GB),
   your SSH public key only. Networking → the subnet's security list: allow TCP 80 and 443 from
   `0.0.0.0/0` (UDP 443 optional) and TCP 22 only from your own IP. If A1 capacity is unavailable,
   use the same steps on a paid India VM (Lightsail Mumbai / DigitalOcean Bangalore, ~₹800–1,000/mo).
4. On the VM: `curl -fsSL https://raw.githubusercontent.com/vinodkumarsharma276/retail-erp/main/infra/vm/bootstrap.sh -o bootstrap.sh && sudo bash bootstrap.sh <your-email>`
   (installs Docker etc., opens the host firewall, clones to `/opt/retailerp/src`, generates
   secrets into `/opt/retailerp/{.env,api.env,backup.env}` with mode 600, installs the 02:30 IST
   backup cron). Then set `OPENAI_API_KEY` in `api.env`. (The URL works once this work is merged
   to `main`; before that, copy `bootstrap.sh` with `scp`.)
5. **DNS**: Cloudflare → DNS → `A api <VM public IP>` with **Proxy off (DNS only)** — Caddy needs
   it for its certificate, and Cloudflare's proxy would cut 100-second requests such as large
   register imports. Do not create `vn`/`admin` by hand; step 8 does.
6. **Backups (R2, free 10 GB)**: Cloudflare → R2 → create bucket `retailerp-backups`; API token with
   *Object Read & Write* on that bucket; put the account ID and keys in `backup.env`. On your PC
   create an age key (`age-keygen -o retailerp-backup.key`), put the **public** key in
   `AGE_RECIPIENT`, and keep the private key in your password manager — never on the server.
7. **GitHub** → Settings:
   - Environments → `production`: deployment branches = `main`; secrets `VM_SSH_KEY` (a new
     ed25519 private key used only by CI), `VM_KNOWN_HOSTS` (`ssh-keyscan <VM IP>`),
     `CLOUDFLARE_API_TOKEN` (Pages: Edit), `CLOUDFLARE_ACCOUNT_ID`.
   - Variables: `API_DOMAIN=api.retailerpai.com`, `WEB_DOMAIN=vn.retailerpai.com`, `VM_HOST`,
     `VM_USER` (e.g. `ubuntu`), `CF_PAGES_PROJECT=retailerp-web`, optionally `API_PLATFORM=linux/amd64`
     for an x86 VM. Leave `DEPLOY_ENABLED` unset until step 10.
   - On the VM, add the CI public key to `~/.ssh/authorized_keys` with the forced command printed by
     `bootstrap.sh` (it can only run `deploy <sha>`); `bootstrap.sh` already allows that user to run
     `sudo /opt/retailerp/src/infra/vm/deploy.sh` and nothing else without a password.
8. **Cloudflare Pages**: Workers & Pages → Create → Pages → *Direct Upload* project `retailerp-web`
   → Custom domains → add `vn.retailerpai.com` and `admin.retailerpai.com`.
9. **Container image**: the first CI run publishes `ghcr.io/vinodkumarsharma276/retailerp-api`.
   Either set the package to *Public* (the repository is public and the image holds no secrets) or
   run `docker login ghcr.io` on the VM with a `read:packages` token.

### First release and data copy (each step needs owner approval)

10. Set `DEPLOY_ENABLED=true`, run *Actions → CI/CD → Run workflow* on `main`: image → VM deploy
    (empty schema) → Pages.
11. Copy data: on the PC `docker exec retailerp-db pg_dump -U retailerp -d retailerp -Fc >
    %USERPROFILE%\.retailerp\transfer\retailerp.dump`; `scp` it to the VM; `sudo
    /opt/retailerp/src/infra/vm/restore.sh <file> --yes`; re-run `deploy.sh <sha>` (applies any newer
    migrations). Then: suspend `star`, delete refresh tokens, apply the owner's user/role list with
    new passwords, compare row counts with local, and delete both dump copies.
12. Smoke test: login on `vn.` and `admin.`, shop switch, Customer Searching, a user without
    `sales.view_real` sees no finance data, `star` login refused, CORS rejects other origins,
    scheduler registered in `stack.sh logs api`.
13. Restore drill: `sudo restore.sh <latest dump> --target restore_drill`, compare counts,
    `sudo restore.sh --drop restore_drill`.

### Releasing

- **API + web**: merge to `main`. CI `check` → `api-image` (arm64, tag = commit SHA) →
  `deploy-api` (SSH `deploy <sha>`; on the server: fetch, run that commit's `deploy.sh`, pull image,
  encrypted pre-deploy backup, `migrate deploy`, swap container, wait for `/api/ready`, automatic
  rollback to the previous image if unhealthy) → `deploy-web` (build with `VITE_API_URL`, publish to
  Pages). The web deploys after the API so it never calls an older API.
- **Manual**: *Run workflow* on `main` (optional `ref`), or on the VM
  `sudo /opt/retailerp/src/infra/vm/deploy.sh <sha>`.
- **Android**: once, `apps\mobile-flutter\tool\create-release-keystore.ps1` and back up both files.
  Each release: `.\tool\build-release-apk.ps1 -BuildNumber <n>` (n greater than every previous
  release; the script checks `%USERPROFILE%\.retailerp\android\releases`). Share the APK and its
  printed SHA-256 (Drive link/WhatsApp). Phones with a debug/dev build must uninstall it first
  (different key); later releases install over each other.

### Rollback

- **API code**: *Run workflow* with `ref=<last good SHA>`, or `sudo deploy.sh <sha>` on the VM.
  A failed health check already rolls back automatically.
- **Schema/data**: `sudo restore.sh /opt/retailerp/backups/<…-pre-<sha>>.dump` (takes a safety
  backup first, stops the API, restores, restarts), then deploy the previous SHA. Anything entered
  after that backup is lost — announce a pause first.
- **From R2** (server lost): new VM → `bootstrap.sh` → `rclone copy r2:retailerp-backups/db/<file>.age .`
  → `sudo restore.sh <file>.age --identity <age key file> --yes` (bring the key temporarily,
  delete it after) → deploy the last good SHA → point the `api` DNS record at the new IP.
- **Web**: Cloudflare Pages → Deployments → previous → *Rollback*.
- **APK**: build from the old commit with a **higher** build number and redistribute.

## API contracts and data

- Health: `GET /api/health` (process up) and `GET /api/ready` (database answers; 503 otherwise).
  Both bypass tenant resolution. Docker, `deploy.sh` and CI use `/api/ready`.
- API settings: [.env.production.example](../../apps/api/.env.production.example) (on the server
  `/opt/retailerp/api.env`). `DATABASE_URL`, `NODE_ENV`, `API_PORT`, `API_HOST`, `TRUST_PROXY`, `TZ`
  come from [compose.yml](../../infra/vm/compose.yml). Stack settings
  [stack.env.example](../../infra/vm/stack.env.example) (`API_IMAGE`, `API_TAG`, `API_DOMAIN`,
  `ACME_EMAIL`, `POSTGRES_PASSWORD`); backup settings
  [backup.env.example](../../infra/vm/backup.env.example). Settings files are parsed as
  `KEY=VALUE`, never executed.
- Web build settings: [apps/web/.env.production.example](../../apps/web/.env.production.example)
  (`VITE_API_URL`, `VITE_TENANT_APEX_DOMAINS`, `VITE_PLATFORM_ADMIN_SUBDOMAIN`; leave
  `VITE_TENANT_SLUG` unset). Everything here is public.
- Flutter: `--dart-define=API_BASE_URL=https://api.retailerpai.com` (set by the build script).
- `AZURE_STORAGE_*` settings are not read by the API (file uploads are processed in memory).
- Backups: `pg_dump -Fc` in `/opt/retailerp/backups` (root-only, last 7 kept), age-encrypted copy
  in R2 `db/` (30 days). Nightly, before each deploy and before each restore.

## Web behavior

Static Vite/React SPA + PWA on Cloudflare Pages. `_redirects` serves `index.html` for client
routes; `_headers` sets security headers, `no-cache` for `index.html`/service worker (so releases
reach users) and immutable caching for hashed assets. The service worker precaches the app shell
only; API calls (cross-origin) are never cached. `admin.` mounts the platform console from the
same build ([host.ts](../../apps/web/src/lib/host.ts)).

## Mobile behavior and differences

- Release APK: signed with the release key from `%USERPROFILE%\.retailerp\android\key.properties`
  (or `RETAILERP_ANDROID_KEY_PROPERTIES`), https API, Dart obfuscation with symbols kept next to the
  APK in `%USERPROFILE%\.retailerp\android\releases`, signature checked (`apksigner`, debug key
  refused).
- Distribution is sideloading; Play Store is a later decision. The OPPO test phone shows a
  *Continue installation* prompt per install.
- Customer Searching's encrypted cache and background updates must be re-verified on the release
  build over mobile data (timings differ from debug). The API's Caddy compression shrinks its
  ~38 MB first download without app changes.
- Notifications are not implemented; no push provider is configured.

## Dependencies and cross-feature effects

- [Authentication and access](authentication-and-access.md): apex default `retailerpai.com`,
  production config guard, `TRUST_PROXY`/rate limit, CORS, reserved tenant slugs.
- [Platform administration](platform-administration.md): `admin.retailerpai.com`, reserved slugs.
- [Mobile foundation](mobile-foundation.md): release signing, versioning, https rule.
- [Customer Searching](customer-searching.md): first mobile release; compression delivered by Caddy.
- [Installments](installment.md) / [Bank rules](bank-rules.md): scheduler on in production.
- The type-error cleanup that turned CI green fixed real runtime errors owned by
  [installments](installment.md), [transfers](transfers.md), [settings](settings.md) and
  [platform administration](platform-administration.md); see those docs.

## Code and source references

- Server stack: [infra/vm](../../infra/vm/) (compose, Caddyfile, scripts, env examples)
- CI/CD: [.github/workflows/ci.yml](../../.github/workflows/ci.yml)
- API packaging: [Dockerfile](../../apps/api/Dockerfile), [build.mjs](../../apps/api/scripts/build.mjs),
  [.dockerignore](../../.dockerignore), [.gitattributes](../../.gitattributes)
- API production config: [config/index.ts](../../apps/api/src/config/index.ts),
  [index.ts](../../apps/api/src/index.ts), [app.ts](../../apps/api/src/app.ts),
  [.env.production.example](../../apps/api/.env.production.example),
  [deployment-config.test.ts](../../apps/api/tests/unit/deployment-config.test.ts)
- Web: [vite.config.ts](../../apps/web/vite.config.ts), [public/_headers](../../apps/web/public/_headers),
  [public/_redirects](../../apps/web/public/_redirects), [api-client.ts](../../apps/web/src/lib/api-client.ts),
  [host.ts](../../apps/web/src/lib/host.ts)
- Android: [build.gradle.kts](../../apps/mobile-flutter/android/app/build.gradle.kts),
  [tool/](../../apps/mobile-flutter/tool/), [pubspec.yaml](../../apps/mobile-flutter/pubspec.yaml)
- Legacy: [infra/azure](../../infra/azure/), [DEPLOYMENT_PLAN.md](../DEPLOYMENT_PLAN.md)
- Local dev (unchanged): [docker-compose.yml](../../docker-compose.yml)

## Verification and acceptance

Run on 2026-11-14 (local PC; nothing hosted):

- `npx turbo typecheck`: 5/5 workspaces pass (was ~133 API errors). `npm test`: 26 files, 365 tests
  pass (unit + integration). `npx turbo build --filter=@retailerp/api --filter=@retailerp/web` passes.
- Bundled API (`NODE_ENV=production node dist/index.js`) against the local DB: health, owner login
  and an authenticated tenant request worked. Config guard, `TRUST_PROXY`, apex and reserved-slug
  rules covered by `deployment-config.test.ts` (8 tests).
- API image built (amd64). In a Docker-in-Docker sandbox with a throwaway database and a local
  registry standing in for GHCR: first deploy migrated an empty DB (38 migrations) and came up
  healthy; HTTPS via Caddy; `/api/ready` ok; unknown tenant 404; CORS allowed the `vn.` origin and
  refused others and `localhost:5180`; PostgreSQL had no published port; API ran as `node`;
  scheduler registered; zstd/gzip (3,088 → 102/120 bytes); upgrade took a pre-deploy backup; an API
  that crashed on start was rolled back automatically to the previous image and checkout; a missing
  image left the release untouched; the CI forced command refused other input; backup → restore
  into a scratch DB matched; restore of the live DB took a safety backup, replaced data and
  restarted the API; dropping the live DB was refused. ShellCheck (warning level) clean;
  actionlint clean.
- Production web build with `VITE_API_URL=https://api.retailerpai.com`: URL baked in, no `:3001`
  fallback, `_headers`/`_redirects`/service worker emitted.
- Android: with a throwaway key, `build-release-apk.ps1` produced a release APK signed with that key
  (verified by `apksigner`), refused an http URL and a non-increasing build number; a release build
  without a key failed with instructions; the debug build still works; the keystore script refused
  to overwrite an existing key.

Not verified: `bootstrap.sh` on a real Ubuntu VM, Let's Encrypt issuance, arm64 image, GitHub
Actions runs, Cloudflare Pages, R2 upload/download, any real-data copy, the release APK on a phone.

Acceptance for the first shop-test release:

- [x] Hosting target, domain and cost approved (Cloudflare + Oracle Always Free, `retailerpai.com`, ₹0/month).
- [ ] Hosted PostgreSQL migrated by `deploy.sh`; nightly encrypted backups to R2; restore drill done.
- [ ] Production secrets only on the server / GitHub environment; API refuses dev secrets (code done).
- [ ] Web loads over HTTPS on `vn.` and `admin.`, logs in, calls `api.retailerpai.com`.
- [ ] CORS limited to the hosted origins; `star` refused; finance data hidden without `sales.view_real`.
- [ ] Release APK signed with the release key, https API, installs and logs in on the shop phone.
- [ ] Customer Searching cache/background update works against the hosted API on mobile data.
- [ ] Automatic deploy on push to `main` enabled deliberately (`DEPLOY_ENABLED`) after the first release.
- [x] Release/rollback steps written into this document.

## Known gaps and next work

- **Phase 2 (owner + approval)**: accounts and DNS (setup steps 1–9), first release, data copy with
  the owner's account/role list, smoke tests, restore drill, release APK on the phone.
- `api.retailerpai.com` is not behind Cloudflare's proxy (origin IP is public; Caddy + host
  firewall only). Proxying would need the 100-second limit solved for large imports.
- No monitoring/alerting beyond Docker restarts; add an uptime check (e.g. a free external
  monitor on `/api/ready`) and alerts for failed nightly backups.
- One API instance; single VM is a single point of failure (mitigated by off-site backups).
- The main web bundle is 2.2 MB; code-splitting would speed first load on phones.
- `npm run lint` in `apps/web` still fails on its ESLint config (pre-existing; not part of CI).
- Docker builds on networks that block `registry.npmjs.org` need `--build-arg NPM_REGISTRY=<mirror>`;
  the lockfile must keep public `registry.npmjs.org` URLs (internal feed URLs break CI/servers).
- iOS release not started.

## Decisions and review checkpoint

- 2026-11-14 (owner): web on **Cloudflare Pages** (Vercel Hobby forbids commercial use); API +
  PostgreSQL on an **Oracle Always Free VM in India** with Docker (portable to any paid VM); not the
  employer-provided Azure subscription. Domain **retailerpai.com** (GoDaddy registration, Cloudflare
  DNS). Hosts `vn.`, `admin.`, `api.`. Only tenant `vn` live; `star` suspended. Hosted DB starts as a
  **copy of local data**. Owner supplies test accounts/roles. **Auto-deploy on push to `main`**
  (gated by `DEPLOY_ENABLED`). Scheduler **on**. OpenAI key on the server. Release keystore at
  `%USERPROFILE%\.retailerp\android\upload-keystore.jks`.
- 2026-11-14: Migrations run in a separate step after a backup, never on container start. The API
  host is DNS-only (no Cloudflare proxy) because of long imports. The deploy script of the target
  commit runs the deploy (fixes take effect immediately).
- 2026-11-14: Deployment and release is its own feature, owned by a dedicated chat. Earlier Azure
  Option A ([DEPLOYMENT_PLAN.md](../DEPLOYMENT_PLAN.md)) is superseded.

The machine-readable source inventory and hashes live in `docs/features/checkpoints.json`.