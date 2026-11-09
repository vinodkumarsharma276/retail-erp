import { describe, expect, it } from 'vitest';
import {
  ALL_FEATURE_KEYS,
  ALL_PERMISSIONS,
  FeatureKey,
  SYSTEM_ROLES,
  effectivePermissions,
} from '@retailerp/shared-types';
import {
  isIsoDate,
  isValidMobile,
  mobileProblem,
  REGISTER_ISSUE_CODES,
  REGISTER_ISSUES,
  nextAccountNumber,
  normalizeMobile,
  parseAccountNumber,
  parseRegisterSheet,
  personNameKey,
  personNameScore,
  SAME_PERSON_SCORE,
  MAYBE_SAME_PERSON_SCORE,
} from '@retailerp/shared-utils';
import {
  buildVariants,
  outcomesFor,
  suggestGroup,
  validResolution,
  variantFor,
  personPairKey,
} from '../../src/modules/customer-search/customer-search.matching.js';
import {
  buildTypeColumns,
  categoryPaths,
  defaultDecision,
  matchProductTexts,
} from '../../src/modules/customer-search/customer-search.product-types.js';
import { rowIssues } from '../../src/modules/customer-search/customer-search.issues.js';
import { resolveShop, rowKey } from '../../src/modules/customer-search/customer-search.import.js';

const allOn = Object.fromEntries(ALL_FEATURE_KEYS.map((k) => [k, true]));

describe('CS1. Account numbers', () => {
  it('reads the register\'s own shapes: BD-1, CI2-421, BD-406A, DF-738(A), BN.596, MJ12', () => {
    expect(parseAccountNumber(' bd- 33 ')).toEqual({ accountNumber: 'BD-33', prefix: 'BD', separator: '-', seriesNo: 33 });
    expect(parseAccountNumber('CI2 -421')).toEqual({ accountNumber: 'CI2-421', prefix: 'CI2', separator: '-', seriesNo: 421 });
    expect(parseAccountNumber('BD-406A')).toMatchObject({ prefix: 'BD', seriesNo: 406 });
    expect(parseAccountNumber('DF-738(A)')).toMatchObject({ prefix: 'DF', seriesNo: 738 });
    expect(parseAccountNumber('BN.596')).toMatchObject({ prefix: 'BN', separator: '.', seriesNo: 596 });
    expect(parseAccountNumber(' mj 12 ')).toEqual({ accountNumber: 'MJ12', prefix: 'MJ', separator: '', seriesNo: 12 });
    expect(parseAccountNumber('D7')).toMatchObject({ prefix: 'D', seriesNo: 7 });
  });

  it('keeps other shapes, without a series number', () => {
    expect(parseAccountNumber('BL-528,35')).toMatchObject({ accountNumber: 'BL-528,35', prefix: 'BL', seriesNo: null });
    expect(parseAccountNumber('1234').prefix).toBe('');
    expect(parseAccountNumber('').accountNumber).toBe('');
  });

  it('suggests the next number written the way the series writes it', () => {
    expect(nextAccountNumber('BD', { accountNumber: 'BD-264', seriesNo: 264 })).toBe('BD-265');
    expect(nextAccountNumber('CI2', { accountNumber: 'CI2-421', seriesNo: 421 })).toBe('CI2-422');
    expect(nextAccountNumber('MJ', { accountNumber: 'MJ12', seriesNo: 12 })).toBe('MJ13');
    expect(nextAccountNumber('MJ', { accountNumber: 'MJ009', seriesNo: 9 })).toBe('MJ010');
    expect(nextAccountNumber('BD', { accountNumber: 'BD-406A', seriesNo: 406 })).toBe('BD-407');
    expect(nextAccountNumber('mi', null)).toBe('MI-1');
  });
});

describe('CS2. Mobiles', () => {
  it('normalises to ten digits and validates', () => {
    expect(normalizeMobile('+91 98765-43210')).toBe('9876543210');
    expect(isValidMobile('09876543210')).toBe(true);
    expect(isValidMobile('12345')).toBe(false);
    expect(isValidMobile('1234567890')).toBe(false);
  });
});

