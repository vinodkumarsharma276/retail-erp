# RetailERP -- Full System Context Document

> Last updated: 2026-11-01 (sections 1–11 and 13–15 refreshed against the code)
> Purpose: Comprehensive context for LLMs working on this codebase.
> Agent rules, commands and conventions live in [AGENTS.md](../AGENTS.md) — read that first.
> Every local login is in [DEV_LOGINS.md](./DEV_LOGINS.md).

---

## 1. What Is RetailERP?

RetailERP is a full-stack web + mobile application that replaces Tally and Marg accounting software for 4 retail electronics/furniture/mobile shops in India. Each shop operates under a separate GST entity. It has since grown into a **multi-tenant SaaS**: each business is a tenant on its own subdomain with a subscription plan that switches modules on/off, managed from a separate platform-admin console. The system handles:

- **Multi-tenancy (SaaS)**: tenants, plans and per-tenant feature switches; platform-admin console for onboarding
- **Multi-shop management** with shop switching for admins
- **Product inventory** with hierarchical categories and dynamic attributes
- **Purchase recording** from distributors with GST tracking
- **4 sale types**: Full Payment, Partial with Promise, Self Finance (installment), Company Finance (NBFC)
- **Dual sale recording**: Real data (admin/accountant) vs sanitized data (staff who must never see installment info)
- **Installment tracking** with EMI schedules, payment collection, rescheduling
- **Invoice PDF generation** (standard Indian GST tax invoice)
- **GST-inclusive pricing** with Input Tax Credit (ITC) profit calculations
- **Inter-shop transfers** (GST entity to entity)
- **Expenses, bank statements** (AI-assisted statement analysis/categorisation, bank API feeds), legacy reconciliation
- **OCR**: distributor-invoice scanning into the purchase form, handwritten sale-register parsing
- **Purchase imports** from Tally purchase registers and spreadsheets (incl. unbilled purchases)
- **DB-driven dynamic forms** (admin can modify form fields without code deploy)
- **Custom roles & per-user permissions**, field-level hiding of sensitive data
- **Employee mobile app** for field installment collection

### Tenants and shops (seed data)

| Tenant | Subdomain | Plan | Shops |
|--------|-----------|------|-------|
| Vinod Electronics | `vn` (default for `localhost`) | Enterprise | VE Vinod Electronics · NE Naveen Electronics · VHA Vinod Home Appliances · NHE New Harshita Electronics |
| Star Electronics (demo) | `star` | Standard | SE Star Electronics · SM Star Mobiles |

---

## 2. Tech Stack

### Backend (apps/api)
- **Runtime**: Node.js 22 LTS
- **Framework**: Fastify 5.3
- **ORM**: Prisma 6.6 with PostgreSQL 16
- **Validation**: Zod 3.24
- **Auth**: JWT (access token 1hr + refresh token 7d), bcryptjs
- **Jobs**: node-cron (installment promise resolution, bank feeds) — only when `ENABLE_SCHEDULER=true`
- **AI**: OpenAI SDK (invoice/register OCR, bank-statement categorisation); disabled without `OPENAI_API_KEY`
- **Tests**: Vitest (`tests/unit`, `tests/integration` against a separate `retailerp_test` DB)
- **Language**: TypeScript (ES2022 target, ESM modules)

### Frontend Web (apps/web)
- **Framework**: React 19 with TypeScript
- **Build**: Vite 6
- **Styling**: TailwindCSS 4 + shadcn/ui (CSS variables, class-based dark mode)
- **State (server)**: TanStack Query (React Query) v5
- **State (client)**: Zustand 5 (7 stores: auth, platform-auth, tenant, shop, preferences, sidebar, toast)
- **PWA**: vite-plugin-pwa (dev server on port 5180)
- **Forms**: react-hook-form 7
- **Charts**: Recharts 2
- **PDF**: @react-pdf/renderer (lazy-loaded)
- **Icons**: lucide-react
- **Routing**: react-router-dom 7

### Frontend Mobile (apps/mobile)
- **Framework**: React Native with Expo SDK 52+
- **Routing**: Expo Router (file-based)
- **Storage**: expo-secure-store
- **Screens (implemented)**: login, collections list/detail, record payment, profile
- **Push**: expo-notifications (planned; API has token-registration stubs)

### Shared Packages
- **@retailerp/shared-types**: TypeScript interfaces/enums shared across all apps
- **@retailerp/shared-utils**: EMI calculator, validators (phone/GST/PAN/Aadhaar), formatters (INR currency, dates), constants

### Infrastructure
- **Monorepo**: Turborepo with npm workspaces
- **Database**: PostgreSQL 16 (Docker for local, Azure Flexible Server for prod)
- **CI/CD**: GitHub Actions (build + deploy on push to main)
- **Hosting**: Azure App Service (API) + Azure Static Web Apps (frontend)
- **IaC**: Azure Bicep templates in `infra/azure/`

---

## 3. Project Structure

