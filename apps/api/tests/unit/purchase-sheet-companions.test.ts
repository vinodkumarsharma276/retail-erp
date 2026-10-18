import { describe, expect, it } from 'vitest';
import {
  parsePurchaseSheet,
  parseSupplierSheet,
  parseVoucherSheet,
  supplierKey,
} from '@retailerp/shared-utils';

/**
 * The companion sheets: per-invoice totals, and the supplier master.
 *
 * Both share columns with the purchase sheet itself, which is what made
 * telling them apart worth testing: the purchase sheet names a supplier on
 * every line, so it answered to being the supplier master, and the supplier
 * list answered to being the purchase sheet.
 */

const VOUCHER_HEADINGS = [
  'Date', 'Voucher No.', 'Supplier Invoice No.', 'Supplier', 'Supplier GSTIN',
  'Taxable Value', 'CGST', 'SGST', 'IGST', 'Round Off / Other', 'Voucher Total', 'Narration',
];

const SUPPLIER_HEADINGS = [
  'Supplier', 'GSTIN', 'PAN', 'Phone', 'Mobile', 'Email', 'Contact', 'Address', 'State', 'PIN', 'Bank Details',
];

const PURCHASE_HEADINGS = [
  'Date', 'Voucher No.', 'Supplier Invoice No.', 'Supplier', 'Supplier GSTIN', 'Phone', 'Address',
  'State', 'Bank Details', 'Item', 'HSN/SAC', 'Qty', 'Unit', 'Rate', 'Amount (before tax)',
  'GST Rate %', 'GST Amount', 'Amount incl. GST', 'IMEI Count', 'IMEI / Description',
];

describe('the voucher totals sheet', () => {
  const sheet = [
    VOUCHER_HEADINGS,
    ['01-10-2026', 'BILL-682', 'LG-26-27/682', 'NAVRANG MARKETING', '07AAMFN4726A1ZG',
      '449,153.80', '0.00', '0.00', '80,847.68', '-0.48', '530,001.00', ''],
    ['05-10-2026', 'BILL-1238', 'GST-26-27-1238', 'M S DISTRIBUTORS', '09ABXFM4586D1ZK',
      '154,533.88', '13,908.05', '13,908.05', '0.00', '0.02', '182,350.00', 'part delivery'],
  ];

  it('reads a row per invoice, keeping the rounding the supplier applied', () => {
    const parse = parseVoucherSheet('Vouchers', sheet)!;
    expect(parse.byInvoice.size).toBe(2);
    const lg = parse.byInvoice.get('lg-26-27/682')!;
    expect(lg.taxableValue).toBeCloseTo(449153.8, 2);
    expect(lg.igst).toBeCloseTo(80847.68, 2);
    expect(lg.roundOff).toBeCloseTo(-0.48, 2);
    expect(lg.total).toBe(530001);
    expect(lg.issues).toEqual([]);
  });

  it('totals the whole book', () => {
    expect(parseVoucherSheet('Vouchers', sheet)!.total).toBeCloseTo(712351, 2);
  });

  it('keeps a narration when there is one', () => {
    const parse = parseVoucherSheet('Vouchers', sheet)!;
    expect(parse.byInvoice.get('gst-26-27-1238')!.narration).toBe('part delivery');
  });

  it('flags a voucher whose parts do not reach its stated total', () => {
    const wrong = [VOUCHER_HEADINGS, ['01-10-2026', 'B-1', 'INV-1', 'A', '', '1000', '0', '0', '0', '0', '9999', '']];
    const parse = parseVoucherSheet('Vouchers', wrong)!;
    expect(parse.byInvoice.get('inv-1')!.issues.join(' ')).toContain('voucher total says ₹9999');
  });

  it('is not fooled by the purchase sheet', () => {
    expect(parseVoucherSheet('Purchase Details', [PURCHASE_HEADINGS])).toBeNull();
  });
});

