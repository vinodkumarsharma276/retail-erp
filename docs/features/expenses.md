# Expenses

## Purpose and scope

The **Expenses** rail item at `/expenses` records shop operating costs, invoice references,
and GST claimability. `/expenses/new` and `/expenses/:id/edit` use the same form.
This is direct expense recording, not an employee claim, reimbursement, approval, or payment
execution system. Bank statement categories do not create Expense records; see
[Bank transactions](bank-transactions.md) for the separate bank workflow.

## Implementation status

| Surface | Status | Evidence / limits |
|---|---|---|
| API | Implemented, with scope gaps | Expense CRUD and category/date summaries; ID operations do not enforce the selected shop. |
| Web | Implemented | List, filters, summary cards, create/edit form and confirmed deletion; no invoice uploader or reimbursement screen. |
| Flutter | Planned only | New approved target, eventually full authorized web parity; no Flutter expense delivery established. |

Reviewed **2026-11-10** against current source, including uncommitted source where present.
Source-reviewed, **not runtime-certified**. Permission names alone are not implemented workflows.

## Business rules and invariants

- Categories are `rent`, `electricity`, `salary`, `transport`, `maintenance`, `marketing`,
  `purchase`, and `misc`. A purchase-category expense is not a supplier purchase/inventory receipt.
- Creation requires a parseable expense date, a valid category, and numeric `amount > 0`.
  Optional GST is nonnegative; missing/null GST becomes zero. Claimability defaults false.
  The API does not calculate GST from amount or require GST to be no greater than amount.
- Vendor, description, invoice number, and invoice URL can be null. `invoiceUrl` is only a
  string of at most 500 characters, not an upload or URL-validation contract.
- `Expense` stores Decimal amount/GST and a database date. API Decimal values can serialize
  as strings despite the web hook's numeric types. The form converts submitted money with `Number()`.
- Summary totals sum stored `amount`; they do not add GST again. Claimable GST sums
  `gstAmount` only on claimable rows. Category summaries expose count, amount and GST.
- Deletion is a hard delete, not a reversal, approval withdrawal, or reimbursed-state transition.

## Access, tenancy, and shop scope

- Feature switch: `expenses` gates `/api/v1/expenses`; `nav.expenses` controls the rail.
  Web route guards require `expenses.list`, `expenses.create`, or `expenses.edit`.
- API permissions: list/summary `expenses.list`; detail `expenses.detail`; create
  `expenses.create`; update `expenses.edit`; delete `expenses.delete`. A stale “admin only”
  comment is not the route policy.
- All API routes run authentication and `shopScope`. Prisma supplies tenant filtering/stamping.
  List/summary honor the current shop or the accessible All Shops set. Creation uses
  `shopFilter.shopId`; in All Shops mode that is the JWT primary shop, not a chosen list row.
- **Confirmed gap:** detail/update/delete use only the expense ID through tenant-scoped
  Prisma. They do not compare the expense's shop to `request.shopFilter`.
- `expenses.mark_gst_claimable`, `expenses.upload_invoice`, and `expenses.export` exist in
  the catalog, but these routes do not separately enforce claimability permission or expose
  invoice-upload/export endpoints. The form shows the GST checkbox under create/edit access.

## User workflows

1. Open the list, select category/date/search filters, and inspect amount and claimable-GST totals.
2. With create permission, add date/category/amount and optional vendor, GST, invoice number,
   description and claimability. Save returns to the list.
3. With edit permission, open a row's edit form; it first fetches detail (requiring
   `expenses.detail` independently). Save invalidates expense queries.
4. With delete permission, confirm permanent removal. API missing records return 404;
   validation rejects invalid body fields; mutation failures stay visible on the form.

## API contracts and data

Prefix: `/api/v1/expenses`. JSON successes use the shared response envelope; list uses
`sendPaginated`, while create returns 201. Errors use `sendError` or validation middleware.

| Method | Path | Contract / permission |
|---|---|---|
| GET | `/` | `page`, `pageSize`, `category`, `dateFrom`, `dateTo`, `search`; `expenses.list` |
| GET | `/summary` | Optional `dateFrom`, `dateTo`; `expenses.list` |
| POST | `/` | Create body described above; `expenses.create` |
| GET | `/:id` | Expense with creator/shop; `expenses.detail` |
| PUT | `/:id` | Optional create fields, partial update semantics; `expenses.edit` |
| DELETE | `/:id` | Hard delete; `expenses.delete` |

