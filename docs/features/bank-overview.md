# Bank Statements — Overview

## Purpose and scope

**Overview** (`/bank`) summarizes imported statement cash flow and review workload, not
the ERP cashbook, a live balance inquiry, profit, or a bank-confirmed reconciliation.
The Bank Statements rail has six separate surfaces:
[Overview](bank-overview.md), [Upload](bank-upload.md), [Review queue](bank-review.md),
[Transactions](bank-transactions.md), [Statements](bank-statements.md), and
[Rules & settings](bank-rules.md). This document owns shared access/navigation and the
legacy-bank distinction; the linked documents own import, flags, row operations and policy.

## Implementation status

| Surface | Status | Evidence / limits |
|---|---|---|
| API | Implemented | Metadata, scoped analytics and export over imported statement rows; separate legacy reconciliation API also remains. |
| Web | Implemented | Overview charts, drilldowns, scoped Excel export and transaction drawer. |
| Flutter | Planned only | New approved target; eventual full authorized web parity, not delivered here. |

Reviewed **2026-11-10** against source and existing context notes. Source-reviewed,
**not runtime-certified**; no API/provider availability is inferred from screen labels.

## Business rules and invariants

- `StatementTransaction.amount` is signed: negative debit, positive credit. Analytics exposes
  positive outflow totals, inflow, net difference and row counts. Engine SQL normalizes
  Decimal/bigint values to JavaScript numbers and dates to date strings.
- Analytics includes only imported rows matching scope/filters. Overlapping copies deliberately
  retained during upload also affect totals; flags do not exclude them or suspicious rows.
- Categories, channels and review statuses are analysis metadata, not automatic ledger posting.
  Supplier-payment posting is a separate authorized action described in [Transactions](bank-transactions.md).
- Currency labeling uses the most frequent statement currency across the accessible shop set,
  not FX conversion and not necessarily the narrowed analytics range. Mixed-currency sums
  are not converted; do not treat them as comparable accounting totals.
- Overview progress counts verified plus suspicious against flagged count. Human decisions
  can persist after flags disappear, so this is not a certified reconciliation ratio.

## Access, tenancy, and shop scope

- Feature `bank.reconciliation` gates both `/api/v1/bank-statements` and `/api/v1/bank`;
  statement routes additionally run the feature gate in their base prehandlers.
- Overview, Review, Transactions, Statements and Rules rail entries use `nav.bank`;
  Upload uses `bank.upload_statement`. Web `/bank` and all children require `bank.view`;
  Upload also requires `bank.upload_statement`. Effective permissions are feature/prerequisite
  filtered, not a blanket grant to a role or “everyone.”
- Statement metadata/analytics/export require `bank.view`. Editing rows/accounts/rules/settings
  requires `bank.reconcile`; statement upload/edit/recategorization requires
  `bank.upload_statement`; destructive statement/row operations require `bank.delete_statement`.
  See each child document for the extra purchase/add-on checks.
- Authentication verifies tenant identity; `shopScope` resolves JWT/header shop. Switching
  needs `shop.switch`; All Shops additionally needs `shops.view_all` (legacy alias
  `shop.view_all` is accepted) and active UserShop membership.
- `scopeOf()` passes the tenant and current/accessible shops into raw SQL. Requested `shopIds`
  intersect that set and cannot expand it. Raw SQL is **not** auto-scoped by Prisma.
  Tenant-global rules/settings and cross-shop account/duplicate discovery have exceptions
  documented in [Rules](bank-rules.md) and [Upload](bank-upload.md).
- There is no bank-prefix field-access rule enforcing `bank.view_account_balance`;
  analytics, row balances and account numbers are available under the actual bank read routes.
  UI masking is not a server-side field restriction.

## User workflows

1. Select the app-header shop, or authorized All Shops and optionally narrow the bank shop picker.
2. Choose all time, this/last month, three/six months, Indian financial year or custom dates.
3. Read cash flow, categories/channels, shop/bank comparisons, payees/payers, daily/monthly
   patterns and review reasons. Drill into Transactions or Review without changing source rows.
4. Open a largest transaction's drawer for inspection/authorized action, or export the filtered
   rows to Excel. Empty views offer Upload rather than inventing transactions.

## API contracts and data

Current analysis prefix: `/api/v1/bank-statements`. JSON successes are
`{ success: true, data: ... }`; handled failures include status, error and sometimes decision
details. Export/file routes return bytes, not this envelope.

| Method | Path | Contract |
|---|---|---|
| GET | `/meta` | Accessible shops, category/group catalog, AI status/model, extensions/size, tenant settings and file-storage entitlement |
| GET | `/analytics` | Filtered totals, monthly/daily/weekday series, categories/groups/channels, top payees/payers, shops/banks, largest rows, pending reasons |
| GET | `/export` | Shared filters and `format=xlsx\|csv`; see [Transactions](bank-transactions.md) |

Shared filters: comma-separated or repeated `shopIds`, `statementIds`, `banks`, `categories`,
`channels`; `from`/`to` in `YYYY-MM-DD`; `direction=debit|credit`; `flagged=true|false`;
`review=pending|verified|suspicious|none`; `reason`; and `q` (max 200).
Metadata is scope-based; currency selection and facets are not full-filter-dependent.

**Separate legacy API:** `/api/v1/bank` uses `BankTransaction`, whereas the new screens use
`StatementTransaction`. They share `BankAccount`, not transaction rows or status models.