```
retail-erp/
├── package.json              # Root workspace config (npm workspaces + turborepo)
├── turbo.json                # Turborepo task pipeline
├── tsconfig.base.json        # Shared TypeScript config
├── docker-compose.yml        # PostgreSQL 16 for local dev
├── AGENTS.md                 # AI agent instructions (CLAUDE.md imports it)
├── .claude/skills/           # Shared agent skills (committed)
├── docs/
│   ├── CONTEXT.md            # This file
│   ├── DEV_LOGINS.md         # Local logins per tenant/role
│   ├── adr/                  # Architecture decisions (0001 installment model)
│   └── *.md                  # Plans: OCR, deployment, UI, sale-form redesign
│
├── apps/
│   ├── api/                  # Fastify backend
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   ├── .env.example
│   │   ├── prisma/
│   │   │   ├── schema.prisma     # 57 models, 16 enums
│   │   │   ├── migrations/       # 30 migrations
│   │   │   └── seed/             # index.ts + bootstrap/backfill/repair scripts
│   │   └── src/
│   │       ├── index.ts          # Server entry point
│   │       ├── app.ts            # Fastify setup, tenant context, registers 23 modules (feature-gated)
│   │       ├── config/           # env config, tenant-scoped Prisma client, tenant context (AsyncLocalStorage)
│   │       ├── jobs/             # installments + bank-feed schedulers, resolve-promises job
│   │       ├── middleware/       # tenant-resolver, auth, platform-auth, permissions, feature-gate,
│   │       │                     # field-access, rbac, shop-scope, validate, error-handler
│   │       ├── modules/          # 23 API modules (see Section 6)
│   │       ├── utils/            # ID generator, pagination, response helpers, tenant-scope
│   │       └── types/            # Fastify request augmentation
│   │   ├── tests/                # Vitest: unit/, integration/, helpers/
│   │   └── scripts/              # dev scripts (set-dev-password, inspect-ledger, list-tenants)
│   │
│   ├── web/                  # React frontend
│   │   ├── package.json
│   │   ├── vite.config.ts
│   │   ├── tailwind.config.ts
│   │   ├── index.html            # Inter font, dark mode flash prevention
│   │   └── src/
│   │       ├── main.tsx
│   │       ├── App.tsx
│   │       ├── index.css         # CSS variables (light + dark theme)
│   │       ├── PlatformApp.tsx   # Platform-admin SPA (admin.<host>)
│   │       ├── routes/           # ProtectedRoute, PermissionGuard, RoleGuard, PlatformProtectedRoute
│   │       ├── layouts/          # DashboardLayout, AuthLayout, Sidebar, Header
│   │       ├── pages/            # 15 page directories incl. platform, preferences (see Section 10)
│   │       ├── components/       # reusable components + ui/ (shadcn-style primitives)
│   │       ├── hooks/            # 23 hooks (one TanStack Query file per domain + usePermission/useFeature)
│   │       ├── stores/           # 7 Zustand stores
│   │       └── lib/              # api-client, platform-api-client, host, query-client, importers, invoice-utils
│   │
│   └── mobile/               # React Native (Expo) -- employee collection app
│       ├── app/              # Expo Router file-based routes
│       └── src/              # components, hooks, lib (api-client, storage), stores
│
├── packages/
│   ├── shared-types/         # TypeScript interfaces + enums
│   │   └── src/
│   │       ├── index.ts      # Re-exports all type modules
│   │       ├── enums.ts
│   │       ├── features.ts           # FeatureKey catalog (plan/tenant switches)
│   │       ├── permissions.ts        # Permission catalog + default role grants
│   │       ├── access.ts             # effectivePermissions(): the rulebook used by API and UI
│   │       ├── platform.types.ts
│   │       ├── installment.types.ts
│   │       ├── customer.types.ts
│   │       ├── distributor.types.ts
│   │       ├── form.types.ts
│   │       └── api-response.types.ts
│   │
│   └── shared-utils/         # Shared business logic
│       └── src/
│           ├── index.ts
│           ├── emi-calculator.ts   # EMI calculation (simple interest)
│           ├── installment-rules.ts # Shared installment/penalty rules
│           ├── validators.ts       # Phone, GST, PAN, Aadhaar
│           ├── gstin.ts            # GSTIN parsing/validation
│           ├── formatters.ts       # INR currency, Indian date format
│           ├── constants.ts        # Interest rates, installment months
│           └── purchase-sheet.ts, tally-purchase-register.ts, creditor-sheet.ts,
│               distributor-duplicates.ts  # Import parsers and supplier de-duplication
│
├── infra/
│   └── azure/
│       ├── main.bicep        # Azure IaC (App Service, PostgreSQL, Static Web Apps)
│       └── deploy.sh
│
└── .github/
    └── workflows/
        └── ci.yml            # Build + deploy pipeline
```

---

## 4. How to Run

### Prerequisites
- Node.js 22 LTS
- Docker Desktop (for PostgreSQL)
- npm 10+

### First-Time Setup
```bash
# 1. Install dependencies
npm install

# 2. Start PostgreSQL
docker compose up -d

# 3. Copy environment file
cp apps/api/.env.example apps/api/.env

# 4. Generate Prisma client
npm run db:generate

# 5. Run database migrations
npm run db:migrate

# 6. Seed the database
npm run db:seed

# 7. Start development servers (API on :3001, Web on :5180)
npm run dev
```

### Individual Commands
```bash
npm run dev              # Start API + Web together
npm run dev:api          # Start only API
npm run dev:web          # Start only Web
npm run dev:mobile       # Start Expo mobile app
npm run dev:all          # Docker + API + Web
npm run build            # Build all apps
npm run typecheck        # TypeScript check all
npm run db:studio        # Open Prisma Studio (DB GUI)
npm run db:seed          # Re-seed database
npm test                 # API tests (Vitest; integration tests need Postgres)
```

### Environment Variables (apps/api/.env)
```
DATABASE_URL=postgresql://retailerp:retailerp@localhost:5432/retailerp
JWT_SECRET=your-secret-key-change-in-production
JWT_REFRESH_SECRET=your-refresh-secret-change-in-production
API_PORT=3001
API_HOST=0.0.0.0
CORS_ORIGIN=http://localhost:5180
# Optional — OCR and statement AI are disabled without a key
OCR_PROVIDER=openai
OPENAI_API_KEY=
OCR_INVOICE_MODEL=gpt-4o-mini
OCR_REGISTER_MODEL=gpt-4o
OCR_MAX_FILE_MB=15
OCR_MAX_PDF_PAGES=8
# Optional — bank API feeds and background jobs
BANK_FEED_SECRET_KEY=
BANK_FEED_CRON=30 6 * * *
ENABLE_SCHEDULER=false
```
Also read by the API: `STATEMENTS_AI_MODEL` (default `gpt-4.1-mini`), `STATEMENTS_MAX_FILE_MB`,
`SCHEDULER_CRON` (default `0 1 * * *`), `SCHEDULER_TZ` (default `Asia/Kolkata`).

### Default Login Credentials
See [DEV_LOGINS.md](./DEV_LOGINS.md) for every account.
- **Password**: seed default `RetailERP@2026`; `npx tsx scripts/set-dev-password.ts` (in `apps/api`) sets all to `1234`
- **Username pattern**: `{shopcode}_{role}{n}` plus owners `vinod_owner`, `nishant_owner`
  - Shop codes: `ve`, `ne`, `vha`, `nhe` (Star tenant: `se`, `sm`)
  - Roles: `admin1`, `admin2`, `acc1`, `acc2`, `acc3`, `staff1`, `staff2`, `emp1`, `emp2`, `emp3`
- **Tenant by address**: Vinod Electronics at http://localhost:5180, Star Electronics at
  http://star.localhost:5180, platform admin at http://admin.localhost:5180

---

## 5. Database Schema (57 Models, 16 Enums)

