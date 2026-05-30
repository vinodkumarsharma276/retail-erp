# ADR-0001: Per-EMI Overdue Installment Model (Pattern B)

- **Status**: Proposed
- **Date**: 2026-05-30
- **Deciders**: Vinod Sharma (owner)
- **Supersedes**: Current "redistribution" model in [apps/api/src/modules/installments/installments.rules.ts](../../apps/api/src/modules/installments/installments.rules.ts)
- **Related docs**: [docs/installment/installment.md](../installment/installment.md)

---

## 1. Context

The current installment engine implements a **redistribution** model:

- Overpayments (R7), promise-after-next partial pays (R3), and daily rollovers of overdue rows (R4) all **mutate the schedule** by pushing leftover balances onto later EMIs.
- Each redistribution writes a `roll_log` entry with `metadata.targets[].delta` so it can theoretically be reversed.
- Once absorbed, source rows are supposed to be marked `isClosed = true`. In practice the engine never sets this flag, so absorbed rows display stale `overdue` / `partially_paid` status with `remaining = 0`.

The model fails for the business in three concrete ways:

1. **Defects keep recurring.** The repo contains 30+ one-off scripts under `apps/api/prisma/seed/fix-*` patching specific ledgers (VE0010, VE0030, VE0036, VE0071, VE0072, VE0083, …). The most recent — [fix-ve0030-revert-double-count.ts](../../apps/api/prisma/seed/fix-ve0030-revert-double-count.ts) — corrected a ₹4,073.50 double-count caused by `revertPayment` re-redistributing an EMI without first reversing the prior absorption.
2. **Reasoning is impossible.** A single ledger may have payment_recorded, redistributed, chain_absorbed, rescheduled, and revert events interleaved. Reconstructing "what does each EMI actually owe today and why" requires walking the full `roll_log` because the snapshot columns (`amountDue`, `remainingAmount`) get rewritten.
3. **Customer-facing math is opaque.** When a customer pays ₹5,000 on EMI #4, the next month's EMI silently increases — they cannot match their handwritten register to our screen.

A separate, deeper problem: redistribution **collapses information**. Once EMI #1 is "absorbed" into EMI #2, we lose the ability to tell that the customer is one month overdue and another month covered. The system reports a single big balance instead of two separate signals.

Real-world NBFCs and bank EMI products do not redistribute. They track each EMI as an independent obligation and layer **promises** and **penalties** on top.

## 2. Decision

Adopt **Pattern B — per-EMI overdue tracking** with the following invariants:

### 2.1 Immutable schedule

- The `InstallmentSchedule` and its `Installment` rows are generated once at sale creation and **never restructured**. No redistribution. No absorption. No sub-row creation by the engine.
- `Installment.amountDue` = original EMI amount, only mutated by explicit user actions: `applyInterest`, `rollbackInterest`, or admin write-off.
- `Installment.remainingAmount = amountDue + Σ(active interestApplications) − Σ(payments)`.
- Each EMI's status is derived from its own dates and balance — never from sibling rows.

### 2.2 Promises as first-class entities

