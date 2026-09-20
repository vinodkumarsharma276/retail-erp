# RetailERP — UI Improvement Plan

> Created: 2026-04-25  
> Status: Draft  
> Priority: High — directly affects daily usability for shop staff on phones and desktops

---

## Current State Assessment

| Area | Current | Problem |
|------|---------|---------|
| Component library | None — all UI is hand-coded HTML + Tailwind | Inconsistent sizing, no density control, massive code duplication |
| Form layout | `max-w-4xl` / `max-w-5xl` (896–1024px) left-aligned | Wastes 40%+ horizontal space on 1440p+ screens; forces unnecessary vertical scrolling |
| Input / button sizes | `py-2.5 text-sm` inputs, `px-4 py-2.5` buttons | Too tall for data-dense screens; significantly too large on mobile |
| Tables (DataTable) | Full HTML `<table>` with `overflow-x-auto` | Forces horizontal scrolling on mobile — unusable for 5+ column tables |
| Mobile layout | Sidebar toggle at `lg:1024px`, grids collapse at `sm:640px` | Gap between 640–1024px is poorly handled; no mobile-first card views |
| PWA install | Manifest configured, icons present, `display: standalone` | Missing `id` field, no in-app install prompt UI, dev-mode SW may interfere |
| shadcn/ui | CVA + clsx + twMerge installed (scaffolding) but `components/ui/` is empty | No reusable primitives — every input/select/button is copy-pasted Tailwind |

---

## Decision: Ant Design vs shadcn/ui vs Current

| Criteria | Ant Design | shadcn/ui | Stay with raw Tailwind |
|----------|-----------|-----------|----------------------|
| Bundle size | ~400KB+ gzipped | 0 KB (copy-paste) | 0 KB |
| Mobile density | Good (compact mode) | Manual | Manual |
| Migration effort | **Full rewrite** of every page | Incremental — add components one at a time | No change |
| Dark mode | Needs ConfigProvider theming | Already uses our CSS vars | Already works |
| Tailwind integration | Conflicts (uses CSS-in-JS) | Native Tailwind | Native |
| Customisation | Override antd tokens | Full control of source | Full control |
| Form integration | Own `<Form>` — conflicts with react-hook-form | Works with RHF | Works with RHF |

### Recommendation: **shadcn/ui** (incremental adoption)

- Zero additional bundle size (components are copied into `components/ui/`)
- Already have the scaffolding (`class-variance-authority`, `clsx`, `tailwind-merge`)
- Works perfectly with existing Tailwind config, dark mode, and react-hook-form
- Can adopt component-by-component without a full rewrite
- Ant Design would require replacing react-hook-form, reworking dark mode, and rewriting every page simultaneously

---

## Phase 1: Foundation — Component Library + Density (Priority: Critical)

### 1.1 Install shadcn/ui CLI and add base components

```bash
# From apps/web/
npx shadcn@latest init
npx shadcn@latest add input label select button textarea checkbox
npx shadcn@latest add dialog sheet dropdown-menu popover
npx shadcn@latest add table card badge separator
npx shadcn@latest add tabs tooltip scroll-area
```

This populates `components/ui/` with properly-sized, accessible, keyboard-navigable primitives.

### 1.2 Create compact density override

Add a global density layer to `index.css`:

```css
/* Compact density for data-heavy ERP */
@layer components {
  .density-compact input,
  .density-compact select,
  .density-compact textarea {
    @apply py-1.5 text-sm;          /* was py-2.5 */
  }
  .density-compact button {
    @apply px-3 py-1.5 text-sm;     /* was px-4 py-2.5 */
  }
  .density-compact label {
    @apply text-xs font-medium;      /* was text-sm */
  }
  .density-compact h1 { @apply text-xl; }     /* was text-2xl */
  .density-compact h2 { @apply text-lg; }     /* was text-xl */
  .density-compact section { @apply p-4; }    /* was p-6 */
}
```

Apply `density-compact` on the `<DashboardLayout>` root wrapper so it cascades everywhere.

### 1.3 Replace raw HTML inputs with shadcn/ui components

Every page currently has:
```tsx
<input className="w-full rounded-md border bg-background px-3 py-2.5 text-sm ..." />
```

Replace with:
```tsx
import { Input } from '@/components/ui/input';
<Input placeholder="..." />
```

This fixes sizing consistency and adds proper focus rings, disabled states, and aria attributes.

**Scope**: All form pages (~12 pages), all dialogs (~5 components).

---

## Phase 2: Form Layout — Use Full Width (Priority: High)

### 2.1 Remove restrictive `max-w-*` containers

Current form pages use `max-w-4xl` (896px) or `max-w-5xl` (1024px), leaving ~40% of a 1440px screen empty.

**Change**: Remove `max-w-*` from form containers or increase to `max-w-7xl` (1280px) with wider grids:

