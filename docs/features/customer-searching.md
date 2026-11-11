# Customer Searching

## Purpose and scope

The shops' **account register**, moved off a Google Sheet into the app. Staff look up a customer
by account number, name, mobile, co-applicant or area, and add new entries in the app instead of
the sheet. The sheet is imported once (in ranges) and then made view-only.

- **Menu:** Revenue → Customer Searching (`/customer-search`)
- **Feature switch:** `customer_search` (Enterprise plan)
- **API:** `/api/v1/customer-search` — module `apps/api/src/modules/customer-search/`

## Implementation status

Source-reviewed and partly runtime-verified 2026-11-10 (see Verification); not release-certified.

| Surface | Status | Evidence / limits |
|---|---|---|
| API | Implemented search/detail/create/edit/delete/import/export, plus mobile sync and safe device saves | [Routes](../../apps/api/src/modules/customer-search/customer-search.routes.ts); [sync](../../apps/api/src/modules/customer-search/customer-search.sync.ts) snapshot + change log with tombstones (2026-11-10). |
| Web | Implemented register workflows | [Screens](../../apps/web/src/pages/customer-search/); server-backed pagination, not a persistent offline register. Unchanged by the mobile work. |
| Flutter | First release implemented (Android-verified, not release-ready) | [Feature code](../../apps/mobile-flutter/lib/features/customer_search/): encrypted cached search + details, online create/edit, background updates. iOS untested; no production signing; notifications deferred. |

ERP database/API is the source of truth. Google Sheets is the initial import, not an editable
sync master. The new mobile direction is Flutter for all authorized roles, not an Expo extension.

## Business rules and invariants

### The register

The sheet's columns are
`Account Number | CUSTOMER_NAME | Address | Mobile | CO | CO_Mobile | AREA | Purchase_Date | Product | Brand | Model | Shop`.
The sheet's `ID` heading is read as **Account Number** — never call it "ID" in the UI.

- One `CustomerSearchEntry` per item bought, in the shop its Shop says. Search is tenant-wide.
- Every entry is filed under a `Customer` matched on **name + mobile** — never mobile alone,
  relatives share phones. The co-applicant (CO) is a Customer marked `isGuarantor`.
- Rows with no usable mobile get a customer of their own (phone `''`); rows with no name get none.
- New customers get the next `CUST-<n>` code from `lastCustomerCode()` (`utils/id-generator.ts`,
  numeric order per tenant — sorting the text would put `CUST-9999` after `CUST-10000`).
- The customer detail page lists a customer's entries as **Items bought**
  (`CustomerRegisterSection`), and the Customers search also matches account numbers.

### Account numbers

Read as the register writes them — `BD-1`, `CI2-421` (sub-series), `BD-406A`, `DF-738(A)`,
`BN.596`, `MJ12` — and stored uppercase with spaces removed (`''` = missing). The form picks a
series (prefix) and suggests the next number, keeping the series' separator and zero-padding
(`BD-264` → `BD-265`, `MJ009` → `MJ010`); a new series defaults to `-` (`MI-1`).

They are **not unique**: the real sheet reuses ~3,700 numbers for different people. A reused
number is allowed — create/edit without `allowDuplicate` returns **409** with
`{ nextAccountNumber, usedBy }` and the form offers **Save anyway** — and every entry sharing it is
flagged `duplicate_account`. Several items bought together are several entries with the same
number (owner decision 2026-11-11): entries with the same **person (name + mobile) and purchase
date** are one purchase (`purchaseKey`, `customer-search.issues.ts`), so they neither get the 409
nor the flag. Only another person or another date is a reuse. An entry with neither name nor
mobile is always its own purchase.

### Needs review

The sheet tolerates missing/invalid business values; an unknown Shop or an account number
longer than 30 characters makes a row invalid. Request/schema limits also apply. Each entry carries
`issues` (`text[]`, GIN-indexed; codes and labels in `REGISTER_ISSUES`,
`packages/shared-utils/src/customer-register.ts`):

`duplicate_account`, `missing_account`, `odd_account`, `missing_name`, `missing_mobile`,
`invalid_mobile`, `missing_date`, `invalid_date`, `future_date`, `co_incomplete`, `no_product_type`,
`items_unknown` (no type and Product is only a count such as `6 ITEM` — `countOnlyProduct`; shown
instead of `no_product_type`).

Unusable sheet values (a 9-digit mobile, an unreadable date) are kept in `rawValues` for whoever
fixes the entry, and cleared once it is fixed. `refreshIssues(tx, { ids, accountNumbers })`
(`customer-search.issues.ts`) recomputes an entry and every entry sharing its number on each
create / edit / delete / import. The search page has a **Needs review** tab with a count and a
problem dropdown (`GET /review-summary`; list filter `issue` = `any` or a code).

### Shops

The Shop column (shop name or code) decides each row's shop; blank → the import's default shop
(pre-selected as the shop the file names most often). Only an unknown Shop makes a row invalid.

Changing a row's Shop and re-importing **moves** the entry (status "move"); changing Shop on Edit
entry does the same. Its customer and co-applicant move too, unless they still have another entry
or a sale in the old shop (`moveCustomersWithEntry`). Real sales never move.

### Product type

`categoryId` → `ProductCategory`, the app's own product-type tree, whatever its depth.