describe('CS3. Reading the sheet', () => {
  const rows = [
    ['ID', 'CUSTOMER_NAME', 'Address', 'Mobile', 'CO', 'CO_Mobile', 'AREA', 'Purchase_Date', 'Product', 'Brand', 'Model'],
    ['MJ12', 'Jitender', 'Gali 4', 9876543210, 'Ramesh', '9812345678', 'Sector 5', '05/03/2024', 'TV', 'Sony', 'X1'],
    [],
    ['MI3', 'Sunita', '', '9898989898', '', '', '', 45000, 'Fridge', 'LG', ''],
  ];

  it('maps the headings (ID as Account Number) and numbers records from 1', () => {
    const parsed = parseRegisterSheet(rows);
    expect(parsed.missing).toEqual([]);
    expect(parsed.headerRow).toBe(1);
    expect(parsed.rows).toHaveLength(2);
    expect(parsed.rows[0]).toMatchObject({
      recordNo: 1, sheetRow: 2, accountNumber: 'MJ12', customerName: 'Jitender', mobile: '9876543210',
      coName: 'Ramesh', coMobile: '9812345678', area: 'Sector 5', purchaseDate: '2024-03-05',
    });
    // A blank line is skipped but sheet rows still count it.
    expect(parsed.rows[1]).toMatchObject({ recordNo: 2, sheetRow: 4, purchaseDate: '2023-03-15' });
  });

  it('reads an "Account Number" heading too, and reports missing required columns', () => {
    expect(parseRegisterSheet([['Account Number', 'Name', 'Mobile']]).missing).toEqual([]);
    expect(parseRegisterSheet([['Account Number', 'Name']]).missing).toEqual(['Mobile']);
  });

  it('accepts only real calendar dates', () => {
    expect(isIsoDate('2024-02-29')).toBe(true);
    expect(isIsoDate('2024-02-31')).toBe(false);
    expect(isIsoDate('2023-02-29')).toBe(false);
    expect(isIsoDate('05/03/2024')).toBe(false);
  });
});

describe('CS4. Person names', () => {
  it('ignores case, punctuation and honorifics', () => {
    expect(personNameKey('  Smt. SUNITA  devi ')).toBe('sunita devi');
  });

  it('scores spelling variants close and different first names far', () => {
    expect(personNameScore('Jitender', 'Jitendra')).toBeGreaterThanOrEqual(MAYBE_SAME_PERSON_SCORE);
    expect(personNameScore('Jitender', 'Jintendar')).toBeGreaterThanOrEqual(MAYBE_SAME_PERSON_SCORE);
    expect(personNameScore('Jitender Kumar', 'Jitendra Kumar')).toBeGreaterThanOrEqual(0.7);
    expect(personNameScore('Ramesh Kumar', 'Suresh Kumar')).toBeLessThan(0.7);
    expect(personNameScore('Jitender', 'Jitender Kumar')).toBeGreaterThanOrEqual(0.7);
    expect(personNameScore('Ramesh', 'ramesh.')).toBe(1);
  });
});

