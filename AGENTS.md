# AGENTS.md — RetailERP

Guidance for AI coding agents (GitHub Copilot, Claude Code, Codex, …) working in this repository.
`CLAUDE.md` imports this file — keep project knowledge **here**, not in tool-specific files.

## What this is

RetailERP replaces Tally/Marg accounting for an Indian retail group selling electronics, home
appliances, furniture and mobile phones. It started as an ERP for the owner's 4 shops (each a
separate GST entity) and is now a **multi-tenant SaaS**: each business is a *tenant* on its own
subdomain, with a subscription *plan* that switches modules on/off, and a separate
platform-admin console for onboarding tenants.

Seeded tenants (local dev — see [docs/DEV_LOGINS.md](docs/DEV_LOGINS.md) for every login):

| Tenant | Address | Plan | Shops |
|---|---|---|---|
| Vinod Electronics (`vn`) | http://localhost:5180 or http://vn.localhost:5180 | Enterprise | VE Vinod Electronics · NE Naveen Electronics · VHA Vinod Home Appliances · NHE New Harshita Electronics |
| Star Electronics (`star`, demo) | http://star.localhost:5180 | Standard | SE Star Electronics · SM Star Mobiles |
| Platform admin console | http://admin.localhost:5180 | — | — |

## Stack & layout

Turborepo + npm workspaces, Node ≥ 22, TypeScript (ESM) for API/web/shared packages and legacy Expo.
The approved new mobile target is Flutter (Dart), not an Expo extension.

| Path | What |
|---|---|
| `apps/api` | Fastify 5 + Prisma 6 + PostgreSQL 16, Zod validation, JWT (access + refresh), `node-cron` jobs, OpenAI (OCR + bank-statement categorisation), Vitest |
| `apps/web` | React 19 + Vite 6 (dev port **5180**, strict), TailwindCSS 4, shadcn-style primitives in `src/components/ui/`, TanStack Query 5, Zustand 5, react-hook-form, react-router 7, Recharts, `@react-pdf/renderer`, PWA (`vite-plugin-pwa`). `PlatformApp.tsx` is the platform-admin SPA |
| `apps/mobile` | **Legacy** Expo Router employee collection app. Preserve it; do not extend it for the new mobile direction or remove it without approval |
| `apps/mobile-flutter` | Flutter Android+iOS app: real tenant login, secure session storage/refresh, offline start, shop/access controls, theme, module shell, and **Customer Searching** (encrypted cached search/details, online create/edit, background updates). RetailERP display name, `com.retailerpai.mobile` ID. Other modules and push still pending |
| `packages/shared-types` | Types/enums shared by all apps (`@retailerp/shared-types`). Holds the **access rulebook**: `features.ts`, `permissions.ts`, `access.ts` |
| `packages/shared-utils` | EMI calculator, installment rules, GSTIN/phone/PAN/Aadhaar validators, INR/date formatters, Tally/purchase-sheet parsers (`@retailerp/shared-utils`) |
| `infra/vm` | Hosted stack for any Docker VM: PostgreSQL + API image + Caddy (HTTPS, compression), `bootstrap`/`deploy`/`backup`/`restore` scripts. Setup, release and rollback: [docs/features/deployment-and-release.md](docs/features/deployment-and-release.md). `infra/azure` is legacy, unused |
| `.github/workflows/ci.yml` | Typecheck + API tests + build on push/PR; on push to `main`, only when repo variable `DEPLOY_ENABLED=true`, builds the API image (GHCR), deploys it to the VM over SSH and the web to Cloudflare Pages |

## Build, run, test

```bash
npm install                                   # also runs scripts/patch-metro.js
docker compose up -d                          # PostgreSQL 16 (npm run db:start)
cp apps/api/.env.example apps/api/.env        # first time only
npm run db:generate && npm run db:migrate && npm run db:seed

npm run dev                                   # API :3001 + web :5180
npm run dev:api | npm run dev:web | npm run dev:mobile

npm run typecheck                             # all workspaces (turbo) — run before finishing
npm run build
npm run lint                                  # web has ESLint; api lint is a no-op placeholder
npm test                                      # = vitest run in apps/api
npm run test --workspace=apps/api -- tests/unit/allocator.test.ts   # single file

npm run docs:status                           # detect feature-context drift
npm run docs:check                            # headings, links, rail coverage, reviewed hashes
npm run docs:test                             # context-checker regression tests
```

