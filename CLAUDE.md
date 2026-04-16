# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

RetailERP — a full-stack application replacing Tally and Marg accounting software for 4 retail electronics/furniture/mobile shops. Each shop operates under a separate GST entity. The system handles products, sales (full payment and installment), distributors, customers, installment tracking, expenses, and bank statements.

## Tech Stack

- **Frontend Web**: React 19+, TypeScript, Vite, TailwindCSS, shadcn/ui
- **Frontend Mobile**: React Native (Expo), TypeScript
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

## API Module Pattern

Each API module in `apps/api/src/modules/<name>/` follows:
- `<name>.routes.ts` — Route registration with auth/RBAC guards
- `<name>.controller.ts` — Request handling, calls service, formats response
- `<name>.service.ts` — Business logic, Prisma queries
- `<name>.validation.ts` — Zod schemas for request validation

## Shared Packages

- `packages/shared-types` — TypeScript interfaces/enums shared across all apps. Import as `@retailerp/shared-types`.
- `packages/shared-utils` — EMI calculator, validators (phone/GST/PAN/Aadhaar), formatters (INR currency, dates), constants. Import as `@retailerp/shared-utils`.

## Seed Data Credentials

Default password for all seed users: `RetailERP@2026`
Username pattern: `{shopcode}_admin1`, `{shopcode}_acc1`, `{shopcode}_staff1`, `{shopcode}_emp1` (shop codes: ve, ne, vha, nhe)
