# Installment

## Purpose and scope

Collect a shop's in-house self-finance receivables through independent EMI balances, payments,
promises, discretionary penalties and audit history. Web left rail **Installments** opens
`/installments`; account detail is `/installments/:scheduleId`.
[Sales](sales.md) creates the account; [Customers](customers.md) supplies identity/reliability;
[Employees](employees.md) explains collector profiles versus user assignments.
Company-finance receivables and partial-with-promise sales are separate sales workflows.

The original 741-line redistribution reference is preserved in
[legacy installment redistribution](../legacy/installment-redistribution.md), not discarded.
It is historical evidence, not the current contract. Read
[ADR-0001, including its amendments](../adr/0001-per-emi-overdue-installment-model.md) and its
[executed implementation plan](../adr/0001-implementation-plan.md) with the source caveats below.

## Implementation status

| Surface | Status | Evidence / limits |
|---|---|---|
| API | Implemented core; mixed-generation correction/settlement paths remain | [Routes](../../apps/api/src/modules/installments/installments.routes.ts), [current engine](../../apps/api/src/modules/installments/installments.engine.ts), [service](../../apps/api/src/modules/installments/installments.service.ts), [promises](../../apps/api/src/modules/promises/promises.service.ts). |
| Web | Implemented collection/account UI; some stale controls | [List](../../apps/web/src/pages/installments/InstallmentListPage.tsx), [detail](../../apps/web/src/pages/installments/InstallmentDetailPage.tsx), [payment dialog](../../apps/web/src/components/RecordPaymentDialog.tsx). |
| Flutter | Planned; no implementation now | New app for all authorized tenant roles, staged toward eventual authorized web parity. Existing Expo employee collection app is legacy, not Flutter delivery. |

Reviewed **2026-11-10** by source inspection of current working-tree files; **not runtime-certified**.
API execution is authoritative where comments, ADR prose or legacy screens disagree.

## Business rules and invariants

- **Per-EMI model:** normal payment does not absorb a missed EMI into the next month or move due
  dates. Current engine acts on primary, nonclosed rows. Historical reschedule/sub-row fields remain
  for legacy data. `plannedAmount` retains original scheduled amount; `amountDue` can change through
  explicit penalty, rebate or shortfall carry. It is not globally immutable in the amended model.
- Creation uses shared [calculateEMI](../../packages/shared-utils/src/emi-calculator.ts):
  principal = selling price − down payment; total interest = principal × monthly rate × tenure;
  payable = principal + interest + file charge. EMI is whole-rupee rounded.
  **Actual date behavior:** calculator starts from current time plus month increments, not the sale
  date; each EMI has the same rounded amount with no last-row reconciliation in this function.
  Do not describe this as reducing-balance interest or claim totals always sum exactly.
- [Allocator](../../apps/api/src/modules/installments/installments.allocator.ts) fills oldest
  unpaid due date first, including future EMIs once older balances clear. `explicitInstallmentId`
  deliberately moves one chosen EMI first; remaining money then continues oldest-first.
  The URL's installment ID opens an account; by itself it does not force payment to that row.
  One cash receipt may create several `InstallmentPayment` allocation rows.
- **Shortfall exception:** for a due/today-or-earlier EMI touched by this payment and left short,
  default `shortfall=spread` reduces that source's `amountDue`, marks it paid and adds the
  shortfall to later-numbered unpaid EMIs. Equal whole-rupee shares go to targets; odd rupees/paise
  go to the first target. Each move is an `InstallmentCarryForward` with payment IDs and roll-log
  evidence. Without later unpaid rows, the shortfall stays owed. Future/not-yet-due partial rows
  are not automatically spread by this branch.
- With a payment promise, omitted shortfall mode defaults to `keep`; explicit `keep` also leaves
  the balance on the source. Payment plus promise is atomic. Invalid promise means no payment,
  penalty or carry from that transaction survives.
- Surplus beyond **all** current row balances increments schedule `creditBalance` and logs
  `credit_added`. A fully paid account rejects another payment. The inspected current engine
  does not implement future automatic credit consumption or refund, nor reverse surplus credit
  when reverting an allocation; do not promise those ADR intentions as delivered behavior.
