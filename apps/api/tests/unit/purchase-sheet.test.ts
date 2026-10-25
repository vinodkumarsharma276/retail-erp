import { describe, expect, it } from 'vitest';
import {
  imeisPerUnit,
  lineKey,
  parseImeiSheet,
  parsePurchaseSheet,
  parseSheetDate,
  splitImeis,
  type PurchaseSheetLine,
} from '@retailerp/shared-utils';

/**
 * The shop's own purchase sheet: one flat row per item line, invoice details
 * repeated on each row, IMEI numbers on a second sheet.
 */

const HEADINGS = [
  'Date', 'Voucher No.', 'Supplier Invoice No.', 'Party', 'Item',
  'Qty', 'Rate', 'Amount (before tax)', 'IMEI Count', 'IMEI / Description',
];

function row(values: Partial<Record<string, string | number>>): unknown[] {
  return HEADINGS.map((heading) => values[heading] ?? '');
}

function sheet(...rows: unknown[][]): unknown[][] {
  return [HEADINGS, ...rows];
}

const TV = row({
  Date: '01-10-2026', 'Voucher No.': 'BILL-682', 'Supplier Invoice No.': 'LG-26-27/682',
  Party: 'NAVRANG MARKETING', Item: 'LG LED LCD 43NU875BPLA',
  Qty: 20, Rate: 22457.69, 'Amount (before tax)': 449153.8, 'IMEI Count': 0,
});
const WASHER = row({
  Date: '01-10-2026', 'Voucher No.': 'BILL-682', 'Supplier Invoice No.': 'LG-26-27/682',
  Party: 'NAVRANG MARKETING', Item: 'LG WASING MACHINE T80KMMB3Z',
  Qty: 3, Rate: 13050.88, 'Amount (before tax)': 39152.64, 'IMEI Count': 0,
});
const PHONES = row({
  Date: '09-10-2026', 'Voucher No.': 'BILL-4518', 'Supplier Invoice No.': 'N/26-27/4518',
  Party: 'SHIVALIK DEVICES PVT LTD', Item: 'VIVO S2 (8+128G) SILK WHITE',
  Qty: 2, Rate: 20000, 'Amount (before tax)': 40000, 'IMEI Count': 2,
  'IMEI / Description': '867335084176793, 867335084177510',
});

describe('reading dates the way Indian accounting writes them', () => {
  it('reads day first', () => {
    expect(parseSheetDate('01-10-2026')).toBe('2026-10-01');
    expect(parseSheetDate('16-10-2026')).toBe('2026-10-16');
    // Ambiguous, and day-first is what the sheet means.
    expect(parseSheetDate('05-06-2026')).toBe('2026-06-05');
  });

  it('still accepts ISO, named months and Excel serials', () => {
    expect(parseSheetDate('2026-10-01')).toBe('2026-10-01');
    expect(parseSheetDate('1-Oct-26')).toBe('2026-10-01');
    expect(parseSheetDate(46296)).toBe('2026-10-01');
    expect(parseSheetDate('')).toBe('');
    expect(parseSheetDate('not a date')).toBe('');
  });
});

describe('splitting an IMEI cell', () => {
  it('takes digits only, however they are separated', () => {
    expect(splitImeis('867335084176793, 867335084177510')).toEqual(['867335084176793', '867335084177510']);
    expect(splitImeis('867335084176793/867335084177510')).toHaveLength(2);
    expect(splitImeis('')).toEqual([]);
  });
});

/**
 * Two faults that kept real numbers off real handsets, both found on the
 * shop's own April-to-October sheet.
 */