describe('CS5. Name groups on a shared mobile', () => {
  const mobile = '9876543210';
  const existing = [{ id: 'c1', name: 'Jitendra', mobile, customerCode: 'CUST-0412' }];

  it('links an exact name to the existing customer and groups variants with it', () => {
    const variants = buildVariants(
      [
        { name: 'Jitender', mobile },
        { name: 'Jitender', mobile },
        { name: 'Jintendar', mobile },
        { name: 'jitendra', mobile },
        { name: 'Suresh', mobile: '9812345678' },
      ],
      existing,
    ).get(mobile)!;
    expect(variants.map((v) => [v.key, v.rows])).toEqual([
      ['c:c1', 1],
      ['n:jitender', 2],
      ['n:jintendar', 1],
    ]);
    expect(variantFor(variants, 'JITENDRA')?.key).toBe('c:c1');

    const group = suggestGroup(mobile, variants);
    expect(group.needsReview).toBe(true);
    // Without a model, borderline-but-close variants are suggested as the existing customer.
    expect(group.suggestion).toEqual({ 'c:c1': 'c:c1', 'n:jitender': 'c:c1', 'n:jintendar': 'c:c1' });
  });

  it('lets a model verdict split a borderline pair', () => {
    const variants = buildVariants([{ name: 'Jitender', mobile }, { name: 'Jitendra', mobile }], []).get(mobile)!;
    const verdicts = new Map([[personPairKey('Jitender', 'Jitendra'), { same: false, reason: 'test' }]]);
    const score = personNameScore('Jitender', 'Jitendra');
    expect(score).toBeLessThan(SAME_PERSON_SCORE);
    const group = suggestGroup(mobile, variants, verdicts);
    expect(group.suggestion).toEqual({ 'n:jitender': 'n:jitender', 'n:jitendra': 'n:jitendra' });
    expect(group.verdicts[0]).toMatchObject({ by: 'ai', same: false });
  });

  it('keeps plainly different family names apart and not flagged for review', () => {
    const variants = buildVariants([{ name: 'Ramesh', mobile }, { name: 'Kamla Devi', mobile }], []).get(mobile)!;
    const group = suggestGroup(mobile, variants);
    expect(group.needsReview).toBe(false);
    expect(new Set(Object.values(group.suggestion)).size).toBe(2);
  });

  it('checks resolutions and turns them into outcomes', () => {
    const variants = buildVariants([{ name: 'Jitender', mobile }, { name: 'Jintendar', mobile }], existing).get(mobile)!;
    expect(validResolution(variants, { 'c:c1': 'c:c1', 'n:jitender': 'n:jintendar' })).toBeNull(); // incomplete / chained
    const keepSheetSpelling = { 'c:c1': 'n:jitender', 'n:jitender': 'n:jitender', 'n:jintendar': 'n:jitender' };
    const valid = validResolution(variants, keepSheetSpelling)!;
    const outcomes = outcomesFor(mobile, variants, valid);
    // One person, the existing customer, renamed to the chosen spelling.
    expect(outcomes.get('n:jintendar')).toEqual({ kind: 'existing', customerId: 'c1', rename: 'Jitender' });

    const separate = validResolution(variants, { 'c:c1': 'c:c1', 'n:jitender': 'n:jitender', 'n:jintendar': 'n:jitender' })!;
    const split = outcomesFor(mobile, variants, separate);
    expect(split.get('c:c1')).toEqual({ kind: 'existing', customerId: 'c1' });
    expect(split.get('n:jintendar')).toEqual({ kind: 'new', ref: `${mobile}|n:jitender`, name: 'Jitender' });
  });
});