| Method | Legacy path | Permission / behavior |
|---|---|---|
| GET | `/accounts` | `bank.view`; shop-scoped accounts |
| POST | `/accounts` | `bank.upload_statement`; current-shop account, current/savings, opening balance |
| GET | `/accounts/:id/transactions` | `bank.view`; pagination, dateFrom/dateTo, reconciliationStatus |
| POST | `/accounts/:id/transactions` | `bank.reconcile`; positive amount and separate debit/credit type |
| POST | `/accounts/:id/upload-statement` | `bank.upload_statement`; JSON `{transactions:[...]}`, **not file multipart** |
| GET | `/transactions/unmatched` | `bank.view`; current/accessibly grouped shop accounts |
| GET | `/transactions/:id/suggestions` | `bank.view`; candidate sales, purchase payments, expenses, installments |
| PUT | `/transactions/:id/reconcile` | `bank.reconcile`; entity type/UUID, marks matched |
| PUT | `/transactions/:id/manual-reconcile` | `bank.reconcile`; notes 1–500, marks manual_match |

Legacy import skips date/amount duplicates, additionally reference when supplied. Suggestions use
±3 days and ±10% amount with heuristic ranking, not AI; reconciliation validates entity existence.
No legacy unmatch route exists despite `bank.unmatch` in the catalog.
The older CONTEXT legacy endpoint table is not the current contract.

## Web behavior

The shared BankLayout wraps the six routes; actual navigation lives in the application sidebar,
not a separate LedgerLens shell. Browser-local `bank.filters` remembers bank shop/date selections;
server authorization remains authoritative. Default date preset is all time.
Overview supports chart/table presentations, top payer/payee switching, transaction drilldowns
and Excel download. Queries/mutations live under `pages/bank/lib`, not the legacy `useBank.ts`.

## Mobile behavior and differences

Flutter is planned toward eventual full authorized web parity: scoped summary, drilldowns,
review and export/navigation equivalents. Chart density and file-sharing presentation need
mobile design. Existing Expo employee collection code is legacy, not delivery of Flutter banking.
Offline data/write policy, notifications and background sync remain undecided/not assumed.

## Dependencies and cross-feature effects

- Import correctness: [Upload](bank-upload.md); human/anomaly workflow: [Review](bank-review.md).
- Accounting writes/undo: [Transactions](bank-transactions.md); provenance:
  [Statements](bank-statements.md); tenant policy/accounts/feeds: [Rules](bank-rules.md).
- [Expenses](expenses.md) can be legacy reconciliation candidates but are not created by
  category selection. Sales/installment suggestions in legacy bank need special care with
  real-versus-sanitized sales permissions.
- Any shared bank permission, shop-scope, category, query key or amount-sign change must be
  coordinated across all six pages, exports, upload engine and supplier posting.

## Code and source references

- [Analysis routes](../../apps/api/src/modules/bank-statements/bank-statements.routes.ts),
  [controller/scope](../../apps/api/src/modules/bank-statements/bank-statements.controller.ts),
  [service/analytics](../../apps/api/src/modules/bank-statements/bank-statements.service.ts),
  [validation](../../apps/api/src/modules/bank-statements/bank-statements.validation.ts),
  [SQL normalization](../../apps/api/src/modules/bank-statements/engine/db.ts).
- [Overview](../../apps/web/src/pages/bank/BankDashboardPage.tsx),
  [layout](../../apps/web/src/pages/bank/components/BankLayout.tsx),
  [filters](../../apps/web/src/pages/bank/lib/store.tsx),
  [queries](../../apps/web/src/pages/bank/lib/queries.ts),
  [API adapter](../../apps/web/src/pages/bank/lib/api.ts).
- [App routes](../../apps/web/src/App.tsx), [rail](../../apps/web/src/layouts/components/Sidebar.tsx),
  [registration](../../apps/api/src/app.ts), [shop scope](../../apps/api/src/middleware/shop-scope.ts),
  [field restrictions](../../apps/api/src/middleware/field-access.ts),
  [access](../../packages/shared-types/src/access.ts).
- Legacy [routes](../../apps/api/src/modules/bank/bank.routes.ts),
  [controller](../../apps/api/src/modules/bank/bank.controller.ts),
  [service](../../apps/api/src/modules/bank/bank.service.ts),
  [validation](../../apps/api/src/modules/bank/bank.validation.ts),
  [hook](../../apps/web/src/hooks/useBank.ts); [context notes](../CONTEXT.md).

## Verification and acceptance

Source inspection only; no runtime, DB, test, build or provider verification performed.
[Access-rule tests](../../apps/api/tests/unit/access-rules.test.ts) cover feature/prerequisite
filtering, not full dashboard acceptance.
Verify two-tenant/two-shop isolation, header scope changes, filter/export totals, empty/error
views, currency labeling, chart drilldowns and forbidden write actions before certification.

## Known gaps and next work

- Legacy ID-based account/transaction operations lack explicit selected-shop comparison;
  suggested-match queries read real sale/installment sources without per-source read guards.
  These are confirmed source gaps, not evidence of runtime-tested access behavior.
- `bank.view_account_balance` is not a separate read gate on analysis responses.
- Mixed-currency conversion is absent; imported cash flow is not live balance or profit.
- Overview's `isLoading || !data` rendering can leave an analytics failure looking like loading.
  Explicit error presentation should be accepted separately.
- Legacy and statement transaction systems coexist; do not point new clients at legacy
  CONTEXT endpoint names or assume the reconciliation statuses map to review decisions.

## Decisions and review checkpoint

Review checkpoint: **2026-11-10**, source-reviewed, not runtime-certified.
Keep one feature document per rail item and link shared behavior instead of copying the engine.
Flutter is approved/planned with eventual full authorized web parity; no mobile delivery is
asserted. Inventory/hashes in `docs/features/checkpoints.json` are owned separately and unchanged here.
