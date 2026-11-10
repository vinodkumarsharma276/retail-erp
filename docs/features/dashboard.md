# Dashboard

## Purpose and scope

**Dashboard** (`/dashboard`, Overview navigation) summarizes shop sales, inventory,
collections, expenses and low-margin sales. It is an analytical view, not a financial
ledger or the authoritative collections worklist.

## Implementation status

| Surface | Status | Evidence / limits |
|---|---|---|
| API | Implemented, with limitations | Six read endpoints in [dashboard.routes.ts](../../apps/api/src/modules/dashboard/dashboard.routes.ts); aggregation semantics below. |
| Web | Implemented, with permission mismatches | [DashboardPage.tsx](../../apps/web/src/pages/dashboard/DashboardPage.tsx) assembles summary, charts and overdue/profit cards. |
| Flutter | Planned, not implemented | Approved new target for all authorized tenant roles, eventually reaching full web parity; existing Expo is legacy, not Flutter delivery. |

Reviewed **2026-11-10** against current working-tree sources. Source-reviewed, not runtime
tested or runtime-certified. The shared API remains the source of truth.

## Business rules and invariants

- Sales totals use real `SaleRecord.totalAmount`, not sanitized sales. Daily graph results
  zero-fill dates without sales; graph and top-products API defaults cover the last 30 days.
- Top products are ranked by **productId sale count**, not a consolidated brand/model
  catalogue. Since inventory is per physical unit, identical models may appear separately.
  YoY likewise aggregates by productId and compares the requested period with dates shifted
  back one year.
- Summary compares calendar-month sales with the previous month; a zero previous month
  yields 100% growth when this month has sales, otherwise zero.
- Stock value sums **sellingPrice** of `in_stock` units, not dealer cost. Placeholder selling
  prices on unpriced inventory therefore affect this number.
- Summary overdue totals cover all past-due, non-paid/non-rescheduled installments on active
  schedules. The overdue table defaults to only the past **30 days**, so the two need not agree.
- Today's expected collection sums remaining amounts due today; actual collection sums
  installment payment amounts dated today. Summary uses an India-local date-only helper;
  chart/month/table paths also use server-local `Date` operations.
- Expenses use the current Indian April–March financial year. Low-margin sales reuse sales
  net-profit/input-tax-credit helpers, include profit percentage at or below the threshold,
  skip undefined percentages and cap the database read at 50,000 sales.

## Access, tenancy, and shop scope

- Navigation: `nav.dashboard`; page: `dashboard.view`; module feature:
  `dashboard.analytics`. YoY additionally depends on `reports.yoy`.
- Endpoint permissions respectively: `dashboard.summary_cards`, `dashboard.sales_chart`,
  `dashboard.top_products`, `dashboard.yoy_comparison`, `dashboard.overdue_table`,
  `dashboard.view_profit`. These are effective permissions, not hard-coded role eligibility.
- `dashboard.overdue_table` requires `installments.list`; sanitized-only sales viewers lose
  that permission. `dashboard.view_profit` requires `sales.view_real`.
- Every route authenticates and runs `shopScope`. Services honor active `shopId` or the
  accessible `shopIds` returned for All Shops. Switching requires `shop.switch`; aggregate
  access requires `shops.view_all` or `shop.view_all` and their feature/prerequisite checks.
- Tenant filtering comes from the shared Prisma extension. **Summary itself is not
  field-redacted by installment/expense/stock permissions**; see the gaps below.

## User workflows

1. Open Dashboard for an accessible shop, or select All Shops for the permitted aggregate.
2. Read month totals, overdue amounts, stock and today's collections; inspect FY expenses.
3. Change chart dates and visualizations; compare product count/revenue and year periods.
4. Open overdue work through `/installments?tab=overdue`; use the profitability tile to open
   `/sales` with its margin/date filters. Destination permissions still apply.
5. Treat forbidden/missing cards or query errors as access/data issues, not proof of zero
   business activity.

## API contracts and data

Prefix `/api/v1/dashboard`; all methods are `GET`, returning `sendSuccess` envelopes:

| Path | Inputs and output |
|---|---|
| `/summary` | No date filter; month sales/change, overdue count/amount, selling-price stock value/count, today's expected/actual collection and FY expenses. |
| `/sales-graph` | `dateFrom`, `dateTo`; daily date, totalAmount and count. |
| `/top-products` | Dates and optional `limit` (default 10); unit identity, category, count and revenue. |
| `/yoy-comparison` | Dates; `thisYear` and `lastYear` ranges with product aggregates. |
| `/overdue-installments` | Optional due-date window; flattened customer/product/installment data, remaining amount and days overdue. End date is an exclusive boundary when before today. |
| `/low-margin-sales` | `threshold` (default 5; non-finite value falls back to 5), optional dates; count, amount and totalProfit. |

