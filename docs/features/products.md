# Products

## Purpose and scope

**Products** (`/products`, Inventory navigation) is physical-unit inventory: find stock,
inspect costs/specifications/history, correct a unit and start a sale or inter-shop transfer.
Stock normally enters through [purchases](purchases.md), not a standalone catalogue editor.

## Implementation status

| Surface | Status | Evidence / limits |
|---|---|---|
| API | Implemented, with scope/consistency gaps | [Routes](../../apps/api/src/modules/products/products.routes.ts) support unit/group/search reads, create/update, history, sellability and enrichment. No product-delete route. |
| Web | Implemented for browsing/editing | [List](../../apps/web/src/pages/products/ProductListPage.tsx), detail and edit routes; standalone create code exists but no `/products/new` route is registered. |
| Flutter | Planned, not implemented | Approved new target for all authorized tenant roles, eventual full web parity; Expo is legacy. |

Reviewed **2026-11-10**; source-reviewed, not runtime tested. API business rules remain shared
source of truth, including for future Flutter clients.

## Business rules and invariants

- A `Product` is one unit, with category, shop, optional supplier/purchase, serial, prices,
  warranty, dynamic attributes and status: `in_stock`, `sold`, `transferred`, `returned`,
  `damaged`. Quantity on the grouped list is a count of rows, not a mutable stock balance.
- Group key is `(shopId, categoryId, brand, modelNumber, status)`. Identical models in
  different shops/statuses remain separate.
- List filters search brand/model/serial case-insensitively. A full 15-digit search also
  matches `dynamicAttributes.imeiNumbers`; purchase-date filters require a linked Purchase.
  A non-leaf category filter includes its immediate children, not arbitrary descendants.
- Direct creation validates category and required active category attributes, optional
  supplier existence and positive prices. Missing selling price falls back to MRP/cost
  and sets `dynamicAttributes.priceNotSet`.
- Updates check serial duplication within category, category/supplier existence and adjust
  warranty expiry from original creation date. Direct creation sets warranty from now.
  These are inventory-date calculations, not a promise of sale-date warranty commencement.
- `can-sell` currently means only `status === 'in_stock'`; it is not sale validation,
  customer approval or stock reservation.
- Enrichment fills blank researchable specifications only, excludes per-unit identifiers,
  never changes prices, and stores an MRP suggestion for human review. It requires
  `OPENAI_API_KEY`; otherwise the API explains that lookup is disabled.

## Access, tenancy, and shop scope

- Menu/page: `nav.products` / `products.list`; feature `products`.
- Detail/edit/create/history: `products.detail`, `products.edit`, `products.create`,
  `products.audit_trail`. Enrichment uses `products.edit`.
- Server field rules under the product API strip dealer-price fields without
  `products.view_dp`, margin/profit fields without `products.view_margin`, and supplier
  identity without `products.view_distributor`.
- List also accepts `transfers.initiate`; search and can-sell allow relevant
  `sales.create_full_payment`, `sales.create_partial_with_promise`,
  `sales.create_self_finance`, `sales.create_company_finance` permissions.
- All product routes run authentication and `shopScope`. List/group/search and enrichment
  explicitly honor accessible single/all-shop scopes; creation uses the active shop.
  **By-ID detail/update/history/can-sell services query by ID only**, without applying
  shopFilter. Middleware validates the selected shop, not record ownership.
- Tenant isolation is provided by the Prisma extension, separately from shop checks.
  Effective permissions and feature prerequisites, not role names, decide access.

## User workflows

1. Browse category/subcategory, status, purchase-date/FY range or search at least three
   characters. Expand a grouped model to see units and choose a particular serial/unit.
2. Open detail for attributes, HSN/category, prices, supplier/purchase and audit timeline.
3. Edit permitted fields; recover from missing required data, category/supplier errors or
   duplicate serial conflict without treating a failed save as a stock change.
4. Fetch specifications on demand and review suggestions; manually complete details when
   lookup is unavailable. Batch enrichment is also reachable after purchase import.
5. Sell or transfer an in-stock unit through the corresponding feature. In the grouped
   list All Shops disables these writes until a single shop is selected.

## API contracts and data

Prefix `/api/v1/products`; standard success/error envelopes, paginated list/group responses.

| Method/path | Contract |
|---|---|
| `GET /`, `GET /grouped` | Pagination; categoryId, status, brand, search, dateFrom/dateTo. Grouped response includes quantity, price ranges and missing-detail counts. |
| `GET /search?query=...` | Cross-category search; controller requires at least three characters. |
| `POST /` | categoryId, brand/model, positive MRP/cost, optional selling price, serial, supplier, warranty and dynamic attributes. |
| `GET /:id`, `PUT /:id` | Unit detail and partial field update; update also accepts status. |
| `GET /:id/history`, `GET /:id/can-sell` | Audit entries / basic status-based eligibility. |
| `POST /:id/enrich` | Fill missing model specifications; return lookup outcome/suggestions. |
| `GET /enrich/batch/:batchId`, `POST /enrich/batch/:batchId` | Import-run progress and enrichment passes; optional limit 1–50, refresh. |

