# Add Sale Form — Redesign Plan

> Created: 2026-04-25  
> Scope: `apps/web/src/pages/sales/SaleCreatePage.tsx`  
> Goal: Eliminate wasted right-side space, reduce vertical scrolling, match ERP/POS conventions.

---

## Why the current form feels empty

The page uses `max-w-7xl` with full-width stacked sections (Product → Ledger → Sale Type → Customer → Guarantor → Notes). Each section spans the entire width but only fills it when the inner grid expands to 4 columns. For sections with 1–2 fields (Ledger, Promise Date, Notes) the right 50–70% is empty.

Stacked-row forms like this are fine for short data entry (sign-up, profile edit) but ERP transaction screens have evolved to a **two-column "document + summary" layout** because:

- The user is filling many fields and needs an always-visible running total.
- Pricing/GST/EMI changes constantly while typing — putting it inline makes it scroll out of view.
- Sticky summary on the right turns "scroll back to verify" into "glance right".

---

## Reference patterns from established systems

| System | Pattern used on Add Sale / Invoice |
|---|---|
| **SAP Fiori — Create Sales Order** | 3-column object page: object header (top), form sections in a 2-column flexbox, sticky "Object Page Footer" with totals + Save action |
| **Odoo — Sales / POS** | Top header (customer, date, ref) + line-items table full width + sticky footer summary (Untaxed, Tax, Total). On wide screens, totals dock on the right |
| **Zoho Books — New Invoice** | Form on left ~70%, "Summary" card sticky on right ~30% showing Sub Total, Discount, GST, Adjustment, **Total** in big numbers |
| **QuickBooks Online — Invoice** | Header strip, full-width line items, right-side rail with Balance Due, Subtotal, Tax, Total |
| **Vyapar / TallyPrime** | Top: party + invoice no + date, middle: items grid, bottom-right docked: totals panel |
| **Stripe Dashboard — Create Invoice** | 2-column: form on left, live preview on right showing how the invoice will look |
| **Razorpay — Payment Link** | Left form, right "Live preview" card sticky, pinned action bar at bottom |

**Common ingredients:**
1. **Document header strip** — short, dense row at the top (customer, date, ref/ledger, type).
2. **Main work area** — line items / pricing in the centre, expanded full-width.
3. **Sticky summary rail on the right** — pricing, GST, EMI breakdown, totals.
4. **Sticky action bar at the bottom** — Save / Cancel / Save & New, never scrolls away.
5. **Inline-edit cards** for small entities (customer, guarantor) instead of full sections.

---

## Proposed layout for RetailERP "New Sale"

### Desktop (≥ `lg` 1024px) — 12-column grid

```
┌────────────────────────────────────────────────────────────────────────────┐
│ ← New Sale                                          [Cancel] [Save Sale]   │  ← page header (always visible)
├────────────────────────────────────────────────────────────────────────────┤
│                                                                            │
│  ┌──────────────────────────────────────────┐   ┌──────────────────────┐  │
│  │ DOCUMENT HEADER (1 row)                  │   │ SUMMARY (sticky)     │  │
│  │ Ledger No  | Sale Date | Sale Type tabs  │   │                      │  │
│  └──────────────────────────────────────────┘   │ Selling Price ₹    │  │
│                                                 │   GST (incl)   ₹    │  │
│  ┌──────────────────────────────────────────┐   │   GST to Govt  ₹    │  │
│  │ PRODUCT (compact card)                   │   │ ────────────────    │  │
│  │ [thumb] Brand Model • Serial • Color    │   │ Customer paid  ₹    │  │
│  │ MRP ₹  DP ₹              [Change]        │   │ Outstanding    ₹    │  │
│  └──────────────────────────────────────────┘   │                      │  │
│                                                 │ Profit (admin)  ₹   │  │
│  ┌──────────────────────────────────────────┐   │ Margin %        %   │  │
│  │ PRICING & PAYMENT                        │   │                      │  │
│  │ Selling Price | GST type | GST %         │   │ ─── EMI (if SF) ─── │  │
│  │ Payment splits (Cash/UPI/Card …)         │   │ Down Pay   ₹        │  │
│  │ For SF: Down Pay | Months | Interest %   │   │ EMI/mo     ₹        │  │
│  │ For CF: Finance Co | Financed Amount     │   │ Months     N        │  │
│  └──────────────────────────────────────────┘   │ Total Pay  ₹        │  │
│                                                 │                      │  │
│  ┌──────────────────────────────────────────┐   │ ─── Validation ──── │  │
│  │ CUSTOMER (compact card)                  │   │ ✓ Product           │  │
│  │ Selected: Name / Phone / City [Change]   │   │ ✓ Customer          │  │
│  │ — or — search + inline create form       │   │ ⚠ Down pay required │  │
│  └──────────────────────────────────────────┘   │                      │  │
│                                                 │ [Save Sale]          │  │
│  ┌──────────────────────────────────────────┐   └──────────────────────┘  │
│  │ GUARANTOR (only for Self Finance)        │                              │
│  │ Search / inline create                   │                              │
│  └──────────────────────────────────────────┘                              │
│                                                                            │
│  ┌──────────────────────────────────────────┐                              │
│  │ NOTES (collapsible, default collapsed)   │                              │
│  └──────────────────────────────────────────┘                              │
│                                                                            │
└────────────────────────────────────────────────────────────────────────────┘
```

