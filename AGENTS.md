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

Turborepo + npm workspaces, Node ≥ 22, TypeScript (ESM) everywhere.

| Path | What |
|---|---|
| `apps/api` | Fastify 5 + Prisma 6 + PostgreSQL 16, Zod validation, JWT (access + refresh), `node-cron` jobs, OpenAI (OCR + bank-statement categorisation), Vitest |
| `apps/web` | React 19 + Vite 6 (dev port **5180**, strict), TailwindCSS 4, shadcn-style primitives in `src/components/ui/`, TanStack Query 5, Zustand 5, react-hook-form, react-router 7, Recharts, `@react-pdf/renderer`, PWA (`vite-plugin-pwa`). `PlatformApp.tsx` is the platform-admin SPA |
| `apps/mobile` | Expo Router app for the **employee** role (installment collection): login, collections list/detail, record payment, profile |
| `packages/shared-types` | Types/enums shared by all apps (`@retailerp/shared-types`). Holds the **access rulebook**: `features.ts`, `permissions.ts`, `access.ts` |
| `packages/shared-utils` | EMI calculator, installment rules, GSTIN/phone/PAN/Aadhaar validators, INR/date formatters, Tally/purchase-sheet parsers (`@retailerp/shared-utils`) |
| `infra/azure` | Bicep + deploy script. Deployment options/costs: [docs/DEPLOYMENT_PLAN.md](docs/DEPLOYMENT_PLAN.md) |
| `.github/workflows/ci.yml` | Typecheck + build on push/PR; deploys API (App Service) and web (Static Web Apps) on push to `main` |

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
```

- **Unit tests** (`apps/api/tests/unit`) need nothing. **Integration tests** (`tests/integration`)
  need PostgreSQL running; `tests/global-setup.ts` migrates and empties a separate
  `retailerp_test` database (the dev DB is never touched). Tests run serially in one fork.
- Schema change: edit `apps/api/prisma/schema.prisma`, then from `apps/api`:
  `npx prisma migrate dev --name <snake_case>` → commit the migration folder.
- Background jobs only run with `ENABLE_SCHEDULER=true` (`SCHEDULER_CRON`, `BANK_FEED_CRON`, `SCHEDULER_TZ`).
- OCR / statement AI are disabled unless `OPENAI_API_KEY` is set (see `apps/api/src/config/index.ts`).
- Dev passwords: seed default `RetailERP@2026`; `npx tsx scripts/set-dev-password.ts` (in `apps/api`) sets all to `1234`.

## Architecture rules (read before changing code)

### Tenancy — enforced in one place
- `middleware/tenant-resolver.ts` resolves the tenant from the subdomain (`<slug>.localhost`,
  `<slug>.retailerp.com`) or `X-Tenant-Slug` header, and stores it in an AsyncLocalStorage
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
  tenants' roles, add them to `NEW_DEFAULTS` in `apps/api/prisma/seed/sync-permission-catalog.ts`.

### Business invariants
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
  [docs/installment/installment.md](docs/installment/installment.md) describes the **legacy** redistribution model.
- **Ledger number** on every sale mirrors the physical office register (e.g. `VE001`).
- Inter-shop transfers are a sale/purchase between two GST entities with a full item audit trail.

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
- Windows dev machine: use PowerShell-friendly commands; `npx tsx <script>` for TS scripts.

## Docs index

| Doc | Status / use |
|---|---|
| [docs/CONTEXT.md](docs/CONTEXT.md) | Long-form system context (schema, endpoints, business logic) |
| [docs/DEV_LOGINS.md](docs/DEV_LOGINS.md) | All local logins per tenant/role — current |
| [docs/adr/0001-per-emi-overdue-installment-model.md](docs/adr/0001-per-emi-overdue-installment-model.md) | Installment model decision (implemented, amended) |
| [docs/installment/installment.md](docs/installment/installment.md) | Legacy redistribution model reference |
| [docs/OCR_INVOICE_AND_REGISTER_PLAN.md](docs/OCR_INVOICE_AND_REGISTER_PLAN.md) | Invoice/register OCR design (implemented: `modules/ocr`) |
| [docs/DEPLOYMENT_PLAN.md](docs/DEPLOYMENT_PLAN.md) | Azure hosting options and costs |
| [docs/UI_IMPROVEMENT_PLAN.md](docs/UI_IMPROVEMENT_PLAN.md), [docs/ADD_SALE_FORM_REDESIGN.md](docs/ADD_SALE_FORM_REDESIGN.md) | UI plans (partially implemented) |
| [PLAN.md](PLAN.md) | Original April-2026 implementation plan — historical |
| [.claude/skills/](.claude/skills/README.md) | Agent skills (repeatable workflows) |