describe('identifiers that are not plain IMEIs', () => {
  it('keeps a serial containing a slash whole', () => {
    // A Xiaomi tablet, written "72666/X5ZS01828" on one line of one unit.
    // Split on the slash it became two identifiers and the line was refused.
    expect(splitImeis('72666/X5ZS01828')).toEqual(['72666/X5ZS01828']);
  });

  it('still splits two IMEIs written either side of a slash', () => {
    expect(splitImeis('867335084176793/867335084177510')).toEqual([
      '867335084176793',
      '867335084177510',
    ]);
  });

  it('reduces an IMEI to its digits but leaves anything else alone', () => {
    expect(splitImeis('IMEI: 867335084176793')).toEqual(['867335084176793']);
    expect(splitImeis('BOX DAMAGED')).toEqual(['BOX DAMAGED']);
  });

  it('reads the IMEI sheet the same way, so the two sides compare equal', () => {
    const imeiSheet = parseImeiSheet('IMEI List', [
      ['Supplier Invoice No.', 'Supplier', 'Item', 'IMEI'],
      ['INV-1021', 'SATYAM SALES PVT LTD', 'XIAOMI PAD 8 (8+128) GREY', '72666/X5ZS01828'],
    ]);
    expect(imeiSheet.byLine.get(lineKey('INV-1021', 'SATYAM SALES PVT LTD', 'XIAOMI PAD 8 (8+128) GREY')))
      .toEqual(['72666/X5ZS01828']);
  });
});

describe('one bill listing the same item on two lines', () => {
  // Both lines say two units and name their own two numbers, but the IMEI
  // sheet is keyed by invoice, supplier and item, so all four pool together
  // and fit neither line.
  const pooled = ['867738085585724', '867738088554727', '862554079877703', '867738080183541'];
  const first: PurchaseSheetLine = {
    rowNumber: 2, date: '2026-09-06', invoiceNumber: 'INV-2627-4078', voucherNumber: 'BILL-4078',
    party: 'SATYAM SALES PVT LTD', item: 'REDMI 15C 5G 4+128 PURPLE', quantity: 2,
    rate: 14893.27, amount: 29786.54, imeiCount: 2,
    imeis: ['867738085585724', '867738088554727'], issues: [],
  } as PurchaseSheetLine;
  const second: PurchaseSheetLine = {
    ...first, rowNumber: 3, imeis: ['862554079877703', '867738080183541'],
  } as PurchaseSheetLine;

  it('falls back to the column on each line, which keeps them apart', () => {
    expect(imeisPerUnit(first, pooled).perUnit).toEqual([
      ['867738085585724'],
      ['867738088554727'],
    ]);
    expect(imeisPerUnit(second, pooled).perUnit).toEqual([
      ['862554079877703'],
      ['867738080183541'],
    ]);
  });

  it('shares an uneven pool out by what each line claims', () => {
    // Nine units on one line, one on another, ten numbers pooled.
    const nine = { ...first, quantity: 9, imeiCount: 9, imeis: Array.from({ length: 9 }, (_, i) => `86773808760${1000 + i}`) } as PurchaseSheetLine;
    const result = imeisPerUnit(nine, [...nine.imeis, '862554078717082']);
    expect(result.issue).toBeNull();
    expect(result.perUnit).toHaveLength(9);
    expect(result.perUnit.flat()).toEqual(nine.imeis);
  });

  it('still refuses when neither source fits', () => {
    const odd = { ...first, quantity: 3, imeiCount: null, imeis: ['1', '2'] } as PurchaseSheetLine;
    expect(imeisPerUnit(odd, ['1', '2']).issue).toContain('do not divide evenly');
  });

  it('still refuses when both fit but name different numbers', () => {
    const other = { ...first, imeis: ['111111111111111', '222222222222222'] } as PurchaseSheetLine;
    expect(imeisPerUnit(other, ['333333333333333', '444444444444444']).issue).toContain('disagree');
  });
});