| Page | Current | New |
|------|---------|-----|
| Sales | `max-w-5xl`, 1→2→3 cols | `max-w-7xl`, 1→2→3→**4 cols** |
| Purchases | `max-w-5xl`, 1→2→3 cols | `max-w-7xl`, 1→2→3→**4 cols** |
| Customers | `max-w-4xl`, 1→2→3 cols | `max-w-6xl`, 1→2→**3→4 cols** |
| Distributors | `max-w-4xl`, 1→2→3 cols | `max-w-6xl`, 1→2→**3→4 cols** |
| Products | `max-w-4xl` | `max-w-6xl` |
| Expenses | `max-w-3xl` | `max-w-5xl` |
| Employees | `max-w-3xl` | `max-w-4xl` |

### 2.2 Add `xl:grid-cols-4` breakpoint to form grids

```tsx
// Before
className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3"

// After
className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4"
```

This puts 4 fields per row on wide screens, drastically reducing form height.

### 2.3 Tighten section spacing

```tsx
// Before: space-y-6 between sections, p-6 padding
<section className="rounded-lg border bg-card p-6">
  <div className="space-y-6">

// After: space-y-4 between sections, p-4 padding
<section className="rounded-lg border bg-card p-4">
  <div className="space-y-4">
```

**Estimated impact**: Forms that required 2 screens of scrolling will fit in 1 or 1.5 screens.

---

## Phase 3: Mobile-First Responsive Tables (Priority: High)

### 3.1 Add card-view mode to DataTable for mobile

On screens below `md:` (768px), transform each table row into a stacked card:

```
┌──────────────────────────────┐
│  Customer Name     ▸ Detail  │
│  Phone: 9811...              │
│  Amount: ₹40,000   Status ● │
└──────────────────────────────┘
```

Implementation approach:
- Add `mobileColumns` prop to `DataTable` — specifies which 2–3 columns to show in card mode
- Add `mobileTitle` prop — which column is the card title
- Render `<div>` cards below `md:`, standard `<table>` above

### 3.2 Column hiding on tablets

Between `md:` and `lg:`, hide low-priority columns (notes, created date, etc.):
- Add `hiddenBelow?: 'sm' | 'md' | 'lg'` to column definition
- Apply `hidden md:table-cell` classes automatically

### 3.3 Sticky action column

On desktop, the last column (actions/view button) should be `sticky right-0` so it's always visible even when scrolling horizontally.

---

## Phase 4: Mobile-Specific Fixes (Priority: High)

### 4.1 Sidebar width on mobile

Current: `w-64` (256px) — occupies 80% of a 320px screen.  
Change: `w-64 sm:w-64` → add `max-w-[85vw]` so it never overflows on very small screens.

### 4.2 Form grid: true single-column on mobile

Ensure all grids start at `grid-cols-1` on mobile (already mostly done, but some use `grid-cols-2` base which forces 2 narrow columns on 320px screens).

### 4.3 Action buttons: full-width on mobile

```tsx
// Before
<button className="px-4 py-2.5">Save</button>

// After (with shadcn Button)
<Button className="w-full sm:w-auto">Save</Button>
```

### 4.4 Reduce padding on mobile

DashboardLayout main area currently: `p-3 sm:p-4 md:p-6`  
Change to: `p-2 sm:p-4 md:p-6` — saves 8px on each side (16px total on 360px = ~4.5%).

### 4.5 Bottom-fixed action bar for forms on mobile

On form pages, the submit/cancel buttons should be sticky at the bottom of the screen on mobile instead of requiring scroll to the end:

```tsx
<div className="sticky bottom-0 border-t bg-card p-3 sm:static sm:border-0 sm:bg-transparent sm:p-0">
  <Button>Save</Button>
  <Button variant="outline">Cancel</Button>
</div>
```

---

## Phase 5: PWA Install Experience (Priority: Medium)

### 5.1 Fix manifest for install prompt

The browser's "Add to Home Screen" prompt requires:
1. ✅ Valid `manifest.webmanifest` — generated by vite-plugin-pwa
2. ✅ Service worker registered
3. ✅ HTTPS (or localhost) — yes
4. ✅ `display: standalone` — yes
5. ✅ `start_url` — yes
6. ❓ `id` field — **missing** (required by Chrome for stable app identity)
7. ❓ `prefer_related_applications` — not set
8. ❓ Production build — **dev-mode SW may not trigger install**

**Fix in `vite.config.ts`**:
```ts
manifest: {
  id: '/',                          // ADD: stable app identity
  name: 'RetailERP',
  short_name: 'RetailERP',
  // ... existing fields
  categories: ['business', 'finance'],  // ADD
  screenshots: [                         // ADD: required for "richer install UI"
    { src: '/screenshots/desktop.png', sizes: '1280x720', type: 'image/png', form_factor: 'wide' },
    { src: '/screenshots/mobile.png', sizes: '360x640', type: 'image/png', form_factor: 'narrow' },
  ],
}
```

### 5.2 Add in-app install prompt

Create an `InstallPrompt` component that captures the `beforeinstallprompt` event and shows a banner:

```
┌────────────────────────────────────────────────┐
│ 📱 Install RetailERP for quick access  [Install] [✕] │
└────────────────────────────────────────────────┘
```

