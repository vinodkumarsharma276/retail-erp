import { countOnlyProduct } from '@retailerp/shared-utils';

/**
 * How the register's Product column is written, so the import can read it.
 *
 * Staff type fast, in English and Hinglish: abbreviations (W/M, REF), Hindi
 * words (ALMARI, GADDA, CHULA), misspellings (STEPLIZER), several items in
 * one cell (W/M-REF) and counts instead of goods (2 ITEM). This table was
 * built from the owner's sheet (records 21,001–59,028, 2026-11-11) and is the
 * one source for the import's matcher, the AI prompt and the help panel on
 * the import screen. Add a spelling here and all three learn it.
 *
 * Paths name the type from the top ("Refrigerator › Deep Freezer"). A tenant
 * whose tree differs still matches by the last name when it is unique there;
 * a path the tenant doesn't have is offered as a new type, never created
 * without the person confirming.
 */

export interface GlossaryEntry {
  path: string[];
  texts: string[];
  /** Why, when it isn't obvious (shown on the import screen). */
  note?: string;
}

export const PRODUCT_GLOSSARY: GlossaryEntry[] = [
  { path: ['Almirah'], texts: ['ALMARI', 'ALMIRA', 'ALMIRAH', 'ALMARIYA'], note: 'Hindi for a steel cupboard' },
  { path: ['Refrigerator'], texts: ['REF', 'REFRIGERATOR', 'REFRIGRATOR', 'FRIDGE', 'FRIZ'] },
  {
    path: ['Refrigerator', 'Deep Freezer'],
    texts: ['DEEPFREEZER', 'DEEP FREEZER', 'DEEPFREZER', 'DEEPFREEZ', 'DEEP REF', 'DEEPREF', 'DEEP-REF', 'DEEPREFZER', 'DEEP FRIZER'],
  },
  { path: ['TV'], texts: ['TV', 'T.V.', 'TELEVISION'] },
  { path: ['TV', 'LED TV'], texts: ['LED', 'LED TV'], note: 'LED on its own means an LED TV' },
  { path: ['Washing Machine'], texts: ['W/M', 'WM', 'W-M', 'W.M', 'W//M', 'W\\M', 'WASHING MACHINE', 'WASHING'] },
  {
    path: ['Mixer Grinder'],
    texts: ['MIXER', 'MIXI', 'MIXIE', 'MIXIER', 'MAXI', 'MIXER GRINDER', 'JUCER/MIXER', 'JUICER MIXER', 'JUICER', 'JUCER'],
    note: 'JUCER/MIXER is one appliance, not two',
  },
  { path: ['Iron'], texts: ['IRON', 'PRESS', 'INSTA IRON'], note: 'PRESS is an iron' },
  { path: ['Water Purifier'], texts: ['RO', 'R.O.', 'WATER PURIFIER', 'PURIFIER'] },
  { path: ['Sewing Machine'], texts: ['S/M', 'SM', 'SWING MACHINE', 'SEWING MACHINE', 'PAYDAN'], note: 'PAYDAN is the sewing-machine pedal' },
  { path: ['AC'], texts: ['AC', 'A.C.', 'A/C'] },
  { path: ['AC', 'Window AC'], texts: ['W/AC', 'WINDOW AC'] },
  { path: ['AC', 'Split AC'], texts: ['S/AC', 'SPLIT AC'] },
  { path: ['Home Theatre'], texts: ['H/T', 'HT', 'HOMETHEATER', 'HOME THEATRE', 'HOME THEATER', 'SOUND BAR', 'SOUNDBAR'] },
  { path: ['Speaker'], texts: ['BT', 'SPEAKER', 'SOUND BOX', 'SONUD BOX', 'SPEKAR', 'SPIKER'], note: 'BT is a Bluetooth speaker' },
  { path: ['Gas Stove'], texts: ['GAS STOVE', 'GAS/STOVE', 'STOVE', 'LPG STOVE', 'CHULA', 'CHULA 3BR'], note: 'CHULA is Hindi for a stove' },
  { path: ['Geyser'], texts: ['GEYSER', 'GIJAR', 'GIJER', 'GIJJAR', 'GEASER'] },
  { path: ['Chimney'], texts: ['CHIMNEY', 'CHIMNI', 'CIMANI', 'COOKER HOOD'] },
  { path: ['Battery'], texts: ['BATTERY', 'BATTREY', 'BATRY'] },
  { path: ['Inverter / UPS'], texts: ['INVERTER', 'UPS'] },
  { path: ['Fan'], texts: ['FAN'] },
  { path: ['Fan', 'Table Fan'], texts: ['TABLE FAN', 'T/ FAN', 'T/FAN'] },
  { path: ['Fan', 'Wall Fan'], texts: ['W/FAN', 'WALL FAN'] },
  { path: ['Fan', 'Pedestal Fan'], texts: ['PEDESTAL FAN', 'PADISTAL FAN', 'STAND FAN'] },
  { path: ['Cooler'], texts: ['COOLER', 'COLLER', 'COOELR', 'COOLOER'] },
  { path: ['Stabilizer'], texts: ['STABILIZER', 'STABILISER', 'STABLIZER', 'STABLISER', 'STABLAISER', 'SATBLIZER', 'STEPLIZER'] },
  { path: ['Induction Cooktop'], texts: ['INDUCTION', 'INDUTION', 'INFRA INDUCTION', 'COOKTOP', 'COOK TPO'] },
  { path: ['Water Dispenser'], texts: ['WATER DISPENSER', 'WATER DISPENCER', 'WATER DISPANCER', 'WATER DIS.', 'W/D'] },
  { path: ['Kettle'], texts: ['KETTLE', 'KETTEL', 'KATEL', 'CATTLE'] },
  { path: ['Trimmer'], texts: ['TRIMMER', 'TRIMER', 'TRIMAR'] },
  { path: ['Hair Dryer'], texts: ['HAIR DRYER', 'HAIRDRYER'] },
  { path: ['Heater'], texts: ['HEATER', 'ROOM HEATER'] },
  { path: ['Laptop'], texts: ['LAPTOP', 'LAP TOP'] },
  { path: ['Microwave'], texts: ['MICROWAVE', 'MICRO WAVE'] },
  { path: ['Furniture', 'Bed'], texts: ['BED'] },
  { path: ['Furniture', 'Sofa'], texts: ['SOFA'] },
  { path: ['Furniture', 'Mattress'], texts: ['MATTRESS', 'GADDA'], note: 'GADDA is Hindi for a mattress' },
  { path: ['Furniture', 'Table'], texts: ['TABLE', 'TABEL'] },
  { path: ['Furniture', 'Chair'], texts: ['CHAIR', 'PLASTIC CHAIR'] },
  { path: ['Furniture', 'Dressing Table'], texts: ['DRESSING TABLE', 'DRESHING TABEL'] },
  { path: ['Mobile'], texts: ['MOBILE', 'MOBILA', 'PHONE'] },
  { path: ['Mobile', 'Accessories'], texts: ['CHARGER', 'CABLE', 'ADAPTER', 'ADAPTOR', 'ADUPTER'] },
  { path: ['Earbuds'], texts: ['EARBUDS', 'BUDS'] },
];