describe('reading the sheet', () => {
  const parse = parsePurchaseSheet('Purchase Details', sheet(TV, WASHER, PHONES));

  it('recognises every declared column', () => {
    expect(parse.detected).toBe(true);
    expect(parse.headerRow).toBe(1);
    expect(Object.keys(parse.columns.found).sort()).toEqual(
      ['amount', 'date', 'imeiCount', 'imeis', 'invoiceNumber', 'item', 'party', 'quantity', 'rate', 'voucherNumber'],
    );
    expect(parse.columns.unknown).toEqual([]);
    expect(parse.columns.missingRequired).toEqual([]);
  });

  it('groups rows of one bill into a single invoice', () => {
    expect(parse.invoices).toHaveLength(2);
    const lg = parse.invoices.find((i) => i.invoiceNumber === 'LG-26-27/682')!;
    expect(lg.lines).toHaveLength(2);
    expect(lg.units).toBe(23);
    expect(lg.taxableValue).toBeCloseTo(488306.44, 2);
    expect(lg.date).toBe('2026-10-01');
    expect(lg.party).toBe('NAVRANG MARKETING');
  });

  it('keeps Excel row numbers so a problem can be pointed at', () => {
    expect(parse.lines.map((l) => l.rowNumber)).toEqual([2, 3, 4]);
  });

  it('finds nothing wrong with a clean sheet', () => {
    expect(parse.lines.flatMap((l) => l.issues)).toEqual([]);
    expect(parse.invoices.flatMap((i) => i.issues)).toEqual([]);
    expect(parse.skipped).toEqual([]);
  });

  it('records no tax when the sheet carries none', () => {
    expect(parse.invoices.every((i) => i.gstAmount === 0)).toBe(true);
  });
});

describe('telling the person what changed about their sheet', () => {
  it('reports a column it does not understand, with examples', () => {
    const withExtra = [
      [...HEADINGS, 'Warranty Months'],
      [...TV, '24'],
      [...WASHER, '12'],
    ];
    const parse = parsePurchaseSheet('Purchase Details', withExtra);
    expect(parse.detected).toBe(true);
    expect(parse.columns.unknown).toHaveLength(1);
    expect(parse.columns.unknown[0].heading).toBe('Warranty Months');
    expect(parse.columns.unknown[0].samples).toEqual(['24', '12']);
    // Its values are kept, so nothing is lost while it waits to be mapped.
    expect(parse.lines[0].extras).toEqual({ 'Warranty Months': '24' });
  });

  it('reports a required column that has gone missing, and why it mattered', () => {
    const noQty = HEADINGS.filter((h) => h !== 'Qty');
    const parse = parsePurchaseSheet('Purchase Details', [noQty, noQty.map(() => 'x')]);
    expect(parse.columns.missingRequired.map((m) => m.label)).toContain('Qty');
    expect(parse.columns.missingRequired[0].purpose).toBeTruthy();
  });

  it('picks up a tax column the moment it appears', () => {
    const withGst = [
      [...HEADINGS, 'GST Rate %', 'GST Amount'],
      [...TV, '18', '80847.68'],
    ];
    const parse = parsePurchaseSheet('Purchase Details', withGst);
    expect(parse.columns.unknown).toEqual([]);
    expect(parse.lines[0].gstRate).toBe(18);
    expect(parse.lines[0].gstAmount).toBeCloseTo(80847.68, 2);
    expect(parse.invoices[0].gstAmount).toBeCloseTo(80847.68, 2);
  });

  it('refuses a sheet that is not a purchase sheet at all', () => {
    const parse = parsePurchaseSheet('Sheet1', [['a', 'b'], ['1', '2']]);
    expect(parse.detected).toBe(false);
    expect(parse.reason).toContain('No heading row');
  });
});

describe('catching rows that do not add up', () => {
  it('flags a line whose amount disagrees with quantity times rate', () => {
    const wrong = row({
      Date: '01-10-2026', 'Supplier Invoice No.': 'X-1', Party: 'A', Item: 'Thing',
      Qty: 2, Rate: 100, 'Amount (before tax)': 500,
    });
    const parse = parsePurchaseSheet('S', sheet(wrong));
    expect(parse.lines[0].issues.join(' ')).toContain('Quantity times rate is ₹200');
  });

  it('flags one invoice whose rows disagree about the date', () => {
    const a = row({ Date: '01-10-2026', 'Supplier Invoice No.': 'X-1', Party: 'A', Item: 'One', Qty: 1, Rate: 10 });
    const b = row({ Date: '02-10-2026', 'Supplier Invoice No.': 'X-1', Party: 'A', Item: 'Two', Qty: 1, Rate: 10 });
    const parse = parsePurchaseSheet('S', sheet(a, b));
    expect(parse.invoices[0].issues.join(' ')).toContain('different dates');
  });

  it('skips a total row and a row with no invoice number', () => {
    const total = row({ Item: 'Grand Total', Qty: 99 });
    const stray = row({ Date: '01-10-2026', Item: 'Orphan', Qty: 1, Rate: 5 });
    const parse = parsePurchaseSheet('S', sheet(TV, total, stray));
    expect(parse.invoices).toHaveLength(1);
    expect(parse.skipped.map((s) => s.reason)).toEqual([
      '"Grand Total" is a total, not an item.',
      '"Orphan" has no invoice number.',
    ]);
  });
});

