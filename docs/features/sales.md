# Sales

## Purpose and scope

Record a serialized product's sale, payment terms, customer and physical-register ledger number.
The web left rail is **Sales**: `/sales`, `/sales/new`, `/sales/:id`,
`/sales/:id/edit` and `/sales/scan-register`. In-house EMI collection belongs to
[Installment](installment.md); customer identity belongs to [Customers](customers.md).
Company-finance receivables are not in-house installment schedules.

## Implementation status

| Surface | Status | Evidence / limits |
|---|---|---|
| API | Implemented, with access/scope gaps noted below | [Routes](../../apps/api/src/modules/sales/sales.routes.ts), [service](../../apps/api/src/modules/sales/sales.service.ts); four sale types, editing, approval and receivable updates. |
| Web | Implemented | [List](../../apps/web/src/pages/sales/SaleListPage.tsx), [form](../../apps/web/src/pages/sales/SaleCreatePage.tsx), [detail](../../apps/web/src/pages/sales/SaleDetailPage.tsx), [register scan](../../apps/web/src/pages/sales/RegisterScanPage.tsx). |
| Flutter | Planned; no implementation delivered here | New app for all authorized tenant roles, staged toward authorized web parity. Existing Expo collection code is legacy, not Flutter delivery. |

Reviewed **2026-11-10** by source inspection, including the dirty working tree.
Not runtime-certified. Current executable API behavior takes precedence over stale code comments,
screen warnings and historical documentation.

## Business rules and invariants

- Types are `full_payment`, `partial_with_promise`, `self_finance` and `company_finance`.
  A sale references one product, an existing customer and a required manual `ledgerNumber`.
  Creation checks that the product is in stock and belongs to the selected shop; customer and
  guarantor existence checks are tenant-wide, supporting repeat customers from another shop.
- **Dual recording is specifically for self-finance**, not every sale. One transaction creates
  `SaleRecord`, its same-ID `SaleRecordSanitized` cash/full-payment copy when self-finance,
  product sold status, product audit entry and, for self-finance, schedule/EMIs.
  Other sale types have one real record. Do not copy the older “every sale is dual-written” claim.
- List/detail select the restricted projection when the caller lacks effective `sales.view_real`,
  irrespective of role name. [Public projection](../../apps/api/src/modules/sales/sales.public-view.ts)
  makes self-finance look like cash full payment: no EMI terms, guarantor, interest or revealing
  notes; split breakdown becomes null. Other sale types remain their actual types, including
  company-finance and partial balances. Restricted full-payment filtering includes self-finance;
  self-finance filtering returns none; records are counted once.
- Selling price is GST-inclusive and is also `totalAmount`; GST is extracted as
  `round(price × rate / (100 + rate))`. Discount is stored separately, not deducted again from
  that total. Purchase-price/input-GST snapshots support profit calculations.
- Self-finance requires a guarantor, installment count and interest rate. Shared calculation uses
  principal = price − down payment, flat monthly interest = principal × monthly rate × months,
  plus file charge. EMI is rounded to a whole rupee. See the installment doc for date/rounding gaps.
- Partial-with-promise tracks `pendingAmount = totalAmount − downPayment`; later payments must
  be positive and no greater than the pending balance. This sale-level promise is distinct from
  `InstallmentPromise`. Company finance tracks company, financed amount, expected date and
  pending/received/overdue/partial status; its default expected date is tomorrow.
- Sale dates cannot be future or precede the product's purchase-invoice day.
- **Editing is not an unconditional payment reset.** Product cannot change. The service can
  change sale type, although the web form locks it. EMI terms/date/price changes rebuild a
  schedule only before installment activity. Any recorded payments, penalty applications,
  rebates or promises block such changes (counts include historical records).
  Ledger, notes, guarantor and penalty-rate edits preserve an unchanged schedule and payments.
  Rebuilding removes old schedule rows/logs/assignments. Finance receipt status/date/reference
  are reset by an edit; review before changing a company-finance sale.
- With `sales.approval_workflow` on, creators without effective `sales.approve` produce pending
  sales; otherwise creation auto-approves. Product/schedule creation already occurs while pending.
  Approving an already approved sale is idempotent.

## Access, tenancy, and shop scope

- Feature `sales` gates `/api/v1/sales`. Self-finance creation also depends on `installments`;
  approval depends on `sales.approval_workflow`.
