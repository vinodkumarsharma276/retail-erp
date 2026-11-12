/**
 * Brand spellings. The account register was typed by hand for years, so one
 * make appears many ways (WHIRLPOOL as WHIRLPHOOL, WHIR, WHIPHOOL…; SAM for
 * SAMSUNG). `canonicalBrand` maps the known variants to one spelling, and
 * the brand catalog (Product type → Brand → Model) is keyed on it.
 *
 * The list was agreed with the owner from the register's own spellings
 * (2026-11-13). Add a variant here when a new misspelling turns up; the
 * `build-brand-catalog` seed re-applies the list to stored entries.
 */
export const BRAND_ALIASES: Readonly<Record<string, readonly string[]>> = {
  // Makes with no variants yet, listed so "VOLTAS WHIRLPOOL LG" is read as three makes.
  ACER: [], BAJAJ: [], BEKO: [], DELL: [], EPSON: [], HP: [], INTEX: [], KHAITAN: [], LG: [], MI: [],
  ORIENT: [], RAMATA: [], SONY: [], TRIVENI: [],
  POLYCAB: ['POLYAB'],
  ASHA: ['AASHA'],
  ASUS: ['ASUSU'],
  BELTEK: ['BELLTEK', 'BELTAK'],
  CELLO: ['CELO'],
  CROMPTON: ['CROMTION', 'CROMTON'],
  DAIKIN: ['DAKIN'],
  DEPIK: ['DAPIK', 'DEEPIK', 'DIPAK'],
  EXIDE: ['EXCIDE'],
  GLEN: ['GELEN', 'GLAIN', 'GLAN', 'GLANE', 'GLEIN'],
  GODREJ: ['GODRAGE', 'GODREG'],
  HAIER: ['HAEIR', 'HAER', 'HAIEER', 'HAIR', 'HAIRE', 'HARIER', 'HIAER'],
  HAVELLS: ['HALVELLS', 'HARVELS', 'HAVEELS', 'HAVELS', 'HEVALLS', 'HEVELLS'],
  HIMALAYAN: ['HIMALYA', 'HIMALYAN'],
  HITACHI: ['HITECHI'],
  KENSTAR: ['KENSTAN', 'KENTSTAR'],
  LENOVO: ['LENEVO'],
  LIEBHERR: ['LIBHERE', 'LIBHERR', 'LIBHIR', 'LIEBHEIER', 'LIEBHIER'],
  LIVGUARD: ['LIV GUARD', 'LIV GRARD', 'LIV-GARDE', 'LIV-GAURD', 'LIV-GUARD', 'LIVEGUARD', 'LIVGARD', 'GIVGARD'],
  LIVPURE: ['LIV PUR', 'LIV PURE', 'LIV-PURE', 'LIVE PURE', 'LIVEPURE', 'LIVEPUR', 'LIVPUR'],
  LUMINOUS: ['LIMINOUS', 'LUMINUS', 'LUM', 'LUMONICES'],
  'O GENERAL': ['O JANRAL', 'O JARNAL'],
  PANASONIC: ['PANACONIC'],
  PHILIPS: ['PHILIP', 'PHILLIPS', 'PHIIPS'],
  PRESTIGE: ['PRESTIG'],
  REDMI: ['REDMI NOTE'],
  SAMSUNG: ['SAM', 'SAM,SUNG', 'SAMAUNG', 'SAMSUBG', 'SAMSUBNG', 'SAMSUING', 'SAMSUN', 'SAMSUNH', 'SAMUSUNG', 'SANSUNG', 'SUMSUNG'],
  SARITA: ['SHARITA'],
  SKYLINE: ['SKYLIN'],
  SUJATA: ['SIJATA', 'SUAJA'],
  SUMMERKING: ['SUMMER KING', 'SAMMERKING'],
  SURYA: ['SUYA', 'SYURA'],
  'T-SERIES': ['T SERIES', 'T SHEIES', 'T-SEREIS', 'T-SERES', 'T-SERICE', 'T-SERISE', 'T-SERSE', 'T. SERIES', 'T.SERIES', 'TSERIES'],
  TRUFAST: ['TRU', 'TRUE', 'TRUF', 'TRUE FAST', 'TRUEFAST'],
  UNIPLUS: ['UNPLUS'],
  USHA: ['UASHA', 'UASA'],
  'V-GUARD': ['V GAURD', 'V GUARD', 'V-GARD', 'V-GAURD', 'V. GUARD', 'V.GUARD', 'VGAURD', 'VGUARD', 'V-GUR'],
  VOLTAS: ['VLOTAS', 'VOILTAS', 'VOLLTAS', 'VOTAS', 'VOTLAS', 'VOLTAS FAN'],
  WHIRLPOOL: ['WHILPHOOL', 'WHIPHOOL', 'WHIR', 'WHIRL', 'WHIEL', 'WHIRLPHOOL', 'WHIRLPOO', 'WHIRPHOOL', 'WIHI', 'WIHIPHOOL', 'WIHIRPHOOL'],
  ZEBRONICS: ['ZABRONICE', 'ZEBRONIC', 'ZEBRONICE', 'ZOBRONICS'],
};