> The tables below cover the original core. Added since: SaaS (`Tenant`, `Plan`, `PlanFeature`,
> `TenantFeature`, `PlatformUser`, `PlatformRefreshToken`, `PlatformAuditLog`), access control
> (`Role`, `Permission`, `RolePermission`, `UserPermission`), installments (`InstallmentInterestApplication`,
> `InstallmentRollLog` (legacy), `InstallmentCarryForward`, `InstallmentRebate`, `InstallmentPromise`),
> bank-statement analysis (`BankStatement`, `StatementTransaction`, `StatementFile`, `StatementRule`,
> `StatementSettings`, `BankFeedConnection`, `BankFeedRun`) and purchase imports (`PurchaseImportBatch`,
> `ImportItemClassification`, `PurchaseInvoiceSeries`). Every tenant-owned model has a `tenantId`
> column, which `config/database.ts` uses to scope all Prisma queries automatically.
> New enums: `CustomerType`, `SaleApprovalStatus`, `UserPermissionEffect`, `TenantStatus`,
> `InstallmentPromiseStatus` (pending, kept, partially_kept, broken, replaced, cancelled).
> `schema.prisma` is the source of truth.

### Enums (core)
| Enum | Values |
|------|--------|
| UserRole | owner, admin, accountant, others, employee |
| ProductStatus | in_stock, sold, transferred, returned, damaged |
| SaleType | full_payment, partial_with_promise, self_finance, company_finance |
| PaymentMode | cash, credit_card, debit_card, upi, bank_transfer, cheque |
| InstallmentStatus | upcoming, due_today, paid, partially_paid, overdue, rescheduled |
| TransferStatus | initiated, in_transit, received, cancelled |
| ExpenseCategory | rent, electricity, salary, transport, maintenance, marketing, purchase, misc |
| FinancePaymentStatus | pending, received, overdue, partial |
| FormFieldType | text, number, select, multi_select, date, tel, email, textarea, checkbox, radio, file, hidden |
| BankTxnType | credit, debit |
| ReconciliationStatus | unmatched, matched, manual_match, disputed |

### Models by Domain

**Multi-Tenancy & Auth** (4):
- `Shop` -- GST entity anchor (name, code, GST number, PAN, address, bank details)
- `User` -- username, password_hash, role, isMobileOnly
- `UserShop` -- many-to-many user-shop assignment
- `RefreshToken` -- JWT refresh token tracking

**Products & Categories** (3):
- `ProductCategory` -- hierarchical (parent_id, level, path, hsnCode); leaf categories hold products
- `CategoryAttribute` -- dynamic form fields per category (e.g., IMEI for phones, tonnage for ACs)
- `Product` -- shop_id scoped, linked to category + distributor + purchase; has dynamicAttributes JSON

**Distributors & Purchases** (4):
- `Distributor` -- supplier with GST, PAN, bank details, credit limit
- `DistributorCategory` -- which categories a distributor supplies
- `Purchase` -- invoice from distributor (totalAmount, gstAmount, netAmount, amountPaid)
- `PurchasePayment` -- payments against purchase invoices

**Customers** (2):
- `Customer` -- phone, aadhaar, address; self-referencing guarantor_id
- `FinanceCompany` -- NBFCs: Bajaj Finance, HDB, Home Credit

**Sales** (2):
- `SaleRecord` -- the REAL sale data with all fields (installment details, GST, purchasePrice, purchaseGstAmount, paymentBreakdown JSON)
- `SaleRecordSanitized` -- same sale shown as full_payment/cash to "Others" role users

**Installments** (3):
- `InstallmentSchedule` -- master EMI schedule linked to sale (principal, interest, fileCharge, emiAmount)
- `Installment` -- individual EMI (dueDate, amountDue, amountPaid, remainingAmount, status, isRescheduled, rescheduledFromId)
- `InstallmentPayment` -- actual payment events against installments

**Transfers** (1):
- `InterShopTransfer` -- product movement between shops (from_shop_id, to_shop_id, transfer_price, GST)

**Expenses & Banking** (3):
- `Expense` -- shop expense (category, amount, GST, invoice)
- `BankAccount` -- shop bank account
- `BankTransaction` -- statement line item with reconciliation status

**Forms** (2):
- `FormDefinition` -- dynamic form metadata (form_name, shop_id, version)
- `FormField` -- individual field (type, label, validation, conditional visibility)

**Other** (5):
- `ProductAuditTrail` -- product lifecycle events (purchased, transferred, sold, returned)
- `AuditLog` -- system-wide change log
- `Employee` -- employee profile (salary, designation, linked to User)
- `EmployeeCollectionAssignment` -- which employee collects which installments
- `NotificationToken` -- Expo push token for mobile notifications
- `Notification` -- notification records
- `AppSetting` -- key-value configuration

### Key Relationships
```
Shop 1--* UserShop *--1 User
Shop 1--* Product, SaleRecord, Purchase, Expense, BankAccount

ProductCategory self-references (parent_id) for hierarchy
ProductCategory 1--* CategoryAttribute (dynamic fields per category)
ProductCategory 1--* Product

Distributor 1--* Purchase 1--* Product (via purchaseId)
Purchase 1--* PurchasePayment

Customer 1--* SaleRecord
Customer self-references (guarantor_id)

SaleRecord 1--1 SaleRecordSanitized (same ID)
SaleRecord 0..1--1 InstallmentSchedule 1--* Installment 1--* InstallmentPayment
SaleRecord *--0..1 FinanceCompany

Product 1--* ProductAuditTrail
Product 1--* InterShopTransfer
```

---

## 6. API Modules (24)

Each module follows the pattern: `routes.ts` -> `controller.ts` -> `service.ts` + `validation.ts`