- Store dismissal in `localStorage` (don't show again for 7 days)
- On iOS (no `beforeinstallprompt`), show manual instructions: "Tap Share → Add to Home Screen"
- Place inside `DashboardLayout` above the main content area

### 5.3 Generate proper screenshots

Add `apps/web/public/screenshots/` with:
- `desktop.png` (1280×720) — dashboard view
- `mobile.png` (360×640) — sales list view

These trigger Chrome's "richer install UI" with preview images.

### 5.4 Verify production build

The install prompt **only fires on production builds** (dev SW from `devOptions.enabled: true` does not trigger `beforeinstallprompt` in most browsers). Test by:

```bash
npm run build --workspace=apps/web
npx serve apps/web/dist
```

Then open in Chrome — the install prompt should appear in the address bar.

---

## Phase 6: Polish & Consistency (Priority: Low)

### 6.1 Standardise page headers

Create a `PageHeader` component:
```tsx
<PageHeader
  title="New Sale"
  breadcrumbs={[{ label: 'Sales', href: '/sales' }, { label: 'New' }]}
  actions={<Button>Scan Invoice</Button>}
/>
```

Currently every page hand-codes its own header with different sizing/spacing.

### 6.2 Loading states

Replace `PageLoader` (full-page spinner) with skeleton screens for list pages — shows the layout structure immediately while data loads.

### 6.3 Form error messages

Currently error messages are plain red text below inputs with inconsistent spacing. Extract a `FormField` wrapper:
```tsx
<FormField label="Phone" error={errors.phone?.message} required>
  <Input {...register('phone')} />
</FormField>
```

### 6.4 Toast positioning on mobile

Move toast container from top-right to bottom-center on mobile (`bottom-4 left-1/2 -translate-x-1/2 sm:top-4 sm:right-4 sm:left-auto sm:translate-x-0`).

---

## Implementation Order & Effort Estimates

| # | Phase | Scope | Pages Affected |
|---|-------|-------|----------------|
| 1 | shadcn/ui setup + density | Foundation | All |
| 2 | Form layout (wider + denser) | 12 form pages | Sales, Purchase, Customer, Distributor, Product, Expense, Employee, Transfer, Settings |
| 3 | Mobile DataTable (card view) | DataTable component + 8 list pages | All list pages |
| 4 | Mobile-specific fixes | Layout + forms | DashboardLayout, Sidebar, all forms |
| 5 | PWA install prompt | Vite config + 1 new component | DashboardLayout |
| 6 | Polish | Components + pages | All |

### Recommended execution

- **Phase 1 + 5** first — foundation + PWA fix (unblocks everything else + quick win for install)
- **Phase 2** next — biggest visual impact for desktop users (forms feel cramped currently)
- **Phase 3 + 4** together — mobile-first pass
- **Phase 6** last — polish

---

## Files to Modify (Summary)

| File / Directory | Changes |
|-----------------|---------|
| `apps/web/src/components/ui/` | Add shadcn/ui components (Input, Button, Select, Label, Table, Card, Dialog, Sheet, etc.) |
| `apps/web/src/index.css` | Density layer, toast mobile positioning |
| `apps/web/src/layouts/DashboardLayout.tsx` | Add `density-compact`, install prompt banner |
| `apps/web/src/layouts/components/Sidebar.tsx` | `max-w-[85vw]` on mobile |
| `apps/web/src/components/DataTable.tsx` | Card-view for mobile, column hiding, sticky actions |
| `apps/web/src/pages/sales/SaleCreatePage.tsx` | Wider container, xl:4 cols, shadcn inputs |
| `apps/web/src/pages/purchases/PurchaseCreatePage.tsx` | Same |
| `apps/web/src/pages/customers/CustomerFormPage.tsx` | Same |
| `apps/web/src/pages/distributors/DistributorFormPage.tsx` | Same |
| `apps/web/src/pages/products/ProductAddPage.tsx` | Same |
| `apps/web/src/pages/expenses/ExpenseFormPage.tsx` | Same |
| `apps/web/src/pages/employees/EmployeeFormPage.tsx` | Same |
| `apps/web/src/pages/transfers/TransferCreatePage.tsx` | Same |
| `apps/web/vite.config.ts` | Manifest `id`, `categories`, `screenshots` |
| `apps/web/src/components/InstallPrompt.tsx` | New — PWA install banner |
| `apps/web/src/components/FormField.tsx` | New — label + input + error wrapper |
| `apps/web/src/components/PageHeader.tsx` | New — standardised page header |
| `apps/web/public/screenshots/` | New — desktop.png + mobile.png for richer install UI |

---

## Out of Scope (Not Recommended)

- **Ant Design migration**: Would require full rewrite of every component and page, conflicts with Tailwind and react-hook-form, adds 400KB+ to bundle. Not justified for this application.
- **React Native Web**: The mobile PWA approach is sufficient for the Employee role; a responsive web app covers admin/accountant use cases on phones.
- **Server-side rendering**: Not needed — this is a private ERP, not public-facing.
