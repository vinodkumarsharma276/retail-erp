import { describe, expect, it } from 'vitest';
import {
  allocateVoucherTax,
  isTallyPurchaseRegister,
  parseLedgerAmount,
  parseTallyDate,
  parseTallyPurchaseRegister,
  parseTallyQuantity,
  parseTallyRate,
} from '@retailerp/shared-utils';

/**
 * The Tally purchase register parser.
 *
 * The grid below is the shape Tally exports, trimmed to the columns that
 * matter: five header lines, the report title and period, the heading row,
 * then voucher blocks — a dated row carrying the invoice, followed by
 * undated rows carrying its items, and a closing Grand Total.
 */

const HEADINGS = [
  'Date', 'Particulars', 'Supplier', 'Supplier Address', 'Consignee', 'Consignee Address',
  'Voucher Type', 'Voucher No.', 'Supplier Invoice No.', 'Supplier Invoice Date', 'GSTIN/UIN',
  'PAN No.', 'Narration', 'Quantity', 'Rate', 'Value', 'Addl. Cost', 'Gross Total',
  'CGST', 'SGST', 'Round Off', 'IGST',
];

/** A voucher row, by heading name, with the rest blank. */
function row(values: Record<string, string>): string[] {
  return HEADINGS.map((heading) => values[heading] ?? '');
}

function sheet(...dataRows: string[][]): string[][] {
  return [
    ['VINOD ELECTRONICS'],
    ['A2,Himalya Vihar,Main Road'],
    ['Ghaziabad'],
    ['Purchase Register'],
    ['1-Sep-26 to 30-Sep-26'],
    HEADINGS,
    ...dataRows,
  ];
}

const INTRA_STATE = row({
  Date: '1-Sep-26',
  Particulars: 'SHREE BIHARI JI DISTRIBUTORS',
  Supplier: 'SHREE BIHARI JI DISTRIBUTORS',
  'Supplier Address': '126, BHAGWAN GANJ MANDI, Modinagar, Ghaziabad,, Uttar Pradesh, 201204',
  Consignee: 'VINOD ELECTRONICS',
  'Voucher Type': 'Purchase',
  'Voucher No.': 'BILL-1572',
  'Supplier Invoice No.': 'NOI-1572',
  'Supplier Invoice Date': '1-Sep-26',
  'GSTIN/UIN': '09AEYFS8829M1ZM',
  Quantity: '4.00 Pcs.',
  Value: '77476.28',
  'Gross Total': '91422.00 Cr',
  CGST: '6972.86 Dr',
  SGST: '6972.86 Dr',
});

const ITEM_A = row({ Particulars: 'OPPO A6 5G (6+128) ICE WHITE', Quantity: '1.00 Pcs.', Rate: '23404.24/Pcs.', Value: '23404.24' });
const ITEM_B = row({ Particulars: 'OPPO A6 5G 6+128GB SAPPHIRE BLUE', Quantity: '1.00 Pcs.', Rate: '23404.24/Pcs.', Value: '23404.24' });
const ITEM_C = row({ Particulars: 'OPPO A6X 5G (4+64) OLIVE GREEN', Quantity: '2.00 Pcs.', Rate: '15333.90/Pcs.', Value: '30667.80' });

describe('cell readers', () => {
  it('reads Tally two-digit years as this century', () => {
    expect(parseTallyDate('1-Sep-26')).toBe('2026-09-01');
    expect(parseTallyDate('30-Sep-26')).toBe('2026-09-30');
    expect(parseTallyDate('3-Mar-2027')).toBe('2027-03-03');
  });

  it('accepts ISO dates from a re-saved sheet, and real Date cells', () => {
    expect(parseTallyDate('2026-09-07')).toBe('2026-09-07');
    expect(parseTallyDate(new Date(Date.UTC(2026, 8, 7)))).toBe('2026-09-07');
  });

  it('accepts an Excel serial, for a sheet read with raw values', () => {
    // 46266 is what Excel stores behind Tally's "1-Sep-26".
    expect(parseTallyDate(46266)).toBe('2026-09-01');
    expect(parseTallyDate(46295)).toBe('2026-09-30');
    // Not a plausible date serial, so not read as one.
    expect(parseTallyDate(4)).toBe('');
  });

  it('returns blank for anything it cannot read', () => {
    expect(parseTallyDate('')).toBe('');
    expect(parseTallyDate('Grand Total')).toBe('');
    expect(parseTallyDate('1-Smarch-26')).toBe('');
  });

  it('treats credit amounts as negative so round-off subtracts', () => {
    expect(parseLedgerAmount('6972.86 Dr')).toBe(6972.86);
    expect(parseLedgerAmount('91422.00 Cr')).toBe(-91422);
    expect(parseLedgerAmount('0.17 Cr')).toBe(-0.17);
    expect(parseLedgerAmount('1,23,456.78')).toBe(123456.78);
    expect(parseLedgerAmount('')).toBeNull();
  });

  it('splits quantity from its unit, and strips the rate suffix', () => {
    expect(parseTallyQuantity('4.00 Pcs.')).toEqual({ quantity: 4, unit: 'Pcs' });
    expect(parseTallyQuantity('')).toEqual({ quantity: null, unit: '' });
    expect(parseTallyRate('23404.24/Pcs.')).toBe(23404.24);
    expect(parseTallyRate('')).toBeNull();
  });
});

