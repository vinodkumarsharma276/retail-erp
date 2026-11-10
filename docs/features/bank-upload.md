# Bank Statements — Upload

## Purpose and scope

**Upload** (`/bank/upload`) imports bank files into statement analysis, with account/shop
resolution, parsing and explicit overlap decisions. This document owns the parsing/import
pipeline. See [Rules](bank-rules.md) for categorization/policy, [Review](bank-review.md)
for flags, and [Statements](bank-statements.md) for provenance and lifecycle.

## Implementation status

| Surface | Status | Evidence / limits |
|---|---|---|
| API | Implemented | Multipart file import, native readers, optional AI, account/overlap decisions and shared persistence pipeline. |
| Web | Implemented | Multi-file/folder queue, drag/drop, password retry and structured account/duplicate recovery. |
| Flutter | Planned only | File selection/capture and import recovery proposed toward eventual full authorized web parity. |

Reviewed **2026-11-10**; source-reviewed, **not runtime-certified**. AI and file entitlements
are conditional behavior, not proof that a configured service is reachable.

## Business rules and invariants

- Supported extensions: `.pdf`, `.xlsx`, `.xls`, `.xlsm`, `.csv`, `.ods`, `.tsv`,
  `.png`, `.jpg`, `.jpeg`, `.webp`. `.txt` is not accepted by the upload endpoint.
  One file per request; configurable `STATEMENTS_MAX_FILE_MB`, default 30 MB.
- Spreadsheet parsing uses SheetJS, detects headers within the first 60 rows on each sheet,
  and preserves CSV/TSV cell strings to avoid US reinterpretation of day-first dates.
  It recognizes narration/date and debit/credit or amount columns, references and balances.
  Native rows are collected across sheets; unrecognized layouts are not guaranteed supported.
- PDF uses pdf.js text extraction and table heuristics. Running balances can correct debit/credit
  signs; a low reconciliation score is a parsing diagnostic, not matching against ERP books.
  Native date fallback is day-first except USD text PDFs use month-first.
- **Actual AI differences:** images require AI; PDFs with fewer than 80 text characters per
  page use AI file extraction; text PDFs attempt AI when fewer than three rows or balance
  reconciliation below 0.9, accepting AI only if it yields rows and meets the source comparison.
  Spreadsheets attempt AI **only when native parsing yields zero rows**, not whenever balances fail.
  No-key text/spreadsheet imports can still work; images/scanned PDFs fail with an explanatory error.
- Extraction AI failures can abort import; categorization AI failures are caught and produce
  warnings while rules/fallback categories persist. Do not equate these recovery paths.
- Account resolution prefers full account number when available, otherwise masked last digits,
  bank-name tie-breaking or explicit account selection. Detected IFSC is supplied to recovery
  UI, not used as a matching predicate. Registered accounts are required; All Shops
  attempts an accessible-shop match or returns a `choose_shop` decision.
- Cross-import overlap uses day, signed amount and running balance (narration when absent),
  matching each existing row at most once. Same-file SHA-256 also participates across shops.
  A 409 asks whether to skip repeats or keep them; skip with no fresh rows is refused.
  The identical file cannot be kept twice in the same shop.
- Kept repeats affect totals and are flagged later. User confirmation to import into the “wrong”
  shop is allowed and leaves a warning; registered account ownership is not moved.
- Statement, row batch and optional original file are stored transactionally. Supplier suggestions
  and shop-wide reflagging follow storage; suggestions do not execute payments.

## Access, tenancy, and shop scope

Shared [bank access/scope](bank-overview.md) applies: `bank.reconciliation`, authenticated
tenant and permitted shops. Both the upload screen and API require `bank.upload_statement`
(the screen also inherits `bank.view`).

An explicit `shopId` must be within request scope. In single-shop mode the web uses the header
shop; in authorized All Shops it can detect or select a destination. Switching to another
permitted shop uses a targeted request header; `allowOtherShop=true` only confirms account
mismatch, not arbitrary shop authorization. Account creation separately needs `bank.reconcile`.

Overlap/account discovery can inspect same-tenant accounts/statements outside the active shop
scope to identify mistakes and repeated uploads; returned recovery details may name those shops
and files. This is broader than normal list scoping and needs a deliberate disclosure policy.
Original storage additionally requires `bank.statement_files` **and** tenant `keepOriginalFiles`.

## User workflows

1. Add files by picker, folder or drag/drop. Choose destination only when needed; review
   registered-account options. Unsupported types are skipped in the browser.
2. Start the queue: the web sends at most two uploads concurrently and shows upload/processing
   progress. It does not expose a server job ID or resumable import.
3. For password-protected PDF, enter password and retry. For account problems, select/register
   account, choose/switch shop or explicitly accept the mismatch.
4. For overlap, inspect repeated samples and earlier files; skip repeats or deliberately keep
   them when permitted. A renamed identical file is not a bypass.
5. On success inspect imported/review counts and follow links to Review or Transactions.
   Retrying after a partial post-storage failure may encounter the newly stored overlap.

## API contracts and data

Prefix `/api/v1/bank-statements`:

| Method | Path | Contract |
|---|---|---|
| GET | `/meta` | `bank.view`; accepted extensions, maxFileMb, AI and entitlement/status |
| POST | `/statements/upload` | `bank.upload_statement`; multipart file and fields; 201 `{statement, aiUsed}` inside success envelope |
| GET | `/accounts` | `bank.view`; accounts used for resolution |
| POST | `/accounts` | `bank.reconcile`; account registration, detailed in [Rules](bank-rules.md) |