**Column split**: `lg:grid-cols-12` — main column `lg:col-span-8`, summary rail `lg:col-span-4`.

### Tablet (768–1023px) — single column

- Document header row → 2-column inside (4 fields).
- Product/Customer cards → full width.
- **Summary becomes a sticky bottom bar** instead of a right rail (collapsed: just "Total ₹85,700 [Save]"; tap to expand).

### Mobile (< 768px)

- Sticky bottom action bar with `Total ₹85,700` + Save button.
- Tap expand chevron → drawer/sheet from bottom showing full summary breakdown.
- All other content single column with `space-y-3` and `p-3` cards.

---

## Concrete changes to `SaleCreatePage.tsx`

### 1. Add a 2-column shell at the page level

Replace the outer `<div className="max-w-7xl">` with:

```tsx
<div className="mx-auto max-w-[1600px]">
  {/* Sticky page header */}
  <div className="sticky top-0 z-20 -mx-2 mb-4 flex items-center justify-between gap-3 border-b bg-background/80 px-2 py-3 backdrop-blur sm:-mx-4 sm:px-4">
    <div className="flex items-center gap-2">
      <BackButton />
      <h1 className="text-lg font-semibold sm:text-xl">New Sale</h1>
    </div>
    <div className="flex items-center gap-2">
      <Button variant="ghost" onClick={() => navigate(-1)}>Cancel</Button>
      <Button type="submit" form="sale-form" disabled={!canSubmit}>
        {createSaleMutation.isPending ? 'Saving…' : 'Save Sale'}
      </Button>
    </div>
  </div>

  <form id="sale-form" onSubmit={handleSubmit(onSubmit)}
        className="grid grid-cols-1 gap-4 lg:grid-cols-12">
    {/* MAIN COLUMN */}
    <div className="space-y-4 lg:col-span-8">
      <DocumentHeaderCard />
      <ProductCard />
      <PricingPaymentCard />
      <CustomerCard />
      {saleType === SaleType.SELF_FINANCE && <GuarantorCard />}
      <NotesCard />
    </div>

    {/* SUMMARY RAIL */}
    <aside className="lg:col-span-4">
      <div className="lg:sticky lg:top-24">
        <SaleSummaryCard … />
      </div>
    </aside>
  </form>
</div>
```

### 2. Combine "Ledger + Date + Sale Type" into one document header card

Today these are 3 separate sections → 3 huge full-width cards. Combine into one compact strip:

```tsx
<section className="rounded-lg border bg-card p-3 sm:p-4">
  <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
    <Field label="Ledger No" required>
      <Input {...register('ledgerNumber')} placeholder="VE001" />
    </Field>
    <Field label="Sale Date" required>
      <Input type="date" {...register('saleDate')} />
    </Field>
    <Field label="Sale Type" className="col-span-2">
      <SaleTypeSegmented value={saleType} onChange={…} />
    </Field>
  </div>
</section>
```

Removes 2 redundant section headers + 2 sets of icons + ~120px of vertical padding.

### 3. Compact Product card

The current product display takes ~250px because it shows every attribute (serial, category, color, barcode, warranty, MRP, DP) in a 4-col grid with generous padding. Compress to 2 lines:

```tsx
<div className="flex items-center gap-3 rounded-lg border bg-card p-3">
  <div className="flex h-10 w-10 items-center justify-center rounded-md bg-primary/10">
    <Package className="h-5 w-5 text-primary" />
  </div>
  <div className="min-w-0 flex-1">
    <div className="flex items-center gap-2">
      <p className="truncate font-semibold">{brand} {model}</p>
      <StatusBadge … />
    </div>
    <p className="text-xs text-muted-foreground">
      {serial} • {color} • MRP {formatINR(mrp)} • DP {formatINR(dp)}
    </p>
  </div>
  <Button variant="ghost" size="sm">Change</Button>
</div>
```

Saves ~180px.

### 4. Move all running totals into a sticky `SaleSummaryCard`

Replace the inline `SellingPriceCalculations` and the various calc strips with one card on the right rail that shows:

- **Pricing**: Selling Price, GST included, GST to Govt
- **Payment**: Customer paid, Outstanding (computed from payment splits)
- **Profit (admin only)**: Margin ₹ + %, ITC, Net Profit
- **EMI (Self Finance)**: Down Payment, EMI/mo, Months, Total Repayment
- **Validation checklist**: Product ✓, Customer ✓, Guarantor (if SF), Down payment required, etc.
- **Submit** button at bottom of the card (in addition to header) — gives a second visible CTA without scrolling.

