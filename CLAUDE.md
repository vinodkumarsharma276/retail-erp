# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

RetailERP — a full-stack application replacing Tally and Marg accounting software for 4 retail electronics/furniture/mobile shops. Each shop operates under a separate GST entity. The system handles products, sales (full payment and installment), distributors, customers, installment tracking, expenses, and bank statements.

## Tech Stack

- **Frontend Web**: React 19+, TypeScript, Vite, TailwindCSS, shadcn/ui
- **Frontend Mobile**: React Native (Expo), TypeScript — mobile app is planned for Employee role (installment collection)
- **Backend**: Node.js 22 LTS, TypeScript, Fastify
- **Database**: PostgreSQL 16+, Prisma ORM
- **Auth**: JWT with refresh tokens
- **Monorepo**: Turborepo (apps/web, apps/mobile, apps/api, packages/shared-types, packages/shared-utils)

## Commands

```bash
# Start all apps in dev mode
npm run dev

# Start only API
npm run dev --workspace=apps/api

# Start only web
npm run dev --workspace=apps/web

# Build all
npm run build

# Typecheck all
npm run typecheck

# Database
docker compose up -d                              # Start PostgreSQL
npm run db:generate --workspace=apps/api           # Generate Prisma client
npm run db:migrate --workspace=apps/api             # Run migrations
npm run db:seed --workspace=apps/api                # Seed database
npm run db:studio --workspace=apps/api              # Open Prisma Studio

# Install a dep in a specific workspace
npm install <pkg> --workspace=apps/api
npm install <pkg> --workspace=apps/web --save-dev
```

## Key Architectural Concepts

- **Multi-tenant by shop**: Every data record is scoped to a `shop_id`. Users are assigned to shops; admins can switch shops. The `shopScope` middleware in `apps/api/src/middleware/shop-scope.ts` injects `shopFilter` into every request.
- **DB-driven dynamic forms**: Product, Customer, Distributor, and Sale forms are rendered from `form_definitions`/`form_fields` tables. Changes in DB reflect on UI after refresh — no code deploy needed.
- **Dual sale recording**: `sale_records` holds real data (installment details, interest, file charges). `sale_records_sanitized` holds the same sales but all recorded as full cash payment — shown to "Others" role users who must never see installment information.
- **RBAC**: Admin (full access), Accountant (no dashboard), Others (no dashboard/installments, sees sanitized sales only), Employee (mobile-only, installment collection only). Enforced via `authorize()` middleware in `apps/api/src/middleware/rbac.ts`.
- **Installment lifecycle**: Self-finance (1%-3% interest, guarantor required) and company-finance (Bajaj Finance, HDB, Home Credit). Complex rescheduling: full pay, reschedule to new date, partial pay + reschedule. All history tracked as timeline.
- **Inter-shop transfers**: Item moving between shops = sale from one GST entity to another. Full item audit trail from purchase through transfers to final customer sale.
- **Ledger number**: Every sale has a `ledger_number` field — the manual account number from the physical office register, maintained for redundancy with offline records.

## API Modules (17 total)

Each API module in `apps/api/src/modules/<name>/` follows this pattern:
- `<name>.routes.ts` — Route registration with auth/RBAC guards
- `<name>.controller.ts` — Request handling, calls service, formats response
- `<name>.service.ts` — Business logic, Prisma queries
- `<name>.validation.ts` — Zod schemas for request validation

### Module list and prefixes

| Module | Prefix | Description |
|--------|--------|-------------|
| auth | `/api/v1/auth` | Login, logout, refresh, change password, shop switching |
| shops | `/api/v1/shops` | Shop CRUD, shop listing |
| users | `/api/v1/users` | User management |
| categories | `/api/v1/categories` | Product category hierarchy with custom attributes |
| products | `/api/v1/products` | Product CRUD with dynamic form fields, stock tracking |
| distributors | `/api/v1/distributors` | Distributor/supplier management |
| purchases | `/api/v1/purchases` | Purchase orders from distributors, stock intake |
| customers | `/api/v1/customers` | Customer CRUD with dynamic fields |
| sales | `/api/v1/sales` | Sale recording (full pay + installment), dual sanitized view |
| installments | `/api/v1/installments` | Installment schedules, payments, rescheduling |
| transfers | `/api/v1/transfers` | Inter-shop product transfers |
| expenses | `/api/v1/expenses` | Expense recording and tracking |
| bank | `/api/v1/bank` | Legacy bank accounts + manual reconciliation (no longer in the UI) |
| bank-statements | `/api/v1/bank-statements` | Statement analysis ported from LedgerLens (`../statement-translater`): parse PDF/Excel/CSV/image statements, auto-categorise (user rules → built-in rules → AI), flag for review, analytics, Excel/CSV export. Engine in `engine/` (raw SQL via Prisma); tables `bank_statements`, `statement_transactions`, `statement_rules`, `statement_settings` |
| dashboard | `/api/v1/dashboard` | Admin dashboard stats, charts, overdue items |
| forms | `/api/v1/forms` | Dynamic form builder (form definitions + fields) |
| employees | `/api/v1/employees` | Employee user management (admin-only) |
| notifications | `/api/v1/notifications` | Push notification stubs (Expo push token registration, notification list, mark-as-read) |