describe('CS7. Product types', () => {
  const top = [
    { id: 't-fridge', name: 'Fridge', slug: 'fridge' },
    { id: 't-wm', name: 'Washing Machine', slug: 'washing-machine' },
    { id: 't-ac', name: 'Air Conditioner', slug: 'air-conditioner' },
  ];

  it('matches sheet text to top-level types: remembered, exact, plural, lookalike, new', () => {
    const matches = matchProductTexts(
      ['Fridge', 'fridges', 'Washing  machine', 'Air Conditoner', 'Cooler', 'cooler', 'Geyser', ''],
      top,
      new Map([['geyser', null]]),
    );
    const byKey = Object.fromEntries(matches.map((m) => [m.textKey, [m.kind, m.categoryId, m.rows]]));
    expect(byKey).toEqual({
      fridge: ['matched', 't-fridge', 1],
      fridges: ['matched', 't-fridge', 1],
      'washing machine': ['matched', 't-wm', 1],
      'air conditoner': ['similar', 't-ac', 1],
      cooler: ['new', null, 2],
      geyser: ['mapped', null, 1],
    });
    // Nothing is created unless asked: a new text defaults to blank.
    expect(defaultDecision(matches.find((m) => m.textKey === 'cooler')!)).toEqual({ action: 'blank' });
    expect(defaultDecision(matches.find((m) => m.textKey === 'fridge')!)).toEqual({ action: 'existing', categoryId: 't-fridge' });
  });

  it('prefers an existing sub-type of the same name over creating a duplicate top-level type', () => {
    const [m] = matchProductTexts(['LED TV'], top, new Map(), [{ id: 's-led', name: 'LED TV', pathLabel: 'Electronics › TV › LED TV' }]);
    expect(m).toMatchObject({ kind: 'matched', categoryId: 's-led', categoryName: 'Electronics › TV › LED TV' });
    // Ambiguous (two sub-types of that name): it stays new for the person to decide.
    const [n] = matchProductTexts(['Stand'], top, new Map(), [
      { id: 'a', name: 'Stand', pathLabel: 'TV › Stand' },
      { id: 'b', name: 'Stand', pathLabel: 'Fan › Stand' },
    ]);
    expect(n.kind).toBe('new');
  });

  it('lays out types of different depths: N level columns for the deepest, blanks below', () => {
    const cols = buildTypeColumns([['Electronics', 'TV', 'LED TV'], ['Fridge'], null, ['A', 'B', 'C', 'D', 'E']], [null, null, 'Geyser', null]);
    expect(cols.levelHeaders).toEqual(['Type Level 1', 'Type Level 2', 'Type Level 3', 'Type Level 4', 'Type Level 5']);
    expect(cols.rows[0]).toEqual({ path: 'Electronics › TV › LED TV', levels: ['Electronics', 'TV', 'LED TV', '', ''] });
    expect(cols.rows[1]).toEqual({ path: 'Fridge', levels: ['Fridge', '', '', '', ''] });
    expect(cols.rows[2]).toEqual({ path: 'Geyser', levels: ['', '', '', '', ''] });
    expect(buildTypeColumns([null]).levelHeaders).toEqual(['Type Level 1']);
  });

  it('walks a category up to the root for its path', () => {
    const pathOf = categoryPaths([
      { id: 'e', name: 'Electronics', parentId: null },
      { id: 't', name: 'TV', parentId: 'e' },
      { id: 'l', name: 'LED TV', parentId: 't' },
    ]);
    expect(pathOf('l')).toEqual(['Electronics', 'TV', 'LED TV']);
    expect(pathOf(null)).toBeNull();
    expect(pathOf('gone')).toBeNull();
  });

  it('reads an exported register back: Type Level 1 as Product, the path when the level is blank', () => {
    const parsed = parseRegisterSheet([
      ['Account Number', 'CUSTOMER_NAME', 'Mobile', 'Product Type', 'Type Level 1', 'Type Level 2'],
      ['E1', 'A', '9810000001', 'Electronics › TV', 'Electronics', 'TV'],
      ['E2', 'B', '9810000002', 'Geyser', '', ''],
    ]);
    expect(parsed.rows.map((r) => r.product)).toEqual(['Electronics', 'Geyser']);
  });

  it('names the two buttons\' permissions after the buttons', () => {
    const desc = Object.fromEntries(ALL_PERMISSIONS.map((p) => [p.key, p.description]));
    expect(desc['customer_search.create']).toBe('Customer Searching: New entry');
    expect(desc['customer_search.import']).toBe('Customer Searching: Import the sheet');
  });
});

