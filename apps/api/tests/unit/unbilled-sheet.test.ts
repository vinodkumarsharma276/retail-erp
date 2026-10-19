import { describe, expect, it } from 'vitest';
import { highestSeriesNumbers, parsePurchaseSheet, parseUnbilledSheet } from '@retailerp/shared-utils';

/**
 * A sheet of goods bought without a bill.
 *
 * One row is one item: no quantity, no tax, and an invoice number the shop
 * wrote itself. The product type is stated outright, so unlike the billed
 * sheet nothing has to be worked out from an item name.
 */

const HEADINGS = [
  'Date', 'Invoice No', 'Item Type', 'Item SubType', 'Model Number', 'Supplier Name', 'Dealer Price',
];

const sheet = (...rows: unknown[][]) => [HEADINGS, ...rows];

const WARDROBE = ['02-11-2026', 'FURN1', 'Furniture', 'Wardrobe', 'TRIVENI GT3D-PF', 'LAXMI ENTERPRISES', 8450];
const SOFA = ['04-11-2026', 'FURN3', 'Furniture', 'Sofa', 'ROYALE 3+1+1 BROWN', 'ANAND JI AGENCIES', 24500];
const ALMIRAH = ['03-11-2026', 'ALMR41', 'Almirah', '', 'GL3-PM', 'LAXMI ENTERPRISES', 6850];

describe('reading the sheet', () => {
  const parse = parseUnbilledSheet('Unbilled Purchases', sheet(WARDROBE, SOFA, ALMIRAH));

  it('recognises every column', () => {
    expect(parse.detected).toBe(true);
    expect(Object.keys(parse.columns.found).sort()).toEqual(
      ['date', 'dealerPrice', 'invoiceNumber', 'itemSubType', 'itemType', 'modelNumber', 'party'],
    );
    expect(parse.columns.unknown).toEqual([]);
    expect(parse.columns.missingRequired).toEqual([]);
  });

  it('treats each invoice number as its own purchase', () => {
    expect(parse.invoices.map((i) => i.invoiceNumber)).toEqual(['FURN1', 'ALMR41', 'FURN3']);
    expect(parse.invoices.every((i) => i.lines.length === 1)).toBe(true);
  });

  it('reads the type, sub-type and price', () => {
    const furn1 = parse.invoices.find((i) => i.invoiceNumber === 'FURN1')!;
    expect(furn1.itemType).toBe('Furniture');
    expect(furn1.lines[0].itemSubType).toBe('Wardrobe');
    expect(furn1.lines[0].modelNumber).toBe('TRIVENI GT3D-PF');
    expect(furn1.total).toBe(8450);
    expect(furn1.date).toBe('2026-11-02');
  });

  it('accepts a type with no sub-type, as an almirah has none', () => {
    const almr = parse.invoices.find((i) => i.invoiceNumber === 'ALMR41')!;
    expect(almr.lines[0].itemSubType).toBe('');
    expect(almr.issues).toEqual([]);
  });

  it('finds nothing wrong with a clean sheet', () => {
    expect(parse.lines.flatMap((l) => l.issues)).toEqual([]);
    expect(parse.invoices.flatMap((i) => i.issues)).toEqual([]);
    expect(parse.skipped).toEqual([]);
  });
});

describe('several items under one number', () => {
  it('gathers them into one purchase and totals it', () => {
    const second = ['02-11-2026', 'FURN1', 'Furniture', 'Bed', 'KING 6X6', 'LAXMI ENTERPRISES', 18900];
    const parse = parseUnbilledSheet('S', sheet(WARDROBE, second));
    expect(parse.invoices).toHaveLength(1);
    expect(parse.invoices[0].lines).toHaveLength(2);
    expect(parse.invoices[0].total).toBe(27350);
  });

  it('objects when one number names two suppliers', () => {
    const other = ['02-11-2026', 'FURN1', 'Furniture', 'Bed', 'KING 6X6', 'ANAND JI AGENCIES', 18900];
    const parse = parseUnbilledSheet('S', sheet(WARDROBE, other));
    expect(parse.invoices[0].issues.join(' ')).toContain('names two suppliers');
  });

  it('objects when one number carries two dates', () => {
    const later = ['09-11-2026', 'FURN1', 'Furniture', 'Bed', 'KING 6X6', 'LAXMI ENTERPRISES', 18900];
    const parse = parseUnbilledSheet('S', sheet(WARDROBE, later));
    expect(parse.invoices[0].issues.join(' ')).toContain('different dates');
  });
});

describe('rows that cannot be used', () => {
  it('flags a price that is not an amount', () => {
    const free = ['02-11-2026', 'FURN9', 'Furniture', 'Bed', 'KING 6X6', 'LAXMI ENTERPRISES', '-'];
    const parse = parseUnbilledSheet('S', sheet(free));
    expect(parse.lines[0].issues.join(' ')).toContain('not an amount above zero');
  });

  it('skips a total row and a row with no invoice number', () => {
    const total = ['', '', '', '', 'Grand Total', '', 99999];
    const stray = ['02-11-2026', '', 'Furniture', 'Bed', 'KING 6X6', 'LAXMI ENTERPRISES', 100];
    const parse = parseUnbilledSheet('S', sheet(WARDROBE, total, stray));
    expect(parse.invoices).toHaveLength(1);
    expect(parse.skipped.map((s) => s.reason)).toEqual([
      '"Grand Total" is a total, not an item.',
      '"KING 6X6" has no invoice number.',
    ]);
  });

  it('says what is missing when a required column is absent', () => {
    const noPrice = HEADINGS.filter((h) => h !== 'Dealer Price');
    const parse = parseUnbilledSheet('S', [noPrice, noPrice.map(() => 'x')]);
    expect(parse.detected).toBe(false);
    expect(parse.columns.missingRequired.map((m) => m.label)).toContain('Dealer Price');
  });
});

describe('not confusing it with the billed sheet', () => {
  it('declines a sheet that has a quantity column', () => {
    const billedish = [...HEADINGS, 'Qty'];
    const parse = parseUnbilledSheet('Purchase Details', [billedish, [...WARDROBE, 3]]);
    expect(parse.detected).toBe(false);
    expect(parse.reason).toContain('quantity column');
  });

  it('is not claimed by the billed reader, which needs an item and a quantity', () => {
    const billed = parsePurchaseSheet('Unbilled Purchases', sheet(WARDROBE, ALMIRAH));
    expect(billed.columns.missingRequired.map((m) => m.label).sort()).toEqual(['Item', 'Qty', 'Rate']);
  });
});

describe('carrying the numbering forward', () => {
  it('reports the highest number used against each set of letters', () => {
    const parse = parseUnbilledSheet('S', sheet(
      WARDROBE,
      ['04-11-2026', 'FURN6', 'Furniture', 'Bed', 'KING 6X6', 'LAXMI ENTERPRISES', 18900],
      ALMIRAH,
      ['11-11-2026', 'ALMR45', 'Almirah', '', 'ST2D-PM', 'L & S MARKETING', 8600],
    ));
    expect(Object.fromEntries(highestSeriesNumbers(parse))).toEqual({ FURN: 6, ALMR: 45 });
  });

  it('ignores a number it cannot read letters and digits out of', () => {
    const odd = ['02-11-2026', 'HANDWRITTEN', 'Furniture', 'Bed', 'KING 6X6', 'LAXMI ENTERPRISES', 100];
    const parse = parseUnbilledSheet('S', sheet(WARDROBE, odd));
    expect(Object.fromEntries(highestSeriesNumbers(parse))).toEqual({ FURN: 1 });
  });
});
