# RetailERP -- Full System Context Document

> Last updated: 2026-04-18
> Purpose: Comprehensive context for LLMs working on this codebase

---

## 1. What Is RetailERP?

RetailERP is a full-stack web + mobile application that replaces Tally and Marg accounting software for 4 retail electronics/furniture/mobile shops in India. Each shop operates under a separate GST entity. The system handles:

- **Multi-shop management** with shop switching for admins
- **Product inventory** with hierarchical categories and dynamic attributes
- **Purchase recording** from distributors with GST tracking
- **4 sale types**: Full Payment, Partial with Promise, Self Finance (installment), Company Finance (NBFC)
- **Dual sale recording**: Real data (admin/accountant) vs sanitized data (staff who must never see installment info)
- **Installment tracking** with EMI schedules, payment collection, rescheduling
- **Invoice PDF generation** (standard Indian GST tax invoice)
- **GST-inclusive pricing** with Input Tax Credit (ITC) profit calculations
- **Inter-shop transfers** (GST entity to entity)
- **Expenses, bank statements, reconciliation**
- **DB-driven dynamic forms** (admin can modify form fields without code deploy)
- **Employee mobile app** for field installment collection

### The 4 Shops

| Shop | Code | Use |
|------|------|-----|
| Vinod Electronics | VE | Electronics retail |
| Nishant Electronics | NE | Electronics retail |
| Vinod Home Appliances | VHA | Appliances/furniture |
| Nishant Home Electronics | NHE | Electronics + appliances |

---

## 2. Tech Stack

### Backend (apps/api)
- **Runtime**: Node.js 22 LTS
- **Framework**: Fastify 5.3
- **ORM**: Prisma 6.6 with PostgreSQL 16
- **Validation**: Zod 3.24
- **Auth**: JWT (access token 1hr + refresh token 7d), bcryptjs
- **Language**: TypeScript (ES2022 target, ESM modules)

### Frontend Web (apps/web)
- **Framework**: React 19 with TypeScript
- **Build**: Vite 6
- **Styling**: TailwindCSS 4 + shadcn/ui (CSS variables, class-based dark mode)
- **State (server)**: TanStack Query (React Query) v5
- **State (client)**: Zustand 5 (4 stores)
- **Forms**: react-hook-form 7
- **Charts**: Recharts 2
- **PDF**: @react-pdf/renderer (lazy-loaded)
- **Icons**: lucide-react
- **Routing**: react-router-dom 7

### Frontend Mobile (apps/mobile)
- **Framework**: React Native with Expo SDK 52+
- **Routing**: Expo Router (file-based)
- **Storage**: expo-secure-store
- **Push**: expo-notifications (planned)

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
├── CLAUDE.md                 # AI assistant instructions
├── docs/
│   └── CONTEXT.md            # This file
│
├── apps/
│   ├── api/                  # Fastify backend
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   ├── .env.example
│   │   ├── prisma/
│   │   │   ├── schema.prisma     # 31 models, 11 enums
│   │   │   ├── migrations/       # 4 migrations
│   │   │   └── seed/             # 10 seed scripts
│   │   └── src/
│   │       ├── index.ts          # Server entry point
│   │       ├── app.ts            # Fastify app setup, registers all 17 modules
│   │       ├── config/           # Database connection, env config
│   │       ├── middleware/       # 5 middleware (auth, rbac, shop-scope, validate, error-handler)
│   │       ├── modules/          # 17 API modules (see Section 6)
│   │       ├── utils/            # ID generator, pagination, response helpers
│   │       └── types/            # Express.d.ts augmentation
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
│   │       ├── routes/           # ProtectedRoute, RoleGuard
│   │       ├── layouts/          # DashboardLayout, AuthLayout, Sidebar, Header
│   │       ├── pages/            # 13 page directories (see Section 7)
│   │       ├── components/       # 17 reusable components (see Section 8)
│   │       ├── hooks/            # 15 custom hooks
│   │       ├── stores/           # 4 Zustand stores
│   │       └── lib/              # api-client, query-client, invoice-utils, utils
│   │
│   └── mobile/               # React Native (Expo) -- employee collection app
│       ├── app/              # Expo Router file-based routes
│       ├── components/       # CollectionCard, PaymentForm, LoadingScreen
│       ├── hooks/            # useAuth, useCollections
│       └── lib/              # api-client, storage
│
├── packages/
│   ├── shared-types/         # TypeScript interfaces + enums
│   │   └── src/
│   │       ├── index.ts      # Re-exports all type modules
│   │       ├── enums.ts
│   │       ├── shop.types.ts
│   │       ├── user.types.ts
│   │       ├── product.types.ts
│   │       ├── sale.types.ts
│   │       ├── installment.types.ts
│   │       ├── customer.types.ts
│   │       ├── distributor.types.ts
│   │       ├── purchase.types.ts
│   │       ├── form.types.ts
│   │       └── api-response.types.ts
│   │
│   └── shared-utils/         # Shared business logic
│       └── src/
│           ├── index.ts
│           ├── emi-calculator.ts   # EMI calculation (simple interest)
│           ├── validators.ts       # Phone, GST, PAN, Aadhaar
│           ├── formatters.ts       # INR currency, Indian date format
│           └── constants.ts        # Interest rates, installment months
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