describe('CS8. Review problems, shops and row identity', () => {
  const base = {
    accountNumber: 'BD-1', seriesNo: 1, customerName: 'Pawan', mobile: '9599418909', coName: null, coMobile: null,
    coCustomerId: null, purchaseDate: new Date('2021-03-01T00:00:00Z'), categoryId: 'type', rawValues: null,
  };

  it('tells a missing mobile from a wrong one', () => {
    expect(mobileProblem('')).toBe('missing');
    expect(mobileProblem('XXXXX')).toBe('missing');
    expect(mobileProblem('NO MOBILE')).toBe('missing');
    expect(mobileProblem('706556835')).toBe('invalid');
    expect(mobileProblem('9599418909')).toBeNull();
  });

  it('lists every problem an entry has on its own', () => {
    expect(rowIssues(base)).toEqual([]);
    expect(rowIssues({ ...base, accountNumber: '', seriesNo: null })).toEqual(['missing_account']);
    expect(rowIssues({ ...base, accountNumber: 'BL-528,35', seriesNo: null })).toEqual(['odd_account']);
    expect(rowIssues({ ...base, customerName: '  ' })).toEqual(['missing_name']);
    expect(rowIssues({ ...base, mobile: '' })).toEqual(['missing_mobile']);
    expect(rowIssues({ ...base, mobile: '', rawValues: { mobile: '706556835' } })).toEqual(['invalid_mobile']);
    expect(rowIssues({ ...base, purchaseDate: null })).toEqual(['missing_date']);
    expect(rowIssues({ ...base, purchaseDate: null, rawValues: { purchaseDate: '31/02/2024' } })).toEqual(['invalid_date']);
    expect(rowIssues({ ...base, purchaseDate: new Date('2999-01-01T00:00:00Z') })).toEqual(['future_date']);
    expect(rowIssues({ ...base, coName: 'Ram' })).toEqual(['co_incomplete']);
    expect(rowIssues({ ...base, coName: 'Ram', coMobile: '9812345678', coCustomerId: 'c' })).toEqual([]);
    expect(rowIssues({ ...base, categoryId: null })).toEqual(['no_product_type']);
    // Labels exist for every code, in a fixed order.
    expect(REGISTER_ISSUE_CODES.every((c) => typeof REGISTER_ISSUES[c] === 'string')).toBe(true);
  });

  it('finds the shop by name or code; blank means the default; unknown is null', () => {
    const shops = [{ id: 've', name: 'Vinod Electronics', code: 'VE' }, { id: 'ne', name: 'Naveen Electronics', code: 'NE' }];
    expect(resolveShop('vinod  electronics', shops, 'ne')?.id).toBe('ve');
    expect(resolveShop('NE', shops, 've')?.id).toBe('ne');
    expect(resolveShop('', shops, 've')?.id).toBe('ve');
    expect(resolveShop('Star Mobiles', shops, 've')).toBeNull();
  });

  it('treats a row as the same row by number, name and mobile (and date when there is no number)', () => {
    expect(rowKey('BD-1', 'PAWAN ', '9599418909', '2021-03-01')).toBe(rowKey('BD-1', 'pawan', '9599418909', '2022-01-01'));
    expect(rowKey('BD-1', 'Pawan', '9599418909', null)).not.toBe(rowKey('BD-1', 'Sani', '9599418909', null));
    expect(rowKey('', 'Pawan', '', '2021-03-01')).not.toBe(rowKey('', 'Pawan', '', '2021-03-02'));
  });

  it('reads the Shop column, and ignores a row that has only a shop name', () => {
    const parsed = parseRegisterSheet([
      ['ID', 'CUSTOMER_NAME', 'Mobile', 'Shop'],
      ['BD-1', 'Pawan', '9599418909', 'Vinod Electronics'],
      ['', '', '', 'Vinod Electronics'],
    ]);
    expect(parsed.rows).toHaveLength(1);
    expect(parsed.rows[0].shop).toBe('Vinod Electronics');
  });
});

describe('CS6. Access', () => {
  const role = (code: string) => SYSTEM_ROLES.find((r) => r.code === code)!.permissions as readonly string[];

  it('staff (others) can search, open and add entries — without seeing real sales', () => {
    const eff = effectivePermissions(role('others'), allOn);
    for (const key of ['nav.customer_search', 'customer_search.list', 'customer_search.detail', 'customer_search.create']) {
      expect(eff.has(key), key).toBe(true);
    }
    expect(eff.has('sales.view_real')).toBe(false);
    expect(eff.has('customer_search.import')).toBe(false);
  });

  it('accountant cannot import; owner and admin can', () => {
    expect(effectivePermissions(role('accountant'), allOn).has('customer_search.import')).toBe(false);
    expect(effectivePermissions(role('admin'), allOn).has('customer_search.import')).toBe(true);
    expect(effectivePermissions(role('owner'), allOn).has('customer_search.import')).toBe(true);
  });

  it('only owner and admin can delete entries by default', () => {
    expect(effectivePermissions(role('owner'), allOn).has('customer_search.delete')).toBe(true);
    expect(effectivePermissions(role('admin'), allOn).has('customer_search.delete')).toBe(true);
    expect(effectivePermissions(role('accountant'), allOn).has('customer_search.delete')).toBe(false);
    expect(effectivePermissions(role('others'), allOn).has('customer_search.delete')).toBe(false);
  });

  it('the employee role gets nothing, and switching the feature off removes it all', () => {
    expect([...effectivePermissions(role('employee'), allOn)].some((k) => k.includes('customer_search'))).toBe(false);
    const off = { ...allOn, [FeatureKey.CUSTOMER_SEARCH]: false };
    expect([...effectivePermissions(role('owner'), off)].some((k) => k.includes('customer_search'))).toBe(false);
  });

  it('adding entries needs creating customers', () => {
    const eff = effectivePermissions(['customers.list', 'customer_search.list', 'customer_search.create'], allOn);
    expect(eff.has('customer_search.create')).toBe(false);
  });
});
