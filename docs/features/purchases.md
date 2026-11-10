# Purchases

## Purpose and scope

**Purchases** (`/purchases`, Inventory navigation) records supplier invoices and goods
bought without a bill, creates physical inventory, imports registers and records invoice
payments. [Distributors](distributors.md) owns supplier-wide settlement/advances;
[products](products.md) owns the resulting unit inventory.

## Implementation status

| Surface | Status | Evidence / limits |
|---|---|---|
| API | Implemented, with consistency gaps | Billed/unbilled creation, import, header editing, payment and guarded deletion in [routes](../../apps/api/src/modules/purchases/purchases.routes.ts). |
| Web | Implemented | List, new-purchase choice/wizard, import, detail, header-edit/payment/delete dialogs. |
| Flutter | Planned, not implemented | Approved new client for all authorized tenant roles with eventual full web parity; Expo is legacy. |

Reviewed **2026-11-10** against working-tree source, not runtime tested. The shared API remains
the business/data source of truth.

## Business rules and invariants

- Billed create writes Purchase, one Product per item, purchase audit entries and supplied
  category links in one transaction. Duplicate supplier/invoice and serials are checked.
  Required category attributes must be populated.
- **Billed header arithmetic is `netAmount = totalAmount - discountAmount + gstAmount`.**
  Do not add tax again to an already tax-inclusive UI total. This header contract differs
  from per-unit GST-inclusive prices and must be preserved when building another client.
- Supplier/invoice duplicate checks span the tenant, not just the current shop; they are
  application checks, not a unique database invoice constraint.
- Unbilled purchases are real supplier stock with `billed=false`, zero GST, total from unit
  costs and a generated type-series invoice. MRP/selling price can be omitted; placeholder
  values and `priceNotSet` track unpriced goods.
- Invoice numbering is **tenant + category**, despite “shop” wording in some comments:
  `PurchaseInvoiceSeries` has no shopId. Prefixes are unique per tenant, numbering advances
  inside the purchase transaction and must first be started/corrected.
- Supplier advances for the same shop/supplier are consumed oldest-first against oldest open
  bills by ordinary create/unbilled/import paths. Settled bills are excluded.
- Payments recompute paid/partial/pending from recorded payments. `settled` means clearing
  deliberately left nothing paid and nothing owed; these bills refuse further payments.
- Delete removes purchases, products, their audit trails and payment rows. It refuses units
  referenced by real/sanitized sales or **any** transfer, non-in-stock units, or positive
  amountPaid. A cancelled-transfer reference still prevents deletion.

## Access, tenancy, and shop scope

- Menu `nav.purchases`; feature `purchases`; list/detail/create/edit/delete permissions are
  `purchases.list`, `.detail`, `.create`, `.edit`, `.delete`.
- Separate permissions: `purchases.create_unbilled`, `purchases.record_payment`,
  `purchases.view_pending_amount`. Create/edit/unbilled require `distributors.list` through
  [access prerequisites](../../packages/shared-types/src/access.ts).
- List, creation, imports, batch history and deletion run `shopScope`. List supports the
  active shop or accessible All Shops IDs. Import and unbilled creation explicitly reject
  All Shops; billed create uses shopFilter.shopId without that rejection.
- Legacy list exception: `?allShops=true&distributorId=...` with JWT role exactly `admin`
  removes the shop filter entirely inside the tenant. This is not a general permission-based
  cross-shop scope and differs from header-driven accessible-shop aggregation.
- Detail, header update and per-invoice payment routes do **not** run shopScope and their
  service lookups are by tenant-filtered ID, not user-accessible shop.
- Classification and numbering endpoints are tenant-wide. Prisma enforces tenant isolation.
  `purchases.view_pending_amount` hides a list column in web; the inspected server field
  middleware has no equivalent purchase-response redaction.

## User workflows

1. Browse/filter invoices or search an invoice number. Select one shop before recording goods.
2. `/purchases/new`: choose billed versus without-a-bill, optionally with a supplier preset.
   The billed wizard has four steps: **Select Distributor → Invoice Details → Add Products
   → Review**. Invoice scanning can populate the draft; inspect results before save.
3. Enter category, brand/model, cost and serials or quantity; multiple serials/quantity
   expand into individual units. Fix duplicate invoice/serial or missing-attribute errors.
4. For unbilled stock, select an enabled product type and initialize its number series if
   necessary, then record supplier/date/items without supplier bill/GST fields.
5. `/purchases/import`: upload/read a sheet, map when needed, identify items, review server
   preview, confirm import and inspect per-invoice results. Correct blocked rows and rerun;
   already-recorded invoices are skipped.
6. `/purchases/:id`: inspect units/payment history, edit header, record payment or delete
   after confirmation. The update API does not edit invoice line items.

## API contracts and data

Prefix `/api/v1/purchases`; success/error and paginated envelopes follow shared helpers.

| Method/path | Purpose / permission |
|---|---|
| `GET /` | Paginated list: distributorId, dates, paymentStatus, search, source; `purchases.list`. |
| `GET /check-invoice` | Invoice existence, optional supplier; create **or** edit. |
| `POST /` | Billed header and nonempty items; create. |
| `POST /unbilled` | Supplier, seriesCategoryId, date, nonempty items; create_unbilled. No client invoice number. |
| `GET /unbilled-types`, `GET /unbilled-series`, `PUT /unbilled-series` | Type/series state and `{ categoryId, prefix, startNumber }`; create_unbilled. |
| `GET /:id`, `PUT /:id` | Detail / header fields only; detail / edit. |
| `POST /:id/payments` | Positive amount, paymentMode/date, optional reference/notes; record_payment. |
| `POST /delete` | `{ ids }`, 1–200 UUIDs; delete. |
| `POST /import/preview`, `POST /import` | Up to 20,000 mapped rows, 25 MB request; create. |
| `POST /import/classify`, `POST /import/lookup` | Item identity / on-demand specifications; create. |
| `PUT /import/classifications`, `DELETE /import/classifications` | Remember/forget classification answers; create. |
| `GET /import/batches` | Import history; list. |