/**
 * Texts typed into the Brand column that are not makes: product types,
 * counts and notes. They are left on the entry as written but never offered
 * as a brand.
 */
export const NOT_BRANDS: ReadonlySet<string> = new Set([
  '2 BRAND', '5 BRAND', '2MODAL', '3MODAL', 'AC', 'ALL', 'ALL ITEM', 'BED 6X6', 'CASH', 'COOKER HOOD',
  'COOKTOP', 'DINER SET', 'GIJJAR', 'GLASS CHIMNI', 'IMMERSION', 'IMMERSON ROD', 'INDUCTION', 'INDUTION',
  'INFRA', 'INFRARED', 'INFRARER', 'INFRO', 'IRON', 'LED', 'MIXI', 'NAVEEN ELECTRONICS BILL', 'PAYDAN',
  'ALMIRA', 'ALMIRAH', 'REF', 'S/M', 'SDSD', 'STON', 'STONE', 'STOVE', 'UPS', 'W/M', 'WIM', 'WM',
]);

const VARIANT_TO_BRAND: ReadonlyMap<string, string> = new Map(
  Object.entries(BRAND_ALIASES).flatMap(([brand, variants]) => [
    [brand, brand] as const,
    ...variants.map((v) => [v, brand] as const),
  ]),
);

/** Upper case, single spaces, no stray marks at either end (`HAVELLS,` → `HAVELLS`). */
export function brandKey(text: string | null | undefined): string {
  return String(text ?? '')
    .toUpperCase()
    .replace(/\s+/g, ' ')
    .replace(/^[^A-Z0-9]+|[^A-Z0-9]+$/g, '')
    .trim();
}

/** Separators between makes in one cell: "LG, HAVELLS", "LG - USHA", "HAVELLS . GLAN" … */
const COMBO_SEPARATOR = /\s*(?:[,;\\&+]|\s-\s|\.\s)\s*/;
/** … and "TRUE/LUM", split last so a product written "W/M" stays whole. */
const SLASH = /\s*\/\s*/;

/** The parts of a cell naming several makes, or null for a single make. */
function comboParts(key: string): string[] | null {
  const parts = key
    .split(COMBO_SEPARATOR)
    .flatMap((part) => (NOT_BRANDS.has(brandKey(part)) || VARIANT_TO_BRAND.has(brandKey(part)) ? [part] : part.split(SLASH)))
    .map(brandKey)
    .filter(Boolean);
  if (parts.length > 1) return parts;
  // "VOLTAS WHIRLPOOL LG", "SAM-HAIER": words that are each a known make.
  const words = key.split(/[ -]+/);
  return words.length > 1 && words.every((w) => VARIANT_TO_BRAND.has(w)) ? words : null;
}

/**
 * One spelling per make. A known variant becomes its brand (`WHIRLPHOOL` →
 * `WHIRLPOOL`); a cell naming several makes has each one corrected and is
 * joined with ", " (`TRU/LUM` → `TRUFAST, LUMINOUS`); anything else is
 * returned trimmed, as typed. Empty → ''.
 */
export function canonicalBrand(text: string | null | undefined): string {
  const original = String(text ?? '').trim().replace(/\s+/g, ' ');
  const key = brandKey(original);
  if (!key) return '';
  const known = VARIANT_TO_BRAND.get(key);
  if (known) return known;
  if (NOT_BRANDS.has(key)) return key;
  const parts = comboParts(key);
  if (parts) return parts.map((p) => VARIANT_TO_BRAND.get(p) ?? p).join(', ');
  return original.replace(/^[^A-Za-z0-9]+|[^A-Za-z0-9]+$/g, '');
}

/**
 * Whether a brand text names one real make, so it belongs in the catalog:
 * not several makes, not a product type or note, and with letters in it.
 */
export function isCatalogBrand(text: string | null | undefined): boolean {
  const key = brandKey(canonicalBrand(text));
  return /[A-Z]{2}/.test(key) && !NOT_BRANDS.has(key) && !comboParts(key);
}

/** Catalog key for a model number: upper case, single spaces, no stray end marks. */
export const modelKey = brandKey;
