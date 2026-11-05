import { describe, expect, it } from 'vitest';
import { detectAccountHint, detectAccountNumber } from '../../src/modules/bank-statements/engine/parsers/bankDetect.js';
import type { Line } from '../../src/modules/bank-statements/engine/parsers/pdf.js';
import { parseLines, resolveSignsFromBalance } from '../../src/modules/bank-statements/engine/parsers/textTable.js';

/** A PDF text line from positioned cells: [text, x, width]. */
function line(y: number, cells: [string, number, number][], page = 1): Line {
  const items = cells.map(([str, x, w]) => ({ str, x, w }));
  return { page, y, items, text: items.map((i) => i.str).join('   ') };
}

/**
 * Federal Bank's table header wraps over three lines, and its last column is a "DR/CR"
 * balance marker — "DR" on the first line, "/CR" on the third. Cell positions are the
 * ones pdf.js reports for a real Federal Bank statement.
 */
const federalHeader = [
  line(459, [['Tran', 267, 18], ['Cheque', 372, 30], ['DR', 572, 12]]),
  line(454.7, [['Date', 33, 15], ['Value Date', 79, 36], ['Particulars', 173, 36], ['Tran ID', 311, 26], ['Withdrawals', 419, 42], ['Deposits', 474, 27], ['Balance', 518, 25]]),
  line(450.3, [['Type', 267, 18], ['Details', 375, 26], ['/CR', 570, 14]]),
];
const opening = line(433.7, [['Opening Balance', 129, 60], ['1117321.57', 513, 36], ['Cr', 572, 8]]);
const deposit = (y: number, amount: string, balance: string) =>
  line(y, [['09-OCT-2026', 22, 42], ['09-OCT-2026', 79, 42], ['UPI IN/628276104594', 129, 80], ['TFR', 272, 15], ['S31120753', 318, 34], [amount, 473, 32], [balance, 513, 36], ['Cr', 572, 8]]);
const withdrawal = (y: number, amount: string, balance: string, payee: string) =>
  line(y, [['09-OCT-2026', 22, 42], ['09-OCT-2026', 79, 42], [payee, 129, 76], ['CLG', 272, 15], ['S39362626', 318, 34], [amount, 433, 28], [balance, 513, 36], ['Cr', 572, 8]]);

describe('Bank statement PDF table reading', () => {
  it('reads Federal Bank withdrawals as money out despite the DR/CR marker column', () => {
    const { rows } = parseLines([
      ...federalHeader,
      opening,
      deposit(417, '2500.00', '1119821.57'),
      withdrawal(400, '26700.00', '1093121.57', 'TARUN ENTERPRISES'),
      deposit(383, '200000.00', '1293121.57'),
      withdrawal(366, '490000.00', '803121.57', 'NAVRANG MARKETING'),
    ]);
    expect(rows.map((r) => r.amount)).toEqual([2500, -26700, 200000, -490000]);
    expect(rows[1].description).toBe('TARUN ENTERPRISES / CLG');
    expect(rows[1].reference).toBe('S39362626');
  });

  it('keeps the page footer out of the narration that ends each page', () => {
    const footer = (page: number) => [
      line(40, [['The Federal Bank Ltd. Corporate Office: Federal Towers, Market Rd, Periyar Nagar, Aluva, Kerala, 683101,', 150, 300], [`Page ${page} of 3`, 520, 40]], page),
      line(30, [['Ph:0484 2630996 Website:www.federalbank.co.in', 200, 180]], page),
    ];
    const page = (n: number, y: number, amount: string, balance: string) => [
      ...(n === 1 ? [...federalHeader, opening] : []).map((l) => ({ ...l, page: n })),
      withdrawal(y, amount, balance, 'NAVRANG MARKETING'),
      ...footer(n),
    ].map((l) => ({ ...l, page: n }));
    const { rows } = parseLines([
      ...page(1, 417, '1000.00', '1116321.57'),
      ...page(2, 700, '2000.00', '1114321.57'),
      ...page(3, 700, '3000.00', '1111321.57'),
    ]);
    expect(rows.map((r) => r.description)).toEqual(['NAVRANG MARKETING / CLG', 'NAVRANG MARKETING / CLG', 'NAVRANG MARKETING / CLG']);
    expect(rows.map((r) => r.amount)).toEqual([-1000, -2000, -3000]);
  });
});

describe('Running balance decides money in vs out', () => {
  const row = (amount: number, balance: number) => ({ amount, balance, fixed: true, magnitude: Math.abs(amount) });

  it('corrects column signs the balance contradicts and reports how many', () => {
    // The 2nd and 4th rows were read under the wrong column.
    const rows = [row(500, 1500), row(200, 1300), row(100, 1400), row(50, 1350)];
    expect(resolveSignsFromBalance(rows, 1000)).toBe(2);
    expect(rows.map((r) => r.amount)).toEqual([500, -200, 100, -50]);
  });

  it('leaves column signs alone when the balances do not chain', () => {
    const rows = [row(500, 1500), row(200, 9999), row(100, 42), row(50, 7)];
    expect(resolveSignsFromBalance(rows, 1000)).toBe(0);
    expect(rows.map((r) => r.amount)).toEqual([500, 200, 100, 50]);
  });

  it('works for statements listed newest first', () => {
    const rows = [row(50, 1350), row(100, 1400), row(200, 1300), row(500, 1500)];
    resolveSignsFromBalance(rows, null);
    expect(rows.map((r) => r.amount).slice(0, 3)).toEqual([-50, 100, -200]);
  });
});

describe('Statement account number', () => {
  it('keeps the full number when the statement prints it', () => {
    const text = 'Address Last Updated On   : null   Account Number   : 13400200029970\nIFSC   : FDRL0001340';
    expect(detectAccountNumber(text)).toBe('13400200029970');
    expect(detectAccountHint(text)).toBe('••9970');
  });

  it('knows only the last four digits of a masked number', () => {
    const text = 'Account No : XXXXXXXX3909';
    expect(detectAccountNumber(text)).toBeNull();
    expect(detectAccountHint(text)).toBe('••3909');
  });
});
