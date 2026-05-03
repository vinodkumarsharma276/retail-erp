# Installment Module — Complete Reference

This document is the authoritative reference for the installment system. Read this before modifying any installment-related code. All files, rules, endpoints, service methods, and edge cases are documented here.

---

## Functional Overview

This section describes what the installment feature does from a business and user perspective, covering every case an accountant, admin, or employee would encounter.

### What is an Installment Sale?

When a shop sells a product on credit (self-finance), the sale is recorded with:
- A **down payment** collected upfront
- A **monthly EMI** (Equated Monthly Installment) amount
- A **number of installments** (e.g., 12 months)
- An **interest rate** (1%–3% per month, set per shop)
- An optional **file charge** (processing fee)

The system generates an `InstallmentSchedule` linked to the sale, with one `Installment` row per EMI. Company-financed sales (Bajaj Finance, HDB, Home Credit) are tracked separately as full-payment sales on the system side — the finance company handles collections directly.

### Who Uses This Feature

| Role | Access |
|------|--------|
| **Admin** | Full access — record payments, revert, move, modify, apply interest, final settlement, run rollover |
| **Accountant** | Same as Admin for collections; no dashboard access |
| **Employee** | Record payments only (mobile app); can view today's and upcoming collections |
| **Others** | No access to installment data |

---

### Case 1 — Normal Monthly Payment

**Scenario:** Customer pays the exact EMI amount on or before the due date.

- Accountant opens the installment detail page → clicks **Pay** on the current installment.
- Enters amount = EMI, selects payment mode (cash, UPI, bank transfer, etc.), confirms.
- Row status changes to `paid`. Next row becomes `due_today` or `upcoming`.
- No excess to distribute. Schedule totals are synced.

**Allowed payment modes:** Cash, UPI, Bank Transfer, Credit Card, Debit Card, Cheque.
**Split payments:** Up to 3 modes in a single transaction (e.g., ₹2,000 cash + ₹1,000 UPI). Each split creates its own payment record.

---

### Case 2 — Overpayment (Customer Pays More Than EMI)

**Scenario:** Customer pays ₹6,000 but EMI is only ₹5,000.

- Accountant records full cash amount.
- Source row is marked `paid` with the full amount.
- Excess ₹1,000 is distributed equally across all future unpaid installments (reducing their remaining balance).
- Optional: accountant can enable **"Waive future interest"** — the excess greedily clears future installments in order, waiving their baked-in interest portion.

---

### Case 3 — Partial Payment + Reschedule

**Scenario:** Customer can only pay ₹2,000 of a ₹5,000 EMI today and commits to pay the rest on a specific future date.

