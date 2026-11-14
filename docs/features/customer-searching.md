# Customer Searching

## Purpose and scope

The shops' **account register**, moved off a Google Sheet into the app. Staff look up a customer
by account number, name, mobile, co-applicant or area, and add new entries in the app instead of
the sheet. The sheet is imported once (in ranges) and then made view-only.

- **Menu:** Revenue → Customer Searching (`/customer-search`)
- **Feature switch:** `customer_search` (Enterprise plan)
- **API:** `/api/v1/customer-search` — module `apps/api/src/modules/customer-search/`

## Implementation status

Source-reviewed and partly runtime-verified, last on 2026-11-14 (see Verification); not release-certified.

| Surface | Status | Evidence / limits |
|---|---|---|
| API | Implemented search (all fields, or one column exactly) / detail / create (several products per save) / edit / delete / import / export, mobile sync and safe device saves, form helpers (next number, areas, customer names, type → brand → model lookups) | [Routes](../../apps/api/src/modules/customer-search/customer-search.routes.ts); [sync](../../apps/api/src/modules/customer-search/customer-search.sync.ts) snapshot + change log with tombstones (2026-11-10); list order and helpers 2026-11-12/13. |
| Web | Implemented register workflows | [Screens](../../apps/web/src/pages/customer-search/); server-backed pagination and sorting (newest purchase first), not a persistent offline register. |
| Flutter | First release implemented, kept level with the web's register form and search (Android-verified, not release-ready) | [Feature code](../../apps/mobile-flutter/lib/features/customer_search/): encrypted cached search (all fields or one column exactly) + details, online create/edit with several products, background updates. Phones need the current build (older builds can't find `MN 1`-format numbers). iOS untested; release signing ready but no release build installed yet ([deployment](deployment-and-release.md)); notifications deferred. |

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

