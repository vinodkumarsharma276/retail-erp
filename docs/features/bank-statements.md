# Bank Statements — Statements

## Purpose and scope

**Statements** (`/bank/statements`) inventories imported files/feed batches, their shop/bank,
parse provenance, warnings, balance-check score and resulting transaction totals. It supports
original download, bank/shop correction, recategorization and destructive removal.
Parsing belongs to [Upload](bank-upload.md); row accounting/deletion rules to
[Transactions](bank-transactions.md); categorization policy to [Rules](bank-rules.md).

## Implementation status

| Surface | Status | Evidence / limits |
|---|---|---|
| API | Implemented | List, metadata patch, recategorize, deletion preview/delete and conditional original download. |
| Web | Implemented | Statement inventory, linked row/review drilldowns, action menu and edit/delete dialogs. |
| Flutter | Planned only | New approved target with eventual full authorized web parity; no Flutter inventory delivered. |

Reviewed **2026-11-10**; source-reviewed, **not runtime-certified**. A statement's existence
does not certify parse completeness, accounting reconciliation or live bank connectivity.

## Business rules and invariants

- Each BankStatement records file name/type/size/hash, tenant/shop, bank/account hint/link,
  currency, source, parse method, reconciliation score, warnings, row period/count and uploader.
  Source can be upload or API; parse methods include spreadsheet, pdf-text, ai-text,
  ai-vision and bank-api.
- Reconciliation score measures running-balance consistency during parsing, not matching to
  sales/expenses or audited books. Period derives from stored row dates.
- Optional StatementFile holds original bytes only when entitlement and setting allowed it
  **at upload**. Enabling storage later cannot reconstruct old originals. File download still
  reads retained files without a new storage-entitlement check; missing originals return 404.
- Recategorization reruns rules/AI only for rows not manually categorized (`category_source`
  other than user), then supplier matching and reflagging. It does not reread/reparse original
  file money/dates. Manual supplier choices also survive matcher passes.
- Bank/shop patch updates statement and its transaction rows. Moving requires destination
  within request scope and reflags old/new/related shops; it does not change registered
  BankAccount ownership/link or reallocate already-recorded purchase payments.
- Whole deletion removes rows, review metadata and retained file. It also reverses linked
  supplier payments/advances as described in [Transactions](bank-transactions.md).
  Empty statements can also disappear after row deletion.

## Access, tenancy, and shop scope

Shared [bank scope](bank-overview.md): `bank.reconciliation`, authenticated tenant and
current/accessible shop set; rail `nav.bank`, route/read `bank.view`.

- List/original download: `bank.view`.
- Bank/shop patch and recategorize: `bank.upload_statement`, not `bank.reconcile`.
- Delete-impact and delete: `bank.delete_statement`; actual deletion also requires
  `purchases.record_payment` if linked supplier payments/advances would be undone.
- Original retention is separately `bank.statement_files` plus `keepOriginalFiles`, but
  reading a previously retained original is not separately re-gated by that add-on.

List narrows `shopIds` by accessible scope. ID operations first establish statement ownership
and compare its shop with scope. Move destination must also be in that scope; single-shop
requests cannot move to an arbitrary other shop merely by knowing its UUID.

## User workflows

1. Inspect inventory, parse method, balance score, warnings, period, money in/out and review counts.
2. Follow Transactions or Review links filtered to the statement.
3. With upload permission, correct bank/shop in the modal, or rerun categorization after adding
   better rules. Read AI-error feedback: rules may have succeeded even when AI failed.
4. Download the original only when `has_file` is true; otherwise recover it from the original
   source outside the app if reimport is necessary.
5. Delete after impact preview; cancellation leaves data untouched. Removing linked payments
   is refused without payment permission even if bank delete permission exists.

## API contracts and data

Prefix `/api/v1/bank-statements`; JSON success envelope except file bytes.

| Method | Path | Contract |
|---|---|---|
| GET | `/statements` | Optional list-valued `shopIds`; all matching summaries, uploaded newest first |
| PATCH | `/statements/:id` | Optional `bank` (trimmed 1–80), UUID `shopId`; returns updated summary |
| POST | `/statements/:id/recategorize` | Returns `{updated, aiUsed, aiError}`; manual categories excluded |
| GET | `/statements/:id/delete-impact` | Scoped transaction count and linked supplier-payment impact |
| DELETE | `/statements/:id` | Deletes/undoes, returns deleted marker and supplier-payment undo summary |
| GET | `/statements/:id/file` | Binary attachment with retained MIME/name; 404 if not retained |