- Accountant records ₹2,000, selects scenario **"Partial + New Date"**, enters the promise date (must be ≤ the next primary installment's due date).
- A sub-row (#N.1) is created for the ₹3,000 remainder at the new date.
- Parent row status becomes `partially_paid`. The sub-row is `upcoming` or `due_today`.

---

### Case 4 — Reschedule Only (No Payment Today)

**Scenario:** Customer cannot pay anything today but commits to a new date.

- Accountant selects scenario **"Reschedule"** with no amount, enters the new date.
- A sub-row is created for the full remaining amount at the new date.
- No cash recorded. The original row is superseded (shown as `rescheduled`).

---

### Case 5 — Overdue Row: Daily Automatic Absorption

**Scenario:** Customer missed a payment. The due date has passed. A later installment's due date has now arrived.

- Daily cron job runs R4 (`applyDailyRollover`) every morning.
- Any overdue row's remaining balance is redistributed equally across all future primary installments, increasing their `amountDue`.
- The overdue row's `remainingAmount` drops to 0. It stays visible in the table as `overdue` (absorbed) — it is not removed.
- The **"Pay"** button on absorbed rows is hidden by default. The employee can click **"Enable Pay"** to manually record a late cash collection (treated as overpayment → redistributed again via R7).

---

### Case 6 — Applying Overdue Interest

**Scenario:** Customer is chronically late and the shop wants to charge a penalty.

- Accountant opens the overdue installment → clicks **"Apply Interest"**.
- System suggests: `remaining × (monthlyRate / 100 / 30) × daysOverdue`.
- Accountant can accept the suggestion or enter a custom amount + notes.
- `amountDue` and `remainingAmount` are incremented by the interest amount.
- An `InstallmentInterestApplication` record is created for full audit trail.

**Rolling back interest:** If the interest was applied by mistake, accountant can roll it back from the same installment row. This decrements `amountDue` / `remainingAmount` (never below the amount already paid).

---

### Case 7 — Undo (Revert) a Payment

**Scenario:** A payment was recorded by mistake — wrong row, wrong amount, or duplicate entry.

- Accountant clicks **"Undo"** on any `paid` row.
- The Revert dialog shows:
  - **Overdue interest suggestion** (amber panel) — if the row's due date has passed and the system thinks interest should be added back now that the row is being reverted to unpaid. Accountant can toggle and adjust.
  - **Distribution preview** — shows exactly which upcoming installments will absorb the reverted amount and by how much each will increase.
- On confirm: the payment record is deleted, the row's balance is restored, and rollover re-runs to redistribute the newly-unpaid amount.

---

### Case 8 — Move a Mis-Attributed Payment

**Scenario:** Accountant recorded a payment under installment #5, but the customer actually paid installment #3 (which was overdue).

- Accountant clicks **"Undo"** on row #5, then enables **"Fix mis-record"** in the revert dialog.
- Selects the correct target installment (#3) from the dropdown.
- Can override the payment date to the actual collection date.
- Can optionally apply overdue interest on the target row.
- On confirm: `movePayment` runs atomically — payment is removed from #5, re-recorded on #3, excess/shortfall resolved, rollover runs on #5.

---

### Case 9 — Correct a Wrong Amount (Modify)

**Scenario:** Accountant recorded ₹5,000 but the customer actually paid ₹3,000 (e.g., ₹2,000 of the cash turned out to be counterfeit, discovered the next day).

- Accountant clicks **"Modify"** (orange pencil icon) on the `paid` row.
- The Modify dialog shows:
  - Recorded amount (read-only context)
  - **Correct amount** input — shortfall is computed live (e.g., ₹2,000 shortfall)
  - **Distribution preview** — shows how the ₹2,000 shortfall will spread across upcoming installments
  - **Optional interest on shortfall** (amber panel, shown when shortfall is overdue) — interest is calculated from the installment's original due date to today
  - Reason field
- On confirm: `correctPayment` runs atomically — payment updated, source row stays `paid` (shortfall transferred), shortfall distributed equally to upcoming rows.
- If no upcoming rows remain, a new installment row is created due today.

---

### Case 10 — Final Settlement (Early Closure)

**Scenario:** Customer wants to close the loan early — pay off all remaining installments at once.

- Accountant navigates to the **Final Settlement** card (on the sale detail page or installment detail page).
- System computes a quote: outstanding principal + unpaid file charge portion (future interest is **waived**).
- Accountant enters the settlement payment details and confirms.
- All unpaid installment rows are marked `paid`. Schedule status changes to `completed`. Sale's `pendingAmount` drops to 0.

---

### Case 11 — Collections View (Daily Work)

**Scenario:** Employee or accountant needs to know whose installments are due today (or on a given date/range).

- **Today's collections**: shows all installments due today across all customers.
- **Date collections**: filter by a specific date.
- **Range collections**: filter by date range (useful for planning weekly field visits).
- **Paid range**: view all payments received in a date window (for reconciliation).
- **Search**: search by customer name, phone, product, or ledger number.

---

### Case 12 — Schedule & Timeline View

- **Schedule list** (`/installments`): all active/completed/defaulted schedules for the shop, with overdue counts, total collected vs payable, and customer name.
- **Schedule detail** (`/installments/:id`): full EMI table with status badges, Pay/Undo/Modify buttons per row, overdue interest banners, absorbed-row indicator, sub-row toggle.
- **Payment timeline** (collapsed by default on detail page): chronological log of every event — payments, rollbacks, interest applications, rollovers, reschedules — grouped by date.

---

### Case 13 — Rescheduled Rows (Sub-Rows)

When a reschedule or partial+reschedule is recorded, the original row is marked `rescheduled` and a sub-row is created. Sub-rows are **hidden by default** in the installment table. The accountant can toggle **"Show N rescheduled"** to reveal them.

- Rescheduled rows cannot be paid directly (system blocks it).
- Pay the active sub-row instead.
- Sub-rows are labeled `#3.1`, `#3.2` etc. to show their lineage.

---

### Case 14 — Admin Rollover (Manual Trigger)

If the daily cron job failed or if a data correction was made manually, an Admin/Owner can trigger R4 rollover manually from the admin panel (`POST /admin/run-rollover`). This re-evaluates all active schedules and ensures absorbed balances are correctly distributed.

---

### Summary of All Cases

| # | Case | Trigger | Key Action |
|---|------|---------|------------|
| 1 | Normal payment | Pay button | Records cash, marks paid |
| 2 | Overpayment | Pay button (higher amount) | Records cash, distributes excess (R7) |
| 3 | Partial + reschedule | Pay button → partial scenario | Records partial cash, creates sub-row |
| 4 | Reschedule only | Pay button → reschedule scenario | Creates sub-row, no cash |
| 5 | Overdue absorption | Daily cron / manual trigger | Redistributes overdue balance to future rows (R4) |
| 6 | Overdue interest | "Apply Interest" button | Bumps amountDue; reversible |
| 7 | Undo payment | "Undo" button | Deletes payment, restores balance, re-runs rollover |
| 8 | Move payment | "Undo" → "Fix mis-record" | Moves payment to correct installment atomically |
| 9 | Correct amount | "Modify" button | Fixes over-recorded amount, distributes shortfall |
| 10 | Final settlement | Settlement card | Waives future interest, closes all rows at once |
| 11 | Collections view | Collections menu | Lists due/paid installments by date |
| 12 | Schedule/timeline | Schedule list/detail | Displays full history and current state |
| 13 | Sub-rows (reschedule) | Auto-created by R2/R3 | Hidden by default; pay active sub-row only |
| 14 | Manual rollover | Admin panel | Forces R4 re-evaluation across all schedules |

---

## Table of Contents

1. [Functional Overview](#functional-overview)
2. [Files & Responsibilities](#files--responsibilities)
3. [Data Model](#data-model)
4. [Rule Engine (R1–R7)](#rule-engine-r1r7)
5. [API Endpoints](#api-endpoints)
6. [Service Methods](#service-methods)
7. [Frontend](#frontend)
8. [Payment Flows](#payment-flows)
9. [Edge Case Handling](#edge-case-handling)
10. [Interest Calculations](#interest-calculations)
11. [Key Invariants](#key-invariants)

---

## Files & Responsibilities

### Backend (`apps/api/src/modules/installments/`)

| File | Purpose |
|------|---------|
| `installments.routes.ts` | Route registration, auth guards, RBAC |
| `installments.controller.ts` | Request/response handling, calls service |
| `installments.service.ts` | All business logic and Prisma queries |
| `installments.rules.ts` | Pure rule-engine functions (R1–R7) |
| `installments.validation.ts` | Zod schemas for all request bodies |

### Frontend (`apps/web/src/`)

| File | Purpose |
|------|---------|
| `pages/installments/InstallmentDetailPage.tsx` | Main page: schedule detail, installment table, all dialogs |
| `pages/installments/InstallmentListPage.tsx` | List all schedules for a shop |
| `components/RecordPaymentDialog.tsx` | Wide 2-column payment recording dialog |
| `components/PaymentTimeline.tsx` | Visual history of payments and events |
| `hooks/useInstallments.ts` | All React Query hooks for installment API calls |

### Shared

| File | Purpose |
|------|---------|
| `packages/shared-utils/src/emi-calculator.ts` | EMI, settlement quote, accrued interest calculation |
| `packages/shared-types/src/installment.types.ts` | TypeScript interfaces for installments |

---

## Data Model

### `InstallmentSchedule`

Top-level schedule created when a self-finance sale is recorded.

| Field | Type | Notes |
|-------|------|-------|
| `id` | UUID | PK |
| `saleId` | UUID | FK → Sale (1:1) |
| `status` | string | `active`, `completed`, `defaulted` |
| `numInstallments` | int | Total EMI count |
| `totalPayable` | Decimal | Principal + interest + file charge |
| `totalPrincipal` | Decimal | Product cost (excluding interest/file) |
| `totalInterest` | Decimal | Total baked-in interest |
| `fileCharge` | Decimal | File/processing charge |
| `totalCollected` | Decimal | Synced after every payment |
| `paidCount` | int | How many installments are fully paid |
| `overdueCount` | int | Live overdue count |
| `lastRolloverDate` | Date? | Last date R4 was run; set to null to force re-run |

### `Installment`

One row per EMI (primary or sub-row). Sub-rows are created by R2/R3 for rescheduling.

| Field | Type | Notes |
|-------|------|-------|
| `id` | UUID | PK |
| `scheduleId` | UUID | FK → InstallmentSchedule |
| `installmentNumber` | int | Visible installment # (1-based, primary only) |
| `parentInstallmentNumber` | int? | Set if this is a sub-row (e.g., #3.1, #3.2) |
| `subSequence` | int? | Sub-row sequence within parent (1, 2, …) |
| `dueDate` | Date | Original due date (never mutated) |
| `amountDue` | Decimal | Contractual EMI amount (may be bumped by interest/shortfall distribution) |
| `amountPaid` | Decimal | Cash actually received by this row |
| `remainingAmount` | Decimal | `amountDue - amountPaid` (0 when absorbed or paid) |
| `status` | string | See statuses below |
| `isRescheduled` | bool | True if superseded by a newer sub-row |
| `isClosed` | bool | True if permanently closed (final settlement) |
| `notes` | string? | Free-text notes on the row |
| `rescheduledFromId` | UUID? | Points to the parent row this was split from |

#### Installment Statuses

| Status | Meaning |
|--------|---------|
| `upcoming` | Due date in the future, nothing paid |
| `due_today` | Due date is today |
| `overdue` | Due date has passed, not fully paid |
| `partially_paid` | Some amount paid, remainder still owed |
| `paid` | Fully settled (remainingAmount = 0, amountPaid ≥ amountDue) |
| `rescheduled` | Superseded by a sub-row; hidden by default in UI |

### `InstallmentPayment`

One payment record per cash transaction. A split payment creates one row per mode.

| Field | Type | Notes |
|-------|------|-------|
| `id` | UUID | PK |
| `installmentId` | UUID | FK → Installment |
| `amount` | Decimal | Amount for this payment record |
| `paymentMode` | enum | `cash`, `upi`, `bank_transfer`, `credit_card`, `debit_card`, `cheque` |
| `paymentDate` | Date | When the customer actually paid |
| `referenceNumber` | string? | Cheque/UPI reference |
| `collectedBy` | UUID? | User who recorded this payment |

### `InstallmentRollLog`

Audit/timeline of every event on a schedule.

| Field | Type | Notes |
|-------|------|-------|
| `scheduleId` | UUID | Which schedule |
| `installmentId` | UUID? | Specific installment (if event is row-specific) |
| `eventType` | string | See event types below |
| `displayMessage` | string | Human-readable description shown in UI |
| `metadata` | JSON | Machine-readable event data |
| `actorUserId` | UUID? | Who triggered the event |

#### Event Types

`payment_recorded` · `payment_reverted` · `payment_moved` · `payment_corrected` · `rolled_over` · `rescheduled` · `interest_applied` · `interest_rolled_back` · `final_settlement`

### `InstallmentInterestApplication`

Tracks discretionary overdue interest applied to an installment.

| Field | Type | Notes |
|-------|------|-------|
| `id` | UUID | PK |
| `installmentId` | UUID | FK → Installment |
| `scheduleId` | UUID | FK → InstallmentSchedule |
| `daysOverdue` | int | Days from due date to when interest was applied |
| `dailyRate` | Decimal | monthlyRate / 100 / 30 |
| `baseAmount` | Decimal | Remaining amount interest was computed on |
| `appliedAmount` | Decimal | Amount added to amountDue (may differ from suggestion) |
| `appliedBy` | UUID | User who applied the interest |
| `rolledBackAt` | DateTime? | If interest was rolled back |
| `rolledBackBy` | UUID? | Who rolled it back |
| `rollbackReason` | string? | Why it was rolled back |

---

## Rule Engine (R1–R7)

All rules live in `installments.rules.ts` and are pure functions called from `installments.service.ts`.

### R1 — `markOverdueForToday`
On the morning of (or after) `dueDate`, any `upcoming` or `due_today` row transitions to `overdue` if nothing was paid. Called by the daily job in `apps/api/src/jobs/`.

### R2 — `applyPartialWithPromise`
Customer pays partial amount + commits a new date ≤ next primary's due date → creates a sub-row (#N.k+1) with the remainder. Current row becomes `partially_paid`. The collector specifies `newDate`.

### R3 — `applyRedistribution`
Customer pays partial/zero + commits a date > next primary's due date → distributes the remainder equally across all future primaries. Current row's `remainingAmount` drops to 0 but status stays overdue.

### R4 — `applyDailyRollover` (via `ensureRolledForToday`)
Daily: when the next primary's due date arrives and a prior row still owes, automatically redistribute (same math as R3). Fires via `ensureRolledForToday(tx, today, { scheduleId? })`.

**Critical:** `ensureRolledForToday` is called:
- After every `recordPayment`
- After every `revertPayment` (with `lastRolloverDate = null` to force re-evaluation)
- After every `movePayment` (same reason)
- By the daily cron job across all active schedules

### R5 — Sub-row logic
Sub-rows (#N.k) behave like primaries for R1/R2/R3. R4 only aggregates by parent primary number.

### R6 — `syncScheduleAndSale`
After every mutation: recomputes `totalCollected`, `paidCount`, `overdueCount` on the schedule; updates `sale.pendingAmount`; if all installments settled, sets `sale.completedAt` and `schedule.status = 'completed'`.

### R7 — `distributeOverpayment`
When cash received > `remainingAmount` of the current row, the excess is spread equally across future primaries. With `waiveInterest = true`, greedy path: fully clears future rows by waiving their baked-in interest share.

Signature:
```typescript
distributeOverpayment(tx, {
  scheduleId, sourcePrimaryNumber, sourceInstallmentId,
  excess, today, actorUserId?, paymentMode?, notes?,
  waiveInterest?: boolean,
})
```

---

## API Endpoints

Base prefix: `POST /api/v1/installments`

### Schedule endpoints (Admin + Accountant)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/` | List schedules (shop-scoped, paginated) |
| GET | `/:scheduleId` | Get full schedule detail (installments + sale + customer) |
| GET | `/:scheduleId/timeline` | Payment timeline (grouped by date) |
| GET | `/:scheduleId/roll-log` | Full audit roll log |
| GET | `/overdue` | List overdue schedules for shop |

### Payment endpoints

| Method | Path | Roles | Description |
|--------|------|-------|-------------|
| POST | `/:installmentId/pay` | Admin, Accountant, Employee | Record a payment (full, partial+reschedule, reschedule-only) |
| POST | `/:installmentId/reschedule` | Admin, Accountant | Reschedule only (no payment) |
| POST | `/payments/:paymentId/revert` | Admin, Accountant | Undo the last payment (restores balance, runs rollover) |
| POST | `/payments/:paymentId/move` | Admin, Accountant | Move a mis-recorded payment to the correct installment |
| POST | `/payments/:paymentId/correct` | Admin, Accountant | Correct a payment recorded with a wrong (higher) amount |

### Settlement

| Method | Path | Description |
|--------|------|-------------|
| GET | `/schedules/:scheduleId/settlement-quote` | Compute early-closure quote |
| POST | `/schedules/:scheduleId/final-settlement` | Record early closure in one payment |

### Interest

| Method | Path | Description |
|--------|------|-------------|
| GET | `/schedules/:scheduleId/interest-accrual` | Get accrued interest suggestion for all overdue rows |
| POST | `/:installmentId/apply-interest` | Apply overdue interest to a specific installment |
| POST | `/interest-applications/:applicationId/rollback` | Roll back a previously applied interest |

### Collections

| Method | Path | Roles | Description |
|--------|------|-------|-------------|
| GET | `/collections/today` | Admin, Accountant, Employee | Today's scheduled collections |
| GET | `/collections/date/:date` | Admin, Accountant, Employee | Collections for a specific date |
| GET | `/collections/range` | Admin, Accountant, Employee | Collections between two dates |
| GET | `/collections/paid-range` | Admin, Accountant | Paid collections in a date range |
| GET | `/search` | Admin, Accountant, Employee | Search schedules |

### Admin

| Method | Path | Roles | Description |
|--------|------|-------|-------------|
| POST | `/admin/run-rollover` | Owner, Admin | Manually trigger R4 across all active schedules |

---

## Service Methods

All methods are in `installmentsService` object in `installments.service.ts`.

### `recordPayment(installmentId, data, userId)`

The main payment recording method. Handles three scenarios:

- **`full_payment`**: Records cash, marks row `paid`, runs R7 for excess, runs rollover.
- **`reschedule`**: Moves due date forward, creates sub-row. No cash recorded.
- **`partial_reschedule`**: Records partial cash, creates sub-row for remainder at new date.

Body fields: `scenario`, `amountPaid`, `paymentMode`, `paymentBreakdown[]`, `paymentDate`, `newDate`, `referenceNumber`, `notes`, `applyInterest`, `waiveExcessInterest`.

**Key invariant**: `amountDue` (contractual EMI) is never changed. Only `amountPaid` and `remainingAmount` change.

### `revertPayment(paymentId, reason, userId, options?)`

Atomically:
1. Deletes the `InstallmentPayment` row.
2. Restores `amountPaid` and `remainingAmount` on the installment.
3. Optionally applies overdue interest (if `options.applyInterest` provided) before rollover.
4. Sets `lastRolloverDate = null` on the schedule, then runs `ensureRolledForToday` so the newly-overdue row is absorbed into future installments immediately.

### `movePayment(paymentId, targetInstallmentId, reason, userId, options?)`

Fixes a payment attributed to the wrong installment (e.g., #3 was recorded but the customer actually paid #2 late).

Atomically:
1. Removes payment from source, restores its balance.
2. Optionally applies interest on target.
3. Records same payment on target with corrected date.
4. Runs excess distribution (R7) if cash exceeds target's amountDue.
5. Runs rollover so source row (now unpaid) is absorbed.

### `correctPayment(paymentId, correctAmount, reason, userId, options?)`

Fixes a payment recorded with a higher-than-actual amount (e.g., recorded ₹5,000 but customer only paid ₹3,000).

Atomically:
1. Optionally applies interest on the shortfall (from `installment.dueDate` to today).
2. Updates `payment.amount = correctAmount`.
3. Sets source installment: `amountPaid = correctAmount`, `remainingAmount = 0`, `status = paid` (shortfall is moved to future rows).
4. Distributes `shortfall + interest` equally across upcoming installments. If none, creates a new installment due today.

### `applyOverdueInterest(installmentId, amount, notes, userId)`

Applies discretionary overdue interest to an installment. Bumps `amountDue` and `remainingAmount`. Creates `InstallmentInterestApplication` row for audit + rollback capability.

### `rollbackInterestApplication(applicationId, body, userId)`

Reverses a previously applied interest. Decrements `amountDue` and `remainingAmount` (never below `amountPaid`). Sets `rolledBackAt`.

### `getSettlementQuote(scheduleId)` / `recordFinalSettlement(scheduleId, body, userId)`

Early-closure: compute principal + file charge for all unpaid rows (waiving future interest). Recording marks all unpaid rows as `paid`, creates payment records, and closes the schedule.

### `getInterestAccrual(scheduleId)`

Returns suggested overdue interest for each overdue installment:
```
interest = remainingAmount × (monthlyRate / 100 / 30) × daysOverdue
```

---

## Frontend

### `InstallmentDetailPage.tsx`

**State managed:**
- `paymentTarget` → opens `RecordPaymentDialog`
- `revertTarget` → opens Revert dialog
- `modifyTarget` → opens Modify (correct amount) dialog
- `showRescheduled` → toggle to show/hide superseded sub-rows
- `showTimeline` → collapse/expand Payment Timeline
- `manuallyEnabled` → Set of installment IDs where Pay button is force-enabled for absorbed rows

**Dialogs rendered inline:**
1. **RecordPaymentDialog** (separate component) — full/partial/reschedule payment
2. **Revert dialog** — undo last payment, with:
   - Overdue interest option (amber panel, only shown if days overdue > 0)
   - Distribution preview (how reverted amount spreads to upcoming rows)
   - Fix mis-record option (blue panel) → calls `movePayment`
3. **Modify dialog** — correct wrong amount, with:
   - Correct amount input + computed shortfall
   - Distribution preview
   - Optional interest on shortfall
   - Orange "Correct Payment" button

**`computeDistributionPreview(amount, excludeId)`** — client-side helper:
Returns `{ count, perRow, createNew }` showing how `amount` will be split.

### `RecordPaymentDialog.tsx`

Wide 2-column dialog (`max-w-4xl`):
- Left: scenario selector, amount input, date, mode, multi-split editor
- Right: sidebar with EMI summary, overdue interest banner, prepayment preview

Features:
- Up to 3 payment modes (`PaymentSplitsEditor`)
- `applyInterest` toggle (sent in payload)
- `waiveExcessInterest` toggle with `PrepaymentPreview`

### `PaymentTimeline.tsx`

Visual timeline of `InstallmentRollLog` entries grouped by date. Collapsed by default on detail page.

### `useInstallments.ts` — Hook exports

| Hook | Description |
|------|-------------|
| `useScheduleDetailQuery(id)` | Full schedule + installments + sale |
| `useScheduleListQuery(filters)` | Paginated schedule list |
| `useRecordPaymentMutation()` | POST `/:id/pay` |
| `useRevertPaymentMutation()` | POST `/payments/:id/revert` |
| `useMovePaymentMutation()` | POST `/payments/:id/move` |
| `useCorrectPaymentMutation()` | POST `/payments/:id/correct` |
| `useSettlementQuoteQuery(id)` | GET settlement quote |
| `useRecordFinalSettlementMutation()` | POST final settlement |
| `useInterestAccrualQuery(id)` | GET interest accrual |
| `useApplyOverdueInterestMutation()` | POST apply interest |
| `useRollbackInterestApplicationMutation()` | POST rollback interest |

---

## Payment Flows

### Normal full payment

1. Customer pays exact EMI amount.
2. `recordPayment(scenario='full_payment', amountPaid=X)`
3. `amountPaid = X`, `remainingAmount = 0`, `status = paid`.
4. Rollover runs (no effect since no overdue chain).

### Overpayment (customer pays more than due)

1. `recordPayment(scenario='full_payment', amountPaid > remainingAmount)`
2. Source row: `amountPaid = full cash`, `remainingAmount = 0`, `status = paid`.
3. Excess = cash − remaining → `distributeOverpayment` spreads to future primaries (R7).
4. If `waiveExcessInterest = true`: greedy clear of future rows with interest waiver.

### Partial payment + reschedule

1. `recordPayment(scenario='partial_reschedule', amountPaid=X, newDate=D)`
2. X is recorded, sub-row created for remainder at date D (R2).
3. Parent row status = `partially_paid`.

### Reschedule only

1. `recordPayment(scenario='reschedule', newDate=D)`
2. Sub-row created with full remainder at date D. No cash recorded.

### Overdue interest

1. Admin/accountant opens "Apply interest" on overdue row.
2. System suggests: `remaining × monthlyRate/100/30 × daysOverdue`.
3. User adjusts amount, confirms → `applyOverdueInterest`.
4. `amountDue` and `remainingAmount` are incremented. `InstallmentInterestApplication` row created.
5. Can be rolled back via `rollbackInterestApplication`.

### Revert (undo) last payment

1. Admin clicks "Undo" on a paid row.
2. Revert dialog shows:
   - Overdue interest suggestion (if row's due date has passed)
   - **Distribution preview**: which upcoming rows will absorb the reverted amount
   - **Fix mis-record option**: move the payment to the correct installment instead
3. On confirm: payment deleted, row balance restored, rollover re-run.

### Modify (correct wrong amount)

1. Admin clicks "Modify" on a paid row.
2. Modify dialog shows:
   - Actual amount received field
   - **Distribution preview**: how shortfall will spread
   - Optional interest on shortfall
3. On confirm: `correctPayment` called atomically (see service method).
4. Source row stays `paid` (shortfall transferred). Upcoming rows bumped up.

### Move (mis-attributed payment)

1. Admin clicks "Undo" on a mis-recorded row.
2. Enables "Fix mis-record" in the revert dialog.
3. Selects the correct target installment + overrides payment date.
4. On confirm: `movePayment` called atomically.
5. Source row: payment removed, balance restored, absorbed by rollover.
6. Target row: payment recorded with original date.

### Final settlement

1. Admin views "Final Settlement" card on sale detail page.
2. Quote computed: unpaid principal + file charge (future interest waived).
3. Admin enters payment mode and confirms.
4. All unpaid rows marked `paid`, schedule closed.

---

## Edge Case Handling

### No upcoming installments when distributing shortfall/overdue amount

When `correctPayment`, `revertPayment+rollover`, or overpayment distribution finds zero upcoming installments, a new `Installment` row is created:
- `installmentNumber = max(existing) + 1`
- `dueDate = today`
- `status = due_today`
- `notes` explains why it was created

### Absorbed rows (remainingAmount = 0, status = overdue)

Overdue rows that have been absorbed via R4 show `remainingAmount = 0` but are still visible in the UI. The "Pay" button is hidden by default; the employee can toggle "Enable Pay" to manually record a missed payment (treated as overpayment → redistributed again).

### Multi-mode payment splits

Up to 3 payment modes per payment. Each split creates one `InstallmentPayment` row. The `paymentBreakdown` array in the request body must sum to `amountPaid` (within ₹0.50 tolerance). `paymentMode` on the top-level body acts as a display/fallback field.

### Rescheduled rows

Rows with `isRescheduled = true` are hidden by default in the table. Toggle "Show N rescheduled" to reveal them. They cannot be paid (system error); pay the active sub-row instead.

### Sub-row numbering

Sub-rows use `parentInstallmentNumber.subSequence` label format (e.g., `#3.1`, `#3.2`). Labels are computed by `formatInstallmentLabel(inst)` in `apps/web/src/lib/installment-label.ts`.

---

## Interest Calculations

### Standard overdue interest (suggestion)

```
interest = remainingAmount × (monthlyRate / 100 / 30) × daysOverdue
```

Where:
- `monthlyRate` = `sale.interestRate` (e.g., `2` for 2% per month)
- `daysOverdue` = calendar days from `installment.dueDate` to today

### Interest on shortfall (correctPayment)

Same formula but `baseAmount = shortfall` (the unrecovered portion of the payment).

### Settlement quote (early closure)

```
earnedInterest = totalInterest × (paidInstallments / numInstallments)
waivedInterest = totalInterest - earnedInterest
finalSettlement = unpaidPrincipal + fileCharge (unpaid share)
```

Implemented in `packages/shared-utils/src/emi-calculator.ts` → `computeSettlementQuote`.

---

## Key Invariants

1. **`amountDue` (contractual EMI) is only ever increased** — by interest application or shortfall distribution from corrections/rollover. It is never decreased (except by interest rollback).

2. **`dueDate` is immutable** — the original due date never changes. Reschedule creates a new sub-row. Payment date lives on `InstallmentPayment.paymentDate`.

3. **`installmentNumber` is permanent** — numbers are never reassigned or renumbered. This preserves audit trail and credit bureau compatibility.

4. **Every mutation that might make a row newly-overdue must call `ensureRolledForToday`** — specifically `revertPayment` and `movePayment`. They reset `lastRolloverDate = null` first to force the engine to re-evaluate.

5. **`syncScheduleAndSale` must be called at the end of every transaction** — to keep schedule totals and `sale.pendingAmount` consistent.

6. **Excess cash is never lost** — if `amountPaid > amountDue` on a row, excess goes to R7 distribution. No money disappears in the system.

7. **Interest applications are reversible** — every `InstallmentInterestApplication` can be rolled back as long as `rolledBackAt` is null. Rolling back decrements `amountDue` / `remainingAmount` but never below `amountPaid`.