- [Effective access](../../packages/shared-types/src/access.ts) = role grants + user grants − user
  denies − disabled-feature permissions − permissions missing prerequisites, iterated to stability.
  Default role labels are not guarantees. Creation needs the matching `sales.create_*`, plus
  customer/product list prerequisites; self-finance creation and editing require `sales.view_real`.
- List/detail/edit/history use `sales.list`, `sales.detail`, `sales.edit`, `sales.view_history`.
  Finance receipt, partial settlement and approval use `sales.record_company_finance_payment`,
  `sales.mark_partial_settled` and `sales.approve`.
- List supports selected-shop or accessible all-shops scope. Creation/edit use the single
  `shopFilter.shopId`; edit checks the sale's shop. Shop switching/all-shops require usable
  permissions and tenant-owned active `UserShop` access in
  [shop middleware](../../apps/api/src/middleware/shop-scope.ts).
- **Scope limitation:** detail/history, finance-payment, pending-payment and approval handlers
  resolve IDs without comparing the target sale's shop against `shopFilter`; a shop pre-handler
  alone is not target ownership enforcement. Sale-installment reads have no shop pre-handler.
  Prisma's [tenant extension](../../apps/api/src/config/database.ts) still supplies tenant isolation.
- [Field filtering](../../apps/api/src/middleware/field-access.ts) removes purchase price/profit
  keys from sales responses without the associated section permissions. UI section and invoice
  permissions are additional presentation controls, not evidence that every underlying field is
  independently stripped.
- Sanitized-viewer restrictions remove installment access in the shared rulebook. Field collectors
  without sales-view permissions are not classified as sanitized viewers merely for lacking
  `sales.view_real`.

## User workflows

1. Select one shop and an in-stock product; find/create a customer; enter ledger, date and price.
2. Select an authorized sale type, enter its terms, optionally split the initial payment across
   up to three modes, review and submit. Invalid product/shop, missing related records or
   invalid terms fail; do not assume every domain validation maps to HTTP 400.
3. If approval is enabled, an authorized reviewer opens the pending list and approves.
4. Open sale details for invoice, allowed financial sections and history; record partial-balance
   receipts or company-finance status through their separate actions.
5. Before editing, distinguish safe metadata changes from EMI term changes. Existing collection
   activity requires correction through installment workflows, not regeneration of the account.

## API contracts and data

Prefix `/api/v1/sales`; JSON uses `sendSuccess`/`sendPaginated`/`sendError`, not bare rows.
Prisma Decimal values may serialize as strings; clients must coerce money deliberately.

| Method and suffix | Actual contract / permission |
|---|---|
| `GET /` | Paginated list; date range, type, customer/product/ledger search, profit thresholds, approval state; `sales.list`. Restricted projection ignores real-only profit filtering. |
| `POST /` | `createSaleSchema`; any create permission at route, exact type permission rechecked by controller; 201. |
| `GET /:id` | Real/restricted detail; `sales.detail`. |
| `PUT /:id` | Full create-shaped payload, not a patch; `sales.edit`. |
| `GET /finance-companies` | Authenticated lookup; still behind the sales feature gate. |
| `GET /:id/installments` | Actual route guard is `sales.view_real` only, despite comment mentioning detail too. |
| `GET /:id/activity` | Modification history; `sales.view_history`. |
| `PUT /:id/finance-payment` | Status plus optional received date/reference; `sales.record_company_finance_payment`. |
| `PUT /:id/record-payment` | Positive amount, payment mode, optional up-to-three breakdown/notes; `sales.mark_partial_settled`. |
| `GET /pending-approval/count` | `sales.list`; actual scoped pending count even without approve permission (route comment claiming zero is stale). |
| `POST /:id/approve` | `sales.approve`. |

[Validation](../../apps/api/src/modules/sales/sales.validation.ts) requires UUID product/customer,
ledger length 1–50, positive price, nonnegative monetary inputs, self-finance count 1–60,
rate 0–100 and penalty/day 0–10,000. Payment modes: cash, credit/debit card, UPI,
bank transfer, cheque. Breakdown length is at most three; this schema does **not** enforce its
sum or distinct modes. No sale DELETE/cancel/export endpoint exists in this router despite
catalog permission names.

## Web behavior