There is **no GET `/statements/:id` route**, server-side paginated list, reparsing endpoint,
or upload replacement endpoint. Upload is a separate multipart route in [Upload](bank-upload.md).
Summary includes aggregate inflow/outflow, pending/flagged counts and `has_file`, not raw file
contents. Errors follow handled `{success:false,error,...details}` conventions.

## Web behavior

The shared header shows bank date filters, but the statement query passes **shopIds only**.
Changing global dates does not narrow this inventory. List is an unpaginated, horizontally
scrollable table showing shop/bank/period/reader/balance-check, counts and flows.
Menus conditionally expose original download, recategorize, bank/shop edit and deletion
according to retained-file status and permissions.

Statement links set Transactions `statementIds` or Review `statementIds` and may still be
intersected with persisted global bank dates. Recategorization invalidates row, analytics,
statement, facet and review-count queries; an AI failure message is explicit.

## Mobile behavior and differences

Flutter is approved/planned only. Proposed workflows include scoped statement inventory,
parse/warning detail, row/review navigation, original-file sharing, authorized correction,
recategorization and impact-aware deletion, eventually matching all authorized web capabilities.
Desktop table/action menus need touch-first design. Expo is legacy, not Flutter delivery.
No offline originals, notifications, background downloading or synchronization is assumed.

## Dependencies and cross-feature effects

- [Upload](bank-upload.md) owns account/overlap/parse provenance; [Rules](bank-rules.md)
  owns retention settings/account links; [Review](bank-review.md) owns flag decisions.
- [Transactions](bank-transactions.md) owns payment/advance undo and source-row accounting.
  Moving a posted statement's rows without moving linked accounting is a cross-feature risk.
- [Overview](bank-overview.md) and exports derive from these rows; destructive changes affect
  cash-flow totals, duplicate flags, supplier balances and purchase-payment statuses together.

## Code and source references

- [Routes](../../apps/api/src/modules/bank-statements/bank-statements.routes.ts),
  [controller](../../apps/api/src/modules/bank-statements/bank-statements.controller.ts),
  [list/move/file/delete/recategorize service](../../apps/api/src/modules/bank-statements/bank-statements.service.ts),
  [validation](../../apps/api/src/modules/bank-statements/bank-statements.validation.ts),
  [schema](../../apps/api/prisma/schema.prisma).
- [Statements page](../../apps/web/src/pages/bank/BankStatementsPage.tsx),
  [delete-impact dialog](../../apps/web/src/pages/bank/components/DeleteTransactionsDialog.tsx),
  [API/download adapter](../../apps/web/src/pages/bank/lib/api.ts),
  [queries](../../apps/web/src/pages/bank/lib/queries.ts),
  [web routes](../../apps/web/src/App.tsx); [context notes](../CONTEXT.md).

## Verification and acceptance

Source inspection only; no runtime download, deletion, tests or build executed.
[Supplier-payment integration tests](../../apps/api/tests/integration/bank-supplier-payment.test.ts)
cover emptied statements and whole-statement payment reversal;
[upload tests](../../apps/api/tests/integration/bank-statement-upload.test.ts) cover provenance/overlap.
Before certification accept retained/not-retained download and entitlement changes, out-of-scope
IDs, destination-scope checks, manual category preservation, AI failure, date-filter mismatch,
empty list and deletion of used advances. Add move-after-payment tests explicitly.

## Known gaps and next work

- Statement moves do not move/revalidate linked accounting or registered account ownership.
  Define whether posted statements may move and how to reconcile their ledger provenance.
- Global date filter is visible but ignored by the inventory query; align UX or contract.
- No server pagination/search or detail/reparse endpoint; assess large inventories and parse
  corrections before claiming full document management.
- Recategorization does not fix bad extraction, and storage add-on cannot recover past files.
- Balance score may describe the original parse while stored row set changed through overlap
  skipping/deletion; it is not recomputed as an ERP reconciliation certification.

## Decisions and review checkpoint

Checkpoint **2026-11-10**, source-reviewed only, not runtime-certified. Preserve distinct
statement provenance, review and supplier-accounting semantics. Flutter is approved/planned;
no delivered mobile storage behavior is implied. Checkpoint inventory/hashes are unchanged here.