The declared query Zod schemas are not attached to GET routes; controllers consume query
strings directly. Search is case-insensitive vendor/description matching, not invoice-number
search. List sorts expense date descending. Date bounds are converted with `new Date()`.
There are no claim/approve/reject/reimburse endpoints or related expense status fields.

## Web behavior

List pages contain 20 rows; initial dates are today minus 90 days through today. URL-backed
filters include category, dates, search and page; clearing restores these default dates,
not an unbounded history. All Shops adds a shop column. Summary requests carry **dates only**,
so category/search can narrow the table without narrowing cards.

The form collects invoice number, not invoice file/URL. It defaults date using UTC ISO
conversion and offers a GST-claimable checkbox. Empty vendor/description/invoice text is sent
as `undefined`, so clearing an existing value in the form does not send the null needed to
erase it in the API. There is no standalone expense-detail route.

## Mobile behavior and differences

Flutter is the approved new target; expense listing, scoped totals, create/edit and authorized
deletion are planned toward eventual full authorized web parity. Receipt capture, reimbursement
policy and approval roles are open product decisions, not implemented mobile behavior.
Existing Expo is legacy, not Flutter delivery. No offline writes, notification delivery or
background synchronization is assumed.

## Dependencies and cross-feature effects

- [Bank overview](bank-overview.md) distinguishes legacy bank matching from statement analysis.
  Legacy bank suggestions can reference expenses; categorizing a statement as an expense
  does not post an expense or reimburse an employee.
- Coordinate permission changes with the shared [access rulebook](../../packages/shared-types/src/access.ts)
  and [permission catalog](../../packages/shared-types/src/permissions.ts).
- Expense reports and summaries depend on amount/GST semantics; changing to approval-based
  inclusion would require coordinated reporting/schema/API/UI changes, not just a form field.

## Code and source references

- [Routes](../../apps/api/src/modules/expenses/expenses.routes.ts),
  [controller](../../apps/api/src/modules/expenses/expenses.controller.ts),
  [service](../../apps/api/src/modules/expenses/expenses.service.ts),
  [validation](../../apps/api/src/modules/expenses/expenses.validation.ts).
- [List](../../apps/web/src/pages/expenses/ExpenseListPage.tsx),
  [form](../../apps/web/src/pages/expenses/ExpenseFormPage.tsx),
  [queries/mutations](../../apps/web/src/hooks/useExpenses.ts).
- [Web routes](../../apps/web/src/App.tsx), [rail](../../apps/web/src/layouts/components/Sidebar.tsx),
  [API registration](../../apps/api/src/app.ts), [Expense schema](../../apps/api/prisma/schema.prisma).
- [Tenant Prisma extension](../../apps/api/src/config/database.ts),
  [shop scope](../../apps/api/src/middleware/shop-scope.ts),
  [older context notes](../CONTEXT.md).

## Verification and acceptance

Source inspection only; no tests, builds, database operations or runtime certification performed
for this documentation change. [Access-rule tests](../../apps/api/tests/unit/access-rules.test.ts)
cover prerequisites including `expenses.list` for create; they do not certify expense CRUD.

Acceptance should exercise valid creation/edit/deletion, bad dates/amounts, nullable field
clearing, date-only summary differences, Decimal rendering, missing records, feature-off and
denied permissions. Add explicit two-tenant/two-shop ID-operation tests before claiming
shop isolation, and verify All Shops create destination visibly.

## Known gaps and next work

- Close the ID-operation shop-scope gap and clarify/create an explicit All Shops write destination.
- No reimbursement/approval implementation was found in the expense API, schema or web sources.
  Define such a workflow separately if wanted; salary category is not employee reimbursement.
- No invoice upload/export surface despite catalog permissions; GST field permission is not
  independently enforced here. Invalid GET filters are not validated with the declared schemas.
- Fix empty-string clearing in the web payload and keep monetary wire types honest.
- No automatic linking/posting from statement categories to expenses; do not imply this exists.

## Decisions and review checkpoint

Current scope is direct expense CRUD. Review date: **2026-11-10**, source review only.
Flutter is an approved planned target with eventual authorized web parity, not a shipped replacement.
No new approval, reimbursement or accounting policy is decided by this document.
Checkpoint inventory/hashes in `docs/features/checkpoints.json` are maintained separately;
this seven-document task does not change that inventory.
