# Distributors

## Purpose and scope

**Distributors** (`/distributors`, Inventory navigation) maintains tenant supplier identity,
contact/tax/bank details, supplied categories, stock/invoices and money paid/owed. It also
imports creditors, consolidates duplicates and performs explicit destructive account clearing.

## Implementation status

| Surface | Status | Evidence / limits |
|---|---|---|
| API | Implemented, with shop-scope differences | CRUD, duplicate checking/import, merge, delete impact, payments and clearing in [routes](../../apps/api/src/modules/distributors/distributors.routes.ts). |
| Web | Implemented | List/form/detail/import, multi-select merge/delete/clear and multi-tender payment dialogs. |
| Flutter | Planned, not implemented | Approved new target for every authorized tenant role, eventual full web parity; existing Expo remains legacy. |

Reviewed **2026-11-10**, source-reviewed, not runtime tested. Future clients must use the shared
API as source of truth rather than implement separate supplier accounting.

## Business rules and invariants

- Suppliers are tenant-wide, not owned by one shop. Categories are a set through
  `DistributorCategory`; purchases maintain links as stock is acquired.
- Totals count purchased product rows. Paid total is invoice amounts paid plus unused
  advances; pending is non-settled invoice net minus paid minus unused advances. Pending
  can be **negative**, representing money waiting for future bills.
- Supplier payment accepts 1–10 tenders, preserving each mode/reference and allocating
  oldest invoices first across the payment. It also normalizes the legacy single
  `{ amount, paymentMode }` payload into one tender.
- Web supplier payment allocates against pending invoices across the tenant, **not only
  the header shop**. The header shop determines where excess is held as a SupplierAdvance.
  In All Shops there is no advance shop: excess is returned unallocated, not recorded.
- Advances later pay bills for the **same supplier and shop**, oldest advance then oldest
  bill, creating traceable PurchasePayment rows. History identifies advance rows and
  payments originating from advances to distinguish movement from fresh money.
- Plain delete refuses suppliers with dependent business data/advances. Explicit cascade
  removes their invoices, eligible stock and audit trails only after the shared purchase
  deletion guard; sold/transferred/non-stock/paid inventory is not made erasable.
- Merge moves purchases, products, advances and deduplicated categories to a retained
  supplier, then deletes sources in one transaction. It does not merge contact profiles
  or recalculate invoice values.
- **Clear payments is not payment reversal:** it deletes payments/advances, sets every
  affected bill to `amountPaid=0, paymentStatus='settled'`, and records an audit log.
  Both paid and owed become zero within the covered shops; original invoices remain.

## Access, tenancy, and shop scope

- Menu/page: `nav.distributors` / `distributors.list`; module feature `distributors`.
- Detail/create/edit/delete/merge use `distributors.detail`, `.create`, `.edit`, `.delete`,
  `.merge`. Duplicate checks and creditor import require create.
- Supplier-wide payments use **`purchases.record_payment`**, not a distributor payment key.
  Clearing requires `distributors.clear_payments`, owner-only in default grants, but still
  permission-based; its prerequisite is distributor detail.
- API field stripping: bank details require `distributors.view_bank_details`; GST/PAN
  require `distributors.view_gst`; credit limit requires `distributors.view_credit_limit`.
- Identity, list/detail totals, products, history, merge/delete and import have no shopScope
  middleware and are tenant-wide. Prisma supplies tenant filtering.
- Payment runs shopScope, but the controller only passes `advanceShopId`, not a bill
  shop filter. Clearing separately resolves **all active UserShop memberships** irrespective
  of header selection. Its coverage may be narrower than tenant-wide displayed totals.
- Effective permission prerequisites/plan features, rather than role labels, apply.

## User workflows

1. Search/sort suppliers, inspect pending/paid/stock totals and open the relevant record.
2. Add/edit a supplier using the shared form and resolve duplicate field/name warnings.
3. Import a Tally Sundry Creditors workbook: browser checks required columns, server previews
   create/fill/unchanged actions, then commit after duplicate review.
4. Open detail tabs **Products, Payments, Invoices, Missing details**. Start a supplier-preset
   purchase after selecting a single shop.
5. Pay the supplier in one or several tender parts; review allocated invoices and any
   recorded advance/unallocated excess. Use payment history, not just the total.
6. For duplicates, choose a retained record and merge. For deletion, preview affected
   counts and explicitly choose whether eligible purchases/stock may go too.
7. Clear accounts only after the separate preview and destructive confirmation; this
   intentionally removes payment history and extinguishes pending balances.

## API contracts and data

Prefix `/api/v1/distributors`; standard success/error envelopes; list/products paginated.

| Method/path | Contract |
|---|---|
| `GET /` | page/pageSize/search, sortBy/sortDir; text columns and computed pending/paid/unit totals are sortable. |
| `POST /`, `GET /:id`, `PUT /:id` | Create/detail/update supplier and category links. |
| `GET /:id/products` | Products with purchase/shop context, optional invoice-date filters. |
| `GET /:id/payments` | Flattened invoice payments and advances, newest payment date first. |
| `POST /:id/payments` | Tenders or legacy amount/mode; date, references/notes; FIFO allocation summary. |
| `POST /check-duplicates` | Up to 5,000 candidates with identity fields, optional excludeId; reports clashes/similar names. |
| `POST /import/preview`, `POST /import` | Up to 5,000 mapped creditor rows, 10 MB body. |
| `POST /deletion-impact` | `{ ids }`, up to 1,000; affected business counts. |
| `POST /delete` | `{ ids, cascade? }`, up to 1,000; safe refusal unless cascade explicitly requested. |
| `POST /merge` | `{ sourceIds, targetId }`, up to 50 sources; target cannot be a source. |
| `POST /clear-payments/preview`, `POST /clear-payments` | `{ ids }`, up to 1,000; accessible-shop impact/clear. |