- A `Promise` is a memo recorded by the field employee or accountant. It captures: "customer commits to pay ₹X on date Y, covering EMIs [list]."
- A single promise may cover 1..N EMIs (no hard cap; soft-bounded by the schedule's total EMI count).
- Promises **do not** modify EMI state. They are pure annotations.
- Promises **do not** suppress collection calls. Every overdue or due-today EMI continues to appear on the daily call list regardless of any open promise. Rationale: "It's our money — we should call." (owner direction, 2026-05-30).
- On the daily call, the employee sees any open promise covering the EMI being called and uses judgement (skip, confirm, update, or collect).
- Promise lifecycle:
  - `pending` — created, due date in the future.
  - `kept` — full promised amount received on or before the promise date.
  - `partially_kept` — some money received but less than promised, by the promise date.
  - `broken` — promise date passed, less than full amount received. Promise still references its EMIs; cannot be resurrected (employee creates a new promise instead).
- A promise's `covered_installment_ids` is fixed at creation and immutable. Re-grouping requires creating a new promise.

### 2.3 Discretionary penalty

- No daily auto-accrual job. The current `applyInterest` flow on [installments.service.ts](../../apps/api/src/modules/installments/installments.service.ts) (which already writes to `installment_interest_applications`) becomes the canonical path.
- Default rate: **1% per month** (tenant-configurable, sale-overridable).
- UI displays the suggested penalty as a passive computation on each overdue EMI but does **not** apply it. A checkbox at payment time (or a standalone "Apply Interest" action) explicitly applies it.
- The employee can edit the suggested amount before applying — partial waiver, custom amount, or no penalty at all.
- Application is always full-auditable: who, when, how much, against what base, with optional notes. Rollback is supported (already in schema via `rolledBackAt`).

### 2.4 Reliability scoring

A computed, per-customer summary surfaces collection risk to the owner. Computed on-the-fly from existing tables (no denormalised counters in v1):

| Metric | Computation |
|---|---|
| `promises_made` | `COUNT(promises) WHERE customer_id = ?` |
| `promises_kept` | `COUNT(promises) WHERE status IN ('kept','partially_kept')` |
| `promises_broken_count` | `COUNT(promises) WHERE status='broken'` |
| `promises_broken_emi_count` | `SUM(jsonb_array_length(covered_installment_ids)) WHERE status='broken'` |
| `active_overdue_emi_count` | `COUNT(installments) WHERE status='overdue'` |
| `total_outstanding` | `SUM(remaining_amount) WHERE status IN ('overdue','partially_paid','due_today','upcoming')` |
| `avg_dpd_at_payment` | `AVG(payment_date - due_date)` over fully-paid EMIs |

A broken promise that covered 3 EMIs increments `promises_broken_emi_count` by 3 (per owner direction). This prevents employees from masking volume by grouping all overdue EMIs into one giant promise.

### 2.5 Payment allocation

- Default: **oldest-first**. Payment received splashes against the oldest overdue EMI, then the next, and so on. No leftover gets pushed into the future.
- Override: at payment time the employee can pick a specific EMI ("Customer is paying EMI #4 specifically").
- Excess (payment > total currently owed across all EMIs): held as a credit on the schedule (`installment_schedules.creditBalance` — new field) and consumed by future EMIs as they come due. **Not** redistributed.

### 2.6 Multi-tenant configuration

- New JSONB field `Tenant.settings` holding installment policy with sensible defaults:
  ```json
  {
    "installment": {
      "defaultPenalRateMonthly": 1.0,
      "defaultPaymentAllocation": "oldest_first",
      "defaultThresholdDays": 60,
      "reliabilityWindowDays": 365
    }
  }
  ```
- New nullable column `SaleRecord.penalRate` (Decimal 4,2) for per-sale override. NULL falls back to tenant default.
- All new tables carry `tenantId` and respect existing tenant/shop scoping middleware. No tenant-specific code paths.

## 3. Consequences

### 3.1 Positive

- **Each EMI is independently auditable.** `due − paid + interest = remaining`, always. No cross-row math.
- **Reverting a payment is trivial.** Delete the payment row, recompute the single EMI's totals. No cascade, no double-count.
- **Customer-friendly math.** Customers can match their physical register row-for-row with the on-screen ledger.
- **Eliminates 90% of bug surface.** The 30+ historical fix scripts addressed redistribution, absorption, and revert interactions — all of which disappear.
- **Discretionary penalty matches the business culture.** Field employees already exercise discretion in real life. The system stops pretending otherwise.
- **Promises decouple customer behaviour tracking from schedule mutation.** We can answer "how reliable is this customer?" without making payment math conditional on promises.
- **Multi-tenant by construction.** Every policy lever is per-tenant from day one.

### 3.2 Negative

- **Schedules visually show more "overdue" rows.** A customer who missed 4 EMIs sees 4 overdue rows, not one merged big row. This is informationally honest but visually heavier — UI must handle this gracefully (collapsible by month, summary band at the top).
- **Employees carry more weight.** The system no longer "automatically" handles overpayments or partial promises. Training material and UI guardrails (defaults, suggestions, warnings) must compensate.
- **Reliability scoring is the only thing that requires custom queries.** Acceptable.
- **Schema migration is destructive in dev.** Acceptable (we are pre-production); production migration path documented separately in §6.

### 3.3 Neutral / out of scope

- `InstallmentSchedule.lastRolloverDate`, `Installment.isClosed`, `Installment.parentInstallmentNumber`, `Installment.subSequence`, `Installment.isRescheduled`, `Installment.rescheduledFromId` become **legacy columns** (kept in schema for forensic reads on historical data; never written by the new engine).
- The daily rollover cron job in [apps/api/src/jobs](../../apps/api/src/jobs/) is removed.
- "Final settlement" (early payoff with interest waiver) remains supported as a separate action — semantically just "pay full remaining + zero out future interest portions."

## 4. Schema Changes

### 4.1 New model: `Promise`

```prisma
model Promise {
  id                    String         @id @default(uuid())
  tenantId              String         @map("tenant_id")
  scheduleId            String         @map("schedule_id")
  customerId            String         @map("customer_id")
  /// EMI installment ids this promise covers (1..N). Array order = priority.
  coveredInstallmentIds String[]       @map("covered_installment_ids")
  promisedDate          DateTime       @map("promised_date") @db.Date
  promisedAmount        Decimal        @map("promised_amount") @db.Decimal(12, 2)
  status                PromiseStatus  @default(pending)
  createdBy             String         @map("created_by")
  createdAt             DateTime       @default(now()) @map("created_at") @db.Timestamptz()
  /// Resolved (kept / partially_kept / broken) at this timestamp by the resolver job or manual action.
  resolvedAt            DateTime?      @map("resolved_at") @db.Timestamptz()
  /// Sum of payments received against covered EMIs between createdAt and resolvedAt — used for kept/partially_kept distinction.
  collectedAmount       Decimal        @default(0) @map("collected_amount") @db.Decimal(12, 2)
  notes                 String?        @db.Text

  tenant       Tenant      @relation(fields: [tenantId], references: [id])
  schedule     InstallmentSchedule @relation(fields: [scheduleId], references: [id])
  customer     Customer    @relation(fields: [customerId], references: [id])
  createdByUser User       @relation(fields: [createdBy], references: [id])

  @@index([tenantId])
  @@index([scheduleId, status])
  @@index([customerId, status])
  @@index([promisedDate, status])
  @@map("promises")
}

enum PromiseStatus {
  pending
  kept
  partially_kept
  broken
}
```

### 4.2 New column on `Tenant`

```prisma
model Tenant {
  // ... existing fields ...
  /// Per-tenant policy knobs. See ADR-0001 §2.6 for shape.
  settings  Json?  @db.JsonB
}
```

### 4.3 New column on `SaleRecord`

```prisma
model SaleRecord {
  // ... existing fields ...
  /// Per-sale override for monthly penal interest rate. NULL = use tenant default.
  penalRate Decimal? @map("penal_rate") @db.Decimal(4, 2)
}
```

### 4.4 New column on `InstallmentSchedule`

```prisma
model InstallmentSchedule {
  // ... existing fields ...
  /// Excess payment held against the schedule, consumed by future EMIs in oldest-first order as they come due.
  creditBalance Decimal @default(0) @map("credit_balance") @db.Decimal(12, 2)
}
```

### 4.5 Legacy columns

Kept in schema, never written by new engine:
- `InstallmentSchedule.lastRolloverDate`
- `Installment.isClosed`
- `Installment.parentInstallmentNumber`
- `Installment.subSequence`
- `Installment.isRescheduled`
- `Installment.rescheduledFromId`

### 4.6 Migration name

`20260530000000_per_emi_overdue_model`

## 5. Code Changes

### 5.1 New / rewritten

| Path | Purpose |
|---|---|
| `apps/api/src/modules/installments/installments.engine.ts` | New engine: `recordPayment`, `revertPayment`, `applyInterest`, `rollbackInterest`. No redistribution. |
| `apps/api/src/modules/installments/installments.allocator.ts` | Oldest-first payment splitter, with explicit-EMI override. |
| `apps/api/src/modules/installments/installments.derivations.ts` | Pure functions for derived state: `computeInstallmentStatus`, `computeDaysOverdue`, `suggestPenalty`. |
| `apps/api/src/modules/promises/` | New module: routes, controller, service, validation. `createPromise`, `listPromisesForSchedule`, `cancelPromise`. |
| `apps/api/src/modules/customers/customers.reliability.ts` | New query layer for reliability metrics. |
| `apps/api/src/jobs/resolve-promises.job.ts` | Daily job: marks pending promises whose `promised_date < today` as `kept` / `partially_kept` / `broken` based on `collected_amount`. |
| `apps/web/src/components/RecordPaymentDialog.tsx` | Replace existing redistribution UX with allocate-and-collect + optional interest checkbox. |
| `apps/web/src/components/PromiseDialog.tsx` | New: create / view promises with multi-select of covered EMIs. |
| `apps/web/src/components/ReliabilityBadge.tsx` | New: compact pill showing kept/broken counts + risk colour. |
| `apps/web/src/pages/installments/InstallmentDetailPage.tsx` | Rewrite: per-EMI cards, promises sidebar, no sub-row / closed-row logic. |
| `apps/web/src/pages/installments/InstallmentListPage.tsx` | Rewrite: daily call list with promise indicators. |
| `apps/mobile/app/(app)/collections/*` | Mobile flow updated for promises + discretionary interest. |
| `packages/shared-types/src/installment.types.ts` | Add `Promise`, `PromiseStatus`, `ReliabilityMetrics` types. Mark legacy types deprecated. |

### 5.2 Deleted

| Path | Reason |
|---|---|
| `apps/api/src/modules/installments/installments.rules.ts` (most of it) | Redistribution rules R3/R4/R7 obsolete. Keep only `resolveScheduleTenantId` if still needed. |
| `apps/api/src/jobs/apply-daily-rollover.job.ts` (if exists) | Rollover removed. |
| `apps/api/prisma/seed/fix-*.ts` (all 16+ files) | One-off corrections for redistribution bugs — no longer needed after reseed. |
| `apps/api/scripts/inspect-ledger.ts` row-sanity warnings | Become genuine bugs in new model; the script stays but its expected-mismatch hints are removed. |

### 5.3 Touched lightly

| Path | Change |
|---|---|
| `apps/api/src/middleware/tenant-resolver.ts` | Load `tenant.settings` into request context. |
| `apps/api/prisma/seed/bootstrap-tenant.ts` | Seed default `tenant.settings` JSON. |

## 6. Seed Strategy — Answering "how do we re-seed existing installments?"

The codebase is pre-production. The right answer is **destructive reseed**, not in-place migration.

### 6.1 What the destructive reseed actually means

1. Run the new migration (creates `promises`, `promise_status` enum, new columns). This is a forward-only schema change.
2. Drop all data in the installment-related tables in one transaction:
   - `installment_payments`
   - `installment_interest_applications`
   - `installment_roll_log`
   - `installments`
   - `installment_schedules`
   - `promises` (will be empty anyway)
   - `employee_collection_assignments`
3. Also drop `sale_records` and `sale_records_sanitized` rows that have `saleType IN ('self_finance', 'partial_with_promise')` since their schedules are now gone — easiest to fully `npm run db:reset` and reseed from scratch.
4. Run the rewritten seed scripts (§6.2). Result: a clean, internally-consistent dataset under Pattern B.

For developers: `npm run db:reset --workspace=apps/api && npm run db:migrate --workspace=apps/api && npm run db:seed --workspace=apps/api`.

### 6.2 Rewritten seed files

| File | Change |
|---|---|
| `apps/api/prisma/seed/sales.seed.ts` | No structural change; still creates 100 self_finance sales per shop. Each sale gets a new `penalRate` value drawn from `[null, 1.0, 1.5]` to exercise the override. |
| `apps/api/prisma/seed/installments.seed.ts` | Rewrite the payment simulator: pay each EMI independently with random success ratio (no redistribution / absorption logic). Each unpaid past-due EMI just stays `overdue`. |
| `apps/api/prisma/seed/promises.seed.ts` | **New.** For ~30% of schedules with overdue EMIs, create 1–3 promises with random `pending`/`kept`/`broken` outcomes. Mix of single-EMI and multi-EMI promises (e.g. 70% single, 25% covering 2 EMIs, 5% covering 3+). |
| `apps/api/prisma/seed/interest-applications.seed.ts` | **New.** For ~20% of overdue EMIs, simulate an employee applying penalty (some at suggested 1%/month, some at custom amount, ~5% later rolled back). |
| `apps/api/prisma/seed/rolling-overdue-scenarios.seed.ts` | Rewrite the canonical demo scenarios for Pattern B: <br>**A.** Happy path — first few paid on time. <br>**B.** Single overdue EMI, no promise. <br>**C.** Two overdue EMIs, one active promise covering both. <br>**D.** Overdue EMI with one broken promise and one fresh pending promise. <br>**E.** Partial-paid EMI with applied interest (5%) and a future promise for the balance. |
| `apps/api/prisma/seed/bootstrap-tenant.ts` | Add `tenant.settings.installment = { defaultPenalRateMonthly: 1.0, defaultPaymentAllocation: 'oldest_first', defaultThresholdDays: 60, reliabilityWindowDays: 365 }`. |
| `apps/api/prisma/seed/index.ts` | Insert `promises.seed.ts` and `interest-applications.seed.ts` calls between `seedInstallments` and `seedRollingOverdueScenarios`. |

### 6.3 Files deleted from seed/

All `fix-*` and `inspect-*` and `restore-*` and `rebalance-*` scripts (16+ files) — they're patches against bugs the new model eliminates:
```
fix-ve-001-stale-interest.ts
fix-ve0010-i4-amountpaid.ts
fix-ve0030-revert-double-count.ts
fix-ve0036-i1-partial-correction.ts
fix-ve0071-i1-partial-correction.ts
fix-ve0072-dup.ts
fix-ve0072-reschedule.ts
fix-ve0083-overpayment-revert.ts
fix-ve0083-reschedule-9.ts
rebalance-ve0010.ts
rerun-rollover-ve0010.ts
restore-ve0010-i4-amountdue.ts
delete-ve0072-apr28.ts
inspect-ve-001.ts
inspect-ve0010.ts
inspect-ve0083.ts
reseed-self-finance-installments.ts
```

These should be deleted in the same PR as the migration. Their git history preserves the forensic value.

### 6.4 What about future production migration?

If the system goes live before Pattern B ships, the migration becomes lossier: legacy schedules under redistribution would need to be **frozen** (write-locked) and read-only displayed under a `pricing_model = 'legacy_redistribute'` flag on the sale, while all new sales use `pricing_model = 'per_emi_overdue'`. This hybrid is documented for future use but **not implemented in v1** since we are still pre-production.

## 7. Testing Plan

### 7.1 Unit tests (new — `apps/api/src/modules/installments/__tests__/`)

| Test file | Scenarios |
|---|---|
| `allocator.test.ts` | Oldest-first with credit; explicit EMI override; payment > total owed (credit balance); zero-amount no-op. |
| `engine.recordPayment.test.ts` | Single EMI full pay; single EMI partial pay; multi-EMI splash; payment with interest checkbox; payment with explicit EMI. |
| `engine.revertPayment.test.ts` | Revert single payment; revert payment that triggered interest application; revert one of several payments on same EMI. Verify per-EMI numbers reconcile after each. |
| `engine.applyInterest.test.ts` | Apply at suggested rate; apply at custom amount; apply then rollback; apply on already-partial-paid EMI. |
| `derivations.test.ts` | Status derivation for all combinations of due_date × paid; days_overdue computation; suggestPenalty math. |

### 7.2 Unit tests (new — `apps/api/src/modules/promises/__tests__/`)

| Test file | Scenarios |
|---|---|
| `promises.service.test.ts` | Create single-EMI; create multi-EMI; cancel pending; reject cancel of resolved. |
| `promises.resolver.test.ts` | Promise covering 1 EMI fully paid → `kept`; covering 1 EMI partially paid → `partially_kept`; covering 2 EMIs only 1 paid → `partially_kept`; covering 2 EMIs none paid by promise date → `broken` with `+2` to broken EMI count. |

### 7.3 Integration tests (new)

| Test | Scenario |
|---|---|
| `installment-flow.e2e.test.ts` | Full sale → schedule → 3 payments → 1 promise → 1 broken promise → 1 interest application → 1 revert. Verify reliability metrics and per-EMI math at every step. |

### 7.4 Existing tests

Delete all redistribution-related test files. Audit `apps/api/src/modules/installments/__tests__/` (if exists) and remove R3/R4/R7 tests; replace with the above.

## 8. Implementation Phases

| Phase | Scope | Done when |
|---|---|---|
| 1. Schema & migration | §4 changes; migration file; updated `bootstrap-tenant.ts` | `npm run db:migrate` clean from empty DB |
| 2. Engine | §5.1 new engine files; deleted §5.2 | All unit tests in §7.1, §7.2 pass |
| 3. API surface | Promises module; reliability endpoint; updated installments routes | Postman/integration tests pass |
| 4. Seed rewrite | §6.2 files; deleted §6.3 files | `npm run db:seed` produces internally-consistent data; `inspect-ledger.ts` reports zero sanity mismatches across all schedules |
| 5. Web UI | §5.1 component rewrites | Manual smoke test of: record payment, create promise (single + multi-EMI), apply interest, revert payment |
| 6. Mobile UI | Employee collection flow updates | Manual smoke test on Expo dev build |
| 7. Cleanup | Remove `installments.rules.ts` redistribution code, rollover job, deprecated types | `tsc` and `eslint` clean |

Phases 1–4 are required as a single PR (they are mutually dependent — partial deploys would break the seed). Phases 5–7 can ship incrementally on top.

## 9. Open Items Settled in this ADR

| # | Decision | Value |
|---|---|---|
| 1 | Default penal rate | 1.0 %/month (tenant default, sale override) |
| 2 | Penalty application | Discretionary checkbox at payment time |
| 3 | Call suppression on promises | None |
| 4 | Max EMIs per promise | Bounded only by schedule's total EMI count |
| 5 | Broken-promise scoring | +1 per covered EMI |
| 6 | Default payment allocation | `oldest_first` (with explicit-EMI override at UI) |
| 7 | Default threshold (overdue → defaulted classification) | 60 days |
| 8 | Pre-existing data | Destructive reseed (pre-prod); hybrid `pricing_model` if needed post-launch |
| 9 | Multi-tenant settings storage | `Tenant.settings` JSONB |

## 10. References

- Current model walkthrough: [docs/installment/installment.md](../installment/installment.md)
- Bug-fix archeology: `apps/api/prisma/seed/fix-ve*.ts` (16+ files)
- Inspection script (still useful): [apps/api/scripts/inspect-ledger.ts](../../apps/api/scripts/inspect-ledger.ts)
- Multi-tenancy pattern: [apps/api/src/middleware/tenant-resolver.ts](../../apps/api/src/middleware/tenant-resolver.ts)
- Shop scoping pattern: [apps/api/src/middleware/shop-scope.ts](../../apps/api/src/middleware/shop-scope.ts)