All endpoints prefixed with `/api/v1`. The tenant comes from the host/`X-Tenant-Slug`; data is
shop-scoped via JWT + `X-Shop-Id` header. Every route is guarded by
`requirePermission('<module>.<action>')`, and most modules are registered behind a tenant
feature switch (`registerGated` in `app.ts` — 403 when the tenant's plan has it off).

Modules: auth, shops, users, categories, products, distributors, purchases, customers,
**customer-search**, sales,
installments, **promises**, transfers, expenses, bank (legacy), **bank-statements**, dashboard,
forms, employees, notifications, **roles**, **ocr**, **lookup**, **platform**. The tables below
are a summary; the `*.routes.ts` files are authoritative.

### Auth (`/api/v1/auth`)
| Method | Path | Description | Auth |
|--------|------|-------------|------|
| GET | /shops | List the tenant's shops | Public |
| POST | /login | Login with username + password (tenant from host); returns effective permissions | Public |
| POST | /refresh | Refresh access token | Refresh token |
| POST | /logout | Revoke refresh token | Yes |
| GET | /me | Current user + shops | Yes |
| GET/PUT | /preferences | Per-user preferences (tables, theme) | Yes |
| PUT | /change-password | Change own password | Yes |
| POST | /switch-shop | Switch active shop (new token) | Owner/Admin/Accountant |

### Shops (`/api/v1/shops`)
| Method | Path | Description |
|--------|------|-------------|
| GET | / | List all shops |
| GET | /:id | Shop details |
| PUT | /:id | Update shop |

### Users (`/api/v1/users`)
| Method | Path | Description |
|--------|------|-------------|
| GET | / | List users (filter by shop, role) |
| POST | / | Create user |
| GET | /:id | User detail |
| PUT | /:id | Update user |
| DELETE | /:id | Deactivate user |

### Categories (`/api/v1/categories`)
| Method | Path | Description |
|--------|------|-------------|
| GET | / | Full category tree |
| GET | /:id | Category with attributes |
| POST | / | Create category (with hsnCode) |
| PUT | /:id | Update category |

### Products (`/api/v1/products`)
| Method | Path | Description |
|--------|------|-------------|
| GET | / | List (paginated, filter by category/status/brand) |
| GET | /search | Global search (3+ chars) |
| POST | / | Create product |
| GET | /:id | Detail + dynamic attrs + audit trail + purchase relation |
| PUT | /:id | Update product |
| GET | /:id/history | Audit trail |
| GET | /:id/can-sell | Check sellability |

### Distributors (`/api/v1/distributors`)
| Method | Path | Description |
|--------|------|-------------|
| GET | / | List (search, paginated) |
| POST | / | Create (with duplicate GST/PAN/bank validation) |
| GET | /:id | Detail with aggregates |
| PUT | /:id | Update |
| POST | /:id/payments | Record lumpsum payment (FIFO across pending invoices; any excess kept as an advance for the header shop) |
| POST | /clear-payments/preview, /clear-payments | `{ ids }`: preview / clear the chosen suppliers in every shop the user can access — payments and advances deleted, bills marked `settled` (nothing paid, nothing owed), so Total paid and Pending both go to 0. Permission `distributors.clear_payments` (owner-only by default) |

### Purchases (`/api/v1/purchases`)
| Method | Path | Description |
|--------|------|-------------|
| GET | / | List (filter by distributor, date, status) |
| POST | / | Create purchase + products (with duplicate invoice#/serial# validation) |
| GET | /:id | Purchase detail |
| PUT | /:id | Update |
| GET | /check-invoice | Check if invoice number is duplicate |

### Customers (`/api/v1/customers`)
| Method | Path | Description |
|--------|------|-------------|
| GET | / | List (paginated, search) |
| GET | /search | Quick search by phone/name |
| POST | / | Create (auto customer_code) |
| GET | /:id | Detail + purchase history |
| PUT | /:id | Update |

### Customer Searching (`/api/v1/customer-search`)
The shops' account register, moved off a Google Sheet (`Account Number | CUSTOMER_NAME |
Address | Mobile | CO | CO_Mobile | AREA | Purchase_Date | Product | Brand | Model | Shop`, the
sheet's `ID` column is the **Account Number**). One `CustomerSearchEntry` per item bought, in
the shop its Shop says. Search is tenant-wide. Every entry is filed under a `Customer` matched on
**name + mobile** (relatives share phones), and the co-applicant (CO) is a Customer marked
`isGuarantor`. Feature `customer_search` (Enterprise); permissions `customer_search.*` need
`customers.list` (writes also `customers.create` + `customers.view_phone`) but **not**
`sales.view_real` — staff see the co-applicant by the owner's decision. The two buttons map to
`customer_search.create` ("Customer Searching: New entry") and `customer_search.import`
("Customer Searching: Import the sheet").

**Account numbers** are read as the register writes them — `BD-1`, `CI2-421` (sub-series),
`BD-406A`, `BN.596`, `MJ12` — and the next number keeps the series' separator (`BD-264` → `BD-265`).
They are **not unique**: the real sheet reuses ~3,700 numbers for different people. A reused
number is allowed — the form warns first (409 with `usedBy` + next free number; "Save anyway"
sends `allowDuplicate`) — and every entry sharing it is flagged.

**Needs review.** The sheet is imported as it is; nothing but an unknown Shop stops a row. Each
entry carries `issues` (codes in `REGISTER_ISSUES`, shared-utils): `duplicate_account`,
`missing_account`, `odd_account`, `missing_name`, `missing_mobile`, `invalid_mobile`,
`missing_date`, `invalid_date`, `future_date`, `co_incomplete`, `no_product_type`. Unusable sheet
values (a 9-digit mobile, an unreadable date) are kept in `rawValues`. `refreshIssues`
(`customer-search.issues.ts`) recomputes an entry and every entry sharing its number on each
create / edit / delete / import. The search page has a **Needs review** tab with a problem
dropdown (`GET /review-summary`). Rows with no usable mobile get a customer of their own (phone
''); rows with no name get none.

**Shops.** The Shop column (name or code) decides each row's shop; blank → the import's default
shop (pre-selected as the shop the file names most often). Changing a row's Shop and re-importing
**moves** the entry; changing Shop on Edit entry does the same. Its customer and co-applicant move
too unless they still have another entry or a sale in the old shop (`moveCustomersWithEntry`);
real sales never move. CSV files are read as plain text in the browser so day-first dates
(`1/3/2021`) aren't turned into US month-first ones.

**Product type** (`categoryId` → `ProductCategory`): entries made in the app must pick a **leaf**
of the tenant's type tree (API checks it). The sheet only names top-level types, so import
matches its Product text against top-level types (exact / plural / lookalike), then a same-named
sub-type ("LED TV" → TV › LED TV), and offers the rest as new top-level types that are created
only when the importer confirms (`categories.create` needed). Each decision is kept in
`CustomerSearchProductMapping` and reused by later ranges; unmatched text stays in `product`
with no type (filter "No product type"). The type filter matches a type and every type below it
(`path` prefix). **Export** has a `Product Type` column (full path, `›`-separated) plus
`Type Level 1…N`, N = deepest type in that export; shallower types leave the extra levels blank,
so a deeper tree just adds columns; then Shop, Customer Code and Needs review. Re-importing an
export reads `Type Level 1` (or the path when blank) as Product.

| Method | Path | Description |
|--------|------|-------------|
| GET | / | Search (account number, name, mobile, co-applicant, area, product type) + filters incl. `categoryId` (subtree, or `none`) and `issue` (`any` or a code); tenant-wide |
| GET | /review-summary | Entries needing review, in all and per problem |
| GET | /prefixes, /next-number?prefix= | Series in use and the next free number (BD-264 → BD-265, MJ009 → MJ010) |
| GET | /customer-matches?mobile=&name= | Customers already on a mobile, for the form's autofill / "did you mean" |
| GET | /by-customer/:customerId | Items a customer bought and entries they are co-applicant on |
| POST, PATCH | /, /:id | Create / edit an entry (shop selectable; a reused account number needs `allowDuplicate`) |
| DELETE | /:id | Delete an entry (`customer_search.delete`, owner/admin by default); its customer and co-applicant stay |
| POST | /import/preview, /import | Sheet import, a range of records at a time: preview classifies rows (new / already imported / moves shop / can't import) with their review problems, groups name variants on one mobile (edit distance, AI for borderline pairs — names only) and matches Product text to types; commit applies the choices, creates/links customers, moves changed-shop rows |
| GET | /import/batches, /export | Past import ranges; Excel export |

**Cutover from the Google Sheet** (one time):
1. Add a `Shop` column (shop name or code per row), then download as .xlsx or .csv. The `ID`
   heading is read as Account Number.
2. Customer Searching → Import: pick records 1–1000 (and the shop for rows with a blank Shop),
   check, confirm the product types (and which new ones to create), decide the name groups,
   import. Repeat with the suggested next range; a range can be re-run safely. Work through the
   **Needs review** tab afterwards.
3. When every range is in, set the sheet to view-only and have staff use **New entry** instead.
4. After deploying, run `npx tsx prisma/seed/sync-permission-catalog.ts` and
   `npx tsx prisma/seed/backfill-customer-search-issues.ts` (in `apps/api`).

### Sales (`/api/v1/sales`)
| Method | Path | Description | Notes |
|--------|------|-------------|-------|
| GET | / | List sales | Others see sanitized |
| POST | / | Create sale (dual-write real + sanitized) | Handles all 4 types |
| GET | /:id | Sale detail | Others see sanitized |
| GET | /:id/installments | Installment schedule | Admin/Accountant only |
| PUT | /:id/finance-payment | Record NBFC payment received | Admin/Accountant |
| PUT | /:id/record-payment | Record pending payment (partial with promise) | Admin/Accountant |
| GET | /finance-companies | List finance companies from DB | Any auth |

### Installments (`/api/v1/installments`)
| Method | Path | Description |
|--------|------|-------------|
| GET | / | List schedules (filter by status) |
| GET | /overdue | All overdue installments (flattened) |
| GET | /collections/today | Today's collections |
| GET | /collections/date/:date | Collections for specific date |
| GET | /collections/range | Collections for date range (?dateFrom, ?dateTo) |
| GET | /call-list | Today's calls: due today, promises due, broken promises, overdue not covered by a later promise |
| GET | /collections/paid-range | Payments actually received in a date range |
| GET | /search | Search schedules by ledger#/sale#/phone/name |
| GET | /:scheduleId | Schedule detail + all installments + payments |
| GET | /:scheduleId/timeline | Timeline visualization data |
| GET | /:scheduleId/roll-log | Legacy redistribution history |
| GET | /:installmentId/payment-preview | Server-computed penalty / early-payment deduction for the payment dialog |
| POST | /:installmentId/pay | Record payment (oldest-first allocation, optional promise, penalty/deduction opt-ins) |
| POST | /payments/:paymentId/revert, /move, /correct | Undo, re-target or correct a payment |
| PATCH | /schedules/:scheduleId/penalty-per-day | Change the sale's late-penalty rate |
| GET/POST | /schedules/:scheduleId/settlement-quote, /final-settlement | Early closure |
| GET | /schedules/:scheduleId/interest-accrual | Late-penalty accrual (sale-level) |
| POST | /:installmentId/apply-interest, /interest-applications/:id/rollback | Manual penalty and its undo |

### Promises (`/api/v1/promises`)
| Method | Path | Description |
|--------|------|-------------|
| POST | / | Create a promise covering one or more EMIs (replaces a pending one on the same EMIs) |
| GET | / | List promises (by schedule / customer / status) |
| DELETE | /:id | Cancel a promise entered by mistake (`cancelled`, not held against the customer) |

### Newer modules (summary)
| Prefix | Purpose |
|--------|---------|
| `/roles` | Custom roles, role permissions, per-user grants/denies (writes need `rbac.custom_roles` feature) |
| `/bank-statements` | Statement analysis ported from LedgerLens: parse PDF/Excel/CSV/image statements (pdf.js / SheetJS first, AI only when the running balances don't reconcile; the balance decides money in vs out), auto-categorise (user rules → built-in rules → AI), suggest the supplier a withdrawal paid (name in narration → trigrams → AI for borderline names) and record it as a supplier payment in one click (`POST /transactions/:id/supplier-payment`, settles that shop's oldest bills, linked via `purchase_payments.statement_transaction_id`; money beyond the open bills is kept, after confirmation, as a `SupplierAdvance` that the shop's next bills from that supplier use up automatically — see `modules/distributors/supplier-advances.ts`). Deleting bank rows (`POST /transactions/delete`, preview via `/transactions/delete-impact`) or a whole statement takes back the supplier payments/advances recorded from them (bills reopen; needs `purchases.record_payment` too), review queue, analytics, Excel/CSV export, bank API feeds. With the header on "All Shops", uploads find their shop from the statement's account number. Engine in `engine/` uses raw SQL (tenant-filtered by hand) |
| `/ocr` | Distributor-invoice → purchase-form pre-fill; handwritten register page → parsed preview (OpenAI) |
| `/lookup` | Lightweight lookups used by forms (always on) |
| `/platform` | Platform-admin console: tenants, plans, feature overrides, onboarding (separate login, no tenant context) |

### Transfers (`/api/v1/transfers`)
| Method | Path | Description |
|--------|------|-------------|
| GET | / | List transfers |
| POST | / | Initiate transfer |
| GET | /:id | Transfer detail |
| PUT | /:id/receive | Mark received at destination |
| PUT | /:id/cancel | Cancel transfer |

### Expenses (`/api/v1/expenses`)
| Method | Path | Description |
|--------|------|-------------|
| GET | / | List (filter by category, date) |
| POST | / | Create expense |
| GET | /summary | Expense summary by category |

### Bank (`/api/v1/bank`)
| Method | Path | Description |
|--------|------|-------------|
| GET | /accounts | List bank accounts |
| POST | /accounts | Create bank account |
| GET | /transactions | List transactions |
| POST | /upload-statement | Upload CSV/Excel |
| POST | /reconcile | Reconcile transaction |

### Dashboard (`/api/v1/dashboard`)
| Method | Path | Description |
|--------|------|-------------|
| GET | /summary | Key metrics (sales, pending installments, stock value) |
| GET | /sales-graph | Sales data (date range) |
| GET | /top-products | Top 10 products sold |
| GET | /yoy-comparison | Year-over-year comparison |
| GET | /overdue-installments | Overdue summary |

### Forms (`/api/v1/forms`)
| Method | Path | Description |
|--------|------|-------------|
| GET | /definitions | List all form definitions |
| GET | /definitions/:formName | Active form by name |
| POST | /definitions | Create form |
| PUT | /definitions/:id | Update form + fields |

### Employees (`/api/v1/employees`)
| Method | Path | Description |
|--------|------|-------------|
| GET | / | List employees for shop |
| POST | / | Create employee |
| GET | /:id | Employee detail |
| PUT | /:id | Update employee |

### Notifications (`/api/v1/notifications`)
| Method | Path | Description |
|--------|------|-------------|
| POST | /register-token | Register Expo push token |
| GET | / | User's notifications |
| PUT | /:id/read | Mark as read |

---

## 7. RBAC (Role-Based Access Control)

### Roles (defaults — editable per tenant in Settings → Roles & Users)
| Role | Web Access | Mobile Access | Description |
|------|-----------|---------------|-------------|
| **Owner** | Full (within the tenant's plan) | — | Every permission; all shops |
| **Admin** | Full | Yes* | Full access, dashboard, settings, user management; can switch shops |
| **Accountant** | Most (no dashboard, users or transfers) | Yes* | Sales, purchases, installments, expenses; can switch shops |
| **Others** | Limited, own shop | No | Products, customers, sales (sanitized only), no cost prices, NO installments ever |
| **Employee** | None (blocked) | Yes | Installment collection only |

### Permissions model
- Roles and permissions are DB rows (`Role`, `Permission`, `RolePermission`, `UserPermission`),
  seeded from the catalog in `packages/shared-types/src/permissions.ts`.
- **Effective permissions** = role grants + user grants − user denies − permissions of features
  the tenant has off − permissions whose prerequisites are missing. Computed by
  `effectivePermissions()` in `packages/shared-types/src/access.ts` — the same code runs in the
  API (`middleware/permissions.ts`, `requirePermission`) and in the browser (`usePermission`,
  `PermissionGuard`), so the UI never offers what the API refuses. Login returns the list.
- `middleware/field-access.ts` strips sensitive fields (cost, Aadhaar, bank details) unless permitted.
- New permissions reach existing tenants via `prisma/seed/sync-permission-catalog.ts`.

### Critical Data Isolation
- **Tenants**: every Prisma query on a model with `tenantId` is auto-filtered and every create
  auto-stamped (`config/database.ts` + `config/tenant-context.ts`); cross-tenant writes throw.
  Raw SQL and background jobs must scope by tenant themselves.
- **Sanitized viewers NEVER see installment data**. Users without `sales.view_real` get data from `sale_records_sanitized` (all sales appear as full cash payment) and lose every installment permission.
- **Decision is server-side**: the API decides from effective permissions. Frontend cannot override.
- **Employee role cannot access web app**: JWT contains `isMobileOnly: true`. Web app shows "Please use the mobile app" message.

### Shop Scoping
- Every data query includes `WHERE shop_id = ?` via the `shopScope` middleware
- The JWT contains the user's active `shopId`
- Admin/Accountant can switch shops via `X-Shop-Id` header

---

## 8. Key Business Logic

### GST-Inclusive Pricing
All selling prices include GST. GST is extracted via reverse calculation:
```
gstAmount = sellingPrice * gstRate / (100 + gstRate)
basePrice = sellingPrice - gstAmount
```

Example: SP = 50,000 at 18% GST -> GST = 7,627, Base = 42,373

### Input Tax Credit (ITC)
The purchase price (DP) also includes GST. Net profit calculation:
```
Output GST (on sale) = SP * rate / (100 + rate)
Input GST (on purchase) = DP * rate / (100 + rate)
GST Payable to Govt = Output GST - Input GST
Net Profit = (SP - Output GST) - (DP - Input GST)
```

Both `purchasePrice` and `purchaseGstAmount` are stored on `sale_records` as snapshots.

### EMI Calculation (Self Finance)
```
Principal = Selling Price - Down Payment
Total Interest = Principal * (interestRate / 100) * numInstallments
Total Payable = Principal + Total Interest + File Charge
EMI = Math.round(Total Payable / numInstallments)
```
All EMIs are equal amounts. Interest rates: 1%, 1.5%, 2%, 2.5%, 3% per month.

### Installment Collection Rules (current)
Based on [ADR-0001](./adr/0001-per-emi-overdue-installment-model.md), amended by later owner
rules. The old reschedule / sub-row / redistribution model is legacy
([installment/installment.md](./installment/installment.md)).
1. **Fixed schedule** — EMIs are generated once at sale time (`plannedAmount` keeps the original).
2. **Oldest-first allocation** — a payment clears the oldest EMI still owing, then the next; the
   collector may pick a specific EMI first. Surplus beyond everything owed → `creditBalance`.
3. **Short payment** — by default the EMI counts as paid and the shortfall is spread equally over
   the remaining EMIs (whole rupees; recorded in `InstallmentCarryForward` with a reason, undone on
   revert). Alternatively keep it on the EMI with a promise date.
4. **Promises** — `InstallmentPromise` covers 1..N EMIs, labelled register-style `N.k` (k-th promise
   on EMI N). Statuses: pending, kept, partially_kept, broken, replaced (new date given before the
   old one), cancelled (shop mistake). Promises never hide a customer from the daily call list;
   promised customers are snoozed only until their date. `resolve-promises.job.ts` settles them.
5. **Late penalty** — flat ₹ per day **per sale** (default ₹2, `SaleRecord.penaltyPerDay`, tenant
   default `defaultPenaltyPerDay`), counted from the day after the oldest unpaid EMI's due date,
   never charging a day twice. Shown to the collector, applied only when ticked.
6. **Early-payment deduction** — EMI paid in full ≥ 30 days early can earn that EMI's share of
   sale-time interest off the last installment (`InstallmentRebate`). Opt-in; file charge never refunded.
7. **Corrections** — revert / move / correct a payment (`installments.revert_payment` permission);
   all derived effects are undone exactly.
Engine: `modules/installments/installments.{engine,allocator,derivations}.ts`; shared rules in
`packages/shared-utils/src/installment-rules.ts`.

### Dual Sale Recording
Every sale creates TWO records in a single transaction:
- `sale_records` -- real data (installment details, interest, file charges, guarantor)
- `sale_records_sanitized` -- same sale but saleType='full_payment', paymentMode='cash'

### Multi-Mode Payment
Sales support up to 3 payment modes (e.g., Cash: 10,000 + UPI: 15,000). Stored as `paymentBreakdown` JSON array on the sale record. The `paymentMode` field stores the primary (largest amount) mode for backward compatibility.

### Invoice Generation
PDF invoices are generated client-side using @react-pdf/renderer (lazy-loaded). Invoices always show the sale as full payment regardless of actual sale type. HSN codes come from the product's category.

### Ledger Number
Physical office register number (format: 2 capital letters + digits, e.g., VE001). Stored on every sale for offline record redundancy.

---

## 9. Seed Data

### Execution Order (apps/api/prisma/seed/index.ts)
0. Bootstrap tenant `vn` (Vinod Electronics) on the `enterprise` plan with every feature on
1. `shops.seed.ts` -- 4 shops (VE Vinod Electronics, NE Naveen Electronics, VHA Vinod Home Appliances, NHE New Harshita Electronics)
2. `roles-permissions.seed.ts` -- system roles + permission catalog
3. `users.seed.ts` -- 2 owners + 10 users per shop (2 admin, 3 accountant, 2 others, 3 employee)
4. `categories.seed.ts` -- category hierarchy with brand dropdowns and HSN codes
5. `finance-companies.seed.ts` -- 3 NBFCs (Bajaj Finance, HDB, Home Credit)
6. `distributors.seed.ts`, `purchases.seed.ts` (creates the products)
7. `form-definitions.seed.ts`

**Customers and sales are not seeded** (since 2026-11-01 — the shops enter real ones), and
neither is anything built on them. `customers.seed.ts`, `sales.seed.ts`,
`installments.seed.ts`, `promises.seed.ts`, `interest-applications.seed.ts` and
`rolling-overdue-scenarios.seed.ts` are kept in the repo; to re-enable, call them from
`index.ts` in that order (each needs the previous one's output).

Run by hand (not part of `index.ts`): `star-electronics.seed.ts` (demo tenant, refuses to run
twice), `bootstrap-platform-admin.ts`, `sync-permission-catalog.ts`, and assorted one-off
`backfill-*` / `repair-*` scripts. Destructive scripts (`clear`, `clear-all`, `reset`) are
protected by `_guard.ts` (blocked in production or against non-local databases).

### Seed Credentials
- **Password**: `RetailERP@2026` (all users); see [DEV_LOGINS.md](./DEV_LOGINS.md)
- **Username pattern**: `{shopcode}_{role}{n}` (e.g., `ve_admin1`, `ne_acc1`), owners `vinod_owner`, `nishant_owner`

### Running Seeds
```bash
npm run db:seed    # Runs index.ts (adds seed purchases/products — don't run it on a database holding real data)
npm run db:clear   # Deletes business data (sales, customers, installments, promises, products…), keeps shops/users/config
npm run db:reset   # prisma migrate reset --force (drops DB, re-applies migrations; then run db:seed)
```

---

## 10. Frontend Architecture

### State Management
| Layer | Tool | Purpose |
|-------|------|---------|
| Server state | TanStack Query | All API calls, caching, refetching |
| Auth state | Zustand (auth-store, platform-auth-store) | User, tokens, effective permissions; separate platform-admin session |
| Tenant state | Zustand (tenant-store) | Tenant resolved from the host, enabled features |
| Shop state | Zustand (shop-store) | Current shop context |
| UI state | Zustand (toast-store, sidebar-store, preferences-store) | Toasts, mobile sidebar, per-user table/column preferences |
| Form state | react-hook-form | Ephemeral per-page form data |

### API Layer
- `lib/api-client.ts` -- Axios instance with Authorization, `X-Shop-Id` and `X-Tenant-Slug` headers (`lib/host.ts` derives the tenant from the subdomain)
- `lib/platform-api-client.ts` -- separate client for the platform-admin console
- Request interceptor: attaches JWT + shop ID + tenant slug
- Response interceptor: on 401, attempts token refresh; on failure, redirects to login
- Each domain has its own hook file (e.g., `hooks/useSales.ts`) wrapping TanStack Query

### Layout System
- `DashboardLayout` -- sidebar (collapsible on mobile) + header (shop switcher, notifications, user menu, breadcrumbs) + content area
- `AuthLayout` -- centered card for login page
- Dark mode: CSS variables, class-based toggle, localStorage persistence, flash prevention script in index.html

### Key Components
| Component | Purpose |
|-----------|---------|
| DataTable | Reusable paginated table with sorting, column picker and drag-to-resize; columns always fit the table's width (saved widths act as proportions) |
| DynamicForm | Renders form from DB form_definitions |
| CategoryCascader | Hierarchical category picker |
| RecordPaymentDialog | Installment payment: single amount, where-it-goes breakdown, spread vs keep shortfall, penalty/deduction checkboxes, optional promise |
| PromiseDialog | Create a promise over one or more EMIs (`N.k` label preview) |
| PaymentTimeline | Visual installment payment history |
| InvoicePDF | Indian GST tax invoice PDF generation |
| StatusBadge | 30+ status variants with dark mode support |
| PaymentSplitSection | Multi-mode payment (up to 3 splits) |

### Pages (16 sections)
| Section | Pages | Key Features |
|---------|-------|--------------|
| auth | LoginPage | Tenant from host -> credentials, mobile-only user blocking |
| dashboard | DashboardPage | Summary cards, sales chart, top products, YoY, overdue |
| products | List, Add, Detail | Category cascader, dynamic attributes, audit timeline |
| distributors | List, Form, Detail | Tabs (products/payments/pending), lumpsum FIFO payment |
| purchases | List, Create, Detail, Import | 5-step wizard, GST slabs, multi-serial, duplicate validation, invoice OCR, Tally/sheet import, unbilled purchases |
| customers | List, Form, Detail | Phone search, auto customer code, "Items bought" from the account register |
| customer-search | Search, Form, Detail, Import | "Customer Searching" (Revenue menu): search-first account register, series prefix → next number, mobile autofill, product type from the category tree (leaf), ranged sheet import with name-variant and product-type resolution |
| sales | List, Create, Detail, RegisterScan | 4 sale types, GST-inclusive, multi-mode payment, invoice PDF, profit breakdown, register-page OCR |
| installments | List (incl. Today's Calls tab), Detail | Daily call list, search by ledger#, date range collections, overdue tracking, payments, promises |
| transfers | List, Create, Detail | Product movement between shops |
| expenses | List, Form | Category-based expense tracking |
| bank | Dashboard, Upload, Review, Transactions, Statements, Rules | Bank-statement analysis: upload, AI categorisation, review queue, rules, analytics |
| employees | List, Form | Admin-only employee management |
| settings | Settings, FormBuilder, CategoryManager, RolesUsers | Dynamic form editing, category tree with HSN codes, roles & per-user permissions |
| preferences | Preferences | Per-user preferences (theme, tables) |
| platform | Login, TenantList, TenantDetail, TenantOnboard, PlanManager | Platform-admin console (admin.<host>, `PlatformApp.tsx`) |

---

## 11. Database Migrations

30 migrations in `apps/api/prisma/migrations/` (first: `init`, 2026-04-16). Latest:

| Name | Description |
|------|-------------|
| 20260922133155_planned_amount_and_carry_forward | `Installment.plannedAmount`, `InstallmentCarryForward` |
| 20261004105718_add_bank_statement_analysis | Bank-statement analysis tables |
| 20261005133338_bank_accounts_link_and_statement_files | Statement files, bank-account links |
| 20261005191207_bank_api_feeds | Bank API feed connections/runs |
| 20261017162614_add_purchase_import_tracking | Purchase import batches / classification |
| 20261018200653_purchases_without_a_bill | Unbilled purchases |
| 20261101204405_bank_rows_pay_suppliers | Supplier on bank rows; supplier payments linked to the bank row |
| 20261105152137_supplier_advances | `supplier_advances`: money paid to a supplier before (or beyond) its bills, per shop; used up automatically by that shop's next bills |

### Running Migrations
```bash
npm run db:migrate              # Apply pending migrations
npx prisma migrate dev --name X # Create new migration (from apps/api/)
npx prisma generate             # Regenerate Prisma client after schema changes
```

---

## 12. CI/CD Pipeline (.github/workflows/ci.yml)

**Trigger**: Push to main/develop, PR to main

### Jobs
1. **build** -- Install, generate Prisma, typecheck, build all apps
2. **deploy-api** (main only) -- Zip deploy to Azure App Service, run migrations
3. **deploy-web** (main only) -- Deploy dist/ to Azure Static Web Apps

### Azure Resources (~$26/month, as originally provisioned)
- App Service B1 (API)
- PostgreSQL Flexible Server B1ms
- Static Web Apps (free tier)
- Blob Storage (hot tier, for uploads)

Wildcard tenant subdomains (`*.retailerp.com`) need a different setup — see
[DEPLOYMENT_PLAN.md](./DEPLOYMENT_PLAN.md) (recommended: single App Service + Postgres B1ms + Cloudflare).

---

## 13. Git History & Workflow

Use `git log` for history (≈160 commits since 2026-04-16). Milestones: scaffolding and core
modules (Apr 2026) → SaaS multi-tenancy, plans and platform admin → Pattern B installments,
promises and call list (Sep 2026) → permission-per-route RBAC (Oct 2026) → bank-statement
analysis, purchase imports and table preferences (Oct 2026).

**Branch strategy**: feature branches (e.g. `feature/bank-statement-analyzer`) and `develop`
for active work; `main` deploys (triggers CI/CD).

**Commit style**: one plain-English sentence describing the user-visible effect
("Pay a supplier in cash and cheque at once"), with a body explaining why.

---

## 14. Known Patterns & Conventions

### API Pattern
Every module: `routes.ts` -> `controller.ts` -> `service.ts` + `validation.ts`
- Routes register endpoints with middleware chains: `authenticate, shopScope, requirePermission('<module>.<action>'), validate(schema)`
- Controllers handle request/response, call services
- Services contain business logic, Prisma queries
- Validation uses Zod schemas

### Response Format
```json
{
  "success": true,
  "data": { ... },
  "pagination": { "page": 1, "pageSize": 20, "totalItems": 100, "totalPages": 5 }
}
```

### Error Format
```json
{
  "success": false,
  "error": "Error message",
  "details": [{ "field": "name", "message": "Required" }]
}
```

### Frontend Hook Pattern
```typescript
export function useSalesQuery(filters) {
  return useQuery({
    queryKey: ['sales', filters],
    queryFn: async () => {
      const { data } = await apiClient.get('/sales', { params: filters });
      return data.data;
    },
  });
}
```

### Prisma Decimal Handling
Prisma returns `Decimal` objects (serialized as strings in JSON). Frontend must coerce with `Number()` before arithmetic or display.

### Dark Mode
CSS variables in `index.css` (`:root` for light, `.dark` for dark). Toggle via `document.documentElement.classList.add/remove('dark')` + `localStorage.setItem('theme', ...)`.

---

## 15. What to Expect When Running

After `npm run dev`:
- **API**: http://localhost:3001 (Fastify, auto-reload via tsx)
- **Web**: http://localhost:5180 (Vite HMR; tenant from host — `star.localhost:5180`, `admin.localhost:5180`)
- **Login**: enter credentials at the tenant's address -> redirected to dashboard (admin) or products (others)
- **Seeded data**: tenant `vn` with 4 shops, 42 users, distributors, purchases and products — no customers or sales (add the Star demo tenant, which does include sample sales, with `star-electronics.seed.ts`)

### Common Issues
- **Page refresh logs out**: Fixed. Uses localStorage (not sessionStorage) + `/auth/me` hydration.
- **CORS errors**: Fixed. Fastify CORS configured with methods + headers.
- **Prisma Decimal in PDF**: Fixed. `formatRupees()` coerces with `Number()`.
- **Finance company UUID**: Fixed. Fetched from DB (was hardcoded with fake IDs).