Routes are [permission-guarded](../../apps/web/src/App.tsx).
[Hooks](../../apps/web/src/hooks/useSales.ts) use the tenant/shop-aware API client and invalidate
sale queries on writes. List filters live in URL parameters; default dates cover the previous
month's start through today. Active text searching removes date constraints; search is debounced
and sent from two characters. Approval badge/filter/actions and profit filtering are permission-aware.
Creation supports customer/product/guarantor search, financing preview and initial payment splits.
Detail supports permitted invoice/PDF, receivable actions and audit sections.
Register scanning is a prefill aid dependent on OCR, not an alternative sales persistence API.
The sale-detail final-settlement card was removed; surviving settlement API is documented under
[Installment](installment.md). The edit screen's reset/type-lock warning is not an exact description
of current service behavior.

## Mobile behavior and differences

NEW Flutter is planned for **all authorized roles**, with staged delivery and eventual authorized
web parity: lookup, creation, permitted editing/approval, invoices and payment-status workflows.
No Flutter implementation is claimed or added. API permissions, tenant selection and shop scope
must remain authoritative on mobile.
Legacy [Expo collections hook](../../apps/mobile/src/hooks/useCollections.ts) can fetch a sale
detail but is not a sales-management app; the API may deny collectors `sales.detail`.
Offline writes, sync/conflict handling, notifications and invoice sharing remain open.

## Dependencies and cross-feature effects

- [Customers](customers.md) supplies customer/guarantor lookup; quick search is tenant-wide.
- [Installment](installment.md) owns EMI payments, promises, penalties and correction history;
  changing sale schedule terms is coordinated with those records.
- Product stock/audit, purchase invoice dates and input GST affect creation and earnings.
- [Customer Searching](customer-searching.md) is a separate register, not another sale table.
- Shared [permissions](../../packages/shared-types/src/permissions.ts) and
  [access prerequisites](../../packages/shared-types/src/access.ts) must change together with
  API/UI behavior. Customer embedded sale/history reads currently bypass the sales projection;
  see the customer doc's confirmed gap.

## Code and source references

- API [registration](../../apps/api/src/app.ts),
  [routes](../../apps/api/src/modules/sales/sales.routes.ts),
  [controller](../../apps/api/src/modules/sales/sales.controller.ts),
  [service](../../apps/api/src/modules/sales/sales.service.ts),
  [validation](../../apps/api/src/modules/sales/sales.validation.ts),
  [public projection](../../apps/api/src/modules/sales/sales.public-view.ts).
- Data [schema](../../apps/api/prisma/schema.prisma);
  [EMI/settlement calculator](../../packages/shared-utils/src/emi-calculator.ts).
- Web [hooks](../../apps/web/src/hooks/useSales.ts), list/form/detail/scan links above.
- [Visibility integration tests](../../apps/api/tests/integration/sales-visibility.test.ts),
  [access-rule unit tests](../../apps/api/tests/unit/access-rules.test.ts).

## Verification and acceptance

Only source inspection and documentation link/heading checks were performed; no API, browser,
database tests or typechecks ran for this documentation-only task. Existing relevant tests:
`npm run test --workspace=apps/api -- tests/integration/sales-visibility.test.ts tests/unit/access-rules.test.ts`
(integration requires the isolated test database).

Acceptance to verify at runtime:
- Restricted self-finance list/detail are indistinguishable from cash, including filters/counts;
  NBFC and partial sales remain real. Check customer and nested responses too.
- Cross-tenant IDs fail, inaccessible-shop IDs do not bypass scope, and feature/user denies win.
- Each sale type checks its own permission, not just another granted create permission.
- Failed creation leaves no sale, stock change, copy or schedule; pending approval still has the
  documented inventory effect.
- Metadata edits preserve payments; changed EMI terms with activity fail without mutation.
- Invalid dates, excess partial receipts and stale/missing related records are actionable errors.

## Known gaps and next work

Confirmed source gaps: target-shop checks are inconsistent; customer responses bypass restricted
sale projection; create/update return real service results rather than explicitly reapplying the
restricted list/detail projection. Verify all write responses for customized grants.
Web edit warnings/type locking disagree with service behavior. Breakdown sums are not schema-checked.
EMI generation is current-date-based, not sale-date-based, and rounding may diverge from total payable.
Do not describe stale comments about unconditional resets or universal dual writes as implemented rules.
Runtime concurrency, invoices and OCR outcomes were not certified.

## Decisions and review checkpoint

Review checkpoint: **2026-11-10**, source-reviewed; API is authoritative.
Current self-finance-only sanitization and permission-based access are recorded above rather than
the broader historical description. Flutter is approved direction, not implementation.
See [ADR-0001 amendments](../adr/0001-per-emi-overdue-installment-model.md) for EMI policy.
The coordinator owns `docs/features/checkpoints.json`; this task does not edit its inventory/hashes.