This card stays visible while user types, making the form feel like a "live invoice preview" similar to Stripe / Zoho Books.

### 5. Customer & Guarantor: inline cards, not full sections

Current: each gets its own large `section` with icon + heading. Convert to a compact selector card that expands inline when needed:

```tsx
<div className="rounded-lg border bg-card p-3">
  <div className="mb-2 flex items-center justify-between">
    <span className="text-sm font-medium">Customer</span>
    {selected && <Button variant="ghost" size="sm">Change</Button>}
  </div>
  {selected
    ? <CustomerLine customer={selected} />              // 1 line
    : <CustomerSearchOrCreate … />}                      // expands
</div>
```

### 6. Notes: collapsible

Default collapsed, `<details>` element. 90% of sales have no notes; saves 100px of empty space.

### 7. Mobile bottom action bar

```tsx
<div className="sticky bottom-0 left-0 right-0 z-30 border-t bg-card p-3 lg:hidden">
  <div className="flex items-center justify-between">
    <button type="button" onClick={() => setSummaryOpen(true)}
            className="flex flex-col items-start text-left">
      <span className="text-xs text-muted-foreground">Total</span>
      <span className="text-base font-semibold">{formatINR(sellingPrice)}</span>
    </button>
    <Button type="submit" form="sale-form" disabled={!canSubmit}>
      Save Sale
    </Button>
  </div>
</div>
```

A bottom-sheet drawer reveals the full summary on tap.

---

## Component breakdown (new files)

| File | Purpose |
|------|---------|
| `apps/web/src/pages/sales/components/DocumentHeader.tsx` | Ledger + Date + Sale Type segmented control |
| `apps/web/src/pages/sales/components/ProductCard.tsx` | Compact selected-product display + change/search |
| `apps/web/src/pages/sales/components/PricingPaymentCard.tsx` | All pricing/EMI/finance fields per sale type |
| `apps/web/src/pages/sales/components/CustomerCard.tsx` | Inline customer selector + create |
| `apps/web/src/pages/sales/components/GuarantorCard.tsx` | Inline guarantor selector + create (SF only) |
| `apps/web/src/pages/sales/components/SaleSummaryCard.tsx` | Sticky right-rail summary + validation + submit |
| `apps/web/src/pages/sales/components/MobileSummaryBar.tsx` | Bottom sticky bar + bottom-sheet drawer |
| `apps/web/src/components/Field.tsx` | Reusable label + control + error wrapper (also useful for other forms) |

These extract chunks already inlined in `SaleCreatePage.tsx` so the page becomes a thin orchestrator (~200 lines instead of 2400).

---

## Visual & UX details to copy from references

- **Field label above input, 12px, muted** (current is 14px medium). Modern ERPs run dense.
- **Numeric fields right-aligned text** for prices/quantities (Tally, Zoho).
- **Helper text only on focus or error**, not always visible (saves ~16px per field × 20 fields = 320px).
- **Required-asterisk in label, not next to label text** — cleaner.
- **Section headers as small capsule badges** ("Pricing", "Customer") inside the card, not big icon + h2.
- **Animated number changes** on the summary total when user types (Zoho/Stripe pattern, optional).
- **Keyboard shortcut hint** on Save button: `Ctrl+S`. Also add the actual handler — power users save many sales/day.

---

## Implementation order

1. **Phase A — Layout shell** (highest impact, lowest risk):  
   Wrap form in 12-col grid, build `SaleSummaryCard` (read-only), move totals into it. No field changes.
2. **Phase B — Compact cards**:  
   Replace tall sections with compact cards (Document Header, Product, Customer, Guarantor, Notes collapsible).
3. **Phase C — Mobile bottom bar**:  
   Sticky bottom total + drawer on small screens.
4. **Phase D — Polish**:  
   Field component, label restyle, numeric right-align, keyboard shortcut.

Each phase is independently shippable and reviewable.

---

## Estimated impact

| Metric | Before | After (target) |
|---|---|---|
| Form height (Full Payment) | ~1800px | ~900px |
| Form height (Self Finance) | ~3200px | ~1500px |
| Right-side empty space at 1440px | ~45% | ~5% |
| Time to fill (estimate, full payment) | ~90s | ~50s |
| Mobile horizontal scroll | sometimes | never |

---

## Open questions for the user

1. **Right rail or right drawer?** Always-visible rail (Zoho-style) vs collapsible drawer (more space for main form when not needed).
2. **Show a live invoice PDF preview** in the right rail on desktop? (Like Stripe.) Adds polish but requires re-rendering the PDF on every keystroke — could lag.
3. **Save & New** vs only **Save**? Useful for shops entering many sales per day.
4. Apply the same redesign template to **Add Purchase** and **Add Distributor** next?
