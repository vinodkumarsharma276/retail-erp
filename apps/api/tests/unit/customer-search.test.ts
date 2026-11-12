import { describe, expect, it } from 'vitest';
import {
  ALL_FEATURE_KEYS,
  ALL_PERMISSIONS,
  FeatureKey,
  SYSTEM_ROLES,
  effectivePermissions,
} from '@retailerp/shared-types';
import {
  accountSearchText,
  formatAccountNumber,
  isIsoDate,
  isValidAccountPrefix,
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
  knownText,
  matchProductTexts,
  TypeTree,
} from '../../src/modules/customer-search/customer-search.product-types.js';
import { glossaryPath, itemParts, planItems, PRODUCT_GLOSSARY } from '../../src/modules/customer-search/customer-search.product-glossary.js';
import { applyAnswer, productPrompt } from '../../src/modules/customer-search/customer-search.product-adjudicator.js';
import { purchaseKey, rowIssues } from '../../src/modules/customer-search/customer-search.issues.js';
import { resolveShop, rowKey } from '../../src/modules/customer-search/customer-search.import.js';

const allOn = Object.fromEntries(ALL_FEATURE_KEYS.map((k) => [k, true]));

describe('CS1. Account numbers', () => {
  it('writes every standard shape one way: two letters, a space, the number', () => {
    for (const typed of ['BD-33', ' bd- 33 ', 'BD33', 'bd 33', 'BD.033', 'BD-33.', 'BD-33`', 'BD - 33']) {
      expect(parseAccountNumber(typed), typed).toEqual({ accountNumber: 'BD 33', prefix: 'BD', seriesNo: 33 });
    }
    expect(formatAccountNumber('mj009')).toBe('MJ 9');
  });

  it('keeps other shapes as written, without a series number (flagged for review)', () => {
    expect(parseAccountNumber('BL-528,35')).toMatchObject({ accountNumber: 'BL-528,35', prefix: 'BL', seriesNo: null });
    expect(parseAccountNumber('DH-306-406')).toMatchObject({ accountNumber: 'DH-306-406', seriesNo: null });
    expect(parseAccountNumber('BD-406A')).toMatchObject({ accountNumber: 'BD-406A', prefix: 'BD', seriesNo: null });
    expect(parseAccountNumber('DF-738(A)')).toMatchObject({ accountNumber: 'DF-738(A)', seriesNo: null });
    expect(parseAccountNumber('ABCD-421').seriesNo).toBeNull();
    expect(parseAccountNumber('D7').seriesNo).toBeNull();
    expect(parseAccountNumber('1234').prefix).toBe('');
    expect(parseAccountNumber('').accountNumber).toBe('');
  });

  it('a series may be 3 letters, and may carry one digit for a new register (CK → CK2)', () => {
    expect(parseAccountNumber('ck2-15')).toEqual({ accountNumber: 'CK2 15', prefix: 'CK2', seriesNo: 15 });
    expect(parseAccountNumber('CK2 015')).toEqual({ accountNumber: 'CK2 15', prefix: 'CK2', seriesNo: 15 });
    expect(parseAccountNumber('ABC-7')).toEqual({ accountNumber: 'ABC 7', prefix: 'ABC', seriesNo: 7 });
    expect(parseAccountNumber('ABC2.7')).toEqual({ accountNumber: 'ABC2 7', prefix: 'ABC2', seriesNo: 7 });
    // With no separator the digits are all the number.
    expect(parseAccountNumber('CK215')).toEqual({ accountNumber: 'CK 215', prefix: 'CK', seriesNo: 215 });
    expect(nextAccountNumber('ck2', { seriesNo: 15 })).toBe('CK2 16');
    expect(accountSearchText('ck2-15')).toBe('CK2 15');
  });

  it('suggests the next number of a series; searches find "BD 12" however it is typed', () => {
    expect(nextAccountNumber('BD', { seriesNo: 264 })).toBe('BD 265');
    expect(nextAccountNumber('mi', null)).toBe('MI 1');
    expect(['bd', 'abc', 'ck2', 'abc2'].map(isValidAccountPrefix)).toEqual([true, true, true, true]);
    expect(['B', 'ABCD', 'CK22', '2CK'].map(isValidAccountPrefix)).toEqual([false, false, false, false]);
    expect(['bd-12', 'bd12', 'BD 012', 'bd', '12'].map(accountSearchText)).toEqual(['BD 12', 'BD 12', 'BD 12', 'BD', '12']);
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
  const tree = new TypeTree([
    { id: 't-fridge', name: 'Fridge', slug: 'fridge', parentId: null },
    { id: 't-wm', name: 'Washing Machine', slug: 'washing-machine', parentId: null },
    { id: 't-ac', name: 'Air Conditioner', slug: 'air-conditioner', parentId: null },
  ]);
  const texts = (list: string[]) => list.map((text) => ({ text }));

  it('matches sheet text: remembered, the tenant\'s own name, plural, glossary, lookalike, new', () => {
    const matches = matchProductTexts(
      texts(['Fridge', 'fridges', 'W/M', 'Air Conditoner', 'Gizmo', 'gizmo', 'Geyser', '']),
      tree,
      new Map([['geyser', null]]),
    );
    const byKey = Object.fromEntries(matches.map((m) => [m.textKey, [m.kind, m.categoryId, m.rows]]));
    expect(byKey).toEqual({
      fridge: ['matched', 't-fridge', 1],
      fridges: ['matched', 't-fridge', 1],
      'w/m': ['glossary', 't-wm', 1],
      'air conditoner': ['similar', 't-ac', 1],
      gizmo: ['new', null, 2],
      geyser: ['mapped', null, 1],
    });
    // Nothing is created unless asked: a new text defaults to blank.
    expect(defaultDecision(matches.find((m) => m.textKey === 'gizmo')!)).toEqual({ action: 'blank' });
    expect(defaultDecision(matches.find((m) => m.textKey === 'fridge')!)).toEqual({ action: 'existing', categoryId: 't-fridge' });
  });

  it('prefers an existing sub-type of the same name over creating a duplicate top-level type', () => {
    const deep = new TypeTree([
      { id: 'e', name: 'Electronics', slug: 'electronics', parentId: null },
      { id: 't', name: 'TV', slug: 'tv', parentId: 'e' },
      { id: 's-led', name: 'LED TV', slug: 'led-tv', parentId: 't' },
      { id: 'tv-stand', name: 'Stand', slug: 'stand', parentId: 't' },
      { id: 'f', name: 'Fan', slug: 'fan', parentId: null },
      { id: 'fan-stand', name: 'Stand', slug: 'stand', parentId: 'f' },
    ]);
    const [m] = matchProductTexts(texts(['LED TV']), deep, new Map());
    expect(m).toMatchObject({ kind: 'matched', categoryId: 's-led', categoryName: 'Electronics › TV › LED TV' });
    // Ambiguous (two sub-types of that name): it stays new for the person to decide.
    const [n] = matchProductTexts(texts(['Stand']), deep, new Map());
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

describe('CS7b. Reading the sheet\'s Product column (glossary, items, counts, AI answers)', () => {
  // The owner's type tree after small appliances moved to the top (2026-11-11).
  const cats: Array<[string, string, string | null]> = [
    ['ac', 'AC', null], ['ac-split', 'Split AC', 'ac'], ['ac-window', 'Window AC', 'ac'],
    ['almirah', 'Almirah', null], ['battery', 'Battery', null], ['battery-ups', 'UPS Battery', 'battery'],
    ['chimney', 'Chimney', null], ['earbuds', 'Earbuds', null], ['fan', 'Fan', null],
    ['furniture', 'Furniture', null], ['bed', 'Bed', 'furniture'], ['dining', 'Dining Table', 'furniture'], ['sofa', 'Sofa', 'furniture'],
    ['gas', 'Gas Stove', null], ['geyser', 'Geyser', null], ['ht', 'Home Theatre', null], ['mobile', 'Mobile', null],
    ['smartphone', 'Smartphone', 'mobile'], ['ref', 'Refrigerator', null], ['ref-single', 'Single Door', 'ref'],
    ['sewing', 'Sewing Machine', null], ['iron', 'Iron', null], ['mixer', 'Mixer Grinder', null], ['ro', 'Water Purifier', null],
    ['speaker', 'Speaker', null], ['tv', 'TV', null], ['led', 'LED TV', 'tv'], ['wm', 'Washing Machine', null], ['wm-top', 'Top Load', 'wm'],
  ];
  const vn = new TypeTree(cats.map(([id, name, parentId]) => ({ id, name, slug: id, parentId })));
  const knows = knownText(vn, new Map());

  /** "Type" (existing), "+Type" (to create), "-" (blank), "?" (for the AI / a person), "count", joined with " + " for items. */
  const read = (product: string, brand = '', model = '') => {
    const plan = planItems({ product, brand, model }, knows);
    if (plan.kind === 'count') return 'count';
    const parts = plan.kind === 'one' ? [plan.text] : plan.items.map((i) => i.text);
    return parts
      .map((p) => {
        const [m] = matchProductTexts([{ text: p }], vn, new Map());
        if (m.categoryId && m.kind !== 'similar') return m.categoryName;
        if (m.create) return `+${m.create.label}`;
        if (m.kind === 'glossary') return '-';
        return '?';
      })
      .join(' + ');
  };

  it('reads every Product text of records 21,001–31,000 the way the owner agreed', () => {
    const expected: Record<string, string> = {
      ALMARI: 'Almirah', REF: 'Refrigerator', LED: 'TV › LED TV', 'W/M': 'Washing Machine', WM: 'Washing Machine', 'W-M': 'Washing Machine',
      'W.M': 'Washing Machine', 'W//M': 'Washing Machine', 'W\\M': 'Washing Machine', MIXER: 'Mixer Grinder', MIXI: 'Mixer Grinder',
      MIXIER: 'Mixer Grinder', 'JUCER/MIXER': 'Mixer Grinder', JUICER: 'Mixer Grinder', 'S/M': 'Sewing Machine', SM: 'Sewing Machine',
      PAYDAN: 'Sewing Machine', GADDA: '+Furniture › Mattress', 'W/AC': 'AC › Window AC', 'H/T': 'Home Theatre', HT: 'Home Theatre',
      HOMETHEATER: 'Home Theatre', 'SOUND BAR': 'Home Theatre', DEEPFREEZER: '+Refrigerator › Deep Freezer', 'DEEP REF': '+Refrigerator › Deep Freezer',
      DEEPFREZER: '+Refrigerator › Deep Freezer', DEEPFREEZ: '+Refrigerator › Deep Freezer', DEEPREF: '+Refrigerator › Deep Freezer',
      'DEEP-REF': '+Refrigerator › Deep Freezer', PRESS: 'Iron', 'INSTA IRON': 'Iron', STEPLIZER: '+Stabilizer', STABLIZER: '+Stabilizer',
      SATBLIZER: '+Stabilizer', STABLAISER: '+Stabilizer', STABLISER: '+Stabilizer', STABILIZER: '+Stabilizer', INDUCTION: '+Induction Cooktop',
      INDUTION: '+Induction Cooktop', 'INFRA INDUCTION': '+Induction Cooktop', 'COOK TPO': '+Induction Cooktop', RO: 'Water Purifier',
      'R.O.': 'Water Purifier', LAPTOP: '+Laptop', 'LAP TOP': '+Laptop', CHULA: 'Gas Stove', 'CHULA 3BR': 'Gas Stove', 'LPG STOVE': 'Gas Stove',
      GIJAR: 'Geyser', GIJER: 'Geyser', CHAIR: '+Furniture › Chair', 'PLASTIC CHAIR': '+Furniture › Chair',
      'WATER DISPANCER': '+Water Dispenser', 'WATER DISPENCER': '+Water Dispenser', 'WATER DIS.': '+Water Dispenser',
      'WATER DISPENSER': '+Water Dispenser', 'W/D': '+Water Dispenser', BT: 'Speaker', 'SONUD BOX': 'Speaker', 'SOUND BOX': 'Speaker',
      SPEKAR: 'Speaker', SPIKER: 'Speaker', COOLER: '+Cooler', KETTEL: '+Kettle', KATEL: '+Kettle', KETTLE: '+Kettle', CATTLE: '+Kettle',
      TRIMER: '+Trimmer', TRIMAR: '+Trimmer', TRIMMER: '+Trimmer', '------': '-', CIMANI: 'Chimney', 'COOKER HOOD': 'Chimney',
      'DRESHING TABEL': '+Furniture › Dressing Table', HAIRDRYER: '+Hair Dryer', MICROWAVE: '+Microwave', TABEL: '+Furniture › Table',
      TABLE: '+Furniture › Table',
      // Several items: an entry each.
      'LED--W/M': 'TV › LED TV + Washing Machine', 'REF--W/M--COLLER': 'Refrigerator + Washing Machine + +Cooler',
      'W/M -- IRON': 'Washing Machine + Iron', 'W/M-REF': 'Washing Machine + Refrigerator', 'W/M, LED': 'Washing Machine + TV › LED TV',
      // Only a count (no Model list here).
      '2 ITEM': 'count', '3 ITEM': 'count', '5 ITEM': 'count', '2ITEM': 'count', '10 ITEM': 'count', '2 ITEN': 'count',
      '3ITEM': 'count', '6 ITEM': 'count', '7 ITEM': 'count', 'ALL ITEM': 'count',
      // Records 31,001 onwards.
      MOBILE: 'Mobile', MOBILA: 'Mobile', FAN: 'Fan', 'FAN,': 'Fan', 'TABLE FAN': '+Fan › Table Fan', 'T/ FAN': '+Fan › Table Fan',
      'W/FAN': '+Fan › Wall Fan', 'PADISTAL FAN': '+Fan › Pedestal Fan', 'STAND FAN': '+Fan › Pedestal Fan', COLLER: '+Cooler',
      COOELR: '+Cooler', BATTREY: 'Battery', INVERTER: '+Inverter / UPS', UPS: '+Inverter / UPS', BUDS: 'Earbuds',
      CHARGER: '+Mobile › Accessories', CABLE: '+Mobile › Accessories', ADUPTER: '+Mobile › Accessories', MAXI: 'Mixer Grinder',
      HEATER: '+Heater', 'COOLER / FAN': '+Cooler + Fan', 'FAN,COOLER': 'Fan + +Cooler', 'COOLOER / FAN': '+Cooler + Fan',
      'COOLER / IRON': '+Cooler + Iron',
    };
    const got = Object.fromEntries(Object.keys(expected).map((t) => [t, read(t)]));
    expect(got).toEqual(expected);
    // Left for the AI and a person: brands, unclear words, a count of ACs.
    for (const t of ['STONE', 'SICER', 'M/AC', '14 AC', 'RED', 'CROMPTON', 'COOLER, FAN V GUARD, LUMI']) {
      expect(read(t), t).toBe('?');
    }
  });

  it('splits an "N ITEM" row from Model only when Model lists exactly that many goods', () => {
    expect(read('2 ITEM', 'LG', 'REF WM')).toBe('Refrigerator + Washing Machine');
    expect(read('3ITEM', '3MODAL', 'LED,,W/M,MOBILE')).toBe('TV › LED TV + Washing Machine + Mobile');
    expect(read('2 ITEN', 'LG', 'WM REF')).toBe('Washing Machine + Refrigerator');
    expect(read('2ITEM', '2MODAL', 'REF,DEEPREFZER')).toBe('Refrigerator + +Refrigerator › Deep Freezer');
    expect(read('ALL ITEM', 'ALL', 'REF WM')).toBe('Refrigerator + Washing Machine');
    // Model names fewer than the count, or model numbers: one entry, flagged.
    expect(read('10 ITEM', 'LG', 'AC LED')).toBe('count');
    expect(read('5 ITEM', 'LG', 'AC WM REF LED')).toBe('count');
    expect(read('2 ITEM', 'LG', 'T80KMM, B199OBEB')).toBe('count');
    const plan = planItems({ product: '10 ITEM', brand: 'LG', model: 'AC LED' }, knows);
    expect(plan).toMatchObject({ kind: 'count', count: 10, note: '10 ITEM: 10 items, not listed (Model lists AC, LED)' });
  });

  it('gives each split item its own Brand and Model when they split the same way', () => {
    expect(planItems({ product: 'W/M-REF', brand: 'BEKO/WHIRL', model: '260 IMPRO/73157' }, knows)).toEqual({
      kind: 'several', from: 'product',
      items: [{ text: 'W/M', brand: 'BEKO', model: '260 IMPRO' }, { text: 'REF', brand: 'WHIRL', model: '73157' }],
    });
    // Brand doesn't split in two: both items keep it.
    expect(planItems({ product: 'W/M, LED', brand: 'SAMSUNG', model: '4520, 20C2723' }, knows)).toMatchObject({
      items: [{ text: 'W/M', brand: 'SAMSUNG', model: '4520' }, { text: 'LED', brand: 'SAMSUNG', model: '20C2723' }],
    });
  });

  it('never splits inside one product: W/M, DEEP-REF, JUCER/MIXER, GAS/STOVE stay whole', () => {
    for (const t of ['W/M', 'DEEP-REF', 'JUCER/MIXER', 'GAS/STOVE', 'T/ FAN']) expect(itemParts(t, knows), t).toEqual([t]);
    // An unknown part stops a split; the text is read as one product.
    expect(itemParts('COOLER, FAN V GUARD, LUMI', knows)).toBeNull();
  });

  it('a saved decision counts as known, so "GIZMO-REF" splits once GIZMO is decided', () => {
    expect(itemParts('GIZMO-REF', knows)).toBeNull();
    expect(itemParts('GIZMO-REF', knownText(vn, new Map([['gizmo', 'fan']])))).toEqual(['GIZMO', 'REF']);
  });

  it('keeps the glossary consistent: no text means two types, and each text is found again', () => {
    for (const e of PRODUCT_GLOSSARY) for (const t of e.texts) expect(glossaryPath(t), t).toEqual(e.path);
  });

  it('checks the AI\'s answers against the tree before suggesting anything', () => {
    const [base] = matchProductTexts([{ text: 'STONE', brand: 'HAVELLS' }], vn, new Map());
    expect(base).toMatchObject({ kind: 'new', samples: ['HAVELLS'] });
    expect(applyAnswer(base, { kind: 'type', path: ['Iron'], reason: 'Havells stone iron' }, vn)).toMatchObject({
      kind: 'ai', categoryId: 'iron', suggestion: { action: 'existing', categoryId: 'iron' }, reason: 'AI: Havells stone iron',
    });
    // A path that isn't in the tree, or a new type under a parent that isn't: ignored.
    expect(applyAnswer(base, { kind: 'type', path: ['Kitchen', 'Stone'] }, vn)).toBeNull();
    expect(applyAnswer(base, { kind: 'new', path: ['Kitchen', 'Stone Grinder'] }, vn)).toBeNull();
    expect(applyAnswer(base, { kind: 'new', path: ['Mobile', 'Power Bank'] }, vn)).toMatchObject({
      kind: 'ai', create: { name: 'Power Bank', parentId: 'mobile', label: 'Mobile › Power Bank' },
      suggestion: { action: 'create', name: 'Power Bank', parentId: 'mobile' },
    });
    // "New" but it exists: that type.
    expect(applyAnswer(base, { kind: 'new', path: ['Geyser'] }, vn)).toMatchObject({ kind: 'ai', categoryId: 'geyser' });
    // Several items: a person separates them in the row; nothing is pre-filled.
    const several = applyAnswer(base, { kind: 'several', items: [['Cooler'], ['Fan']] }, vn)!;
    expect(several.suggestion).toEqual({ action: 'blank' });
    expect(several.reason).toContain('Separate them with commas');
    expect(applyAnswer(base, { kind: 'nonsense' }, vn)).toBeNull();
  });

  it('builds the prompt from the same glossary and the tenant\'s tree', () => {
    const prompt = productPrompt(vn);
    expect(prompt).toContain('ALMARI, ALMIRA, ALMIRAH, ALMARIYA → Almirah');
    expect(prompt).toContain('TV › LED TV');
    expect(prompt).toContain('GADDA = Mattress');
  });

  it('treats items of one purchase (same person, same date) as one use of an account number', () => {
    const a = { customerName: 'Ram  Lal', mobile: '9812345678', purchaseDate: '2024-03-01' };
    expect(purchaseKey(a)).toBe(purchaseKey({ ...a, customerName: 'ram lal', purchaseDate: new Date('2024-03-01T00:00:00Z') }));
    expect(purchaseKey(a)).not.toBe(purchaseKey({ ...a, purchaseDate: '2024-03-02' }));
    expect(purchaseKey(a)).not.toBe(purchaseKey({ ...a, customerName: 'Shyam Lal' }));
    // Entries naming nobody are never "the same purchase".
    expect(purchaseKey({ id: '1', customerName: '', mobile: '', purchaseDate: null })).not.toBe(
      purchaseKey({ id: '2', customerName: '', mobile: '', purchaseDate: null }),
    );
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
    // "3 ITEM" with no type: the items aren't known, which says more than "no type".
    expect(rowIssues({ ...base, categoryId: null, product: '3 ITEM' })).toEqual(['items_unknown']);
    expect(rowIssues({ ...base, product: '3 ITEM' })).toEqual([]);
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