- **In the app:** the form must pick a **leaf** type (`assertLeafType` — `isLeaf` or no active
  children). The list's type filter matches a type and every type below it (`path` prefix), or
  `none` for "No product type".
- **On import** (2026-11-11 rework): staff write Product fast — abbreviations (W/M, REF), Hindi
  words (ALMARI, GADDA, CHULA), misspellings (STEPLIZER), several items in a cell (W/M-REF) and
  counts (2 ITEM). Each row is first planned into items (`planItems`,
  [product glossary](../../apps/api/src/modules/customer-search/customer-search.product-glossary.ts)):
  - **Several items** (`,` `;` `+` `&` `--`, a spaced `/`, or a single `-`/`/` when every side is
    known; never inside W/M, DEEP-REF, JUCER/MIXER) → **one entry per item**, same account number,
    customer, co-applicant, date and shop; Brand/Model split the same way when they have that many
    parts, else copied. `product` holds the item's own text.
  - **A count** (`N ITEM/ITEN`, `ALL ITEM`) → split from Model when it lists exactly N known goods
    (`2 ITEM` + `REF WM`); otherwise one entry, no type, `items_unknown`.
  - A part is "known" only from a saved decision, the glossary or an exact type name — never a
    spelling guess.

  Each distinct item text is then read, first answer wins: **saved decision**
  (`CustomerSearchProductMapping`) → junk (no letters/digits → blank) → the tenant's **exact type
  name** (top level, plural, slug, or a unique same-named sub-type) → the built-in **glossary**
  (path such as Refrigerator › Deep Freezer; found by walking the tree, or by the last name when
  unique; a missing path is proposed as a new type under its deepest existing parent) → a close
  spelling of a top-level type → **not recognised**. With a working `OPENAI_API_KEY`, the
  preview sends the not-recognised and lookalike texts (≤300, batches of 60) to `gpt-4o-mini`
  ([product adjudicator](../../apps/api/src/modules/customer-search/customer-search.product-adjudicator.ts)):
  only the text, its row count and ≤3 Brand / Model samples, plus the type names and the same
  glossary/rules — no names, mobiles or addresses. Answers (`type`, `new` under an existing parent,
  `several`, `blank`, `unsure`) are validated against the tree; a bad answer, a failure or no key
  leaves the text as it was. `several` is never applied — the reason asks the importer to separate
  the items with commas in the row and check again.

  Everything is only **pre-filled** (`suggestion`): AI answers are pre-selected but highlighted;
  not-recognised texts default to **blank** (no longer to "create"); glossary/AI types are created
  only when the importer keeps "create" (needs `categories.create`, else 403), at the top level or
  under `parentId` (the parent's `isLeaf` turns false). Each decision is saved per text and reused
  by later ranges, so a text is decided once. Unmatched text stays in `product` with no type
  (`no_product_type`).
- **Glossary** (`PRODUCT_GLOSSARY`, built from the owner's sheet, records 21,001–59,028): one table
  feeds the matcher, the AI prompt and the import screen's "How product texts are read" panel —
  add a spelling there and all three learn it. A text listed under two types fails at startup.
- **Owner decisions 2026-11-11:** new types Refrigerator › Deep Freezer; Cooler; Stabilizer;
  Laptop; Microwave; Inverter / UPS; Heater; Fan › Table Fan / Wall Fan / Pedestal Fan;
  Furniture › Mattress / Table / Chair / Dressing Table; Mobile › Accessories; and small
  appliances at the top level (Induction Cooktop, Water Dispenser, Kettle, Trimmer, Hair Dryer,
  and the existing Iron, Mixer Grinder, Water Purifier — moved for `vn` by
  `prisma/seed/flatten-small-appliances.ts vn`, which also switched the emptied "Small
  Appliances" off). SOUND BAR → Home Theatre, BT → Speaker, JUICER → Mixer Grinder; STONE,
  SICER, M/AC, 14 AC, RED and brand-only texts (CROMPTON) are left to the AI and the importer.
- **Export:** a `Product Type` column (full path, `›`-separated) plus `Type Level 1…N`, where N is
  the deepest type in that export — shallower types leave the extra levels blank, so a deeper tree
  just adds columns. Then Shop, Customer Code and Needs review. Re-importing an export reads
  `Type Level 1` (or the path when blank) as Product.

## Access, tenancy, and shop scope

The `customer_search` tenant feature switch gates the module. Effective permissions, not
hard-coded roles, decide access. The [access rulebook](../../packages/shared-types/src/access.ts)
requires `customers.list` for register list access; create/edit/import additionally require
`customers.create` and `customers.view_phone`. No `sales.view_real` prerequisite applies.

| Permission | Shown as | Default roles |
|---|---|---|
| `nav.customer_search` | Show Customer Searching menu item | owner, admin, accountant, staff |
| `customer_search.list` / `.detail` | Search the account register / Open an entry | owner, admin, accountant, staff |
| `customer_search.create` | New entry | owner, admin, accountant, staff |
| `customer_search.edit` | Edit an entry | owner, admin, accountant |
| `customer_search.export` | Export | owner, admin, accountant |
| `customer_search.delete` | Delete an entry | owner, admin |
| `customer_search.import` | Import the sheet | owner, admin |

Current employee defaults include none of these. Mobile's intended audience does not
automatically grant them. Defaults live in
[permissions.ts](../../packages/shared-types/src/permissions.ts); existing tenants get new keys
via [permission sync](../../apps/api/prisma/seed/sync-permission-catalog.ts).
[Field access](../../apps/api/src/middleware/field-access.ts) strips `mobile`, `coMobile`,
`phone` and `rawValues` without `customers.view_phone`; absent fields must stay absent in cache.
The API caches permissions for 60 s; in-app edits invalidate immediately, scripts do not.

Routes run authentication and shop middleware, but register reads are deliberately tenant-wide,
not restricted by the active shop. An optional `shopId` filters search. Create defaults to the
current shop; selecting another shop and changing an existing entry's shop require an active
user-shop assignment. Do not apply generic shop-only mobile filtering to this register.
Detail's optional `matchingSale` is populated only with `sales.detail` plus `sales.view_real`.
Tenant-wide register access does not grant sales access.

## User workflows

### Search, details, create and edit

- Search account number, customer/co-applicant name, eligible mobile digits, area, product,
  category name, brand, model or customer code. Current API search is case-insensitive
  **substring** matching, not fuzzy/AI name search. Numeric phone matching starts at three
  digits and accepts only digit-like queries (spaces, `+`, `-` allowed).
- Filter by series, area, purchase-date range, product-type subtree or review issue; API also
  supports shop, customer and import-batch filters. Detail shows purchase, customer,
  co-applicant and import provenance; a permitted sale link is optional.
- Create requires account number, customer name, real ISO purchase date and leaf product type;
  mobile is optional, but a supplied invalid customer/co-applicant mobile is rejected.
  Prefix/next-number and same-mobile customer-match helpers assist the form.
- Edit supports partial updates and keeps an unchanged imported top-level category; a changed
  category must be an active leaf. Customer identity changes re-resolve links. A duplicate-number
  409 provides `details.nextAccountNumber` and `details.usedBy`; explicitly confirm Save anyway
  before retrying with `allowDuplicate`.
- Delete confirms first and removes only the entry; linked customers stay. Related duplicate
  flags are recomputed. Failures are shown rather than reported as success.

### Import

Page `CustomerSearchImportPage.tsx`, engine `customer-search.import.ts`.

1. **File** — .xlsx or .csv, read in the browser. CSVs are read as raw text
   (`XLSX.read(…, { raw: true })`) and dates parsed day-first, so `1/3/2021` stays 1 March.
2. **Range** — From / To record (record 1 = first row under the headings). Up to **20,000 records**
   per range (`MAX_IMPORT_ROWS`; raised from 10,000 on 2026-11-12 — the largest 20,000-row range of
   the owner's sheet is about 6 MB of JSON). The page shows which ranges of the file are already in
   (`/import/batches`) and suggests the next one.
3. **Check** (`POST /import/preview`) — each row is *new*, *already imported*, *moves shop* or
   *can't import*, with its review problems and notes ("2 items, one entry each: W/M, REF",
   "6 ITEM: 6 items, not listed"). Rows already in are matched on account number +
   name + mobile (+ date when there is no number); identical rows inside a range are skipped, so a
   range can be re-run safely. A row split into items made several entries; re-running skips them
   all, and a changed Shop moves them all. The preview opens on the **Problems** filter and lists
   500 rows at a time ("Show more"). Chips also show the entries the rows make, rows with several
   items, count-only rows and product texts not recognised.
4. **Decide** — product types (above; the table can show only the ones to check, and has the
   glossary/rules panel) and **names on the same mobile**: variants are grouped by
   edit distance, with OpenAI (`gpt-4o-mini`, names only) for borderline pairs when
   `OPENAI_API_KEY` works; the importer picks who is the same person and which spelling to keep.
5. **Import** (`POST /import`) — the **Import N entries** button sits above the preview and at the
   bottom. One transaction (300 s timeout; request body limit 25 MB; the web client waits 300 s /
   330 s) creates/links customers, creates confirmed product types, moves changed-shop rows,
   records the import batch and refreshes issues.

An earlier local observation reported roughly 1 s preview / 10 s commit for a 10,000-row range.
This review did not rerun or certify that timing.

## API contracts and data

Base `/api/v1/customer-search`. JSON uses `sendSuccess` / `sendPaginated`; list payload is
`{ success, data, pagination }`, ordinary responses are `{ success, data }`. Errors carry
`success: false` and `error`; duplicate conflicts additionally carry `details`.
`page` / `pageSize` use the shared [pagination helper](../../apps/api/src/utils/pagination.ts).
List order is purchase date descending (null last), then account number ascending; this is
not a unique stable sync cursor. Date-only values serialize as `yyyy-mm-dd` or null.

| Method | Path | Permission | Description |
|--------|------|------------|-------------|
| GET | / | list | Search (account number, name, mobile, co-applicant, area, product type) + filters incl. `categoryId` (subtree, or `none`) and `issue` (`any` or a code); tenant-wide |
| GET | /review-summary | list | Entries needing review, in all and per problem |
| GET | /sync?token=&limit= | list | Mobile on-device copy: snapshot pages, then changes and deletions (see below) |
| GET | /prefixes | list | Series in use |
| GET | /next-number?prefix= | create/edit | The next free number in a series |
| GET | /customer-matches?mobile=&name= | create/edit | Customers already on a mobile, for the form's autofill / "did you mean" |
| GET | /by-customer/:customerId | list | Items a customer bought and entries they are co-applicant on |
| GET | /:id | detail | Entry detail |
| POST, PATCH | /, /:id | create, edit | Create / edit an entry (shop selectable; a reused account number needs `allowDuplicate`) |
| DELETE | /:id | delete | Delete an entry; its customer and co-applicant stay |
| POST | /import/preview, /import | import | Sheet import, one range at a time (see Import) |
| GET | /import/batches | import | Past import ranges |
| GET | /export | export | Excel export |

The [schema](../../apps/api/prisma/schema.prisma) defines `CustomerSearchEntry`,
`CustomerSearchImportBatch`, `CustomerSearchProductMapping` and `CustomerSearchChange`. Entries
have UUID identities, tenant/shop/customer/category links, review issues, provenance, an optional
`clientRequestId`, `createdAt` and `updatedAt`. Account number is indexed but not unique.
Deletion is hard delete; the change log keeps the tombstone. Joined customer names, type paths
and customer item counts are derived values: the sync sends ids, customer codes, every shop and
every product type so the device derives them itself.

### Mobile sync contract (`GET /sync`)

Implemented 2026-11-10 in [customer-search.sync.ts](../../apps/api/src/modules/customer-search/customer-search.sync.ts)
and migration `20261110120000_customer_search_sync_log`.

- **Change capture:** a database trigger on `customer_search_entries` writes one
  `customer_search_changes` row (tenant, entry id, writer's transaction id `txid`, `I`/`U`/`D`)
  for every insert, real update and delete, in the same transaction. It therefore covers app
  saves, imports (`createMany`), issue refreshes, shop moves, scripts/backfills and FK
  `SET NULL` actions (customer or category deletion). Rows carry no entry data.
- **Bootstrap:** no `token` → the server records the start watermark (the oldest still-running
  transaction id) and returns entries in id order, `BOOTSTRAP_PAGE` = 2,000 per call. `start`
  marks the first page; `complete` the last, which also carries `reference` (`shops`,
  `categories` with `parentId`/`path`/`level`/`isLeaf`/`isActive`/`displayOrder`). The device
  keeps its previous copy until `complete`, then swaps.
- **Delta:** the next token reads changes with `(txid, seq)` after the cursor and `txid` below
  the current oldest running transaction, up to 5,000 rows; each changed id comes back as its
  current row, or in `deleted` when gone. Changes made during the bootstrap are replayed by the
  first delta. A long-running write (e.g. a big import) holds deltas back until it commits —
  correct, but deltas pause meanwhile. `more: true` means call again now; `reference` comes
  with the last page of every run.
- **Rows:** entry columns plus `purchaseDate` as `yyyy-mm-dd`, `customerCode`,
  `coCustomerCode`, `issues`, `createdAt`, `updatedAt`; `rawValues` only when the user has
  `customer_search.detail` and `customers.view_phone`. Field access removes `mobile`,
  `coMobile` and `rawValues` without `customers.view_phone` (same URL prefix).
- **Token:** opaque base64url JSON with tenant id, projection key (phones / raw values) and
  position. Replaying a token is safe (current rows, never diffs). **410** with
  `details: { reset: true, reason }` — `invalid`, `tenant`, or `projection` (what the user may
  see changed) — means download again; for `projection` the device must drop its copy first.
- **Not implemented:** change-log pruning/retention (rows grow by one per write) and so no
  "cursor too old" case yet; push of changes (the device polls).

### Safe saves from a device

- `POST /` accepts optional `clientRequestId` (UUID, unique per tenant). Repeating a save with
  the same id returns the entry already made; another user's reuse is **409**
  `details.code = 'request_reused'`. A racing duplicate is resolved through the unique index.
- `PATCH /:id` accepts optional `expectedUpdatedAt` (the `updatedAt` the editor loaded). If
  the entry changed since — including issue refreshes caused by other entries — **409**
  `details: { code: 'stale', updatedAt }`; checked again under a row lock inside the
  transaction. The web sends neither field, so its behaviour is unchanged.
- The reused-number 409 now also carries `details.code = 'duplicate_account'`.

## Web behavior

The [search screen](../../apps/web/src/pages/customer-search/CustomerSearchPage.tsx) uses
25-row pages, 300 ms debounced name/area input, URL-backed filters, All / Needs review tabs and
permission-gated actions. It sends `q` only after two trimmed characters. A line above the table
shows the total from the list's pagination ("20,976 entries in the register", or "N entries
match" with filters / Needs review). Opening a row, its Edit button or New entry passes the list
URL (tab, problem, search, page) in router state ([registerListUrl.ts](../../apps/web/src/pages/customer-search/registerListUrl.ts));
the details screen's ← Back, Delete, Edit → Cancel/Save and the form's Back return to that exact
view instead of the plain register (owner request 2026-11-12). Dragging across a cell to select
text no longer opens the row — the shared `DataTable` ignores a row click while text is
selected, in every table. All-shops mode offers
read/search but asks users to select a single shop before adding.

The [form](../../apps/web/src/pages/customer-search/CustomerSearchFormPage.tsx) handles series
suggestions, existing-person selection, category cascades, selectable shops and duplicate-number
confirmation. The [detail screen](../../apps/web/src/pages/customer-search/CustomerSearchDetailPage.tsx)
shows preserved invalid imported values only when returned by the API.
The [hook](../../apps/web/src/hooks/useCustomerSearch.ts) invalidates relevant register/customer
queries after writes; this is not cross-device persistent cache synchronization.

## Mobile behavior and differences

Approved first Flutter release: cached search and entry details **plus online create/edit**.
ERP is authoritative; no Google Sheets polling. Periodic best-effort refresh, foreground/resume
refresh and coalesced connected search-triggered refresh must include old-row edits and deletions,
not merely records after the last cached row.

Flutter must reproduce current matching/filter semantics and field permissions, preserve
date-only values and duplicate-number confirmation, and keep offline read state visibly stale.
Do not silently queue writes or retry ambiguous creates. Import/export/delete are later mobile
slices; eventual authorized web parity remains the goal.

An authorized stable snapshot + incremental change/tombstone contract exists on the API (above),
and the Flutter client below implements the first release on it.

### What the Flutter client does (implemented 2026-11-10)

Code: [lib/features/customer_search](../../apps/mobile-flutter/lib/features/customer_search/).

- **Device copy** ([register_files.dart](../../apps/mobile-flutter/lib/features/customer_search/register_files.dart),
  [register_database.dart](../../apps/mobile-flutter/lib/features/customer_search/register_database.dart)):
  SQLCipher file `register_<tenant>_<user>.db` with a random 32-byte key in platform secure
  storage per tenant + user. Tables `entries`, `staging_entries`, `shops`, `categories`, `meta`,
  plus an FTS5 **trigram** index `entry_text` (`detail = 'column'`) kept in step by triggers.
  An unreadable file (lost key, SQLite "not a database") is recreated; any other open error
  (e.g. busy) is reported and never deletes the copy. Schema changes drop and re-download the copy.
  The app and the background updater each open **their own connection**
  (`singleInstance: false`): the Android plugin keeps connections process-wide and WorkManager
  runs in the app's process, so a shared connection closed by the background run used to break
  the open app ("could not be opened: DatabaseException(database_closed)", or a stuck
  "updating…"; found on the phone 2026-11-10). If an update still finds its connection closed,
  the controller reopens the copy once and retries; a lease blocked by the other connection's
  write counts as "already updating".
  Withheld phones are stored as NULL, never as an empty number.
- **Sync** ([register_sync.dart](../../apps/mobile-flutter/lib/features/customer_search/register_sync.dart)):
  one run at a time per process and per device (a lease row shared with the background task);
  every page is applied in one transaction together with the next token, so an interrupted run
  resumes without loss or duplicates. A bootstrap fills `staging_entries` while the old copy is
  still shown, then renames it into place and gives back the space. 410 `projection` drops the
  copy at once, then downloads again; other 410s re-download behind the current copy.
- **Search** mirrors the web's `whereFor`: case-insensitive substring per field (name,
  co-applicant, area, product, brand, model, customer code), account number with spaces
  removed, mobile digits from 3 digits up, product-type name; order purchase date newest first
  (undated last) then account number; 2-character minimum. A **"Search in"** dropdown beside
  the box limits the same text to one column — **All** (default, the web's rule), Account
  number, Customer name, Mobile, Co-applicant (name, or mobile when digits are typed), Area or
  Product (product text, brand, model, type name). The phone has no Needs review / series /
  product type / shop filter chips (owner decision 2026-11-10: the search box covers them);
  the device store still supports those filters. Queries of 3+ characters use the trigram
  index (it narrows candidates, the exact column check decides); shorter ones or ones with
  `%`/`_` scan.
- **Screens** ([page](../../apps/mobile-flutter/lib/features/customer_search/customer_search_page.dart),
  [detail](../../apps/mobile-flutter/lib/features/customer_search/entry_detail_page.dart),
  [form](../../apps/mobile-flutter/lib/features/customer_search/entry_form_page.dart)):
  last-updated banner (warning when stale or the last update failed; tap to update), "Search
  in" + search box with clear button, a counts line ("20,976 entries in the register", or
  "N found of TOTAL" while searching, Indian digit grouping, plus "N need review" in red),
  50-row pages with endless scroll; a new search or column choice jumps back to the first
  (newest) row, while a background update keeps the loaded rows and position. Each row is two
  lines (owner decision 2026-11-10, simpler rows; compact type — name 14sp, account number and
  second line 12sp, then scaled by the phone's own font-size setting): customer name (bold) with the account number
  on the right; then product type (last level, else the product text) · purchase date
  (`28 Dec 2025`) · mobile (`98765 43210`, only when visible to the user); a small red dot
  (tooltip lists the problems) when the entry needs review. Shop, area, co-applicant, brand
  and model are on the details screen. Details come from the
  copy; "entered by",
  import file/rows and a permitted matching sale load online. New entry / Edit need a
  connection: series → `next-number`, existing customers on the mobile (`customer-matches`),
  product-type cascade from the cached tree (leaf for new entries; an edit may keep an imported
  or empty type), shop from the user's assigned shops. Save sends a per-form `clientRequestId`
  (create) or only changed fields + `expectedUpdatedAt` (edit); reused number → dialog with
  "Use next" / "Save anyway"; changed by someone else → the latest version is loaded with this
  person's changes on top for review; dropped connection → input kept, retry is safe. After a
  save the app syncs, so derived changes (issues, customer links) arrive the same way.
- **When it updates** ([controller](../../apps/mobile-flutter/lib/features/customer_search/customer_search_controller.dart),
  [background](../../apps/mobile-flutter/lib/features/customer_search/background_sync.dart)):
  on app start/resume, every 5 minutes while open, while searching (at most once a minute),
  after a save, and in the Android background via WorkManager (network required) at the
  interval chosen under Account → "Check for updates" (15/30/60 min or only while open). The
  background task re-checks `/auth/me` first and deletes the copy when access is confirmed gone.
- **Offline:** the app starts and searches with the last server-confirmed identity; writes are
  disabled with a "needs connection" note.

Confirmed with the owner on 2026-11-10 for the first release:

- **On-device copy:** encrypted database (SQLCipher; key in secure storage), one per tenant +
  user. Downloaded once, then kept up to date with changes — never wiped on sign-out or after
  time offline. Another user on the same phone never sees it. It is deleted only when the
  server reports the user lost Customer Searching access, and downloaded again when
  phone-number visibility changes (410 `projection`).
- **Offline:** no time limit for reading the cached register. Signing in again after the 7-day
  refresh token lapses needs a connection.
- **Updates:** Android background refresh (WorkManager, best effort) at a per-phone interval
  chosen under Account — 15 (default) / 30 / 60 minutes or only while the app is open — plus on
  opening/resume, every 5 minutes while open, and when searching (at most once a minute).
- **Freshness:** always show "last updated"; a warning banner when the last successful update is
  older than the chosen interval + 5 minutes.
- **Writes:** online only, with `clientRequestId` on create and `expectedUpdatedAt` on edit; no
  queued offline writes, no silent retries of uncertain creates.
- **Targets** (synthetic ~60,000 rows on the test Android phone): search ≤ 150 ms, first full
  download ≤ 2 min on Wi-Fi, on-device storage ≤ 60 MB, applying ≤ 1,000 changes ≤ 5 s.
- **Access:** employee defaults unchanged (no Customer Searching); grant per role or user in
  Settings. Device notifications are deferred to a later slice.

## Dependencies and cross-feature effects

- [Customers](customers.md): name + mobile linking, item lists and shop movement.
- [Products](products.md) / [Settings](settings.md): category trees, leaf selection, lookup data.
- [Sales](sales.md): optional matching ledger link; never implies finance visibility.
- [Authentication/access](authentication-and-access.md): tenant-wide read exception, field filters.
- [Mobile foundation](mobile-foundation.md): Flutter cache lifecycle and sync requirements.
- Re-import, issue refresh, customer relinks and category renames affect cached derived views;
  future delta-sync coverage must include these paths.

## Code and source references

| Area | Files |
|---|---|
| Schema | `CustomerSearchEntry`, `CustomerSearchImportBatch`, `CustomerSearchProductMapping`, `CustomerSearchChange` in `apps/api/prisma/schema.prisma`; migrations `20261109070907_add_customer_search_entries`, `20261109131458_customer_search_product_type`, `20261109155549_customer_search_review_and_duplicates`, `20261110120000_customer_search_sync_log` (change-log table + trigger, `client_request_id`) |
| API | `customer-search.{routes,controller,service,validation}.ts`; `.sync.ts` (mobile snapshot/delta), `.import.ts` (preview/commit), `.matching.ts` (name variants), `.product-types.ts`, `.issues.ts` (`refreshIssues`, `moveCustomersWithEntry`), `customer-name-adjudicator.ts` (OpenAI) |
| Shared | `packages/shared-utils/src/customer-register.ts` (account-number parsing, next number, mobile/name helpers, `REGISTER_COLUMNS`, `parseRegisterSheet`, `REGISTER_ISSUES`); `features.ts`, `permissions.ts`, `access.ts` in `packages/shared-types` |
| Web | `apps/web/src/pages/customer-search/` (Search, Form, Detail, Import, `CustomerRegisterSection`); hook `apps/web/src/hooks/useCustomerSearch.ts` |
| Flutter | `apps/mobile-flutter/lib/features/customer_search/` (models, encrypted store, sync, controller, background task, setting, screens); shell wiring in `lib/app/app_shell.dart` |
| Scripts | `apps/api/prisma/seed/backfill-customer-search-issues.ts` |
| Tests | `apps/api/tests/unit/customer-search.test.ts`; `apps/api/tests/integration/customer-search.test.ts` (CS1–CS22); `apps/mobile-flutter/test/customer_search/` (store/sync/search, screens, form); `apps/mobile-flutter/integration_test/register_perf_test.dart` (on-device timings, synthetic data only) |

Authoritative entry points:
[routes](../../apps/api/src/modules/customer-search/customer-search.routes.ts),
[controller](../../apps/api/src/modules/customer-search/customer-search.controller.ts),
[service](../../apps/api/src/modules/customer-search/customer-search.service.ts),
[validation](../../apps/api/src/modules/customer-search/customer-search.validation.ts),
[import engine](../../apps/api/src/modules/customer-search/customer-search.import.ts),
[issue derivation](../../apps/api/src/modules/customer-search/customer-search.issues.ts),
[register utilities](../../packages/shared-utils/src/customer-register.ts),
[unit tests](../../apps/api/tests/unit/customer-search.test.ts),
[integration tests](../../apps/api/tests/integration/customer-search.test.ts).

## Verification and acceptance

Source reviewed against routes/controller/service/validation, schema, web hook/screens and
test coverage references. Unit tests cover parsing/normalization; integration tests cover
imports, tenant separation, permission checks, writes and review behavior.

2026-11-10 (sync slice): `npm run test --workspace=apps/api` ran — 24 files, 334 tests passed,
including CS16–CS22: bootstrap + delta convergence with mid-bootstrap edit/insert/delete,
import/duplicate-flag/shop-move/category-deletion capture, an uncommitted older transaction not
being skipped, tenant isolation and token refusal, projection reset and raw-value omission,
idempotent create and stale-edit refusal. Web `tsc -p tsconfig.app.json` passed.

2026-11-10 (Flutter slice):

- `flutter analyze` clean; `flutter test` — 40 tests passed (synthetic data): download page by
  page, interrupted re-download keeps the old copy and resumes without duplicates, old-row
  edits / deletions / additions through changes across a dropped page, phone-visibility loss
  drops then re-downloads without phones, lease and single flight, a run left unfinished by a
  closed screen not blocking the next, an unexpected database failure ending the run instead of
  hanging, the web's search rules and each "Search in" column on both the trigram and the scan
  path, the text index following edits/deletes/re-download, the screen (download, no filter
  chips, row badges/date/mobile/review label, "Search in" → Account number, access re-check
  keeping the screen, details, Account setting, copy kept on sign-out), and the form
  (dropped connection keeps input and reuses the request id, reused number → Save anyway,
  stale edit → latest version with this person's change kept). Session/API foundation tests
  cover offline start, server refusal still blocking, and a refresh token rotated by another
  isolate being adopted.
- Phone fix found on the device (2026-11-10): resuming the app during a first download
  re-checked access, which used to replace the whole shell with a "checking" screen — closing
  the register mid-download and leaving it stuck on "Downloading…" for up to 5 minutes (lease).
  Now the shell stays during a re-check (blocked only if it fails), the lease belongs to the app
  process, and any sync error ends the run. Re-verified on the phone: the interrupted download
  resumed and completed (60,000 entries), and the redesigned rows rendered as described.
- Against a **separate synthetic database** (`retailerp_perf`, 60,000 made-up entries, dropped
  afterwards) through a second API on port 3101:
  - over HTTP, a user denied `customers.view_phone` received rows without `mobile`,
    `coMobile` or `rawValues`;
  - a repeated `clientRequestId` returned the same entry;
  - a stale `expectedUpdatedAt` got 409 `stale`.
- On the Android test phone (OPPO CPH2521, **debug** build, API over USB via `adb reverse`,
  encrypted copy), `integration_test/register_perf_test.dart` measured:

  | Measure | Result | Target |
  |---|---|---|
  | First full download, 60,000 entries in 32 pages | 25.2 s (USB, not Wi-Fi) | ≤ 2 min on Wi-Fi |
  | On-device storage | 55.6 MB | ≤ 60 MB |
  | Search p50 / p95 / max (10 kinds × 5 runs) | 83 / 142 / 159 ms | ≤ 150 ms |
  | Applying 1,000 changed rows | 1.85 s | ≤ 5 s |
  | Update with nothing changed | 0.29 s | — |

  The worst case (159 ms) was a 4-letter area search matching about 6,000 rows; broad searches
  sort every match. A full download is about 38 MB of uncompressed JSON (1.28 MB per page).
- On the same phone the real app signed in, downloaded the 60,000 entries, showed the list,
  searched ("kumar" → 6,354 entries) and opened the New entry form. A full create/edit
  through the phone UI was not driven (simulated taps lag on this device); the widget tests and
  the HTTP check above cover that path.

2026-11-10 (row/header/module slice): `flutter analyze` clean; `flutter test` — 44 tests
passed, adding the owner vs non-owner module list (others see only Installments and Customer
Searching; plan/permissions still apply; `mobile_app` off → none), Indian digit grouping, and
the screen's counts line ("2 entries in the register", "need review", "found of 2"), two-line
row and review-dot tooltip. Scroll-to-top on a new search is by source inspection only (the
widget test has two rows). Web `tsc -p tsconfig.app.json` passed with the total line above the
table.

2026-11-11 (background/foreground connection fix): on the phone (debug build, the owner's dev
server), a scheduled WorkManager update ran in the app's own process while the register was
open; with the old build the open app's next update then hung on "updating…" (and, as reported,
failed with `database_closed`); the cause is the plugin's process-wide connection sharing (see
Device copy). With the fix, a scheduled background run (01:12, same process id as the open app)
was followed by a successful resume update and tap-to-update in the same session. A forced
`cmd jobscheduler run` does not reproduce it — WorkManager declines to run periodic work early.
`flutter test` — 45 passed, including a controller test that closes the copy under the open
app and expects a reopen + successful update (it fails with the reopen disabled), and the sync
result reporting `closed`.

2026-11-11 (product glossary, items, AI suggestions):

- `npm run test --workspace=apps/api` — 24 files, 344 tests passed. Unit CS7b reads every
  Product text of records 21,001–59,028 against the owner's tree and checks the agreed result
  (glossary, new type, split, count, AI-only), Model-based splits, Brand/Model splitting, no
  split inside one product, saved decisions enabling a split, glossary consistency, AI answer
  validation and the prompt. Integration CS23: a split row → two entries under one customer
  with split Brand/Model and no reused-number flag, a count row → `items_unknown`, a sub-type
  created under its parent (parent no longer a leaf), the item count, a hand-entered item of the
  same purchase without a 409 and another person's with one, re-import skipping and a Shop change
  moving all items. CS4/CS21 now use another date for their reuse checks; CS6 uses texts the
  glossary doesn't know. Web `tsc -p tsconfig.app.json` and `flutter analyze` passed.
- Dry-run preview of records 21,001–31,000 against the dev database (nothing saved; name AI off
  for the run so no customer names were sent): 98 distinct texts → 83 glossary, 9 exact type
  names, 6 not recognised (14 AC, CROMPTON, M/AC, RED, SICER, STONE) plus `------` blank;
  14 new types proposed (the agreed list, previously 99); 12 rows split (10,001 entries from
  9,987 rows); 18 count-only rows flagged. The AI step could not be verified: OpenAI answered
  429 `insufficient_quota` ("no credits remaining") — the name adjudicator is affected too.
  The UI screens were not exercised in a browser.

Acceptance must cover shared-mobile relatives, duplicate 409/confirmation, no-mobile entries,
invalid dates/mobile, category hierarchy, forbidden shop, cross-tenant IDs, restricted phones,
review updates, missing entry, save failure, and preserving customers on deletion. Flutter
additionally needs interrupted snapshot/delta, old-row edits, hard deletes, identity changes,
permission downgrades and measured approximately 58,000-row cache/search performance.

### Cutover from the Google Sheet (one time)

1. Add a `Shop` column (shop name or code per row; blank = the import's default shop), then
   download as .xlsx or .csv.
2. Customer Searching → **Import the sheet**: pick a range of up to 20,000 records, check, confirm
   the product types (and which new ones to create), decide the name groups, import. Repeat with
   the suggested next range. Work through the **Needs review** tab afterwards.
3. When every range is in, set the sheet to view-only and have staff use **New entry** instead.
4. Once per database (already done on the local dev DB; the app is not deployed yet), run in
   `apps/api`: `npx tsx prisma/seed/sync-permission-catalog.ts` and
   `npx tsx prisma/seed/backfill-customer-search-issues.ts`.

## Known gaps and next work

- **OpenAI key has no credits** (seen 2026-11-11): product-type and name suggestions silently fall
  back (glossary / edit distance) until billing is topped up. The product AI was never run
  successfully, so its prompt is untested against the live model.
- Rows already imported (records 1–21,000) have no Product text, so the glossary can't type them;
  an AI's "several items" answer is shown, not applied (the importer edits the row). Two sheet
  rows with the same account number + name + mobile but different products are still treated as
  the same row (one such case in the whole sheet).
- **Not verified on a device yet:** iOS build/Keychain/background; a release (non-debug)
  build's timings; the first download over Wi-Fi rather than USB. (The Android WorkManager
  update was observed running on the phone on 2026-11-10/11 — see Verification.)
- **Recommended:** HTTP response compression on the API (e.g. `@fastify/compress`, a new server
  dependency — needs approval). A first download is ~38 MB of JSON; Dart's HTTP client already
  accepts gzip, so no app change would be needed.
- Change log has no pruning/retention policy yet (and so no "cursor too old" reset); long-running
  write transactions (a big import) pause deltas until they commit.
- Mobile import/export/delete, a Needs review / series / type / shop / date filter on the phone
  (removed by owner decision; the store supports them), and choosing an existing
  co-applicant on the phone form are later slices (the server still links the co-applicant by
  name + mobile).
- Device notifications are deferred (needs an FCM/Firebase project).
- Existing list pagination is for interactive web search, not a bulk sync protocol — use `/sync`.
- Web next-number query currently enables only 1-2-letter prefixes, while the API accepts 1-3
  letters plus an optional digit. Flutter uses the API's rule; a web fix is separate.
- The web edit form does not send `expectedUpdatedAt`, so two web editors still overwrite each
  other (unchanged behaviour); only device edits are version-checked.

## Decisions and review checkpoint

2026-11-10: Flutter from scratch, all authorized roles, eventual full parity. Customer Searching
is first, including cached reads and online create/edit. ERP is the sole master; Sheets is
initial import only.
2026-11-10 (feature chat): owner approved the trigger-based change log + snapshot/delta sync,
encrypted per-user device copy that is kept (not wiped) except on lost access, no offline time
limit, per-phone 15/30/60-minute background refresh, stale banner at interval + 5 min, the
performance targets above, idempotent create and version-checked edit, unchanged employee
defaults, notifications deferred. API and Flutter first release are implemented and measured
against those targets (see Verification).
Review file inventory and hashes are in [checkpoints.json](checkpoints.json).