# 7. Start development servers (API on :3001, Web on :5173)
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
```

### Environment Variables (apps/api/.env)
```
DATABASE_URL=postgresql://retailerp:retailerp@localhost:5432/retailerp
JWT_SECRET=your-secret-key-change-in-production
JWT_REFRESH_SECRET=your-refresh-secret-change-in-production
JWT_EXPIRES_IN=1h
JWT_REFRESH_EXPIRES_IN=7d
API_PORT=3001
API_HOST=0.0.0.0
CORS_ORIGIN=http://localhost:5173
```

### Default Login Credentials
- **Password**: `RetailERP@2026` (all users)
- **Username pattern**: `{shopcode}_{role}{n}`
  - Shop codes: `ve`, `ne`, `vha`, `nhe`
  - Roles: `admin1`, `admin2`, `acc1`, `acc2`, `acc3`, `staff1`, `staff2`, `emp1`, `emp2`, `emp3`
- **Example**: `ve_admin1` / `RetailERP@2026` (Vinod Electronics admin)

---

## 5. Database Schema (31 Models)

### Enums (11)
| Enum | Values |
|------|--------|
| UserRole | admin, accountant, others, employee |
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

## 6. API Modules (17)

Each module follows the pattern: `routes.ts` -> `controller.ts` -> `service.ts` + `validation.ts`

All endpoints prefixed with `/api/v1`. Data is shop-scoped via JWT + `X-Shop-Id` header.

### Auth (`/api/v1/auth`)
| Method | Path | Description | Auth |
|--------|------|-------------|------|
| GET | /shops | List all shops (login dropdown) | Public |
| POST | /login | Login with username + password + shopId | Public |
| POST | /refresh | Refresh access token | Refresh token |
| POST | /logout | Revoke refresh token | Yes |
| GET | /me | Current user + shops | Yes |
| POST | /change-password | Change own password | Yes |
| POST | /switch-shop | Switch active shop (new token) | Admin/Accountant |

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
| POST | /:id/lumpsum-payment | Record lumpsum payment (FIFO across pending invoices) |

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
| GET | /search | Search schedules by ledger#/sale#/phone/name |
| GET | /:scheduleId | Schedule detail + all installments + payments |
| GET | /:scheduleId/timeline | Timeline visualization data |
| PUT | /:installmentId/pay | Record payment (3 scenarios) |
| PUT | /:installmentId/reschedule | Reschedule to new date |

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

### Roles
| Role | Web Access | Mobile Access | Description |
|------|-----------|---------------|-------------|
| **Admin** | Full | Yes* | Full access, dashboard, settings, user management |
| **Accountant** | Most (no dashboard/settings) | Yes* | Sales, purchases, installments, expenses |
| **Others** | Limited | No | Products, customers, sales (sanitized only), NO installments ever |
| **Employee** | None (blocked) | Yes | Installment collection only |

### Critical Data Isolation
- **"Others" role NEVER sees installment data**. The sidebar hides the link, routes are server-guarded, and the sales API returns data from `sale_records_sanitized` (all sales appear as full cash payment).
- **Decision is server-side**: The service layer decides which table to query based on `userRole`. Frontend cannot override.
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

### Installment Payment Scenarios
1. **Full Payment** -- pay the full remaining amount, optionally with a different payment date
2. **Reschedule** -- move installment to a new date (original marked as rescheduled)
3. **Partial + Reschedule** -- pay partial amount, remainder rescheduled to new date (creates new installment record)

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
1. `shops.seed.ts` -- 4 shops (VE, NE, VHA, NHE)
2. `users.seed.ts` -- 10 users per shop (2 admin, 3 accountant, 2 others, 3 employee)
3. `categories.seed.ts` -- 29 categories in hierarchy (TV > LED/OLED/QLED, Mobile > Smartphone/Feature Phone, AC > Window/Split/Tower, etc.) with brand dropdowns and HSN codes
4. `finance-companies.seed.ts` -- 3 NBFCs (Bajaj Finance, HDB, Home Credit)
5. `distributors.seed.ts` -- 5 distributors (Samsung, LG, Xiaomi, Godrej, Whirlpool)
6. `products.seed.ts` -- 100+ products distributed across shops and categories
7. `customers.seed.ts` -- 7 customers + 2 guarantors
8. `sales.seed.ts` -- 10 sales spanning Nov 2025 - Apr 2026 (all 4 types)
9. `installments.seed.ts` -- 47 installments with payment history, partial payments, rescheduling
10. `form-definitions.seed.ts` -- 3 form definitions (product, customer, distributor)

### Seed Credentials
- **Password**: `RetailERP@2026` (all users)
- **Username pattern**: `{shopcode}_{role}{n}` (e.g., `ve_admin1`, `ne_acc1`)

### Running Seeds
```bash
npm run db:seed    # Runs all seeds in order (idempotent -- checks for existing records)
```

---

## 10. Frontend Architecture

### State Management
| Layer | Tool | Purpose |
|-------|------|---------|
| Server state | TanStack Query | All API calls, caching, refetching |
| Auth state | Zustand (auth-store) | User, tokens, login/logout |
| Shop state | Zustand (shop-store) | Current shop context |
| UI state | Zustand (toast-store, sidebar-store) | Toasts, mobile sidebar |
| Form state | react-hook-form | Ephemeral per-page form data |

### API Layer
- `lib/api-client.ts` -- Axios instance with Authorization header + X-Shop-Id header
- Request interceptor: attaches JWT + shop ID
- Response interceptor: on 401, attempts token refresh; on failure, redirects to login
- Each domain has its own hook file (e.g., `hooks/useSales.ts`) wrapping TanStack Query

### Layout System
- `DashboardLayout` -- sidebar (collapsible on mobile) + header (shop switcher, notifications, user menu, breadcrumbs) + content area
- `AuthLayout` -- centered card for login page
- Dark mode: CSS variables, class-based toggle, localStorage persistence, flash prevention script in index.html

### Key Components
| Component | Purpose |
|-----------|---------|
| DataTable | Reusable paginated table with sorting |
| DynamicForm | Renders form from DB form_definitions |
| CategoryCascader | Hierarchical category picker |
| RecordPaymentDialog | 3-tab dialog for installment payments (full/reschedule/partial) |
| PaymentTimeline | Visual installment payment history |
| InvoicePDF | Indian GST tax invoice PDF generation |
| StatusBadge | 30+ status variants with dark mode support |
| PaymentSplitSection | Multi-mode payment (up to 3 splits) |

### Pages (13 sections)
| Section | Pages | Key Features |
|---------|-------|--------------|
| auth | LoginPage | Shop selector -> credentials, mobile-only user blocking |
| dashboard | DashboardPage | Summary cards, sales chart, top products, YoY, overdue |
| products | List, Add, Detail | Category cascader, dynamic attributes, audit timeline |
| distributors | List, Form, Detail | Tabs (products/payments/pending), lumpsum FIFO payment |
| purchases | List, Create, Detail | 5-step wizard, GST slabs, multi-serial, duplicate validation |
| customers | List, Form, Detail | Phone search, auto customer code |
| sales | List, Create, Detail | 4 sale types, GST-inclusive, multi-mode payment, invoice PDF, profit breakdown |
| installments | List, Detail | Search by ledger#, date range collections, overdue tracking, payment recording |
| transfers | List, Create, Detail | Product movement between shops |
| expenses | List, Form | Category-based expense tracking |
| bank | BankPage | CSV upload, reconciliation panel |
| employees | List, Form | Admin-only employee management |
| settings | Settings, FormBuilder, CategoryManager | Dynamic form editing, category tree with HSN codes |

---

## 11. Database Migrations

| # | Name | Date | Description |
|---|------|------|-------------|
| 1 | init | 2026-04-16 | Full initial schema (31 models, 11 enums) |
| 2 | add_purchase_gst_to_sales | 2026-04-17 | purchasePrice + purchaseGstAmount on sale_records |
| 3 | add_payment_breakdown | 2026-04-17 | paymentBreakdown JSON on sale_records |
| 4 | add_hsn_code_to_categories | 2026-04-17 | hsnCode on product_categories |

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

### Azure Resources (~$26/month)
- App Service B1 (API)
- PostgreSQL Flexible Server B1ms
- Static Web Apps (free tier)
- Blob Storage (hot tier, for uploads)

---

## 13. Git History (Recent Commits on develop)

```
7c68e87 Major update: HSN codes, payment breakdown, installment search, profit fixes
0ebe781 Add invoice PDF, fix EMI, Net Profit %, GST auto-select from purchase
027c80a GST-inclusive pricing, ITC profit tracking, form reorder, discount %
7020d01 Revamp sale form: auto-discount, GST dropdown, 50% down payment default
9c21fbe Fix: Purchase totals showing 0 + missing totalAmount in API payload
9a194e7 Theme: Modern ERP design + full dark mode (24 files)
a0bd089 Revamp purchase form: GST%, remove payment fields, multi-serial support
a44b97b Fix: Page refresh preserves current route instead of redirecting
```

**Branch strategy**: `develop` for active work, `main` for deployments (triggers CI/CD).

---

## 14. Known Patterns & Conventions

### API Pattern
Every module: `routes.ts` -> `controller.ts` -> `service.ts` + `validation.ts`
- Routes register endpoints with middleware chains
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
- **Web**: http://localhost:5173 (Vite HMR)
- **Login**: Select shop -> enter credentials -> redirected to dashboard (admin) or products (others)
- **Seeded data**: 4 shops, 40 users, 100+ products, 10 sales, 47 installments with payment history

### Common Issues
- **Page refresh logs out**: Fixed. Uses localStorage (not sessionStorage) + `/auth/me` hydration.
- **CORS errors**: Fixed. Fastify CORS configured with methods + headers.
- **Prisma Decimal in PDF**: Fixed. `formatRupees()` coerces with `Number()`.
- **Finance company UUID**: Fixed. Fetched from DB (was hardcoded with fake IDs).