- [Status derivation](../../apps/api/src/modules/installments/installments.derivations.ts) uses
  UTC date-only days: nonpositive remaining → paid; otherwise any paid amount → partially paid;
  otherwise past/today/future → overdue/due_today/upcoming. Thus partially paid can also be late;
  status alone is not a days-past-due calculation. Stored statuses are not universally refreshed
  by a daily rollover job.
- **Late penalty is opt-in, flat ₹/day per sale**, default ₹2 via tenant
  `settings.installment.defaultPenaltyPerDay`; nullable sale `penaltyPerDay` overrides, including zero.
  Clock starts after oldest unpaid due date, not once per overdue EMI; `chargedThrough` prevents
  repeated days across active applications (legacy entries use applied day). Reading a preview
  never charges anything. Payment `applyPenalty=true` computes the amount on the server and
  adds it to the first receiving EMI. Sale rate updates allow 0–10,000.
- **Early-payment deduction is opt-in:** default threshold 30 days; share of original sale interest
  (`totalInterest / numInstallments`), no interest means no rebate. Older unpaid EMI blocks it;
  a live rebate for that source EMI blocks a second. Source EMI must be paid in full in the same
  transaction. Deduction reduces the **last unpaid EMI first**, spilling backward if necessary,
  never below zero; `InstallmentRebate` links the source and payment IDs.
- Standalone legacy-compatible apply-interest accepts an explicit positive amount with a separate
  permission. It is not automatic flat-penalty charging and must not be confused with monthly
  percentage suggestion helpers still present in the service/derivations.
- **Promises:** separate `InstallmentPromise`, not generated EMI sub-rows. Required schedule,
  customer, unpaid covered EMI IDs, positive amount, today-or-later promise date.
  Covered EMIs must belong to that customer/account; amount cannot exceed their outstanding
  balance by more than ₹0.50. An overlapping pending promise is marked `replaced` as a whole,
  retaining history. Pending promises can be cancelled as mistakes, not deleted.
- Register labels are `N.k` per covered EMI, ordered by creation; a multi-EMI promise has multiple
  labels. Cancelled promises take no number; replaced promises remain numbered and are not broken.
- **Actual call-list policy differs from ADR prose:** `/call-list` returns one row per active
  account with due-today, promise-due, broken-promise or uncovered-overdue reasons.
  Overdue EMIs covered by a later pending promise are **snoozed** into `snoozed` (“Waiting on a
  promise”); another EMI due today still produces a call. Promise due day restores the call;
  afterward unkept promises can appear broken. The independent all-overdue data remains visible.
  Do not repeat the historical blanket statement “promises never suppress calls” as current behavior.
- [Resolver job](../../apps/api/src/jobs/resolve-promises.job.ts) resolves only pending promises
  whose promised date has passed: sums covered payment rows created since promise creation and
  paid on/before its date; full → kept, some → partially_kept, none → broken. Late payments do not
  keep it. Job is tenant-filtered. Daily scheduler runs only with `ENABLE_SCHEDULER=true`
  (default 01:00 Asia/Kolkata); no automatic penalty/redistribution. Compatibility
  `runDailyRollover` is a no-op, not an overdue-status refresh.
- Current engine revert deletes one payment allocation row, restores balance/status, reverses
  linked live rebates/carries and reactivates schedule. If a carried target has already been paid
  including that carry, revert is rejected atomically: undo dependent payment first.
  Penalty rollback is separate and cannot lower due below paid amount. Revert does not promise
  to cancel/recompute earlier promise outcomes or reverse all rows from one receipt.
- Move/correct and final settlement still call older **service** implementations, not the current
  engine. Move is same-schedule only; correct requires a positive amount lower than recorded and
  redistributes the difference, optionally with interest, with fallback row creation if needed.
  These are explicit compatibility actions, not evidence that normal Pattern B redistributes missed
  payments. Automatic interest-waiving final settlement was removed from the sale screen, but its
  API remains reachable: quote uses principal/file-charge shares of unpaid rows and settlement
  rewrites/marks them paid. Optional expected quote rejects >₹1 drift. Treat it as a policy/code
  mismatch needing review, not the recommended current early-payment deduction flow.

