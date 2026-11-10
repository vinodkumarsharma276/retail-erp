# Bank Statements — Transactions

## Purpose and scope

**Transactions** (`/bank/transactions`) searches, filters, exports and maintains imported bank
rows. It also exposes explicit supplier-payment posting and deletion that can reverse those
payments. It is not the legacy BankTransaction reconciliation page; see
[Overview](bank-overview.md). Shared parsing, category policy and flags live in
[Upload](bank-upload.md), [Rules](bank-rules.md) and [Review](bank-review.md).

## Implementation status

| Surface | Status | Evidence / limits |
|---|---|---|
| API | Implemented | Scoped listing/detail, edit/bulk edit, filtered export, supplier payment, delete-impact and row deletion. |
| Web | Implemented | 50-row table, URL filters, selection/bulk actions, detail drawer, supplier card and destructive-impact dialog. |
| Flutter | Planned only | New approved target toward eventual full authorized web parity; no shipped Flutter transaction surface. |

Reviewed **2026-11-10**; source-reviewed, **not runtime-certified**.

## Business rules and invariants

- Imported amounts are signed; direction is separately stored. The editor changes category,
  review/note and supplier choice, **not amount/date/narration**. Correcting a bad parsed row
  can require deletion/reimport rather than editing its money.
- Human category changes survive recategorization (`category_source=user`). An explicit supplier
  choice, including null (“not a supplier”), survives automated supplier matching.
- Supplier suggestions use active same-tenant suppliers: name containment/truncated words,
  then normalized trigram similarity and optional AI adjudication for uncertain names.
  ATM/Cash and Bank channels are skipped for automatic suggestions; only debit rows are matched.
  Suggestions never create accounting payments.
- Explicit posting requires a debit, known/chosen supplier and an unrecorded bank row.
  The whole absolute withdrawal is distributed against that shop's oldest eligible unpaid bills.
  Payment date is the bank-row date; channel suggests payment mode but the caller can choose it.
- If bills do not absorb the amount, 422 `advance_needed` asks for confirmation;
  retrying with `asAdvance=true` retains surplus as a shop-specific SupplierAdvance.
  Those advances can pay the shop's later supplier bills.
- Duplicate bank-row posting is refused (409). A supplied/nonempty reference also checks
  existing same-tenant supplier payments/advances on that date (not only the current shop).
  This is source-level duplicate prevention, not a claim of concurrency certification.
- Posting stamps chosen supplier and human supplier-payment category. Review state remains
  separately governed by the flag/review engine.
- Deletion is permanent: row, notes and linked accounting provenance are removed. Linked
  supplier bill payments and advances (including later use of those advances) are undone;
  affected bills reopen, then surviving advances may pay those bills again. Statement count/period
  are recomputed, and empty statements disappear.

## Access, tenancy, and shop scope

See [shared bank scope](bank-overview.md): feature `bank.reconciliation`, authenticated
tenant and current/accessible shops; rail `nav.bank`, web/read `bank.view`.

| Operation | Additional access |
|---|---|
| Category/review/note/supplier choice, bulk update | `bank.reconcile` |
| Export and row detail | `bank.view` (no separate bank export permission) |
| Delete preview and delete rows | `bank.delete_statement` |
| Delete rows carrying supplier payments/advances | Also `purchases.record_payment`, checked by service |
| Record supplier payment | `bank.view`, `purchases.record_payment`, and feature `purchases`; not `bank.reconcile` |

The supplier picker also calls distributor listing, so its availability depends on that endpoint's
permissions; a read-only bank user may see already-returned supplier information without being
able to browse suppliers. Bank row balances are not separately gated by
`bank.view_account_balance` in these routes.

All list/export/detail/write SQL filters tenant and authorized shops or validates scoped records
before operations. Supplier matching uses tenant-wide suppliers; payment allocation explicitly
uses the transaction's shop, not whatever shop has that supplier's largest balance.

## User workflows

1. Filter/search rows, sort and page. Inspect a row in the drawer, including category source,
   flag reasons, running balance, reference and source file.
2. With reconcile permission, change category, note/review or supplier. Select visible rows
   for bulk category, verification or suspicious status.
3. For a debit supplier payment, confirm supplier, payment mode and reference; post. If surplus
   is reported, either cancel/correct supplier or explicitly confirm advance handling.
4. Export all matching rows (not just the visible page) as CSV or Excel.
5. Delete a row/selection only after reading the impact preview naming affected suppliers,
   amounts and bills. Without purchase-payment permission, linked-payment removal is blocked.

## API contracts and data

Prefix `/api/v1/bank-statements`; JSON success envelope except binary exports.

| Method | Path | Contract |
|---|---|---|
| GET | `/transactions` | Filtered page `{rows,total,inflow,outflow,page,pageSize}` |
| GET | `/transactions/facets` | Accessible-scope bank/channel values, not fully filtered facets |
| GET | `/transactions/:id` | Row plus supplier/payment/source fields, or 404 |
| PATCH | `/transactions/:id` | Optional category, nullable review_status/reviewer_note/distributor_id; empty patch 400 |
| POST | `/transactions/bulk` | Same patch plus 1–5,000 UUID `ids`; returns `{updated}` for scoped matches |
| POST | `/transactions/delete-impact` | `{ids}` (1–5,000 UUIDs); counts and linked supplier payments |
| POST | `/transactions/delete` | `{ids}`; returns deleted count, removed empty statements and undone-payment summary |
| POST | `/transactions/:id/supplier-payment` | Optional distributorId, paymentMode, nullable referenceNumber (100), notes (500), asAdvance; 201 result |
| GET | `/export` | Same data filters, `format=xlsx\|csv` default xlsx; binary attachment |