describe('the supplier master sheet', () => {
  const sheet = [
    SUPPLIER_HEADINGS,
    ['ANAND JI AGENCIES', '09AACPL9042R1Z1', '', '', '', '', '', 'C-322, SEC-10, NOIDA', 'Uttar Pradesh', '201309', ''],
    ['M/s Kay Dee Communications', '09AADCK5718M1Z3', 'AADCK5718M', '0120-4567890', '9876543210',
      'kaydee@example.com', 'Rakesh', 'H-14, Sector 63, Noida', 'Uttar Pradesh', '201301', 'HDFC 123456'],
  ];

  it('reads each supplier, keyed so punctuation and "M/s" do not matter', () => {
    const parse = parseSupplierSheet('Suppliers', sheet)!;
    expect(parse.count).toBe(2);
    const kaydee = parse.byName.get(supplierKey('KAY DEE COMMUNICATIONS'))!;
    expect(kaydee.gstin).toBe('09AADCK5718M1Z3');
    expect(kaydee.pan).toBe('AADCK5718M');
    expect(kaydee.mobile).toBe('9876543210');
    expect(kaydee.email).toBe('kaydee@example.com');
    expect(kaydee.pincode).toBe('201301');
    expect(kaydee.bankDetails).toBe('HDFC 123456');
  });

  it('keeps a row that is mostly empty, since the GSTIN alone is worth having', () => {
    const parse = parseSupplierSheet('Suppliers', sheet)!;
    const anand = parse.byName.get(supplierKey('ANAND JI AGENCIES'))!;
    expect(anand.gstin).toBe('09AACPL9042R1Z1');
    expect(anand.state).toBe('Uttar Pradesh');
    expect(anand.mobile).toBe('');
  });

  it('refuses the purchase sheet, which also names a supplier on every line', () => {
    // The real failure: it has a Supplier column, so it answered to this
    // reader and took the purchase sheet out of play.
    expect(parseSupplierSheet('Purchase Details', [PURCHASE_HEADINGS, PURCHASE_HEADINGS.map(() => 'x')])).toBeNull();
  });

  it('refuses a sheet with no supplier column at all', () => {
    expect(parseSupplierSheet('Sheet1', [['a', 'b'], ['1', '2']])).toBeNull();
  });
});

describe('telling the four sheets apart', () => {
  const purchaseRow = [
    '01-10-2026', 'BILL-682', 'LG-26-27/682', 'NAVRANG MARKETING', '07AAMFN4726A1ZG', '9999647564',
    'D-8, LAXMI NAGAR, DELHI', 'Delhi', '', 'LG LED LCD 43NU875BPLA', '85287217', '20', 'Pcs.',
    '22,457.69', '449,153.80', '18', '80,847.68', '530,001.48', '0', '',
  ];

  it('reads the purchase sheet with every column recognised', () => {
    const parse = parsePurchaseSheet('Purchase Details', [PURCHASE_HEADINGS, purchaseRow]);
    expect(parse.detected).toBe(true);
    expect(parse.columns.unknown).toEqual([]);
    expect(parse.columns.missingRequired).toEqual([]);

    const line = parse.lines[0];
    expect(line.gstin).toBe('07AAMFN4726A1ZG');
    expect(line.supplier.phone).toBe('9999647564');
    expect(line.supplier.state).toBe('Delhi');
    expect(line.hsnCode).toBe('85287217');
    expect(line.unit).toBe('Pcs.');
    expect(line.gstRate).toBe(18);
    expect(line.gstAmount).toBeCloseTo(80847.68, 2);
    expect(line.amountInclTax).toBeCloseTo(530001.48, 2);
    expect(line.issues).toEqual([]);
  });

  it('does not mistake the supplier master for a purchase sheet with lines', () => {
    const parse = parsePurchaseSheet('Suppliers', [SUPPLIER_HEADINGS, SUPPLIER_HEADINGS.map(() => 'x')]);
    // It may look like one on headings alone, but it cannot carry purchases:
    // no item, no quantity, no rate. That is what the caller checks.
    expect(parse.columns.missingRequired.map((m) => m.label).sort()).toEqual(['Date', 'Item', 'Qty', 'Rate', 'Supplier Invoice No.']);
  });
});
