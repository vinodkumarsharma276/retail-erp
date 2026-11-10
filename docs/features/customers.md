# Customers

## Purpose and scope

Maintain tenant customer identities, contact/address/business fields and guarantor relationships,
and find repeat customers across shops. Web left rail **Customers** opens `/customers`;
related routes are `/customers/new`, `/customers/:id` and `/customers/:id/edit`.
[Customer Searching](customer-searching.md) is a separate account-register feature filed under
these identities; [Sales](sales.md) and [Installment](installment.md) consume them.

## Implementation status

| Surface | Status | Evidence / limits |
|---|---|---|
| API | Implemented, with scope/disclosure gaps | [Routes](../../apps/api/src/modules/customers/customers.routes.ts), [service](../../apps/api/src/modules/customers/customers.service.ts); CRUD without delete, search, sales history and two different reliability endpoints. |
| Web | Implemented | [List](../../apps/web/src/pages/customers/CustomerListPage.tsx), [form](../../apps/web/src/pages/customers/CustomerFormPage.tsx), [detail](../../apps/web/src/pages/customers/CustomerDetailPage.tsx). |
| Flutter | Planned | New app for all authorized roles, staged toward authorized web parity; legacy Expo collections only display customer context. |

Reviewed **2026-11-10** against current working-tree source, including modified customer service.
Source inspection is not runtime certification. No Flutter implementation is part of this work.

## Business rules and invariants

- Customer code is tenant-sequenced `CUST-<n>`, at least four digits, growing beyond 9999.
  Creation uses numeric [lastCustomerCode](../../apps/api/src/utils/id-generator.ts), not
  lexicographic descending code order. This is not a claim that concurrent creates are retry-safe.
- Create requires name and phone; the general customer API does not enforce phone uniqueness or
  automatically merge records. Never identify relatives as one customer just because they share
  a phone. Name-plus-mobile matching is specifically the Customer Searching import/create policy.
- A customer belongs to a shop and records its creator. General update does not expose a shop
  move. Cross-shop sale lookup deliberately finds existing identities without duplicating them.
- `isGuarantor`, nullable `guarantorId` and reverse guaranteed-customer relationships use Customer
  records, not an independent guarantor table. Services check referenced guarantor existence
  within the tenant, but do not validate a full acyclic/non-self guarantor graph.
- Individual/business type, business name, GSTIN, zone, address, alternate contact and
  `dynamicAttributes` are supported. General API validation does not require business name/GSTIN
  for business type. Optional blank GSTIN becomes null.
- Two different reliability contracts coexist: `/installment-history` is lifetime,
  legacy-aware schedule/payment scoring (absorbed/rescheduled rows included in its statistics);
  `/reliability` reports promise/payment risk metrics. Do not equate their scores or time windows.
- No delete route exists here, despite `customers.delete` being in the permission catalog.

## Access, tenancy, and shop scope

Feature `customers` gates the router. Usable permissions follow the shared
[access rulebook](../../packages/shared-types/src/access.ts), not role comments:
role/user grants minus user denies, disabled features and recursively missing prerequisites.

| Capability | Actual API guard / scope |
|---|---|
| List | `customers.list`, selected shop or accessible all-shops IDs. |
| Search | Either `customers.list` or `customers.detail`; tenant-wide, no shop middleware. |
| Create | `customers.create`, current single shop from `shopFilter`. |
| Detail / edit | `customers.detail` / `customers.edit`; shop middleware runs, but service selects/updates by customer ID without comparing target shop. |
| Sales history | `customers.view_purchase_history`; tenant-wide by customer ID, no shop middleware. |
| Reliability | `installments.detail`; explicit tenant/customer filter, no shop middleware. |
| Installment history | Either `installments.list` or `sales.create_self_finance`; tenant-wide by customer ID. |

[Shop middleware](../../apps/api/src/middleware/shop-scope.ts) verifies chosen active tenant shop
membership and permission-based switching/all-shops. The distinction between that request check
and a missing target-row shop comparison is important; do not claim all detail reads are shop-isolated.
[Prisma tenancy](../../apps/api/src/config/database.ts) filters/stamps tenant-owned models.