## Access, tenancy, and shop scope

Feature `installments` gates both `/api/v1/installments` and `/api/v1/promises`.
Usable permissions follow [access.ts](../../packages/shared-types/src/access.ts): role/user grants,
user denies, feature switches and recursive prerequisites, not the route comments' role labels.
Sanitized sales viewers (`sales.view_sanitized` without `sales.view_real`) lose installment
permissions; a field collector with no sales-view access can retain authorized collection access.

- List/call-list/paid-range: `installments.list`; overdue: `.tab.all_overdue`;
  scheduled today/date/range: `.tab.todays_scheduled`; search: `.tab.search`;
  detail/settlement quote/accrual: `.detail`; timeline/roll-log: `.payment_timeline`.
- Payment and preview: `.record_payment`; revert/move/correct and promise cancel:
  `.revert_payment`; explicit interest apply and penalty-rate edit: `.interest.apply`;
  interest rollback: `.interest.rollback`; final settlement: `.final_settlement`.
- Promise create uses `.record_payment`; list accepts either `.detail` or `.list`.
  No separate promise permission or role-only gate is registered.
- Read lists pass selected-shop or accessible `shopIds` through the sale relation. Date/today/range
  controllers force JWT role `employee` to its own **user ID** and active assignment filter;
  other callers may request `employeeId`. Call-list, overdue, paid-range and search are not
  universally assignment-filtered.
- Detail/timeline/roll-log/quote/accrual routes omit shop middleware and use tenant-isolated IDs.
  Payment/preview/promises and several correction routes run shop middleware, but inspected
  handlers do not compare target account shop/assignment against that request scope.
  Do not label every mutation “assignment-scoped” or “target-shop-enforced.”
- [Tenant Prisma](../../apps/api/src/config/database.ts) and explicit engine/promise tenant filters
  protect tenant boundaries. [Shop middleware](../../apps/api/src/middleware/shop-scope.ts)
  validates current selected tenant shop and membership, not arbitrary target-row ownership.
- [Field filtering](../../apps/api/src/middleware/field-access.ts) strips `interestRate`/`effectiveRate`
  on the installment prefix without `.view_interest_rate`. It does not generally strip all finance
  amounts or guarantor contacts there, nor does the customer phone-prefix rule apply to this prefix.
  UI/contact permission names are not evidence of full server field filtering.
- Payment flag `applyPenalty` is accepted on the record-payment permission path; the engine does
  not additionally require `.interest.apply` for that flag even though the web hides its penalty
  control without that permission. Distinguish standalone action guards from payment options.

## User workflows

1. Create an authorized self-finance sale, then open its installment account or collection list.
2. Use Today's Calls to call due/promised/overdue accounts; inspect “Waiting on a promise” and
   All Overdue separately. A promise does not move an EMI date or clear its debt.
3. Open payment preview, choose payment date and optionally a first target EMI; inspect outstanding,
   planned/carry differences and discretionary adjustments before recording money.
4. Pay full or partial. Choose spread versus keep for an eligible shortfall; optionally save the
   remaining-balance promise in the same transaction. To record no money, use separate promise
   creation rather than rejected `scenario=reschedule`.
5. View promise labels/history, payments and roll log. Replace a pending promise with a new date
   or cancel a mistaken pending one with the required correction permission.
6. Correct mistakes through permitted revert/move/correct actions. Review dependent carry/rebate
   effects first; a failed dependent revert requires unwinding target payment, not a blind retry.
   Refresh state after failures; controller error status mapping is not uniform across domain errors.

## API contracts and data

Prefix `/api/v1/installments` unless noted. JSON uses success/error envelopes; schedule list is
paginated. Decimal money often serializes as strings; payment preview uses numeric amounts.