Multipart text fields **must precede the file**: optional UUID `shopId`, `bankAccountId`,
`bank` (max 80), `password` (max 200), `duplicates=skip|keep`, `allowOtherShop=true|false`.
Upload route rate limit is 60 per five minutes. Too large: 413; unsupported extension: 415;
parse/no-row/password/account decisions: generally 422; overlap: 409 with `code=overlap`,
counts, date range, prior file summaries and up to 200 repeated samples.
Password decisions carry `needsPassword`; account decisions use codes including `choose_shop`,
`no_accounts`, `account_number_missing`, `choose_account`, `account_other_shop`,
and `account_not_registered`.

Models: BankStatement, StatementTransaction, optional StatementFile and linked BankAccount.
Metadata/warnings include parse method, reconciliation and source. Import does not create
legacy BankTransaction rows. [Statements](bank-statements.md) describes the resulting fields.

## Web behavior

Queue state holds File objects/passwords in memory; the selected upload shop is remembered in
browser storage. Same filename/size already queued is filtered locally, independently of server
overlap logic. Users can retry failed/blocked items, remove queue items, or clear completed ones.
The subtitle “only pages … sent to AI” is not a per-page contract: scanned PDFs go through file
extraction and unusual text PDFs through extracted text. The real parser branches above govern.

## Mobile behavior and differences

Flutter is the new approved target, planned only. Proposed parity covers scoped file selection,
camera/image input where appropriate, password entry, account/shop decisions, overlap preview
and import results. Native file/camera permissions and long-request UX require design.
No Flutter capture implementation, offline import, notifications or background/resumable sync
is assumed; Expo is legacy, not Flutter delivery.

## Dependencies and cross-feature effects

- [Rules](bank-rules.md) owns category precedence and account/feed management;
  [Review](bank-review.md) owns automatic flags; [Transactions](bank-transactions.md)
  owns human decisions and supplier posting.
- The same persistence/categorization path serves feed imports, but feeds skip overlaps
  automatically rather than asking upload decisions.
- AI configuration uses `OPENAI_API_KEY` and `STATEMENTS_AI_MODEL` (default `gpt-4.1-mini`);
  external extraction/categorization requires approved handling of statement data.
- Parser direction/account changes can affect shop routing, duplicate checks, charts and
  supplier payments; test them together, not just the extraction count.

## Code and source references

- [Routes](../../apps/api/src/modules/bank-statements/bank-statements.routes.ts),
  [multipart controller](../../apps/api/src/modules/bank-statements/bank-statements.controller.ts),
  [upload/account/overlap/storage service](../../apps/api/src/modules/bank-statements/bank-statements.service.ts),
  [validation](../../apps/api/src/modules/bank-statements/bank-statements.validation.ts).
- [Parser dispatch](../../apps/api/src/modules/bank-statements/engine/parsers/index.ts),
  [PDF](../../apps/api/src/modules/bank-statements/engine/parsers/pdf.ts),
  [text tables](../../apps/api/src/modules/bank-statements/engine/parsers/textTable.ts),
  [spreadsheet](../../apps/api/src/modules/bank-statements/engine/parsers/spreadsheet.ts),
  [normalization](../../apps/api/src/modules/bank-statements/engine/parsers/normalize.ts),
  [account detection](../../apps/api/src/modules/bank-statements/engine/parsers/bankDetect.ts),
  [AI](../../apps/api/src/modules/bank-statements/engine/parsers/ai.ts).
- [Upload page](../../apps/web/src/pages/bank/BankUploadPage.tsx),
  [problem/retry UI](../../apps/web/src/pages/bank/components/UploadProblem.tsx),
  [API adapter](../../apps/web/src/pages/bank/lib/api.ts),
  [config](../../apps/api/src/config/index.ts); [older notes](../CONTEXT.md).

## Verification and acceptance

Source inspection only; no tests or runtime import executed.
Existing [parser tests](../../apps/api/tests/unit/bank-statement-parser.test.ts) cover
Federal debit/credit, footer handling, balance signs, newest-first order and account detection.
[Upload integration tests](../../apps/api/tests/integration/bank-statement-upload.test.ts)
cover wrong-shop warning, renamed duplicate, keep-repeats and skip-repeats cases.

Before certification run those tests and accept real native/scanned/encrypted PDF, spreadsheet
and image paths with AI enabled/disabled/failing; malformed/oversize input; ambiguous account;
unauthorized tenant/shop; partial overlaps; zero fresh rows and storage entitlement combinations.
Integration tests require the isolated PostgreSQL test database.

## Known gaps and next work

- Federal feed is not a working real-bank import alternative; see [Rules](bank-rules.md).
- No server import-job polling/resume contract; memory queue state is lost on reload.
- Post-storage supplier matching/flagging is outside the insert transaction; failure can leave
  a stored import even when the request fails. Verify recovery before promising atomic end-to-end import.
- Extraction fallback does not guarantee every accepted layout is parsed correctly; warnings
  and balance diagnostics must be reviewed. Spreadsheet low reconciliation alone does not invoke AI.
- Review cross-shop recovery metadata disclosure and mismatch override policy explicitly.

## Decisions and review checkpoint

Checkpoint: **2026-11-10**, source review only. Actual parser branches supersede simplified
CONTEXT/UI statements about AI fallback. Mobile parity is approved direction, not implementation.
No code, parser policy or checkpoint inventory/hashes were changed by this documentation task.