[Field access](../../apps/api/src/middleware/field-access.ts) strips phone/altPhone, Aadhaar and
guarantor-chain keys recursively under `/api/v1/customers` unless `customers.view_phone`,
`customers.view_aadhaar`, `customers.view_guarantor_chain` respectively. The last requires real-sale
access. It does **not** apply the sales restricted projection to embedded `saleRecords` or history.
Default field collectors can open permitted customer detail without a customer list; do not turn
the whole feature into a role-only “admin/accountant” contract.

## User workflows

1. Search/filter the customer list by name, phone or code and zone; choose a record or create one
   under a single selected shop.
2. Enter identity, contact and optional business/address fields. Link an existing guarantor
   where applicable or create the required identity separately. Missing guarantor fails with 404.
3. From sale creation, quick-search customers across the tenant's shops using name/mobile/code,
   ledger number or account-register number. Reuse an existing identity when appropriate.
4. Open details, permitted guarantor links, purchase history, register entries and reliability context;
   edit authorized fields. Missing records show a not-found/error state.
5. For register reconciliation, duplicates or shop moves follow
   [Customer Searching](customer-searching.md), not an undocumented customer merge endpoint.

## API contracts and data

Prefix `/api/v1/customers`; authenticated feature-gated JSON success/error envelopes, paginated list.

| Method and suffix | Contract |
|---|---|
| `GET /` | `page`, `pageSize`, `search`, `zone`; returns joined guarantor/creator/shop data subject to field stripping. |
| `GET /search?query=...` | Minimum two characters checked by controller; up to 20 newest matches across all tenant shops. Includes sales ledger and whitespace-normalized register account-number matching. |
| `POST /` | Validated create; 201, creator and current shop recorded. |
| `GET /:id` | Customer, guarantor chain, shop/creator and embedded real `saleRecords`. |
| `PUT /:id` | Partial update of allowed customer fields; existing code/shop/creator preserved. |
| `GET /:id/sales` | Real sales plus product/shop/guarantor/company and schedule summary. |
| `GET /:id/installment-history` | Lifetime totals, on-time/late/completed/active/absorbed/reschedule counts, delay metrics, financed/paid sums, numeric score and rating. |
| `GET /:id/reliability` | `ReliabilityMetrics`: promise outcomes, broken EMI coverage count, outstanding, overdue count, average DPD, risk band. |

[Validation](../../apps/api/src/modules/customers/customers.validation.ts): name 1–200;
phone length 10–15 (not a digits-only regex); alternate phone ≤15; Aadhaar ≤12 (not exactly
12 digits here); pincode ≤6; GSTIN regex; guarantor UUID; arbitrary dynamic-attribute record.
Zones are East, West, North, South, Delhi, Ghaziabad, Noida; blank becomes null.
Update fields are optional; explicit null clears supported nullable fields.

[Current risk computation](../../apps/api/src/modules/customers/customers.reliability.ts) uses
tenant installment settings (default 365 days) for promises and payments, but all customer
installments for outstanding/current counts. Cancelled promises do not count as made; replaced
ones count as made but not broken. Broken-EMI count sums coverage lengths, not unique EMI IDs.
“Active overdue” currently counts stored `overdue` **or** `partially_paid` statuses, not a fresh
due-date test; average DPD is over payment rows, not just fully paid EMIs.
High risk is ≥3 broken-covered EMIs or ≥3 active-overdue rows; medium is ≥1; otherwise low.

## Web behavior

[App routes](../../apps/web/src/App.tsx) separately guard list/create/detail/edit.
[Hooks](../../apps/web/src/hooks/useCustomers.ts) use the shared API client; list supports
pagination/search/zone, quick search starts at two characters, mutations invalidate customer keys.
List keeps URL filters, debounces search and displays shop information in all-shops mode;
creation is disabled there until a single shop is selected.
The current form uses fixed fields and guarantor search; API `dynamicAttributes` support does not
mean this screen renders a DB-driven dynamic form. Detail masks returned Aadhaar to its last four
digits, conditionally presents guarantor links, and embeds the register section.
Purchase-history query currently runs for any nonempty detail ID rather than checking
`customers.view_purchase_history` before the request; API permission errors remain authoritative.
Presentation hiding is not proof of safe nested sale data.