/** How glossary texts are compared: "W/M", "W.M", "W-M" and "WM" are all "wm". */
export function glossaryKey(text: string): string {
  return String(text ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '');
}

const byKey = new Map<string, string[]>();
for (const entry of PRODUCT_GLOSSARY) {
  for (const t of entry.texts) {
    const key = glossaryKey(t);
    const prior = byKey.get(key);
    if (prior && prior.join('/') !== entry.path.join('/')) {
      throw new Error(`Product glossary: "${t}" is listed under both ${prior.join(' › ')} and ${entry.path.join(' › ')}`);
    }
    byKey.set(key, entry.path);
  }
}

/** The glossary's type path for a text, or null. */
export function glossaryPath(text: string): string[] | null {
  const key = glossaryKey(text);
  return key ? byKey.get(key) ?? null : null;
}

/** A Product cell with no letters or digits at all ("------", "."): nothing to read. */
export function isJunkProduct(text: string): boolean {
  return !!String(text ?? '').trim() && !glossaryKey(text);
}

// --- Items in one cell ------------------------------------------------------

/** Between items: , ; + & and "--", or a slash with a space beside it ("COOLER / FAN"). */
const BETWEEN_ITEMS = /\s*(?:[,;+&]|-{2,}|\s\/|\/\s)\s*/;

/**
 * The goods a text names, when each part is something known: "W/M-REF" →
 * ["W/M", "REF"], "COOLER / FAN" → ["COOLER", "FAN"], "FAN," → ["FAN"].
 * A single "-" or "/" splits only when every side is known, so W/M, DEEP-REF
 * and JUCER/MIXER stay whole. Null when any part is unknown: the text is then
 * read as one product (and may go to the AI or a person).
 */
export function itemParts(text: string, knows: (part: string) => boolean, options: { words?: boolean } = {}): string[] | null {
  const whole = String(text ?? '').replace(/\s+/g, ' ').trim();
  if (!whole) return null;
  if (knows(whole)) return [whole];
  const parts = whole.split(BETWEEN_ITEMS).map((p) => p.trim()).filter((p) => glossaryKey(p));
  if (parts.length === 0) return null;
  const out: string[] = [];
  for (const part of parts) {
    const pieces = splitKnown(part, knows, options.words ?? false);
    if (!pieces) return null;
    out.push(...pieces);
  }
  return out;
}