**One format** (owner decision 2026-11-12): the series, a space, the number — `BD 12`.
A series is **2 or 3 letters, optionally followed by one digit** (owner request 2026-11-12): a
new register of the same letters is numbered `CK2` (so `CK 15` and `CK2 15` are different
accounts, listed as separate series), and `ABC 7` is a 3-letter series.
`formatAccountNumber` / `parseAccountNumber` (`packages/shared-utils/src/customer-register.ts`)
write `BD-12`, `BD12`, `bd.012`, `BD - 12` and a stray trailing mark (`DB-513.`, ``BQ-418` ``) as
`BD 12`, and `ck2-15` / `CK2 015` as `CK2 15`, on import, create and edit, so re-importing the
sheet still matches existing rows. A series digit is recognised only when a separator follows it:
`CK215` reads as `CK 215`. Any other shape (`BK-73A`, `DF-738(A)`, `DE-452,53`, one or four
letters) is kept as written (upper case, no spaces), has no series number and is flagged
`odd_account` for a person to fix. New series must follow the same rule (`isValidAccountPrefix`;
the API's `next-number` refuses others); the next number is the series' highest + 1 (`BD 264` →
`BD 265`, a new series starts at `BD 1` / `CK2 1`). Search on web, Customers and the phone uses
`accountSearchText`: `bd-12`, `bd12` and `BD 12` all find `BD 12`, `ck2-15` finds `CK2 15` (plus
a raw match for odd shapes). A dry run of the standardiser after this change (41,078 entries)
converted nothing new: no stored odd number had the digit-series shape.

`prisma/seed/standardise-account-numbers.ts` (dry run; `--apply`) converted the dev DB on
2026-11-12: 30,808 rewritten (155 had leading zeros, e.g. `BD-007` → `BD 7`; no two numbers
collided), 167 left unusual and flagged (161 with a trailing letter such as `BK-73A`, and
`DE-452,53`, `DE-453,54`, `DE-515,16`, `BL-528,35`, `BL-536,40` — the owner fixes these by
hand). `DH-306-406` (one customer, 101 items) was expanded into entries `DH 306`…`DH 406` with the
same customer, date and shop and a blank product / brand / model. Re-importing that sheet row
would add it again as a new odd-shaped entry.

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

- **In the app:** the form must pick a product type, at **any level** — the sub-type is optional
  (owner decision 2026-11-12; `assertType` only checks it is an active type of this tenant, and the
  web cascader runs with `allowNonLeaf`, so "Select subcategory…" keeps the level above). The
  list's type filter matches a type and every type below it (`path` prefix), or
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
  just adds columns. Then Shop, Customer Code, Needs review, `Mobile 2` and `CO_Mobile 2`. Re-importing an
  export reads `Type Level 1` (or the path when blank) as Product; the import ignores the two
  second-mobile columns.
- **Second mobiles** (owner request 2026-11-13): an entry may hold one more number for the customer
  (`altMobile`) and one for the co-applicant (`coAltMobile`), migration
  `20261112202605_customer_search_second_mobiles`. Each must be a valid 10-digit Indian mobile;
  the same as the first number is stored as none. They are searched like the first number (web
  list, phone search and Mobile / Co-applicant search fields), copied to the other items of the
  same save, shown on details and exported, but **never used to match or link a customer** —
  that stays name + first mobile.
- **More addresses** (owner request 2026-11-13): up to 3 addresses per person — `address` plus
  `moreAddresses` (≤ 2) for the customer, and, new, `coAddress` plus `coMoreAddresses` (≤ 2) for the
  co-applicant (migration `20261113135513_customer_search_more_addresses`). Blanks, repeats and a copy
  of the main address are dropped; they are copied to the other items of the save, shown on details
  and exported (`More addresses`, `CO_Address`, `CO more addresses`, joined with ` | `). Not searched.

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
[Field access](../../apps/api/src/middleware/field-access.ts) strips `mobile`, `altMobile`, `coMobile`,
`coAltMobile`, `phone` and `rawValues` without `customers.view_phone`; absent fields must stay absent in cache.
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
  digits and accepts only digit-like queries (spaces, `+`, `-` allowed). That is **All fields**,
  the default of the **"Search in"** dropdown (owner request 2026-11-13, web and phone alike).
  Choosing one column — Account number, Customer name, Mobile, Co-applicant, Area, Product type,
  Brand, Model or Customer code (API `field` = `account` | `name` | `mobile` | `coApplicant` |
  `area` | `product` | `brand` | `model` | `customerCode`) — finds entries whose value is
  **exactly** the text, ignoring case and extra spaces: `mn 1` finds MN 1 only, not MN 10…MN 199
  (111 entries with All fields). A mobile must be the full 10 digits and matches either number of
  the person; Co-applicant takes a name or a 10-digit mobile; a product type includes its
  sub-types (or the product text as written); a brand matches one make of a several-make cell
  (`LUMINOUS` finds `TRUFAST, LUMINOUS`; the API also maps misspellings, the phone doesn't). Exact
  search takes any length; All fields waits for 2 characters. The web keeps the choice in the
  URL (`in`), with a hint under the box; the phone's hint reads "Exact …".
- Filter by series, area, purchase-date range, product-type subtree or review issue; API also
  supports shop, customer and import-batch filters. Detail shows purchase, customer,
  co-applicant and import provenance; a permitted sale link is optional.
- Create requires account number, customer name, real ISO purchase date and a product type (any
  level); mobile is optional, but a supplied invalid customer/co-applicant mobile is rejected.
  Prefix/next-number and same-mobile customer-match helpers assist the form.
- Edit supports partial updates and keeps an unchanged imported category; a changed category
  must be an active type of the tenant. Customer identity changes re-resolve links. A duplicate-number
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
List order is purchase date descending (null last), then account number ascending — always, unless
`sort` asks for another column (owner rule 2026-11-13). The order is kept in the database by the index
`(tenant_id, purchase_date DESC NULLS LAST, account_number)` (migration
`20261113134508_customer_search_purchase_date_order`), so the first page is read straight off it
(0.2 ms instead of sorting all ~41,000 entries, 105 ms, on the dev DB). `sort` = `purchaseDate` |
`accountNumber` (series, number) | `customerName` (alias `customer`) | `area` | `shop`, `dir` = `asc` |
`desc`; unknown values fall back to newest first, and every other column breaks ties newest first.
This is not a unique stable sync cursor. The Excel export stays in account-number order (the
sheet's order). Date-only values serialize as `yyyy-mm-dd` or null.

| Method | Path | Permission | Description |
|--------|------|------------|-------------|
| GET | / | list | Search `q` (all fields, or with `field` one column exactly — see Search above) + filters incl. `categoryId` (subtree, or `none`) and `issue` (`any` or a code); `sort` / `dir` (default newest purchase first); tenant-wide |
| GET | /review-summary | list | Entries needing review, in all and per problem |
| GET | /sync?token=&limit= | list | Mobile on-device copy: snapshot pages, then changes and deletions (see below) |
| GET | /prefixes | list | Series in use |
| GET | /areas | list | Areas in use for the form's type-or-pick Area field: `{ area, count }`, case variants merged into capitals, values without two letters in a row dropped, most used first; tenant-wide |
| GET | /next-number?prefix= | create/edit | The next free number in a series |
| GET | /customer-matches?mobile=&name= | create/edit | Customers already on a mobile, for the form's autofill / "did you mean" |
| GET | /customer-names?q= | create/edit | Names of existing customers containing the text (2+ letters): `{ name, count }`, each name once, starting matches first, at most 20. Picking one only fills the name |
| GET | /by-customer/:customerId | list | Items a customer bought and entries they are co-applicant on |
| GET | /:id | detail | Entry detail |
| POST, PATCH | /, /:id | create, edit | Create / edit an entry (shop selectable; a reused account number needs `allowDuplicate`). Several products in one save: create takes `quantity` for its own item and `moreItems: [{ categoryId, brand?, model?, quantity }]`; edit takes `moreItems`. Each unit becomes its own entry with the same account number, customer, co-applicant, date and shop, in one transaction (≤100 per row, ≤200 per save); the response is the first/edited entry plus `itemsSaved` |
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
25-row pages, newest purchase first, 300 ms debounced name/area input, URL-backed filters and
sort (`sort` / `dir`; clicking a header re-sorts the whole register on the API, not just the
page shown — 2026-11-13), All / Needs review tabs and
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
confirmation. Products sit in an **Items** table ([ItemsTable](../../apps/web/src/pages/customer-search/ItemsTable.tsx),
owner request 2026-11-12): a spreadsheet-style row per product — type (any level, picked by full
path such as `Refrigerator › Deep Freezer`, or "+ New type…"), brand, model, Qty — with Add item,
Duplicate row and Remove row, and a count of the entries the save makes. On Edit, row 1 is the
entry itself (Qty fixed at 1, can't be removed) and added rows become new entries under the same
account. Cancel and Save sit both in the page header and at the bottom (the header button
submits the form by id), and a save error is shown above the form and above the bottom buttons
(owner request 2026-11-12). The account number is tidied to `BD 12` when the field loses focus.
The purchase date uses the shared `DateInput` (owner request 2026-11-12): typed or pasted as
dd/mm/yyyy (also yyyy-mm-dd or "5 Mar 2025"), taken as soon as it is a whole real date, with a
calendar button; text that isn't a date stays visible with "Not a date…" below it. An invalid
customer or co-applicant mobile shows "Enter a 10-digit mobile number starting with 6, 7, 8 or 9"
under its box (Save stays disabled until fixed or emptied). "New series…" takes up to 4
characters (`BD`, `CK2`, `ABC`) and says what is allowed while the text isn't a valid series.
**Area** is type-or-pick (owner request 2026-11-12, compact list 2026-11-13): the shared
[SuggestInput](../../apps/web/src/components/SuggestInput.tsx) dropdown — not the browser's
`<datalist>` popup, which was too long and mixed in saved addresses — listing every area already
in the register (`GET /customer-search/areas` — spellings differing only in case merged,
values without two letters in a row, such as a mobile shown as `9.91E+09`, left out, most used
first), narrowing as you type (start matches first, 50 rows, "type to narrow"); a new area
can be typed, and the text is trimmed and put in capitals when the box loses focus.
**Customer name** is also type-or-pick (2026-11-13): after 2 letters it lists names of existing
customers containing the text (`/customer-names`, each name once with "N customers"); picking one
only fills the name — mobile, address, area and the customer link come from the mobile matches
under Mobile, as before (owner decision: name + mobile decide the person). **Mobile** and
**Co-applicant mobile** each have "+ Add another number", which opens a second box with a remove
button; an invalid second number, or one without a first number, shows an error and blocks Save.
Address and Co-applicant address each have "+ Add another address" (up to 3 in all, each extra
removable; the link waits for the first address). In the list, a person with two mobiles shows the
first and "+1 more ▾" under it; the menu (drawn above the page so the narrow column and the
table's scroll box can't cut it off) lists both, and clicking one copies it without opening the
entry. The phone row shows "98765 43210 +1"; its details screen lists every number and address.
**Brand** and **Model** in the Items table are the same kind of dropdown, tied to the row's
product type: Brand lists only that type's makes, Model only that make's models within the type
(`/lookup/brands`, `/lookup/models` — see [Products](products.md) for the catalog). A new brand
or model can be typed and joins the lists when saved. The API writes known misspellings one way
(`canonicalBrand`: `whirlphool` → `WHIRLPOOL`, `TRU/LUM` → `TRUFAST, LUMINOUS`) on create, edit
and import; `build-brand-catalog.ts --apply` corrected 1,296 existing entries (2026-11-13, owner
approved the merge list; ambiguous `LIV`, SAVITA, SUNITA, ASHU, SADI left as written).
The [detail screen](../../apps/web/src/pages/customer-search/CustomerSearchDetailPage.tsx)
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
  (e.g. busy) is reported and never deletes the copy. Local schema version 6: a version 4 or 5
  copy gains the new columns (second mobiles; more and co-applicant addresses) in place and
  downloads a fresh copy in the background while the old one stays on screen; any older layout
  is dropped and downloaded again.
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
  co-applicant, area, product, brand, model, customer code), account number as typed any way
  (`accountSearchText`: `mn1` / `mn-1` → `MN 1`), mobile digits from 3 digits up (either number), product-type name; order purchase date newest first
  (undated last) then account number; 2-character minimum. A **"Search in"** dropdown beside
  the box offers the web's list — **All fields** (default, the web's anywhere rule), Account
  number, Customer name, Mobile, Co-applicant, Area, Product type, Brand, Model, Customer code —
  and a column finds its exact value, as on the web (2026-11-13; one column is checked by
  equality on the copy, without the trigram index). The phone has no Needs review / series /
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
  (`28 Dec 2025`) · mobile (`98765 43210`, `+1` when there is a second number; only when visible to the user); a small red dot
  (tooltip lists the problems) when the entry needs review. Shop, area, co-applicant, brand
  and model are on the details screen, as are second mobiles and every address. Details come from the
  copy; "entered by",
  import file/rows and a permitted matching sale load online. New entry / Edit need a
  connection (Save at the top as well as the bottom, 2026-11-13): Quantity for the form's product
  and "Add another item" cards (type by full path, Brand/Model suggested per type and make,
  Qty, Duplicate, Remove) sent as `quantity` / `moreItems` like the web's Items table, with "N
  entries will be saved…" (an edit adds new entries the same way); an invalid mobile reads "Enter a
  10-digit mobile number starting with 6, 7, 8 or 9"; series → `next-number` (2–3 letters plus an optional digit, as on the web), a
  type-or-pick Customer name (`customer-names`; picking fills only the name), "Add another number"
  under Mobile and Co-applicant mobile (second numbers; shown on details, searched in the copy), existing
  customers on the mobile (`customer-matches`), Area suggestions from the cached copy (case
  variants merged, most used first; a new area can be typed), Brand and Model suggestions for the
  chosen type and make from `/lookup/brands` and `/lookup/models` (online, like the rest of the form),
  product-type cascade from the cached tree (any level for new entries, "Sub-type (optional)"; an
  edit may keep an imported
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

2026-11-12 (series with a digit / 3 letters, Area type-or-pick):

- Unit `customer-search.test.ts` (39 passed): `ck2-15` → `CK2 15`, `ABC-7`, `ABC2.7`, `CK215` →
  `CK 215`, `ABCD-421` stays odd, valid/invalid prefixes. Integration
  `tests/integration/customer-search.test.ts` (25 passed) incl. CS25: next numbers for `CK2` /
  `ABC`, `CK` and `CK2` listed as separate series, `/areas` merging `Khora`/`KHORA ` and dropping
  `9.91E+09`. Web `tsc -p tsconfig.app.json` passed; `flutter analyze` clean, `flutter test`
  passed (register test adds `accountSearchText` and `areas()` cases).
- Browser check on the dev server (ve_admin1): New series `CK2` → `CK2 1`, `ABC` → `ABC 1`, `BD` →
  `BD 1057`; Area offered 172 areas (KHORA, NOIDA, DELHI…); `  new   colony ` became `NEW COLONY`
  on blur. The phone form was not run on a device.

2026-11-13 (compact Area list, type → brand → model dropdowns):

- `npm run test --workspace=apps/api` — 25 files, 352 tests passed: unit `brand-names.test.ts`;
  integration CS26 (brands per type family, models per make found through a misspelling,
  learning on create/edit) and CS23/CS24 now expecting `WHIRLPOOL` for `WHIRL`/`Whirlpool`;
  CS25's area rule now needs two letters in a row, so `9.91E+09` is really dropped (the earlier
  "any letter" rule let it through via the `E`). Web `tsc -p tsconfig.app.json` passed;
  `flutter analyze` clean, `flutter test` 46 passed.
- Browser check (ve_admin1): Area "kh" → KHORA, KHORA COLONY, KHODA… with no number values;
  Items row Refrigerator → brands Bosch, Godrej, Haier, LG, LIEBHERR, Samsung, VOLTAS, Whirlpool;
  LG → 93 models (50 shown). The phone form was not run on a device.

2026-11-13 (second mobiles, name list):

- `npm run test --workspace=apps/api` — 25 files, 354 tests passed, incl. CS27 (names found by any
  part, each once with a count) and CS28 (second mobiles saved, normalised, the same as the first
  dropped, copied to more items, searchable, invalid one refused). Web `tsc` passed; `flutter
  analyze` clean, `flutter test` passed incl. a version-4 → 5 copy upgrade test (columns added in
  place, second number searchable) and a second-mobile search.
- Browser check: "ramesh ku" → "RAMESH KUMAR · 26 customers", "RAMESH KUMAR NISHAAD"…; picking
  kept the typed mobile and left the customer unlinked; second mobile `12345` showed the error and
  disabled Save. The phone was not run on a device; installed phones upgrade their copy in place.

2026-11-13 (purchase-date order): 355 API tests passed incl. CS29 (newest first, undated last,
other columns and a bad `sort` value). `EXPLAIN ANALYZE` of the first page uses the new index.
Browser: the register opens at 12/11/2026, 27/10/2026…; the Purchase date header gives 02/02/2021
first and back. The phone copy already orders by `purchase_date DESC` (undated last); unchanged.

2026-11-13 (more addresses, mobile dropdown): 356 API tests passed incl. CS30 (3 addresses each,
tidied, copied to more items, edited, a 4th refused). Web `tsc` passed; `flutter analyze` clean,
`flutter test` 48 passed incl. version 4 → 6 and 5 → 6 copy upgrades (columns added in place, rows
kept, cursor cleared so a fresh copy downloads in the background — rows synced by the old app lacked
the new fields). Browser: CK2 642 shows +91 70530 8… / "+1 more", menu lists both numbers; the edit
form offers Address 2 and 3 and a co-applicant address (not saved).

2026-11-13 (Search in, phone parity): API integration CS31 (each column's exact match, All fields
unchanged, unknown `field` = All); full API suite 357 passed. Web `tsc` passed; browser: `mn 1` → 111
entries with All fields, 1 (MN 1) with Account number. `flutter analyze` clean, `flutter test` 49
passed: exact matches per column on the copy (`bd 1` no longer finds BD 12/13; `tv` includes LED TV)
and a new-entry test saving Quantity 2 plus a Fridge item × 3 (one POST with `quantity` and
`moreItems`, "5 entries will be saved").

2026-11-14 (device): the OPPO CPH2521 still had a 2026-11-11 build and found no `MN 1` (it searched
`MN1`); its total of 51,053 matched the database (about 10,000 rows imported on 2026-11-13). The
current debug build (`--dart-define=API_BASE_URL=http://<LAN IP>:3001`) was installed from the
phone's browser; the owner confirmed `MN 1` is found with "Search in" → Account number. Other new
phone screens were not exercised on the device.

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
- **Compression:** decided at the hosting layer, not in the API — the hosted stack's Caddy proxy
  compresses responses with zstd/gzip (verified in a local sandbox). A first download is ~38 MB of
  JSON uncompressed; Dart's HTTP client already accepts gzip, so no app change was needed. Local
  development (no proxy) stays uncompressed.
- Change log has no pruning/retention policy yet (and so no "cursor too old" reset); long-running
  write transactions (a big import) pause deltas until they commit.
- Mobile import/export/delete, a Needs review / series / type / shop / date filter on the phone
  (removed by owner decision; the store supports them), and choosing an existing
  co-applicant on the phone form are later slices (the server still links the co-applicant by
  name + mobile).
- Device notifications are deferred (needs an FCM/Firebase project).
- **Phone builds must be current.** Builds from before 2026-11-12 search for `MN1` and can't find
  numbers stored as `MN 1` (seen on the OPPO CPH2521 2026-11-14, fixed by installing the current
  build); the second test phone (CPH2495) still has an old build. There is no in-app update prompt.
- Phone purchase date uses the date picker (its pencil button allows typing); no paste as on the web.
  The phone's exact Brand search does not map misspellings (the API does), and exact column search
  on the copy is a scan, not indexed.
- USB installs to the test phone keep dropping; serving the debug APK over the LAN and installing
  from the phone's browser worked (2026-11-14).
- Existing list pagination is for interactive web search, not a bulk sync protocol — use `/sync`.
- Existing Area values are not rewritten: `khora` and `KHORA` stay as stored (the suggestion list
  merges them; search is case-insensitive). New/edited entries get capitals on the web form.
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
2026-11-12/13 (owner): account numbers written `BD 12` (series 2–3 letters plus an optional register
digit, e.g. `CK2`); several products per save; sub-type optional; type-or-pick Area, Customer name
(fills the name only), Brand and Model (per type → brand catalog, misspelt makes merged); a second
mobile and up to 3 addresses per person (co-applicant included); the register always newest
purchase first; "Search in" a column finds its exact value, "All fields" stays the default;
the phone gets every web change.
Review file inventory and hashes are in [checkpoints.json](checkpoints.json).