- Flutter is separate from npm workspaces: in `apps/mobile-flutter`, run `flutter analyze`,
  `flutter test` and `flutter build apk --debug --dart-define=API_BASE_URL=<LAN-server-URL>`.
  Configure the reachable LAN API URL explicitly; release/profile builds require HTTPS.
  See [apps/mobile-flutter/README.md](apps/mobile-flutter/README.md). iOS needs macOS/Xcode.
- **Unit tests** (`apps/api/tests/unit`) need nothing. **Integration tests** (`tests/integration`)
  need PostgreSQL running; `tests/global-setup.ts` migrates and empties a separate
  `retailerp_test` database (the dev DB is never touched). Tests run serially in one fork.
  `tests/setup-env.ts` fakes today as **2026-10-04**, so test data dated later counts as future.
- `npx turbo typecheck` is clean across all workspaces — keep it that way (CI runs it). Known
  pre-existing noise: `npm run lint` fails on `apps/web/eslint.config.js`. Web typecheck:
  `npx tsc --noEmit -p tsconfig.app.json` in `apps/web` — it is not `strict`, so check null
  handling by eye.
- API `build` is an esbuild bundle (`apps/api/scripts/build.mjs` → `dist/index.js`, inlining the
  TS-only `@retailerp/*` packages); `tsc` is typecheck only. Production config is guarded: with
  `NODE_ENV=production` the API refuses dev JWT secrets or a non-https `CORS_ORIGIN`.
- Release Android builds need the release key outside the repo
  (`%USERPROFILE%\.retailerp\android\key.properties`); use
  `apps/mobile-flutter/tool/build-release-apk.ps1`. Debug builds need nothing.