Import accepts format/provenance, categoryMap, optional markPaid, billed flag and
updateDistributors. It groups supplier/invoice/date rows, matches supplier GST then normalized
name, validates quantities (1–500 per line) and required IMEIs, and can create suppliers.
Preview writes no purchases; **commit is per-invoice transactional**, not whole-file atomic.
It records a `PurchaseImportBatch`, returns created/skipped/error outcomes, and optionally
records a full payment. Supplier blank-filling can occur before invoice transactions.

Models: `Purchase`, `Product`, `ProductAuditTrail`, `PurchasePayment`, `SupplierAdvance`,
`DistributorCategory`, `PurchaseImportBatch`, stored item classifications and
`PurchaseInvoiceSeries`. Decimal money usually arrives as strings.

## Web behavior

- Registered nested routes: `/purchases/new`, `/purchases/import`, `/purchases/:id`.
  Both new and import require `purchases.create`, even to reach the unbilled branch.
- List URL filters include supplier, status, dates, source and invoice search. Default
  date window is 30 days; invoice search removes the implicit window unless dates are set.
  Current/last FY presets and All Shops shop column are available.
- Detail header editing is a dialog, not a separate edit route. Payment modes are cash,
  credit/debit card, UPI, bank transfer and cheque.
- Import supports Tally registers, mapped workbooks, purchase sheets and unbilled sheets
  through browser parsers. Identity corrections are reusable; subsequent specification
  enrichment is a separate product action, not silently part of every import.
- OCR and web lookup depend on configured providers; they do not prove a scanned/imported
  invoice is correct. The API preview and human review remain necessary.

## Mobile behavior and differences

Planned Flutter parity includes invoice list/detail, billed/unbilled entry, authorized
payments/header correction, import review and deletion safeguards. File-selection/scanning
UX and rollout order remain open. No Flutter delivery or offline write/sync capability is
implemented by these sources; reuse API contracts rather than duplicate accounting rules.

## Dependencies and cross-feature effects

- [Distributors](distributors.md) supplies identity, FIFO settlement, advances and clearing;
  purchases automatically maintain supplier category links.
- [Products](products.md) supplies categories/attributes and post-import enrichment.
  [Transfers](transfers.md) directly creates destination purchases outside ordinary create.
- Bank-linked payments/advances use the shared supplier-advance undo engine.
  [Dashboard](dashboard.md) stock value changes when imported unit placeholders change.
- Existing OCR design is described in [OCR plan](../OCR_INVOICE_AND_REGISTER_PLAN.md);
  it is context, not proof of every current workflow.

## Code and source references

- API [routes](../../apps/api/src/modules/purchases/purchases.routes.ts),
  [controller](../../apps/api/src/modules/purchases/purchases.controller.ts),
  [service](../../apps/api/src/modules/purchases/purchases.service.ts),
  [validation](../../apps/api/src/modules/purchases/purchases.validation.ts),
  [import](../../apps/api/src/modules/purchases/purchases.import.ts),
  [numbering](../../apps/api/src/modules/purchases/unbilled-series.ts).
- Web [pages](../../apps/web/src/pages/purchases),
  [hook](../../apps/web/src/hooks/usePurchases.ts),
  [import parsers](../../apps/web/src/lib/purchase-import.ts),
  [Tally adapter](../../apps/web/src/lib/tally-import.ts),
  [routes](../../apps/web/src/App.tsx).
- [Schema](../../apps/api/prisma/schema.prisma),
  [advance engine](../../apps/api/src/modules/distributors/supplier-advances.ts),
  [context](../CONTEXT.md).

## Verification and acceptance

Source inspection only; no test/build/runtime commands executed. Existing unit tests include
[purchase sheets](../../apps/api/tests/unit/purchase-sheet.test.ts),
[Tally register](../../apps/api/tests/unit/tally-purchase-register.test.ts),
[unbilled sheets](../../apps/api/tests/unit/unbilled-sheet.test.ts) and
[unbilled types](../../apps/api/tests/unit/unbilled-types.test.ts).
Acceptance: tax/header arithmetic; serial/required-IMEI errors; duplicate rerun; mixed
successful/failed imports; unbilled numbering rollback/concurrency; advance consumption;
settled bills; denied pending amounts; by-ID scope; deletion guards and All Shops writes.

## Known gaps and next work

- Web `/purchases/new` requires billed-create permission, so unbilled-only permission does
  not independently unlock its screen. Import with `billed=false` is guarded by create,
  not create_unbilled.
- Header numbers are not reconciled against unit totals by the billed create service.
  Per-invoice payment accepts overpayment and marks paid; it does not convert the surplus
  to a supplier advance as supplier-wide payment does.
- By-ID shop checks, legacy admin all-shops escape hatch and server-side pending-amount
  redaction need alignment. The supplier selector initially fetches a bounded list.
- Some manual versus imported pricing markers differ. Do not describe every stock entry
  path as identical. Flutter is not implemented.

## Decisions and review checkpoint

2026-11-10: current four-step billed wizard supersedes older five-step context summaries;
number series are tenant/category-scoped; imports are per-invoice transactions. Flutter is
approved for eventual authorized web parity using the shared API. No checkpoint edits made.