| Method and suffix | Current behavior |
|---|---|
| `GET /` | Schedule page (`page`, `pageSize`, `status`). |
| `GET /call-list` | `date=YYYY-MM-DD`, optional zone; rows, snoozed accounts and totals. |
| `GET /overdue` | Overdue items, optional zone. |
| `GET /collections/today`, `/collections/date/:date` | Scheduled collection object with `collections`/legacy note context; optional employee/zone. |
| `GET /collections/range` | Date range, optional employee/zone; defaults from two weeks ago through today. |
| `GET /collections/paid-range` | Paid date-range view, optional zone; `installments.list`, not assignment-filtered like scheduled ranges. |
| `GET /search` | `q`, `filterBy`: ledger, sale number, phone/name or all; web starts from two characters. |
| `GET /:scheduleId` | Reshaped schedule/installments/sale/customer/product/guarantor/shop/assignments; active carry/rebate/interest explanations. |
| `GET /:scheduleId/timeline`, `/:scheduleId/roll-log` | Payment/history views, including legacy events. |
| `GET /:installmentId/payment-preview` | Optional payment date and `targetInstallmentId`; read-only outstanding, carry, penalty and rebate eligibility. |
| `POST /:installmentId/pay` | Positive `amount` or `amountPaid`, required mode; optional date/reference/notes/explicit target, adjustment flags, shortfall and promise; 201. |
| `POST /payments/:paymentId/revert` | Current engine; controller uses body reason only, ignoring legacy cascade/interest options; no body Zod validator registered on this route. |
| `POST /payments/:paymentId/move` | Target UUID, required reason, optional date/interest; older service. |
| `POST /payments/:paymentId/correct` | Positive lower `correctAmount`, reason, optional interest; older service. |
| `PATCH /schedules/:scheduleId/penalty-per-day` | Numeric `penaltyPerDay` 0–10,000. |
| `GET /schedules/:scheduleId/settlement-quote`, `POST /schedules/:scheduleId/final-settlement` | Surviving older waiver/closure API; not the removed sale-page card. |
| `GET /schedules/:scheduleId/interest-accrual` | Per-row active applications and flat per-sale uncharged penalty reported once on the oldest unpaid primary row. The monthly-rate method comment is stale. |
| `POST /:installmentId/apply-interest` | Explicit positive amount, optional notes. |
| `POST /interest-applications/:applicationId/rollback` | Required reason; refuses rollback below paid balance. |
| `POST /api/v1/promises` | Validated schedule/customer/covered UUIDs, date, amount and optional ≤500-character notes; 201. |
| `GET /api/v1/promises` | Optional schedule/customer/status; stable labels computed before status filtering. |
| `DELETE /api/v1/promises/:id` | Cancels pending promise with optional reason; retains history. |

[Payment validation](../../apps/api/src/modules/installments/installments.validation.ts) accepts six
modes: cash, cards, UPI, bank transfer, cheque; date strings match `YYYY-MM-DD`.
`scenario=reschedule` is explicitly rejected; `partial_reschedule + newDate` is translated to a
payment promise for older clients. Positive amount is mandatory, so separate promise is the
no-payment path. Unknown body keys are stripped: **`paymentBreakdown` is not declared**, despite
the current web dialog/hook sending it. Split-mode EMI receipts are not implemented by this
contract; do not copy the legacy “three splits atomically recorded” statement.
No live rollover/reschedule/undo-reschedule/assignment route is registered in this installment
router, even though related service methods, validation exports, permissions and web hooks remain.

Models: `InstallmentSchedule`, `Installment`, `InstallmentPayment`,
`InstallmentInterestApplication`, `InstallmentCarryForward`, `InstallmentRebate`,
`InstallmentPromise`, `InstallmentRollLog`, `EmployeeCollectionAssignment`.
Assignments reference User IDs, not personnel Employee IDs.
Reliability endpoints live under [Customers](customers.md), with different lifetime and
promise-risk semantics.

## Web behavior

[App routes](../../apps/web/src/App.tsx) guard list and detail independently.
Tabs are **Today's Calls**, **Scheduled**, **All Overdue**, **Paid**, **Search Installment**,
filtered by their usable permissions. URL tab/date state, zone filters, date ranges and totals
support collection work. Search covers ledger/sale number and customer phone/name.
[CallListTab](../../apps/web/src/pages/installments/CallListTab.tsx) displays snoozed promises separately.