describe('detection', () => {
  it('recognises a purchase register', () => {
    expect(isTallyPurchaseRegister(sheet(INTRA_STATE, ITEM_A))).toBe(true);
  });

  it('rejects an ordinary flat sheet, with a reason', () => {
    const flat = [['Invoice No', 'Party', 'Item', 'Qty', 'Amount'], ['INV-1', 'Acme', 'Fan', '2', '3000']];
    expect(isTallyPurchaseRegister(flat)).toBe(false);
    const parse = parseTallyPurchaseRegister(flat);
    expect(parse.detected).toBe(false);
    expect(parse.reason).toContain('does not look like a Tally purchase register');
    expect(parse.vouchers).toEqual([]);
  });
});

describe('parsing voucher blocks', () => {
  const parse = parseTallyPurchaseRegister(
    sheet(
      INTRA_STATE, ITEM_A, ITEM_B, ITEM_C,
      row({
        Date: '4-Sep-26',
        Particulars: 'NAVRANG MARKETING',
        Supplier: 'NAVRANG MARKETING',
        'Supplier Address': 'D-8, LAXMI NAGAR, DELHI PH-9654133839',
        Consignee: 'VINOD ELECTRONICS',
        'Voucher Type': 'Purchase',
        'Voucher No.': 'BILL-579',
        'Supplier Invoice No.': 'LG/26-27/579',
        'Supplier Invoice Date': '4-Sep-26',
        'GSTIN/UIN': '07AAMFN4726A1ZG',
        Quantity: '6.00 Pcs.',
        Value: '60000.18',
        'Gross Total': '70800.00 Cr',
        'Round Off': '0.21 Cr',
        IGST: '10800.03 Dr',
      }),
      row({ Particulars: 'LG W/M 8035 SRAZA', Quantity: '6.00 Pcs.', Rate: '10000.03/Pcs.', Value: '60000.18' }),
      row({ Particulars: 'Grand Total', Quantity: '10.00 Pcs.', Value: '137476.46', 'Gross Total': '162222.00 Cr' }),
    ),
  );

  it('reads the page header and the heading row position', () => {
    expect(parse.detected).toBe(true);
    expect(parse.ownerName).toBe('VINOD ELECTRONICS');
    expect(parse.title).toBe('Purchase Register');
    expect(parse.period).toBe('1-Sep-26 to 30-Sep-26');
    expect(parse.headerRow).toBe(6);
  });

  it('groups each dated row with the item rows beneath it', () => {
    expect(parse.vouchers).toHaveLength(2);
    expect(parse.vouchers[0].items.map((item) => item.name)).toEqual([
      'OPPO A6 5G (6+128) ICE WHITE',
      'OPPO A6 5G 6+128GB SAPPHIRE BLUE',
      'OPPO A6X 5G (4+64) OLIVE GREEN',
    ]);
    expect(parse.vouchers[1].items.map((item) => item.name)).toEqual(['LG W/M 8035 SRAZA']);
  });

  it('keeps Excel row numbers so problems can be pointed at', () => {
    expect(parse.vouchers[0].rowNumber).toBe(7);
    expect(parse.vouchers[0].items[0].rowNumber).toBe(8);
    expect(parse.vouchers[1].rowNumber).toBe(11);
  });

  it('prefers the supplier invoice number over Tally voucher number', () => {
    expect(parse.vouchers[0].invoiceNumber).toBe('NOI-1572');
    expect(parse.vouchers[0].invoiceNumberSource).toBe('supplier');
    expect(parse.vouchers[0].voucherNumber).toBe('BILL-1572');
  });

  it('derives PAN, state, PIN code and phone that the sheet never spells out', () => {
    const first = parse.vouchers[0];
    expect(first.pan).toBe('AEYFS8829M');
    expect(first.supplierState).toBe('Uttar Pradesh');
    expect(first.supplierPincode).toBe('201204');

    const second = parse.vouchers[1];
    expect(second.supplierState).toBe('Delhi');
    expect(second.supplierPhone).toBe('9654133839');
  });

  it('reads invoice amounts, with credits as positive invoice totals', () => {
    const first = parse.vouchers[0];
    expect(first.taxableValue).toBe(77476.28);
    expect(first.cgst).toBe(6972.86);
    expect(first.sgst).toBe(6972.86);
    expect(first.igst).toBe(0);
    expect(first.grossTotal).toBe(91422);
  });

  it('handles an inter-state invoice and a credit round-off', () => {
    const second = parse.vouchers[1];
    expect(second.igst).toBe(10800.03);
    expect(second.cgst).toBe(0);
    expect(second.roundOff).toBe(-0.21);
    expect(second.grossTotal).toBe(70800);
  });

  it('reports no issues when the sheet adds up', () => {
    expect(parse.vouchers.flatMap((voucher) => voucher.issues)).toEqual([]);
  });

  it('takes the Grand Total row as a total, not as a voucher', () => {
    expect(parse.grandTotal).toEqual({ quantity: 10, taxableValue: 137476.46, grossTotal: 162222 });
    expect(parse.vouchers.some((voucher) => voucher.supplierName === 'Grand Total')).toBe(false);
  });

  it('skips nothing it should have kept', () => {
    expect(parse.skipped).toEqual([]);
  });
});