## Frontend Architecture

### Key Components (`apps/web/src/components/`)

| Component | Purpose |
|-----------|---------|
| ErrorBoundary | React class component error boundary with retry and go-home |
| LoadingSpinner / PageLoader | Centered spinner with optional message, page-level variant |
| EmptyState | Empty list state with icon, title, description, optional action |
| Toast / ToastContainer | Lightweight toast notifications (success/error/info/warning) |
| ConfirmDialog | Reusable confirmation modal with danger/default variants |
| FileUpload | Drag-and-drop file upload with image preview |
| DataTable | Reusable data table with sorting, pagination, search |
| DynamicForm | Renders forms from DB-driven form_definitions |
| DynamicAttributeFields | Category-specific attribute inputs |
| CategoryCascader | Hierarchical category picker |
| RecordPaymentDialog | Installment payment recording modal |
| PaymentTimeline | Visual installment payment history |
| UploadStatementDialog | Bank statement CSV/Excel upload |
| ReconciliationPanel | Bank transaction matching UI |
| StatusBadge | Color-coded status labels |
| DateRangePicker | Date range filter component |

### State Management

- **Zustand stores** in `apps/web/src/stores/`:
  - `auth-store.ts` — User auth state, login/logout, token management
  - `shop-store.ts` — Current shop context (id, name, code)
  - `toast-store.ts` — Toast notification queue with auto-dismiss
  - `sidebar-store.ts` — Mobile sidebar open/close state

### Layout System

- `DashboardLayout` — Main app shell with sidebar + header + content area
- `AuthLayout` — Centered card layout for login page
- `Sidebar` — Responsive: fixed overlay on mobile (with backdrop), always visible on desktop (lg+)
- `Header` — Shop switcher, global search, notifications bell, user info, logout, breadcrumbs; hamburger menu toggle on mobile

### Pages (`apps/web/src/pages/`)

- **auth**: LoginPage
- **dashboard**: DashboardPage (SummaryCards, SalesChart, TopProductsChart, YoYComparison, OverdueTable)
- **products**: ProductListPage, ProductAddPage, ProductDetailPage
- **distributors**: DistributorListPage, DistributorFormPage, DistributorDetailPage
- **purchases**: PurchaseListPage, PurchaseCreatePage, PurchaseDetailPage
- **customers**: CustomerListPage, CustomerFormPage, CustomerDetailPage
- **sales**: SaleListPage, SaleCreatePage, SaleDetailPage
- **installments**: InstallmentListPage, InstallmentDetailPage
- **transfers**: TransferListPage, TransferCreatePage, TransferDetailPage
- **expenses**: ExpenseListPage, ExpenseFormPage
- **bank**: "Bank Statements" sidebar section — BankDashboardPage (`/bank`), BankUploadPage, BankReviewPage, BankTransactionsPage, BankStatementsPage, BankRulesPage; shared `components/BankLayout` (date + shop filters) and `lib/` (api, queries, store)
- **employees**: EmployeeListPage, EmployeeFormPage
- **settings**: SettingsPage, FormBuilderPage, CategoryManagerPage

## Shared Packages

- `packages/shared-types` — TypeScript interfaces/enums shared across all apps. Import as `@retailerp/shared-types`.
- `packages/shared-utils` — EMI calculator, validators (phone/GST/PAN/Aadhaar), formatters (INR currency, dates), constants. Import as `@retailerp/shared-utils`.

## Seed Data Credentials

Default password for all seed users: `RetailERP@2026`
Username pattern: `{shopcode}_admin1`, `{shopcode}_acc1`, `{shopcode}_staff1`, `{shopcode}_emp1`
Shop codes: `ve` (Vinod Electronics), `ne` (Nishant Electronics), `vha` (Vinod Home Appliances), `nhe` (Nishant Home Electronics)

## Mobile App (apps/mobile)

Planned React Native (Expo) app for the Employee role. Employees are mobile-only users who handle installment collection in the field. The notifications module provides push token registration stubs that will connect to Expo Push Notification service.