Account detail shows current EMI rows, original/planned versus carry differences, payment records,
promise labels/history, timeline and correction dialogs, plus a permitted penalty-rate edit.
[RecordPaymentDialog](../../apps/web/src/components/RecordPaymentDialog.tsx) previews oldest-first
allocation, chosen first EMI, shortfall spread, rest-on-date promise, optional penalty/rebate and
split-mode input. Its split input is a confirmed contract mismatch, not API delivery.
Legacy reschedule/undo/manual controls still occur in detail/hooks; absent route registration
means they must not be documented as supported new workflows.
Revert dialog still sends legacy cascade/interest choices not consumed by current controller.
The sale detail's automatic final-settlement card is removed, while hooks/API remain.

## Mobile behavior and differences

Legacy Expo has collections list/detail, record-payment and profile routes.
[Collection hooks](../../apps/mobile/src/hooks/useCollections.ts) call scheduled collection,
schedule detail and payment endpoints. [PaymentForm](../../apps/mobile/src/components/PaymentForm.tsx)
reads server preview, has full/partial tabs, cash/UPI/card modes and opt-in penalty/rebate.
Its partial form currently does **not** send its promise date: it posts a plain payment with no
promise, so default shortfall spread may apply. It lacks current web promise/correction parity.

NEW Flutter is planned for all authorized tenant roles, not employee-only: staged delivery of
calls/scheduled/overdue/paid/search, account/promise history, authorized payment/adjustments,
correction and linked customer/sale workflows, eventually authorized web parity.
No implementation now. Offline writes, retry/idempotency and reconciliation strategy, notifications,
background sync and device PII retention are open decisions; none is implied by Expo or PWA code.

## Dependencies and cross-feature effects

- [Sales](sales.md) creates self-finance schedules and blocks term regeneration once payments,
  penalties, rebates or promises exist. Metadata/rate edits preserve existing account activity.
- [Customers](customers.md) exposes both legacy lifetime score and promise-risk metrics. Its
  embedded real sales/history projection is a separate disclosure gap; sanitized users must not
  obtain installment data through another prefix.
- [Employees](employees.md) distinguishes personnel records from User assignment/collector IDs;
  assignment provisioning must not be inferred from employee creation.
- Shared access, [installment types/settings](../../packages/shared-types/src/installment.types.ts),
  calculator, field stripping and tenant/shop middleware affect API, web and future Flutter together.
- Scheduler deployment/configuration determines when pending promise outcomes materialize; no
  runtime scheduler execution was established by this review.

## Code and source references

- API [registration](../../apps/api/src/app.ts),
  [routes](../../apps/api/src/modules/installments/installments.routes.ts),
  [controller](../../apps/api/src/modules/installments/installments.controller.ts),
  [validation](../../apps/api/src/modules/installments/installments.validation.ts),
  [engine](../../apps/api/src/modules/installments/installments.engine.ts),
  [allocator](../../apps/api/src/modules/installments/installments.allocator.ts),
  [derivations](../../apps/api/src/modules/installments/installments.derivations.ts),
  [service](../../apps/api/src/modules/installments/installments.service.ts).
- Promise [routes](../../apps/api/src/modules/promises/promises.routes.ts),
  [controller](../../apps/api/src/modules/promises/promises.controller.ts),
  [service](../../apps/api/src/modules/promises/promises.service.ts),
  [validation](../../apps/api/src/modules/promises/promises.validation.ts).
- [Scheduler](../../apps/api/src/jobs/installments-scheduler.ts),
  [resolver](../../apps/api/src/jobs/resolve-promises.job.ts),
  [schema](../../apps/api/prisma/schema.prisma),
  [shared calculator](../../packages/shared-utils/src/emi-calculator.ts).
- Web [hooks](../../apps/web/src/hooks/useInstallments.ts), list/detail/dialog links above;
  customer [risk computation](../../apps/api/src/modules/customers/customers.reliability.ts).
