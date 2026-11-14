# Transfers

## Purpose and scope

**Transfers** (`/transfers`, Inventory navigation) moves a physical unit between tenant shops
that keep separate GST books. Receipt is modeled as a source-shop sale plus destination-shop
purchase/new inventory, not simply changing the original product's shopId.

## Implementation status

| Surface | Status | Evidence / limits |
|---|---|---|
| API | Implemented lifecycle, with accounting/scope gaps | [Routes](../../apps/api/src/modules/transfers/transfers.routes.ts) provide list/incoming/detail/initiate/receive/cancel. |
| Web | Implemented | List/incoming, create and detail with receipt/cancellation confirmations. |
| Flutter | Planned, not implemented | Approved new target for all authorized tenant roles, eventual full web parity; existing Expo is legacy. |

Reviewed **2026-11-10**; source-reviewed, not runtime tested. The shared API is the source of
truth for all current/future clients; proposed Flutter workflows below are not delivered.

## Business rules and invariants

- Initiation requires an existing `in_stock` product belonging to the source/header shop,
  a different existing destination and valid UUIDs. It creates an `initiated` transfer,
  marks the original product `transferred` and writes `transferred_out` audit in a transaction.
- Missing invoice is generated as `TRF-{FROM}-{TO}-YYYYMMDD-NNNN`, using a count of matching
  invoices. Transfer date is server now, not a user-entered date.
- Receive accepts `initiated` **or** `in_transit`. In one transaction it marks received,
  retains the original product at source as `sold`, creates/reuses a supplier representing
  the source shop by GST, creates a destination pending Purchase and clones an `in_stock`
  Product linked to it. Audit entries connect both unit histories via transfer reference.
- Clone preserves model/serial/specifications/MRP/selling price/warranty/barcode; destination
  purchasePrice is transferPrice, or original cost when omitted. Original and clone may
  legitimately have the same serial.
- Transfer amount is treated GST-inclusive. Receipt calculates net as
  `max(0, transferPrice - gstAmount)`; omitted GST becomes zero. Inferred source-sale GST rate
  snaps to nearest 0/5/12/18/28 slab; source input-tax credit is calculated from original cost.
- Receipt creates/reuses a customer representing destination (`SHOP-{source}-{destination}`)
  and creates a real source `SaleRecord`: `partial_with_promise`, full amount pending,
  bank-transfer mode, promise date 30 days later, ledger number from transfer invoice.
- **Current receive explicitly writes no sanitized sale copy.** This is an exception to,
  and inconsistency with, the general dual-sale invariant; do not document it as dual-write.
- Cancel is allowed only while `initiated`: mark cancelled, restore source unit `in_stock`,
  append `transfer_cancelled` audit. There is no received-transfer reversal or delete API.

## Access, tenancy, and shop scope

- Menu `nav.transfers`; feature `transfers`; page/list `transfers.list`, detail
  `transfers.detail`, initiate `transfers.initiate`, receive `transfers.receive`,
  cancel `transfers.cancel`. Initiate also depends on `products.list`.
- Transfer-price response field is stripped without `transfers.view_transfer_price`.
  This prefix rule does not strip nested product.purchasePrice.
- List/incoming/initiate authenticate and run shopScope. List matches source **or**
  destination equal to shopFilter.shopId, then applies explicit from/to/status/date filters.
  Incoming returns initiated/in_transit where destination matches that shop.
- **All Shops is not aggregated here:** controllers ignore shopIds and use the primary
  shopId retained by middleware. Initiate likewise uses that primary ID if called in All Shops.
- Detail/receive/cancel have no shopScope and look up tenant-filtered ID without
  membership/source/destination authorization. Web receipt's destination check is not an API
  authorization guarantee. Tenant isolation is separately enforced by Prisma.
- Receipt writes purchases, products, customers and sales under the transfer permission;
  it does not independently require each destination module's create permission/feature.

## User workflows

1. Select the relevant shop and browse transfer history or Incoming transfers.
2. `/transfers/new`: select an in-stock unit or arrive with `?productId=...` from Products,
   choose destination and review price, GST, optional invoice and notes.
3. Save initiation; the original unit is no longer sellable inventory while awaiting receipt.
4. At destination, confirm receipt through incoming/detail. Inspect resulting stock and
   accounting records; a received transfer cannot simply be cancelled.
5. Before receipt, cancel with confirmation to return stock at source. Handle invalid-status,
   missing-product/shop and same-shop errors without assuming state changed.

## API contracts and data

Prefix `/api/v1/transfers`; shared success/error envelopes and paginated list.

| Method/path | Inputs / result |
|---|---|
| `GET /` | page/pageSize, fromShopId/toShopId, status, dateFrom/dateTo; product, shops and users. |
| `GET /incoming` | Current shop pending receipts; accepts transfers.list **or** transfers.receive. |
| `GET /:id` | Transfer detail with product/shops/initiator/receiver. |
| `POST /` | productId, toShopId, optional positive transferPrice, nonnegative gstAmount, invoice ≤100 characters, notes; 201. |
| `PUT /:id/receive` | No body; received transfer detail. |
| `PUT /:id/cancel` | No body; cancelled transfer detail. |

Zod validates initiation body. A list-query schema exists but is not wired with `validate`
on the list route; controllers read query strings directly. Known invalid initiation/status
conditions return 400, missing entities 404; unexpected failures return 500.