describe('cross-checks against Tally own totals', () => {
  it('flags item lines that do not add up to the taxable value', () => {
    const parse = parseTallyPurchaseRegister(
      sheet(INTRA_STATE, ITEM_A, ITEM_B), // ITEM_C left out, so 30667.80 short
    );
    expect(parse.vouchers[0].issues.join(' ')).toContain('Item lines add up to ₹46808.48');
  });

  it('flags a unit count that disagrees with the voucher', () => {
    const parse = parseTallyPurchaseRegister(
      sheet(INTRA_STATE, ITEM_A, ITEM_B, row({ Particulars: 'OPPO A6X', Quantity: '1.00 Pcs.', Value: '30667.80' })),
    );
    expect(parse.vouchers[0].issues.join(' ')).toContain('total 3 units, but the voucher says 4');
  });

  it('flags a printed invoice total that does not match value plus tax', () => {
    const tampered = [...INTRA_STATE];
    tampered[HEADINGS.indexOf('Gross Total')] = '99999.00 Cr';
    const parse = parseTallyPurchaseRegister(sheet(tampered, ITEM_A, ITEM_B, ITEM_C));
    expect(parse.vouchers[0].issues.join(' ')).toContain('printed invoice total is ₹99999');
  });

  it('flags a voucher with no item lines', () => {
    const parse = parseTallyPurchaseRegister(sheet(INTRA_STATE));
    expect(parse.vouchers[0].issues).toContain('No item lines were found under this voucher.');
  });

  it('drops an invalid GSTIN rather than storing a bad one', () => {
    const bad = [...INTRA_STATE];
    bad[HEADINGS.indexOf('GSTIN/UIN')] = '09AEYFS8829M1Z';
    const parse = parseTallyPurchaseRegister(sheet(bad, ITEM_A, ITEM_B, ITEM_C));
    expect(parse.vouchers[0].gstin).toBe('');
    expect(parse.vouchers[0].issues.join(' ')).toContain('is not a valid GST number');
  });

  it('notes an item line that appears before any voucher', () => {
    const parse = parseTallyPurchaseRegister(sheet(ITEM_A, INTRA_STATE));
    expect(parse.skipped[0].reason).toContain('appears before any voucher');
  });
});

describe('spreading voucher tax over its item lines', () => {
  it('splits tax in proportion to line value, to the paisa', () => {
    const parse = parseTallyPurchaseRegister(sheet(INTRA_STATE, ITEM_A, ITEM_B, ITEM_C));
    const shares = allocateVoucherTax(parse.vouchers[0]);
    expect(shares).toHaveLength(3);
    // 6972.86 x 2 of tax over 23404.24 / 23404.24 / 30667.80 of value.
    expect(shares.reduce((sum, share) => sum + share, 0)).toBeCloseTo(13945.72, 2);
    expect(shares[0]).toBeCloseTo(shares[1], 2);
    expect(shares[2]).toBeGreaterThan(shares[0]);
  });

  it('gives the rounding remainder to the last line so the parts always add back up', () => {
    const odd = [...INTRA_STATE];
    odd[HEADINGS.indexOf('CGST')] = '0.01 Dr';
    odd[HEADINGS.indexOf('SGST')] = '';
    const parse = parseTallyPurchaseRegister(sheet(odd, ITEM_A, ITEM_B, ITEM_C));
    const shares = allocateVoucherTax(parse.vouchers[0]);
    expect(shares.reduce((sum, share) => sum + share, 0)).toBeCloseTo(0.01, 4);
  });

  it('returns zeroes for a tax-free voucher, and nothing for an empty one', () => {
    const free = [...INTRA_STATE];
    free[HEADINGS.indexOf('CGST')] = '';
    free[HEADINGS.indexOf('SGST')] = '';
    const parse = parseTallyPurchaseRegister(sheet(free, ITEM_A, ITEM_B, ITEM_C));
    expect(allocateVoucherTax(parse.vouchers[0])).toEqual([0, 0, 0]);

    const bare = parseTallyPurchaseRegister(sheet(INTRA_STATE));
    expect(allocateVoucherTax(bare.vouchers[0])).toEqual([]);
  });
});