- `package-lock.json` must resolve to `https://registry.npmjs.org/`; if a corporate npm mirror
  writes internal feed URLs into it, rewrite them (CI and servers can't reach the mirror). Docker
  builds on a network that blocks npmjs.org: `--build-arg NPM_REGISTRY=<mirror>`.
- Schema change: edit `apps/api/prisma/schema.prisma`, then from `apps/api`:
  `npx prisma migrate dev --name <snake_case>` → commit the migration folder.
- Background jobs only run with `ENABLE_SCHEDULER=true` (`SCHEDULER_CRON`, `BANK_FEED_CRON`, `SCHEDULER_TZ`).
- OCR / statement AI / customer-name matching AI are disabled unless `OPENAI_API_KEY` is set (see `apps/api/src/config/index.ts`); name matching then falls back to edit distance.
- Dev passwords: seed default `RetailERP@2026`; `npx tsx scripts/set-dev-password.ts` (in `apps/api`) sets all to `1234`.

## Architecture rules (read before changing code)

### Tenancy — enforced in one place
- `middleware/tenant-resolver.ts` resolves the tenant from the subdomain (`<slug>.localhost`,
  `<slug>.retailerpai.com`) or `X-Tenant-Slug` header, and stores it in an AsyncLocalStorage
  context (`config/tenant-context.ts`).
- `config/database.ts` extends Prisma so **every query on a model with a `tenantId` column is
  auto-filtered and every create is auto-stamped**; cross-tenant writes throw. New models get this
  for free *if they have `tenantId`*.
- Not covered: `$queryRaw*` (filter by tenant yourself — e.g. the bank-statements engine) and
  code outside a request (jobs, seeds, scripts) — wrap with `tenantContext.runAs(tenantId, fn)`.
- Platform-admin routes (`/api/v1/platform/*`) have no tenant context and a separate identity (`PlatformUser`).

### Shops
- Within a tenant, data is further scoped by shop. `middleware/shop-scope.ts` sets
  `request.shopFilter` (`shopId`, `shopIds`, `allShops`) from the JWT + `X-Shop-Id` header.
  Services must honour it.

### Access control — permissions, not role names
- Roles: `owner`, `admin`, `accountant`, `others` (staff), `employee` (mobile-only). Roles are
  DB rows (`Role`, `Permission`, `RolePermission`, `UserPermission`); tenants can customise them.
- **Effective permissions** = role grants + user grants − user denies − permissions of features
  the tenant's plan has off − anything missing its prerequisites. One rulebook,
  `packages/shared-types/src/access.ts`, is used by both API and UI.
- Every route guards with `requirePermission('<module>.<action>')` (`middleware/permissions.ts`).
  Don't add new `authorize([...role names])` checks.
- Modules sit behind a tenant feature switch via `registerGated(...)` in `apps/api/src/app.ts`
  (403 when off; `writesOnly` keeps reads open).
- `middleware/field-access.ts` strips sensitive fields (cost price, Aadhaar, bank details) from
  responses unless the caller has permission.
- New permission keys go in `packages/shared-types/src/permissions.ts`; to grant them to existing
  tenants' roles, add them to `NEW_DEFAULTS` in `apps/api/prisma/seed/sync-permission-catalog.ts`
  (run it with `npx tsx prisma/seed/sync-permission-catalog.ts` in `apps/api`). `ROLE_ADMIN_PERMISSIONS`
  is "everything except …", so an owner-only key must be excluded there explicitly.
- The API caches each user's effective permissions in memory for 60 s (`CACHE_TTL_MS`). Changes
  made through the app clear it at once; changes made by a script take up to a minute to show.

### Business invariants
These are intended policies. Source-reviewed feature docs list observed implementation gaps;
those gaps are not approval to reproduce unsafe behavior in Flutter or expand access.

- **Dual sale recording**: every sale writes `sale_records` (real) and `sale_records_sanitized`
  (shown as a cash full-payment) in one transaction. Users without `sales.view_real` see only the
  sanitized copy and **must never see installment, interest or finance data** — they lose every
  installment permission. Decided server-side.
- **Sale types**: `full_payment`, `partial_with_promise`, `self_finance` (in-house EMIs, guarantor),
  `company_finance` (Bajaj Finance / HDB / Home Credit). Up to 3 payment modes per sale (`paymentBreakdown`).
- **Prices are GST-inclusive**; GST = price × rate / (100 + rate). Profit uses input-tax credit on the purchase price.
- **Installments** follow [ADR-0001](docs/adr/0001-per-emi-overdue-installment-model.md) as amended
  by later commits: the schedule is generated once; payments go oldest-EMI-first (a chosen EMI may
  be paid first); a short payment is by default spread over the remaining EMIs (recorded in
  `InstallmentCarryForward`) or kept on the EMI with a promise; surplus goes to `creditBalance`.
  Promises are first-class (`InstallmentPromise`, register-style labels `N.k`, statuses incl.
  `replaced`/`cancelled`) and never hide a customer from the daily call list. Late penalty is a
  flat ₹/day **per sale** (default ₹2, `SaleRecord.penaltyPerDay`), early-payment deduction is
  opt-in — nothing is charged automatically; the collector ticks a box. Engine:
  `apps/api/src/modules/installments/installments.{engine,allocator,derivations}.ts`.
  [docs/features/installment.md](docs/features/installment.md) is the current feature reference;
  [docs/legacy/installment-redistribution.md](docs/legacy/installment-redistribution.md) preserves the old model.
- **Ledger number** on every sale mirrors the physical office register (e.g. `VE001`).
- **Customer Searching** (`modules/customer-search`, feature `customer_search`) is the account
  register moved off a Google Sheet: one entry per item bought, with an **Account Number**
  written `BD 12` (series of 2–3 letters plus an optional register digit such as `CK2`, a space,
  the number — `formatAccountNumber`; other shapes are kept
  and flagged) that may repeat — a reused number is allowed but flagged. Every
  entry is filed under a Customer matched on **name + mobile** — never mobile alone, relatives
  share phones; the co-applicant is a Customer with `isGuarantor`. Unlike installments, it does
  not need `sales.view_real`. Problems (no mobile, reused number…) are stored per entry in
  `issues` and kept current by `refreshIssues`; the UI lists them under "Needs review".
  Changing an entry's shop moves its customer too unless they have other entries/sales in the
  old shop. The sheet is imported in ranges of up to **20,000 rows** (`MAX_IMPORT_ROWS`; 25 MB body,
  one 300 s transaction); CSVs are parsed as raw text in the browser so d/m dates stay day-first.
  See [docs/features/customer-searching.md](docs/features/customer-searching.md) for the full model, endpoints and cutover steps.
- **Customer codes** are `CUST-<n>`, one sequence per tenant, padded to 4 digits but growing past
  9999. Get the last one with `lastCustomerCode()` (`utils/id-generator.ts`, numeric order) —
  never `orderBy: { customerCode: 'desc' }`: as text `CUST-9999` sorts after `CUST-10000`, which
  re-issues an existing code (unique on `tenant_id, customer_code`).
- Inter-shop transfers are a sale/purchase between two GST entities with a full item audit trail.

## Feature context workflow

- **The agent loads the documents; do not ask the user to assemble or manually read context.**
  Before feature work, read [docs/features/README.md](docs/features/README.md), the owning feature
  doc and relevant dependency docs. Match left-rail items through
  [manifest.json](docs/features/manifest.json); supporting capabilities have docs too.
- Use the [update-feature-docs skill](.claude/skills/update-feature-docs/SKILL.md) at task start,
  after meaningful behavior changes and before handoff. Keep the
  [standard shape](docs/features/_template.md), preserve useful detail, and distinguish implemented,
  planned, legacy and unverified behavior. Source review is not runtime certification.
- Update owning/dependent docs and index when affected; ADRs hold architectural rationale.
  After source review, run `npm run docs:checkpoint -- <feature-id> --reviewed`, then
  `npm run docs:check`. Hash checkpoints include committed and uncommitted changes. Never advance
  checkpoints just to hide stale context; classify UNMAPPED changes and add real source ownership.
- See [docs/FEATURE_CONTEXT_WORKFLOW.md](docs/FEATURE_CONTEXT_WORKFLOW.md) for all-layer ownership,
  checkpoint semantics and cadence. Skills run on task events/request, not an idle-chat timer.
  End with changed / verified / remaining / cross-feature impact / next action.
- Mobile: ERP/API is authoritative; Sheets is import-only. Flutter's first slice is described in
  [docs/mobile/customer-searching-handoff.md](docs/mobile/customer-searching-handoff.md).
  Reuse [apps/mobile-flutter](apps/mobile-flutter/) for every feature; do not recreate its
  shell, session store or HTTP/auth flow. Intended website is `retailerpai.com`, but no domain
  registration/deployment or server tenant-apex change is implied by the app identity.
  Local caching must include updates/deletions and access changes, not merely appended rows.
  Customer Searching implements this: `GET /customer-search/sync` (trigger-written change log,
  snapshot + delta + tombstones) and an encrypted per-user SQLCipher copy in Flutter — follow
  [docs/features/customer-searching.md](docs/features/customer-searching.md) for the next cached
  feature. Offline reads do not imply offline writes.
- Keep agent memory to short durable conventions; feature state belongs in versioned docs.
  Separate chats do not isolate files: use worktrees for concurrent implementation.

## Code conventions

- **API module** = `apps/api/src/modules/<name>/<name>.{routes,controller,service,validation}.ts`
  (+ optional helpers). Routes chain `authenticate → shopScope → requirePermission(...) → validate(zodSchema)`;
  controllers return via `sendSuccess` / `sendPaginated` / `sendError` (`utils/response.ts`) and
  `parsePagination` (`utils/pagination.ts`). Use the `add-api-module` skill for new modules.
- ESM: relative imports in the API end in `.js` (e.g. `'./expenses.service.js'`).
- Money: Prisma `Decimal` in the API; it serialises as a string — coerce with `Number()` in UI code.
- Web data access: one TanStack Query hook file per domain in `apps/web/src/hooks/`, calling
  `lib/api-client.ts` (adds JWT, `X-Shop-Id`, tenant header; refreshes on 401). Gate screens with
  `routes/PermissionGuard`.
- DB-driven dynamic forms (`form_definitions` / `form_fields`) render product, customer,
  distributor and sale forms — field changes need no deploy.
- Only comment code that needs clarifying. Match surrounding style; no new dependencies without need.
- Commit messages: a plain-English sentence describing the user-visible effect
  (e.g. "Pay a supplier in cash and cheque at once"), body explaining why.

## Gotchas

- Seed scripts under `apps/api/prisma/seed/` include one-off backfills/repairs; `npm run db:seed`
  runs `index.ts` only. `star-electronics.seed.ts` and `bootstrap-platform-admin.ts` are run by hand.
- `.claude/` is git-ignored except `.claude/skills/` (shared, committed skills).
- `apps/web/dev-dist/` is generated by the PWA plugin in dev.
- Windows dev machine: use PowerShell-friendly commands; `npx tsx <script>` for TS scripts
  (`.ts`, not `.mts`, and no top-level `await` — wrap in an async IIFE).
- `prisma migrate dev` / `prisma generate` fail with `EPERM … query_engine-windows.dll.node` while
  the API dev server (`tsx watch`) is running — stop `npm run dev` first.
- A developer usually has `npm run dev` running in their own terminal — check ports 3001/5180 and
  use it; don't stop or restart it without asking. Stopping an agent-started `npm run dev` can
  leave turbo/vite/tsx orphaned on those ports — kill those node PIDs and confirm the ports are free.
- The app runs **locally only** — nothing is deployed yet (target: `vn.`/`admin.retailerpai.com`
  on Cloudflare Pages, `api.retailerpai.com` on a VM). "After deploying" steps in the docs just mean
  "run once against the database you use". `ci.yml` deploys on push to `main` only once the
  `DEPLOY_ENABLED` repository variable is `true`; never push to `main` or deploy without approval.

## Docs index

| Doc | Status / use |
|---|---|
| [docs/CONTEXT.md](docs/CONTEXT.md) | Historical long-form overview; current behavior belongs in the source-reviewed feature docs |
| [docs/features/README.md](docs/features/README.md) | Feature inventory: all left-rail items and supporting capabilities, web/mobile direction and dependencies |
| [docs/features/_template.md](docs/features/_template.md) | Standard feature shape; use it for every current feature doc |
| [docs/FEATURE_CONTEXT_WORKFLOW.md](docs/FEATURE_CONTEXT_WORKFLOW.md) | Agent-driven maintenance, source-hash checkpoints and feature-chat handoffs |
| [docs/APP_CHAT_ORCHESTRATOR.md](docs/APP_CHAT_ORCHESTRATOR.md) | Coordinator notes: chat organisation, cross-feature decisions/state, prompts to start/resume/hand off chats (`/update-feature-docs orchestrator`) |
| [docs/mobile/customer-searching-handoff.md](docs/mobile/customer-searching-handoff.md) | First Flutter implementation slice and sync/cache acceptance requirements |
| [docs/DEV_LOGINS.md](docs/DEV_LOGINS.md) | All local logins per tenant/role — current |
| [docs/adr/0001-per-emi-overdue-installment-model.md](docs/adr/0001-per-emi-overdue-installment-model.md) | Installment model decision (implemented, amended) |
| [docs/features/installment.md](docs/features/installment.md) | Current installment feature reference |
| [docs/legacy/installment-redistribution.md](docs/legacy/installment-redistribution.md) | Preserved legacy redistribution reference; not the implementation spec |
| [docs/OCR_INVOICE_AND_REGISTER_PLAN.md](docs/OCR_INVOICE_AND_REGISTER_PLAN.md) | Invoice/register OCR design (implemented: `modules/ocr`) |
| [docs/DEPLOYMENT_PLAN.md](docs/DEPLOYMENT_PLAN.md) | Superseded Azure hosting options (historical); current plan in [deployment and release](docs/features/deployment-and-release.md) |
| [docs/UI_IMPROVEMENT_PLAN.md](docs/UI_IMPROVEMENT_PLAN.md), [docs/ADD_SALE_FORM_REDESIGN.md](docs/ADD_SALE_FORM_REDESIGN.md) | UI plans (partially implemented) |
| [PLAN.md](PLAN.md) | Original April-2026 implementation plan — historical |
| [.claude/skills/](.claude/skills/README.md) | Agent skills (repeatable workflows) |