Primary model `InterShopTransfer` contains source product, shops, optional money/invoice,
status and initiator/receipt timestamps. Receipt also writes `Product`, `Purchase`,
`ProductAuditTrail`, `Distributor`, `Customer` and real `SaleRecord`. There is no stored
destinationProductId relation on the transfer itself; traceability uses purchase/audit notes
and references. Decimal values may serialize as strings.

## Web behavior

- Registered routes: `/transfers`, `/transfers/new`, `/transfers/:id`, with corresponding
  permission guards. List includes incoming receipts, status/date/shop filters and detail links.
- Create uses product search with three-character minimum through the shared product hook,
  filters results to in-stock and offers shops other than current selection.
- Suggested transfer price is **dealer price + ₹1**, a web default, not an API rule.
  GST is calculated inclusively from inferred invoice slab (fallback 18%); both are editable.
  Empty invoice asks the API to generate one.
- Detail receipt button requires receive permission, status `initiated` and selected shop
  matching destination. Cancel requires cancel permission and initiated status.
  API additionally accepts receiving `in_transit`, which this detail button does not expose.
- [useTransfers.ts](../../apps/web/src/hooks/useTransfers.ts) invalidates transfer/product
  queries after mutations, but not every purchase/supplier/sales/dashboard query affected by
  receipt. Cached cross-feature views can therefore need refetch.

## Mobile behavior and differences

Proposed Flutter parity: scoped outgoing/incoming history, select/identify a physical unit,
review price/GST, initiate, confirm receipt and cancel with status-aware confirmations.
All authorized tenant roles remain permission/feature constrained, not limited to collectors.
Flutter is not implemented; scan UX, rollout order and any offline handling remain open.
No existing offline writes, notification delivery or background sync is asserted.

## Dependencies and cross-feature effects

- [Products](products.md): source status/clone identity and audit; serial-duplicate logic
  must account for legitimate transfer clones.
- [Purchases](purchases.md): receipt books a destination pending invoice directly, without
  invoking ordinary create's advance consumption/category-link maintenance.
- [Distributors](distributors.md): source shop becomes supplier and destination owes it.
- [Dashboard](dashboard.md): received transfers count in real source sales and destination
  inventory. Sales sanitized views may omit this sale because no sanitized copy is written.
- Transfer references, including cancelled ones, block the shared purchase-deletion guard.
  Any future reversal needs coordinated stock, sale, purchase, payment and audit semantics.

## Code and source references

- API [routes](../../apps/api/src/modules/transfers/transfers.routes.ts),
  [controller](../../apps/api/src/modules/transfers/transfers.controller.ts),
  [service](../../apps/api/src/modules/transfers/transfers.service.ts),
  [validation](../../apps/api/src/modules/transfers/transfers.validation.ts).
- Web [list](../../apps/web/src/pages/transfers/TransferListPage.tsx),
  [create](../../apps/web/src/pages/transfers/TransferCreatePage.tsx),
  [detail](../../apps/web/src/pages/transfers/TransferDetailPage.tsx),
  [hook](../../apps/web/src/hooks/useTransfers.ts), [routes](../../apps/web/src/App.tsx).
- [Schema](../../apps/api/prisma/schema.prisma),
  [shop scope](../../apps/api/src/middleware/shop-scope.ts),
  [field access](../../apps/api/src/middleware/field-access.ts),
  [access rulebook](../../packages/shared-types/src/access.ts),
  [registration](../../apps/api/src/app.ts), [context](../CONTEXT.md).

## Verification and acceptance

Source inspection only; no tests or runtime verification executed.
Acceptance needs: wrong-shop/by-ID authorization; forbidden feature/action/price fields;
same-shop/non-stock initiation; receipt clone plus matching source/destination accounting;
cancel restores stock; repeated/concurrent receive/cancel; missing price/GST fallback;
invoice-number collisions; All Shops behavior; sanitized-sales visibility; advance treatment
and refreshing related lists after receipt.

## Known gaps and next work

- General dual-write sale invariant is not honored; decide intended visibility/accounting
  before treating sanitized sales and real-sales reports as reconciled.
- By-ID shop authorization and All Shops behavior differ from the UI's apparent scope.
  Price field redaction does not automatically hide nested dealer cost.
- Lifecycle checks occur before transactions without conditional status updates/locking;
  concurrent actions are not proven safe. Generated invoice counting is not a unique sequence.
- `in_transit` is modeled/receivable, but no transition-to-in-transit endpoint exists.
  No received reversal or direct destination-unit relation exists.
- Receipt bypasses ordinary purchase advance/category maintenance; cross-feature cache
  invalidation is incomplete. Flutter remains unimplemented.

## Decisions and review checkpoint

2026-11-14 (type cleanup for CI, [deployment and release](deployment-and-release.md)): receipt
looked up the `SHOP-{source}-{destination}` customer with `findUnique` on `customerCode`, which is
unique only per tenant, so Prisma rejected the call; it now uses the tenant-filtered `findFirst`.
The source sale's empty `paymentBreakdown` is written as SQL NULL (`Prisma.DbNull`), as ordinary
sales do. Other edits were type-only.

2026-11-10: retain/document source sale + destination purchase/clone behavior and flag its
dual-write/scope differences, without changing application code. Flutter is approved for
eventual full authorized web parity using the same API. No checkpoint inventory edits made.