## Mobile behavior and differences

Flutter is planned for all authorized tenant roles: customer search/detail, permitted create/edit,
guarantor/business fields and linked sales/register/reliability workflows, eventually matching
authorized web capabilities in stages. No Flutter screens or APIs were added.
Legacy [Expo collection types/hooks](../../apps/mobile/src/hooks/useCollections.ts) include customer
phone/address and guarantor context within collections; they are not general customer management.
Offline PII caching, document capture, local search and synchronization are open decisions, not
existing delivery commitments. A collector's permission to open customer detail must not imply
permission to list or edit all customers.

## Dependencies and cross-feature effects

[Sales](sales.md) uses customer and guarantor IDs; changing contact data affects historical linked
views. [Installment](installment.md) supplies promise-based reliability and collection contact context.
[Customer Searching](customer-searching.md) creates/matches identities, searches account numbers
and may move a customer's shop under its own entry/sale checks. Do not transplant its matching
rules into the general API without a decision.
Coordinate response projections with sales sanitization and customer field-access permissions;
currently customer nested sales are an alternate disclosure path.

## Code and source references

- API [routes](../../apps/api/src/modules/customers/customers.routes.ts),
  [controller](../../apps/api/src/modules/customers/customers.controller.ts),
  [service](../../apps/api/src/modules/customers/customers.service.ts),
  [validation](../../apps/api/src/modules/customers/customers.validation.ts),
  [risk computation](../../apps/api/src/modules/customers/customers.reliability.ts).
- [Schema](../../apps/api/prisma/schema.prisma),
  [ID generation](../../apps/api/src/utils/id-generator.ts),
  [registration](../../apps/api/src/app.ts),
  [field restrictions](../../apps/api/src/middleware/field-access.ts).
- Web [hooks](../../apps/web/src/hooks/useCustomers.ts); list/form/detail links above.
- [Access tests](../../apps/api/tests/unit/access-rules.test.ts),
  [promise integration tests](../../apps/api/tests/integration/promises.test.ts).

## Verification and acceptance

Reviewed source and documentation structure/links only; no database, browser or test execution.
Existing access and promise tests provide related coverage, not certification of every customer route.
Runtime acceptance should check:
- Tenant isolation across direct IDs/search; selected/all-shops list versus intentionally
  tenant-wide quick search; explicitly test target-shop behavior for detail/edit/history.
- Two-character search, ledger/account-number matches, shared family phone numbers and separate
  identities; sequential customer codes past 9999 and concurrent create conflicts.
- Phone/Aadhaar/guarantor stripping in nested responses and no self-finance disclosure to a
  sanitized viewer through either customer detail or sales history.
- Valid/invalid GSTIN/zone/guarantor, nullable clears, missing customer and absent permissions.
- Both reliability endpoints against known payment/promise data; partially paid future rows and
  disabled scheduler cases must not be silently treated as fresh risk calculations.

## Known gaps and next work

Confirmed: customer detail embeds real sales without `sales.view_real`; history also returns real
sales/schedule data without using the sales public projection. Field stripping does not repair
that broader disclosure. Detail/edit do not enforce target shop; reliability/history are tenant-wide.
General customer API lacks delete/merge and strong phone/Aadhaar/pincode semantic validation.
Concurrency of customer-code allocation and stale stored-status reliability need runtime review.
Do not claim these gaps were fixed by documenting them.

## Decisions and review checkpoint

Checkpoint **2026-11-10**: API is source of truth; general customer identity, register matching and
two reliability contracts remain distinct. All-role Flutter parity is planned, not current Expo behavior.
[ADR-0001 amendments](../adr/0001-per-emi-overdue-installment-model.md) explain installment context,
but current calculations above follow executable source.
Coordinator owns `docs/features/checkpoints.json`; inventory/hashes were not edited here.