Models: `Product`, `ProductCategory`, category attributes, `ProductAuditTrail`, `Purchase`,
`Distributor`, `Shop`, `PurchaseImportBatch`. Prisma money is Decimal and usually serialized
as strings; UI code converts for arithmetic/formatting.

## Web behavior

- `/products/:id` requires detail permission; `/products/:id/edit` requires edit permission.
  [ProductAddPage](../../apps/web/src/pages/products/ProductAddPage.tsx) serves edit despite
  its name and retains an otherwise unregistered create branch.
- List stores filters in URL parameters (`rootCategoryId`, `subCategoryId`, `statusFilter`,
  `searchText`, dates, page), debounces search and uses the common DataTable.
- Grouped rows show missing pricing/details, expandable physical units and a unit picker
  before selling/transferring. All Shops adds shop context.
- Detail requests history even when the caller lacks its separate permission. Server
  denial remains authoritative; a permission-restricted timeline is not proof of no history.
- [useProducts.ts](../../apps/web/src/hooks/useProducts.ts) also fetches category tree and
  attribute definitions. Category administration belongs to Settings, not this stock list.

## Mobile behavior and differences

Proposed Flutter workflows: scoped search/grouped stock, unit detail/history, authorized
correction, specification review and hand-off to sale/transfer. Full authorized web parity
is the destination, not an implemented release. Camera/barcode UX, rollout order and local
caching are open; offline writes/background synchronization are not implemented claims.

## Dependencies and cross-feature effects

- [Purchases](purchases.md) creates units, pricing placeholders and import provenance.
  [Transfers](transfers.md) retains the source unit and clones a new destination unit.
- [Distributors](distributors.md) merge/delete can reassign/remove stock under guards.
  [Dashboard](dashboard.md) values in-stock units at selling price.
- Sales must revalidate stock; `can-sell` alone cannot protect concurrent writes.
  Dynamic form/category definition changes affect required attributes and import behavior.

## Code and source references

- API [routes](../../apps/api/src/modules/products/products.routes.ts),
  [controller](../../apps/api/src/modules/products/products.controller.ts),
  [service](../../apps/api/src/modules/products/products.service.ts),
  [validation](../../apps/api/src/modules/products/products.validation.ts),
  [enrichment](../../apps/api/src/modules/products/products.enrich.ts).
- Web [pages](../../apps/web/src/pages/products),
  [hook](../../apps/web/src/hooks/useProducts.ts), [route registration](../../apps/web/src/App.tsx).
- [Schema](../../apps/api/prisma/schema.prisma),
  [field restrictions](../../apps/api/src/middleware/field-access.ts),
  [access prerequisites](../../packages/shared-types/src/access.ts),
  [module registration](../../apps/api/src/app.ts), [context](../CONTEXT.md).
- Existing [enrichment unit tests](../../apps/api/tests/unit/product-enrich.test.ts).

## Verification and acceptance

Source inspection only; no tests executed. Targeted existing command:
`npm run test --workspace=apps/api -- tests/unit/product-enrich.test.ts`.
Acceptance needs: shop/tenant separation including by-ID paths; denied cost/supplier/history;
full IMEI lookup; grouped-unit selection; duplicate serials; missing attributes; pricing
placeholders; disabled enrichment and preservation of entered values; sold/transferred units
refusing sale/transfer; purchase-date filters excluding unlinked stock.

## Known gaps and next work

- No standalone create route or delete API/UI; do not infer them from page/hook names.
- Product serial is indexed, not uniquely constrained in schema. Direct create lacks the
  duplicate check present in update/purchase creation.
- Update accepts arbitrary allowed inventory statuses and does not repeat required-attribute
  validation or add a general edit audit entry. Initial create and audit are separate writes.
- By-ID shop ownership is not enforced by the inspected service paths. Field stripping is
  API-prefix-specific: the product rule does not automatically protect nested product costs
  returned from other modules.
- Not all detail actions share the grouped list's All Shops write guard. Flutter is absent.

## Decisions and review checkpoint

2026-11-10: document physical-unit identity, implemented entry paths and scope gaps explicitly.
Flutter is approved for all authorized tenant roles with eventual web parity through the same
API. No checkpoint inventory/hashes were edited in this source-only documentation pass.