Filters: list-valued `shopIds`, `statementIds`, `banks`, `categories`, `channels` accept commas
or repeated parameters. Dates `from`/`to` are optional `YYYY-MM-DD`. Direction debit/credit;
flagged true/false; review pending/verified/suspicious/none; flag reason; `q` up to 200.
Search matches description, counterparty, reference or category case-insensitively and exact
absolute amount when input parses numerically (commas allowed).

Pagination defaults page 1/size 50, size range 10–500. Sort keys: date, amount, abs, category,
bank, shop, counterparty; unknown sort falls back to date; dir asc/desc. Totals cover all filtered
rows, not the page. Bulk writes can silently omit out-of-scope/missing IDs; deletion returns
404 only when no scoped rows remain. Single patch returns fresh detail.

Exports include supplier/payment metadata, amount-in/out, balance, category/source, reasons,
reviewer/note and file. CSV has UTF-8 BOM; Excel sheets are Transactions, By category and Flagged.
No export paging or row limit is declared here. Data models include StatementTransaction,
PurchasePayment.statementTransactionId and SupplierAdvance links.

## Web behavior

The table uses 50 rows, debounced search (300 ms), URL-backed bank/category/direction/review
filters and statement/channel drilldown filters. Global dates/shops are added separately.
Selection resets on page/URL changes; select-all targets the visible page, not every filtered row.
CSV/Excel export follows full filters, not selection. Some displays explicitly format INR even
when a statement has another currency; no currency conversion occurs.

Shared drawer supports category, supplier, review note/state, rule creation (“Always categorize
like this”) and deletion. Posting/undo invalidates bank summaries, purchases and distributors.
Mutation errors use toasts; 422 advance decisions show a confirmation instead of silently
discarding surplus.

## Mobile behavior and differences

Flutter is approved, planned only. Proposed parity includes search/filter/detail, authorized
edits/bulk equivalents, file sharing/export, supplier posting with surplus confirmation and
impact-aware deletion. Touch selection and destructive confirmation need mobile-specific UX.
Existing Expo is legacy, not Flutter. No offline payment posting, notification delivery or
background synchronization is assumed; accounting conflicts require explicit design.

## Dependencies and cross-feature effects

- [Statements](bank-statements.md) shares deletion impact and recategorization lifecycle.
  [Review](bank-review.md) uses the same patch/posting card; [Rules](bank-rules.md) affects
  categories; [Overview](bank-overview.md) aggregates the same rows.
- Supplier/payment code is shared with distributor payments and supplier advances. A bank-row
  deletion can reverse an advance already used by later purchases, not just one visible bill.
- Expense categories here do not create [Expenses](expenses.md); legacy bank matching is distinct.
- Any change to supplier merging, payment clearing, oldest-bill allocation or advance consumption
  must preserve bank provenance and exactly-once/undo behavior.

## Code and source references

- [Routes](../../apps/api/src/modules/bank-statements/bank-statements.routes.ts),
  [controller](../../apps/api/src/modules/bank-statements/bank-statements.controller.ts),
  [service](../../apps/api/src/modules/bank-statements/bank-statements.service.ts),
  [validation](../../apps/api/src/modules/bank-statements/bank-statements.validation.ts),
  [supplier matcher](../../apps/api/src/modules/bank-statements/engine/categorize/suppliers.ts).
- [Distributor payment service](../../apps/api/src/modules/distributors/distributors.service.ts),
  [advance/undo helper](../../apps/api/src/modules/distributors/supplier-advances.ts),
  [schema](../../apps/api/prisma/schema.prisma).
- [Transactions page](../../apps/web/src/pages/bank/BankTransactionsPage.tsx),
  [drawer](../../apps/web/src/pages/bank/components/TransactionDrawer.tsx),
  [supplier card](../../apps/web/src/pages/bank/components/SupplierPaymentCard.tsx),
  [delete dialog](../../apps/web/src/pages/bank/components/DeleteTransactionsDialog.tsx),
  [API adapter](../../apps/web/src/pages/bank/lib/api.ts); [context](../CONTEXT.md).

## Verification and acceptance

Source inspection only; no commands/tests or accounting writes executed.
Existing tests: [supplier matcher](../../apps/api/tests/unit/bank-supplier-match.test.ts),
[payee extraction](../../apps/api/tests/unit/bank-payee-name.test.ts),
[supplier-payment integration](../../apps/api/tests/integration/bank-supplier-payment.test.ts).
Integration cases cover debit-only posting, same-row duplication, shop allocation, advances,
human-choice preservation and deletion/undo. They require PostgreSQL's separate test database.

Accept permission/feature combinations, two-tenant/shop filters, unknown IDs, 5,000-ID limits,
filtered export totals, category preservation, duplicate reference, overpayment confirmation,
repeated/concurrent posting, and reversal of spent advances before runtime certification.

## Known gaps and next work

- No amount/date/narration patch contract; corrections need a carefully explained delete/reimport.
- Supplier information returned with bank reads and delete previews is not independently
  guarded by distributor detail permission; review intended cross-feature disclosure.
- Duplicate guards and posting/category-update phases need concurrency/failure verification;
  a successful ledger write and later bank metadata update are not one end-to-end transaction here.
- Exports are full-result in-memory generation; establish practical limits for large histories.
- Currency-specific row rendering/export semantics need review for non-INR data.

## Decisions and review checkpoint

Checkpoint **2026-11-10**, source-reviewed, not runtime-certified. Supplier posting is explicit
and reversible through bank deletion, not a side effect of verification/categorization.
Flutter parity is planned. Checkpoint inventory/hashes are maintained separately and unchanged.