- Tests: [allocator](../../apps/api/tests/unit/allocator.test.ts),
  [penalty rules](../../apps/api/tests/unit/penalty-rules.test.ts),
  [access](../../apps/api/tests/unit/access-rules.test.ts),
  [promises](../../apps/api/tests/integration/promises.test.ts),
  [call-list/preview](../../apps/api/tests/integration/call-list.test.ts).
- [ADR/amendments](../adr/0001-per-emi-overdue-installment-model.md),
  [historical implementation plan](../adr/0001-implementation-plan.md),
  [preserved redistribution reference](../legacy/installment-redistribution.md).

## Verification and acceptance

Source inspection plus documentation heading/link/preservation checks only. No tests, API/browser,
database or mobile runtime verification performed. Relevant existing commands, **not run here**:

```text
npm run test --workspace=apps/api -- tests/unit/allocator.test.ts tests/unit/penalty-rules.test.ts tests/unit/access-rules.test.ts
npm run test --workspace=apps/api -- tests/integration/promises.test.ts tests/integration/call-list.test.ts
```

Integration commands require PostgreSQL and the isolated test database. Acceptance should cover:
- Oldest-first versus chosen-first multi-EMI allocation; zero/negative/no-balance rejection;
  surplus accounting and rounding/month-end dates.
- Due short payment spreads with exact remainder/carry evidence; explicit keep/promise and last
  EMI retain debt; future partial EMI does not spread unexpectedly.
- Preview is read-only; penalty is once per sale/day coverage; zero override; optional early
  rebate requires full/early source payment and reverses correctly.
- Invalid atomic promise rolls back payment; overlapping replacements, cancellation labels,
  multiple covered EMIs and on-time/late resolver classification.
- Actual snoozed call behavior versus all-overdue visibility; another EMI becoming due restores
  calls even while older debt has a promise; disabled scheduler leaves pending outcomes.
- Revert dependencies, surplus-credit behavior, correction versus current carry/rebate data,
  legacy settlement waiver and stale quote rejection.
- Feature/user denies, sanitized-viewer prohibition, collector access without sales access,
  tenant boundaries, inaccessible shop/assignment IDs and field leakage on every response prefix.
- Split-mode request mismatch, stale undo hooks and ignored revert options fail visibly rather
  than being advertised as reliable supported workflows.

## Known gaps and next work

Confirmed source discrepancies needing coordinated decisions/fixes:
- ADR/legacy “never suppress calls” conflicts with implemented later-promise snoozing, which is
  also asserted by existing call-list tests. Resolve policy/documentation deliberately; this task
  records reality, not an approved change to that ADR.
- Split-mode web payment data is stripped by schema. Old reschedule/undo controls have no routes.
  Legacy revert cascade/interest inputs are ignored by current revert handler.
- Move/correct/settlement remain older service paths. Review their carry/rebate/credit consistency
  before calling corrections uniformly Pattern B-safe. Credit spending/refund/revert handling is
  not established by the current engine.
- ID-based shop/assignment checks and permission-based field redaction are incomplete. UI penalty
  permission gating is stricter than the payment flag's API guard.
- Current-date schedule generation, month-end rollover, whole-rupee sum mismatch and stale stored
  statuses need runtime/accounting review. Original immutable/no-redistribution language has
  explicit shortfall and compatibility exceptions.
- Expo partial-payment promise omission is known; new Flutter planning must use current contracts,
  not copy legacy inputs. No Flutter delivery or runtime certification is claimed.

## Decisions and review checkpoint

Checkpoint **2026-11-10**: source-reviewed API behavior is the contract described here.
ADR-0001's later flat-penalty/shortfall/rebate amendments override its original monthly/no-spread
rules; remaining ADR/code conflicts are explicitly open above. The full old redistribution text
is retained under `docs/legacy`, including statements now superseded, with an added historical banner.
Flutter is approved direction for all authorized roles and eventual parity, not implementation.
Coordinator owns `docs/features/checkpoints.json`; this task does not edit inventory or hashes.