function splitKnown(text: string, knows: (part: string) => boolean, words: boolean): string[] | null {
  if (knows(text)) return [text];
  for (const sep of words ? ['-', '/', ' '] : ['-', '/']) {
    const pieces = text.split(sep).map((p) => p.trim()).filter(Boolean);
    if (pieces.length < 2) continue;
    const out: string[] = [];
    let ok = true;
    for (const piece of pieces) {
      const sub = splitKnown(piece, knows, words);
      if (!sub) {
        ok = false;
        break;
      }
      out.push(...sub);
    }
    if (ok) return out;
  }
  return null;
}

/**
 * Brand or Model cut into `n` parts the same way the items were, when it
 * splits into exactly that many; otherwise the whole cell for every item.
 */
export function partsFor(cell: string, n: number): string[] {
  const text = String(cell ?? '').trim();
  if (n <= 1 || !text) return Array(Math.max(n, 1)).fill(text);
  for (const sep of [BETWEEN_ITEMS, /\s*\/\s*/, /\s*-\s*/]) {
    const pieces = text.split(sep).map((p) => p.trim()).filter(Boolean);
    if (pieces.length === n) return pieces;
  }
  return Array(n).fill(text);
}

export type ItemPlan =
  /** One item: the text as written (tidied). */
  | { kind: 'one'; text: string }
  /** Several named items, one entry each. */
  | { kind: 'several'; items: Array<{ text: string; brand: string; model: string }>; from: 'product' | 'model' }
  /** "6 ITEM" with no list of what they were: one entry, flagged. */
  | { kind: 'count'; count: number | 'all'; note: string };

/**
 * What one sheet row's Product means: one item, several (each its own
 * entry), or only a count. A count is read from the Model cell when that
 * lists exactly that many known goods ("2 ITEM" + "REF WM").
 */
export function planItems(row: { product: string; brand: string; model: string }, knows: (part: string) => boolean): ItemPlan {
  const product = String(row.product ?? '').replace(/\s+/g, ' ').trim();
  const count = countOnlyProduct(product);
  if (count) {
    const listed = itemParts(row.model, knows, { words: true });
    if (listed && listed.length >= 2 && (count === 'all' || listed.length === count)) {
      const brands = partsFor(row.brand, listed.length);
      return { kind: 'several', from: 'model', items: listed.map((text, i) => ({ text, brand: brands[i], model: row.model })) };
    }
    const named = listed?.length ? ` (Model lists ${listed.join(', ')})` : '';
    return { kind: 'count', count, note: `${product}: ${count === 'all' ? 'several' : count} items, not listed${named}` };
  }
  const parts = itemParts(product, knows);
  if (!parts || parts.length < 2) return { kind: 'one', text: parts?.[0] ?? product };
  const brands = partsFor(row.brand, parts.length);
  const models = partsFor(row.model, parts.length);
  return { kind: 'several', from: 'product', items: parts.map((text, i) => ({ text, brand: brands[i], model: models[i] })) };
}

// --- For the AI prompt and the help panel -----------------------------------

export const PRODUCT_TEXT_RULES = [
  'Abbreviations: W/M, WM, W.M, W-M = Washing Machine; REF = Refrigerator; LED = LED TV; S/M, SM = Sewing Machine; H/T, HT = Home Theatre; RO = Water Purifier; W/AC = Window AC; W/D = Water Dispenser; BT = Bluetooth speaker; PRESS = Iron.',
  'Hindi words: ALMARI = Almirah; GADDA = Mattress; CHULA = Gas Stove; GIJAR = Geyser; MIXI = Mixer Grinder; PAYDAN = sewing-machine pedal.',
  'Misspellings are read by sound: STEPLIZER = Stabilizer, KATEL = Kettle, DEEPFREZER = Deep Freezer.',
  'Several items in one cell (W/M-REF, COOLER / FAN, LED--W/M) become one entry per item, under the same account number. A slash inside one word (W/M, JUCER/MIXER) is not a separator.',
  'A count instead of goods (2 ITEM, 3ITEM, 2 ITEN, ALL ITEM) is split using the Model cell when it lists exactly that many goods (REF WM, AC LED); otherwise it stays one entry flagged "Several items, details unknown".',
  'A brand typed instead of the product (CROMPTON) is read from the Brand/Model cells by the AI, and a person confirms.',
  'Cells with no letters or digits (------) are left blank.',
];

/** The glossary as "text, text → Type › Sub-type" lines. */
export function glossaryLines(): string[] {
  return PRODUCT_GLOSSARY.map((e) => `${e.texts.join(', ')} → ${e.path.join(' › ')}`);
}