describe('the IMEI sheet', () => {
  const IMEI_HEADINGS = ['Date', 'Voucher No.', 'Supplier Invoice No.', 'Party', 'Item', 'IMEI'];
  const imeiRow = (item: string, imei: string) =>
    ['09-10-2026', 'BILL-4518', 'N/26-27/4518', 'SHIVALIK DEVICES PVT LTD', item, imei];

  it('reads the numbers and ties each to its line', () => {
    const parsed = parseImeiSheet('IMEI List', [
      IMEI_HEADINGS,
      imeiRow('VIVO S2 (8+128G) SILK WHITE', '867335084176793'),
      imeiRow('VIVO S2 (8+128G) SILK WHITE', '867335084177510'),
    ])!;
    expect(parsed.total).toBe(2);
    const key = lineKey('N/26-27/4518', 'SHIVALIK DEVICES PVT LTD', 'VIVO S2 (8+128G) SILK WHITE');
    expect(parsed.byLine.get(key)).toEqual(['867335084176793', '867335084177510']);
  });

  it('is not mistaken for the purchase sheet', () => {
    expect(parseImeiSheet('Nope', [['a', 'b'], ['1', '2']])).toBeNull();
  });
});

describe('giving each unit its own IMEI numbers', () => {
  const line = (quantity: number, imeis: string[], imeiCount: number | null = null): PurchaseSheetLine => ({
    rowNumber: 2, date: '2026-10-09', voucherNumber: '', invoiceNumber: 'N-1', party: 'A',
    item: 'VIVO', quantity, rate: 1, amount: quantity, imeis, imeiCount,
    gstAmount: null, gstRate: null, gstin: '', hsnCode: '', mrp: null, colour: '',
    serialNumber: '', extras: {}, issues: [],
  });

  it('gives one each when there is one per unit', () => {
    const { perUnit, issue } = imeisPerUnit(line(3, ['111', '222', '333']));
    expect(issue).toBeNull();
    expect(perUnit).toEqual([['111'], ['222'], ['333']]);
  });

  it('gives a pair each for dual-SIM handsets', () => {
    const { perUnit, issue } = imeisPerUnit(line(2, ['111', '222', '333', '444']));
    expect(issue).toBeNull();
    expect(perUnit).toEqual([['111', '222'], ['333', '444']]);
  });

  it('refuses to split a count that divides neither way', () => {
    const { perUnit, issue } = imeisPerUnit(line(2, ['111', '222', '333']));
    expect(perUnit).toEqual([]);
    expect(issue).toContain('do not divide evenly');
  });

  it('prefers the IMEI sheet but checks the column against it', () => {
    const ok = imeisPerUnit(line(1, ['111']), ['111']);
    expect(ok.issue).toBeNull();
    expect(ok.perUnit).toEqual([['111']]);

    const clash = imeisPerUnit(line(1, ['999']), ['111']);
    expect(clash.perUnit).toEqual([]);
    expect(clash.issue).toContain('disagree');
  });

  it('believes the declared count over what it was given', () => {
    const { issue } = imeisPerUnit(line(2, ['111', '222'], 4));
    expect(issue).toContain('says 4 IMEI numbers but 2 were found');
  });

  it('says nothing for a line that has no IMEIs, such as a washing machine', () => {
    const { perUnit, issue } = imeisPerUnit(line(3, []));
    expect(perUnit).toEqual([]);
    expect(issue).toBeNull();
  });
});
