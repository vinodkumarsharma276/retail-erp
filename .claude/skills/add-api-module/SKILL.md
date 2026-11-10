---
name: add-api-module
description: 'Scaffold a new RetailERP backend API module (Fastify routes, controller, service, Zod validation) that is tenant-isolated, shop-scoped, permission-guarded and feature-gated, plus an optional web TanStack Query hook. Use when adding a new API module, resource, endpoint group, or CRUD backend for a new entity.'
argument-hint: 'Module name (plural, kebab-case) and what entity/feature it serves'
---

# Add an API module

Creates `apps/api/src/modules/<name>/` following the house pattern used by
`apps/api/src/modules/expenses/` (the reference implementation — read it first).

## When to use

- A new entity or feature needs its own `/api/v1/<name>` endpoints.
- Not for adding one endpoint to an existing module — edit that module instead.

## Inputs to settle first

1. **Module name** — plural kebab-case (`warranty-claims`). Files use the same stem.
2. **Prisma model(s)** — existing, or new (then do the schema step).
3. **Shop-scoped?** — almost always yes (data belongs to a shop inside a tenant).
4. **Tenant feature** — which `FeatureKey` in `packages/shared-types/src/features.ts` switches
   it off, or a new one, or none (always on).
5. **Permission keys** — `<module>.list`, `.detail`, `.create`, `.edit`, `.delete`, plus any
   specific actions; and which system roles get them by default.

## Procedure

1. **Schema (if new model)** — in `apps/api/prisma/schema.prisma` add the model with
   `tenantId String @map("tenant_id")` + relation to `Tenant`, and `shopId` + relation to `Shop`
   if shop-scoped; `@@index([tenantId])`; `@@map("snake_case_plural")`; money as
   `Decimal @db.Decimal(12, 2)`. The `tenantId` column is what makes `config/database.ts`
   auto-scope and auto-stamp every query — never skip it. Then from `apps/api`:
   `npx prisma migrate dev --name add_<name>` (regenerates the client).
2. **Permissions** — add a group in `packages/shared-types/src/permissions.ts`
   (`g('<module>', '<Label>', [['<module>.list', 'Open … list'], …])`) and add the keys to the
   right `ROLE_*_PERMISSIONS` lists. Owner gets everything automatically. For existing tenants,
   add the keys to `NEW_DEFAULTS` in `apps/api/prisma/seed/sync-permission-catalog.ts`.
3. **Feature mapping** — if the module belongs to a tenant feature, map its permission prefix in
   `MODULE_FEATURE` in `packages/shared-types/src/access.ts` (and a `nav.<module>` key in
   `KEY_FEATURE` if it gets a sidebar entry). Add prerequisites there if actions depend on
   another module's screen.
4. **Module files** — create the four files using
   [the templates](./references/module-template.md):
   `<name>.validation.ts`, `<name>.service.ts`, `<name>.controller.ts`, `<name>.routes.ts`.
   Rules:
   - Route `preHandler` order: `authenticate, shopScope, requirePermission('<module>.<action>')`
     then `validate(schema)` for bodies. Never guard by role names.
   - Controllers read `request.shopFilter!` / `request.currentUser!` and respond only through
     `sendSuccess` / `sendPaginated` / `sendError`; paginate with `parsePagination`.
   - Services import `prisma` from `../../config/database.js` and filter by shop
     (`shopId` or `shopId: { in: shopIds }` in All-Shops mode). Tenant filtering is automatic —
     except in `$queryRaw`, where you must add `tenant_id = ${tenantId}` yourself.
   - Relative imports end in `.js` (ESM).
   - If the response includes sensitive fields (cost price, Aadhaar, bank details), check
     `apps/api/src/middleware/field-access.ts` and register them.
5. **Register** — in `apps/api/src/app.ts` import the routes and add either
   `await registerGated(app, <x>Routes, '/api/v1/<name>', FeatureKey.<KEY>);` or, for an
   always-on module, `await app.register(<x>Routes, { prefix: '/api/v1/<name>' });`.
6. **Shared types (optional)** — DTOs used by web and mobile go in
   `packages/shared-types/src/<name>.types.ts`, re-exported from `index.ts`.
7. **Web hook (optional)** — `apps/web/src/hooks/use<Name>.ts` modelled on `useExpenses.ts`:
   a `keys` object, `useQuery` for lists (with `placeholderData: keepPreviousData`) and
   `useMutation` + `invalidateQueries` for writes, all through `apiClient`. Gate pages with
   `routes/PermissionGuard` and buttons with `usePermission`.
8. **Tests** — add `apps/api/tests/unit/<name>*.test.ts` for pure logic; add an integration test
   under `tests/integration/` when the module writes data, including a tenant-isolation case
   (see `tests/integration/tenant-isolation.test.ts` and `tests/helpers/fixtures.ts`).
9. **Docs** — if it is user-facing, describe it in `docs/features/<feature>.md` (what it does,
   rules, access, API, where the code lives — see `docs/features/customer-searching.md`) and add a
   short pointer to that file in the module list of `docs/CONTEXT.md` (§6).

## Verify

```bash
npm run typecheck
npm run test --workspace=apps/api -- tests/unit          # always
npm run test --workspace=apps/api                         # if Postgres is up (integration)
npm run dev:api   # then: curl http://localhost:3001/api/v1/<name> → 401 without a token
```

With a token for a user lacking the permission the route must return 403; with the tenant
feature off it must return 403 as well.