Models read: `SaleRecord`, `Product`, `ProductCategory`, `Installment`,
`InstallmentSchedule`, `InstallmentPayment`, `Customer`, `Expense`.
There is no dashboard Zod query validator wired into these routes; controller/service parsing
is authoritative, not a guaranteed bounded or valid date range.

## Web behavior

- [Components](../../apps/web/src/pages/dashboard/components) include bar/line sales charts,
  top-product count/revenue views, YoY comparison, overdue table and low-margin tile.
- Sales/top-product dates initially cover the last 30 days; YoY starts with the next
  30-day window, comparing with the equivalent previous-year period.
- [useDashboard.ts](../../apps/web/src/hooks/useDashboard.ts) refreshes summary every minute;
  graph/top-products have five-minute stale times, YoY ten minutes, overdue/profit one minute.
- Most cards mount without per-card permission checks. The profit tile checks
  `sales.section.profit`, **not** its API's `dashboard.view_profit`.

## Mobile behavior and differences

Planned Flutter parity includes authorized summary cards, shop selection, date filters,
charts and drill-down into sales/collections. Delivery order and chart presentation are open.
No Flutter implementation, offline cache/write contract, notifications or background sync is
established by these sources. Do not copy web permission mismatches into Flutter.

## Dependencies and cross-feature effects

- [Products](products.md) provides selling-price stock valuation;
  [purchases](purchases.md) and [transfers](transfers.md) change that inventory.
- Transfer receipt creates a real sale and affects real-sales charts. The transfer path's
  lack of sanitized sale copy matters to sales reconciliation.
- The [installment model ADR](../adr/0001-per-emi-overdue-installment-model.md) provides
  collections context; dashboard overdue calculations should not be mistaken for the full
  installment daily-call/promise rules.
- Sales profit helpers and expense dates must stay aligned with any future reporting change.
  Permission prerequisites live in [access.ts](../../packages/shared-types/src/access.ts).

## Code and source references

- API [routes](../../apps/api/src/modules/dashboard/dashboard.routes.ts),
  [controller](../../apps/api/src/modules/dashboard/dashboard.controller.ts),
  [service](../../apps/api/src/modules/dashboard/dashboard.service.ts).
- Web [page](../../apps/web/src/pages/dashboard/DashboardPage.tsx),
  [components](../../apps/web/src/pages/dashboard/components),
  [hook](../../apps/web/src/hooks/useDashboard.ts),
  [routes](../../apps/web/src/App.tsx),
  [sidebar](../../apps/web/src/layouts/components/Sidebar.tsx).
- Shared [permissions](../../packages/shared-types/src/permissions.ts),
  [features](../../packages/shared-types/src/features.ts),
  [shop scope](../../apps/api/src/middleware/shop-scope.ts),
  [tenant database extension](../../apps/api/src/config/database.ts),
  [registration](../../apps/api/src/app.ts),
  [existing context](../CONTEXT.md).

## Verification and acceptance

Source inspection only; no application, unit or integration tests executed.
Acceptance should exercise: feature off/403; independently denied card permissions;
sanitized-only viewers; shop and All Shops separation; empty periods and zero-fill;
month/FY/India-midnight boundaries; overdue table versus all-overdue totals; placeholder
stock prices; top-product identity and the 50,000-sale profitability cap.

## Known gaps and next work

- Card mounting and endpoint guards disagree; the summary exposes collection aggregates
  without independently checking installment permissions, including for otherwise
  sanitized-only users with summary access. This is a confirmed source discrepancy,
  not a tested production incident.
- “Top products” and YoY are unit-ID aggregates, not model-level comparisons.
- The low-margin cap has no truncation indicator; date/limit validation and mixed timezone
  semantics need explicit acceptance coverage.
- Error handling varies by card; not every empty-looking chart distinguishes access failure.
  Flutter remains unimplemented.

## Decisions and review checkpoint

2026-11-10: document current calculations and access discrepancies rather than assuming
analytical completeness. Flutter is the approved new all-authorized-role target with eventual
web parity, using the shared API. No checkpoint inventory or hashes were changed in this pass.
