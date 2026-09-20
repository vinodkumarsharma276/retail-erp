# ADR-0001 Implementation Plan — Per-EMI Overdue Installment Model

Companion to [0001-per-emi-overdue-installment-model.md](./0001-per-emi-overdue-installment-model.md).

## Execution Rules

- Phases 1–4 ship together: schema, engine, API, and seed data are mutually dependent.
- Every read/write query for installments, promises, payments, interest, and reliability must include `tenantId`.
- Background jobs iterate active tenants and process one tenant per transaction.
- Money values use `Prisma.Decimal` in the API and numbers only at API/UI boundaries.
- Promises never suppress calls. Due-today and overdue EMIs always remain visible.
- Penalty is discretionary. The UI can show the 1% monthly suggestion, but it is applied only when the employee checks the box or explicitly uses Apply Interest.

## Phase 1 — Schema & Shared Types

1. Add `Tenant.settings Json? @db.JsonB` for tenant-scoped installment policy.
2. Add `SaleRecord.penalRate Decimal? @db.Decimal(4,2)` as a per-sale override.
3. Add `InstallmentSchedule.creditBalance Decimal @default(0)` for surplus payments.
4. Add `InstallmentPromiseStatus` enum and `InstallmentPromise` model mapped to the `promises` table, with tenant, schedule, customer, created-by user, covered installment IDs, promised date/amount, status, resolved timestamp, collected amount, and notes.
5. Add shared types: `InstallmentPromiseRecord`, `CreateInstallmentPromiseInput`, `TenantInstallmentSettings`, `ReliabilityMetrics`, and Pattern B payment request shape.
6. Generate and apply migration `per_emi_overdue_model`; regenerate Prisma client.

Acceptance: `npx prisma format && npx prisma validate`, Prisma client generation, and shared-types typecheck pass.

## Phase 2 — Backend Engine & Services

1. Create `installments.derivations.ts` with pure helpers for status derivation, days overdue, suggested penalty, and effective penal rate.
2. Create `installments.allocator.ts` with oldest-first payment allocation plus explicit-EMI override. Surplus returns as `unallocated` and becomes schedule credit.
3. Create `installments.engine.ts` with `recordPayment`, `revertPayment`, `applyInterest`, and `rollbackInterest` implemented without redistribution.
4. Create `apps/api/src/modules/promises/` with validation, service, controller, and routes.
5. Create `customers.reliability.ts` to compute promise and overdue metrics tenant-scoped.
6. Create `resolve-promises.job.ts` to resolve pending promises whose promised date has passed.

Acceptance: engine unit tests cover full pay, partial pay, multi-EMI allocation, surplus credit, explicit EMI, discretionary interest, rollback, revert, promise creation, promise resolution, and tenant isolation.

## Phase 3 — API Wiring

1. Rewire installment payment, revert, apply-interest, and rollback endpoints to the new engine.
2. Remove or deprecate redistribution/rollover/reschedule endpoints from active routes.
3. Register `/api/v1/promises`.
4. Add `GET /api/v1/customers/:id/reliability`.
5. Load `Tenant.settings` in `tenant-resolver` and expose merged defaults to downstream code.

Acceptance: API typecheck passes and legacy redistribution routes are not reachable in normal UI flows.

## Phase 4 — Seed Rewrite

1. Seed default `tenant.settings.installment` in `bootstrap-tenant.ts`.
2. Rewrite `installments.seed.ts`: each EMI is independent; unpaid past-due EMIs stay overdue; no sub-rows, absorption, or redistribution.
3. Add `promises.seed.ts`: create realistic pending/kept/partially-kept/broken promises, including multi-EMI promises.
4. Add `interest-applications.seed.ts`: apply discretionary interest to a minority of overdue EMIs and include a few rollback examples.
5. Rewrite `rolling-overdue-scenarios.seed.ts` with Pattern B scenarios: happy path, single overdue, multi-EMI promise, broken-plus-fresh promise, penalty plus partial payment plus promise.
6. Add optional `penalRate` overrides to self-finance sale seed data.
7. Remove legacy one-off fix/rebalance/restore scripts that existed to patch redistribution bugs.
8. Run destructive reseed for dev data.

Acceptance: full seed succeeds, no generated sub-rows exist, and sampled ledgers reconcile row-by-row.

## Phase 5 — Web UI

1. Create `PromiseDialog` for single and multi-EMI promises.
2. Rewrite `RecordPaymentDialog` to show amount, payment mode, date, explicit-EMI override, and an unchecked-by-default overdue-interest checkbox with suggested 1% monthly amount.
3. Create `ReliabilityBadge`.
4. Rewrite installment detail to show independent EMI rows/cards, promises, timeline, outstanding, and credit balance.
5. Rewrite installment list with tabs: Due Today, Overdue, Promised, All Active. Do not suppress promised EMIs.
6. Add reliability section to customer detail.

Acceptance: manual web smoke test covers payment, interest checkbox, single promise, multi-EMI promise, and revert.

## Phase 6 — Mobile UI

1. Update employee collections list with the same active collections model.
2. Update payment recording to include discretionary interest.
3. Add mobile promise creation, defaulting to the current EMI but allowing multi-select when practical.

Acceptance: Expo smoke test as employee user can view call list, record payment, and create promise.

## Phase 7 — Cleanup & Docs

1. Delete redistribution rule engine and rollover scheduler code once no imports remain.
2. Mark legacy sub-row/reschedule shared types as deprecated if still needed for old roll-log display.
3. Rewrite installment reference documentation for Pattern B.
4. Run final `typecheck`, `lint`, and backend tests.

## Edge Cases

- Promise on paid EMI: reject.
- Promise dated in the past: reject.
- Cross-tenant promise or payment target: 404/validation error.
- Multiple promises on the same EMI: allowed.
- Payment greater than total due: add surplus to `creditBalance`.
- Interest amount less than or equal to zero: reject.
- Rollback interest that would make paid amount exceed amount due: reject.
- Fully paid schedule payment: reject unless future credit deposits are explicitly added later.
- Promise resolver is idempotent and only resolves `pending` promises with promised date strictly before today.
- Legacy roll-log event types should render as generic timeline entries, not crash UI.

## Final Verification

1. `npx prisma migrate reset --force && npx prisma migrate dev`
2. `npm run db:seed --workspace=apps/api`
3. Spot-check sampled ledgers with `inspect-ledger.ts` and verify every row reconciles.
4. `SELECT COUNT(*) FROM installments WHERE parent_installment_number IS NOT NULL;` returns `0` on fresh seed.
5. Tenant isolation tests pass.
6. `npm run typecheck`, `npm run lint`, and API tests pass.