Manual validation requires company/contact/phone/address/city/state/six-character pincode;
tax/bank fields are optional length-bounded values, not blanket proof of valid GSTIN/IFSC.
Service duplicate checks cover GST/PAN/bank identifiers where supplied.

Creditor import matches GST then normalized name, fills blanks without replacing maintained
values and creates imported suppliers with review metadata. Closing Cr/Dr/net figures are
stored as source metadata, **not opening payables or purchases**. Hard identity clashes
block commit (409); similar-name detection is advisory, optionally AI-assisted when configured.
Commit writes the planned supplier changes transactionally.

Models: `Distributor`, `DistributorCategory`, `Product`, `Purchase`, `PurchasePayment`,
`SupplierAdvance`, `AuditLog`, `UserShop`; money is Decimal/string at the boundary.

## Web behavior

- Nested routes: `/distributors/new`, `/distributors/import`, `/distributors/:id`,
  `/distributors/:id/edit`, independently permission guarded.
- List supports stable selection across pages, fetching matching IDs for broader selection,
  totals sorting and bulk merge/delete/clear. Impact previews make destructive choices explicit.
- Detail shows contact/tax/bank/category information and completeness guidance for imported
  suppliers. Invoice queries use `allShops=true`; see the purchase API's legacy admin-only
  interpretation, which can differ from this page's tenant-wide headline totals.
- The multi-tender dialog reports results rather than pretending excess always paid a bill.
  All Shops disables new purchase entry but not supplier identity maintenance.

## Mobile behavior and differences

Planned Flutter parity includes supplier search/detail, authorized contact maintenance,
invoice/payment history, multi-tender payment/advances, duplicate/import review and guarded
merge/delete/clear. Staging and file import UX remain open. Flutter/offline writes,
notifications and background sync are not implemented; legacy Expo is not parity evidence.

## Dependencies and cross-feature effects

- [Purchases](purchases.md) defines invoice creation, deletion guards and settled semantics;
  [products](products.md) links suppliers to physical stock.
- [Transfers](transfers.md) may create a supplier representing a source shop.
- Bank statement settlement shares supplier payments/advances and their undo helper; clearing
  must not be interpreted as restoring bank transactions or issuing a refund.
- Merge can make originally separate invoice identities coincide; coordinate any future
  supplier/invoice uniqueness rule with imports and retained historical records.

## Code and source references

- API [routes](../../apps/api/src/modules/distributors/distributors.routes.ts),
  [controller](../../apps/api/src/modules/distributors/distributors.controller.ts),
  [service](../../apps/api/src/modules/distributors/distributors.service.ts),
  [validation](../../apps/api/src/modules/distributors/distributors.validation.ts),
  [import](../../apps/api/src/modules/distributors/distributors.import.ts),
  [advances/undo](../../apps/api/src/modules/distributors/supplier-advances.ts).
- Web [pages/dialogs](../../apps/web/src/pages/distributors),
  [hook](../../apps/web/src/hooks/useDistributors.ts),
  [creditor reader](../../apps/web/src/lib/creditor-import.ts),
  [routes](../../apps/web/src/App.tsx).
- [Schema](../../apps/api/prisma/schema.prisma),
  [field access](../../apps/api/src/middleware/field-access.ts),
  [permissions](../../packages/shared-types/src/permissions.ts),
  [access rulebook](../../packages/shared-types/src/access.ts), [context](../CONTEXT.md).

## Verification and acceptance

Source inspection only; no tests/runtime commands executed. Acceptance needs: tenant-wide
supplier identity versus active-shop stock; denied tax/bank fields; sort across pages;
duplicate preview/commit conflicts; repeat import preserving existing fields; multi-tender
FIFO; negative pending/advances; All Shops excess; merge retaining history; blocked cascade;
clear preview matching covered memberships and settled bills refusing new payment.

## Known gaps and next work

- Header shop does not limit supplier payment's bill allocation. Displayed tenant totals and
  accessible-shop clearing can disagree; do not promise global zero with restricted memberships.
- Detail computes a pending-invoice subset from a bounded purchase query (requested pageSize
  1,000), with role-specific allShops behavior; do not equate it with server aggregate totals.
- Lump-sum tender paymentMode is a nonempty string, whereas per-invoice validation uses a
  fixed enum; callers should use supported modes and handle rejection.
- Multi-supplier clearing loops transactions per supplier, not one atomic batch.
  No Flutter implementation exists.

## Decisions and review checkpoint

2026-11-10: distinguish supplier identity, cross-shop bill allocation, shop-held advances and
membership-scoped clearing. Flutter is the approved eventual authorized-web-parity client;
shared API remains authoritative. No checkpoint inventory/hashes were modified.
