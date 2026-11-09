import type { Channel } from '../types.js';

const CHANNELS: [Channel, RegExp][] = [
  ['Bank', /\bINT(EREST)?\b.*\b(PD|PAID|CR|CREDIT)\b|\bCHARGES?\b|\bCHGS\b|\bFEE\b|\bGST\b.*\bCHG|\bSMS\b|\bAMC\b|\bMIN(IMUM)? BAL/i],
  ['UPI', /\bUPI\b|@ok(axis|hdfc|icici|sbi)|@ybl|@paytm|@ibl|@axl|@upi|\bBHIM\b|\bVPA\b/i],
  ['NEFT/IMPS/RTGS', /\bNEFT\b|\bIMPS\b|\bRTGS\b|\bMMT\b|\bFT\s*-|\bTRF\b|\bTRANSFER\b|\bACH CR\b|\bWIRE\b|\bZELLE\b/i],
  ['ATM/Cash', /\bATM\b|\bNWD\b|\bCASH\s*(WDL|WITHDRAWAL|DEP|DEPOSIT)\b|\bCDM\b|\bBY CASH\b|\bSELF\b.*\bCASH\b|\bCASH\b/i],
  ['Card', /\bPOS\b|\bECOM\b|\bDEBIT CARD\b|\bCREDIT CARD\b|\bVISA\b|\bMASTERCARD\b|\bRUPAY\b|\bVPS\b|\bIPS\b|\bCARD\b/i],
  ['Cheque', /\bCHQ\b|\bCHEQUE\b|\bCLG\b|\bCLEARING\b|\bCTS\b|\bINWARD\b|\bOUTWARD\b/i],
  ['Auto-debit', /\bNACH\b|\bACH\b|\bECS\b|\bMANDATE\b|\bAUTOPAY\b|\bSI\b|\bSTANDING INSTRUCTION\b|\bE-?MANDATE\b/i],
];

export function detectChannel(desc: string): Channel {
  for (const [ch, re] of CHANNELS) if (re.test(desc)) return ch;
  return 'Other';
}

const STOP = new Set([
  'UPI', 'DR', 'CR', 'NEFT', 'IMPS', 'RTGS', 'P2A', 'P2M', 'P2P', 'MMT', 'POS', 'ECOM', 'ATM', 'NWD', 'ACH', 'NACH', 'ECS', 'TRF',
  'TO', 'FROM', 'BY', 'PAYMENT', 'PAY', 'SENT', 'RECEIVED', 'COLLECT', 'REQ', 'REQUEST', 'TRANSFER', 'FT', 'INB', 'MB', 'IB', 'BIL',
  'ONL', 'ONLINE', 'REF', 'NO', 'TXN', 'UTR', 'PVT', 'LTD', 'BANK', 'NA', 'NULL', 'OTHERS', 'VPS', 'IPS', 'DEBIT', 'CREDIT', 'CARD',
  'HDFC', 'ICICI', 'SBI', 'AXIS', 'KOTAK', 'YESB', 'PAYTM', 'YBL', 'IBL', 'OKAXIS', 'OKHDFCBANK', 'OKICICI', 'OKSBI', 'INDIA',
  'CHQ', 'CLG', 'CTS', 'CLR', 'DT', 'GST', 'CGST', 'SGST', 'IGST', 'MANDATE', 'SI', 'AUTOPAY', 'DEP', 'WDL', 'CASH', 'SELF', 'IMPS-P2A', 'AND', 'THE', 'FOR', 'VIA',
  // Federal Bank codes: NFT = NEFT, TFR/FT/CLG = transaction type, IN/OUT = UPI direction, ACHDR/ACHCR = NACH, STD INS = standing instruction.
  'NFT', 'TFR', 'IN', 'OUT', 'ACHDR', 'ACHCR', 'STD', 'INS', 'WWW',
  // UPI remarks, often cut short.
  'PAID', 'REMARK', 'USING', 'SENT',
]);

/** Free-text remark words that, cut short, show up as fake payees ("Payme", "Paid sup"). */
const REMARK_PREFIX = /^(pay|paid|sent|navi|remark|na)/i;

const KEEP_CASE = new Set(['pvt', 'ltd', 'llp', 'inc', 'mr', 'mrs', 'ms', 'dr', 'st']);

/** RAMESH KUMAR -> Ramesh Kumar, but keep short vowel-less acronyms: LG, HP, GST, CBDT. */
function titleCase(s: string) {
  return s
    .split(' ')
    .map((w) => {
      const lower = w.toLowerCase();
      if (!KEEP_CASE.has(lower) && w.length <= 4 && !/[aeiou]/i.test(w)) return w.toUpperCase();
      return lower.charAt(0).toUpperCase() + lower.slice(1);
    })
    .join(' ');
}

/** UPI ids as banks print them; a wrapped id is rejoined first ("sandeep.9489- 13@waicici"). */
const VPA = /([a-z0-9][a-z0-9._-]{1,})@([a-z]*)/i;

/** A name from a UPI id's handle: "harish15kaira" -> "Harish Kaira"; a phone-number handle has no name. */
function nameFromHandle(handle: string): string | null {
  if (/^\d{10}/.test(handle)) return null;
  const words = handle
    .split(/[._\-\d]+/)
    .filter((w) => w.length >= 2 && !STOP.has(w.toUpperCase()));
  // "ak3733176951" — two letters say nothing; the id itself is the better label.
  if (words.join('').length < 3) return null;
  return titleCase(words.slice(0, 3).join(' '));
}

/** A name-like token: no reference codes, no leading filler words, no stray trailing letter. */
function nameFromToken(token: string): string | null {
  const words = token
    // References and IFSCs mix letters and digits (FBBT262925890053, ICIC0001917, S93626886).
    .replace(/\b(?=[A-Z]*\d)(?=\d*[A-Z])[A-Z0-9]{5,}\b/gi, ' ')
    .replace(/[^A-Za-z&.' ]/g, ' ')
    .split(' ')
    .map((w) => w.replace(/^\.+|\.+$/g, ''))
    .filter(Boolean);
  let start = 0;
  while (start < words.length && STOP.has(words[start].toUpperCase())) start++;
  let end = words.length;
  // A narration cut mid-word leaves one letter behind ("… ICIC0001917 V").
  while (end > start && words[end - 1].length === 1) end--;
  let name = words.slice(start, end);
  if (!name.length || name.every((w) => STOP.has(w.toUpperCase()))) return null;
  if (name.length === 1 && (REMARK_PREFIX.test(name[0]) || name[0].length <= 3)) return null;
  // Some banks print the beneficiary twice ("LBS AIRCON LBS AIRCON").
  const half = name.length / 2;
  if (Number.isInteger(half) && name.slice(0, half).join(' ').toUpperCase() === name.slice(half).join(' ').toUpperCase()) name = name.slice(0, half);
  const cleaned = name.join(' ').replace(/\s+(CHQ|CHEQUE)\b.*$/i, '');
  if (cleaned.replace(/[^A-Za-z]/g, '').length < 3) return null;
  return titleCase(cleaned).slice(0, 60);
}

/**
 * Pull the most likely payee / payer name out of a bank narration, e.g.
 *   "UPI/DR/412345678901/RAMESH KUMAR/SBIN/ramesh@oksbi/Payment" -> "Ramesh Kumar"
 *   "NEFT-HDFCR52024031512345-SAMSUNG INDIA ELECTRONICS PVT LTD-..." -> "Samsung India Electronics Pvt Ltd"
 *   "NFT/FBBT262925890053 Laxmi Enterpris ICIC0001917 V / FT" -> "Laxmi Enterpris"
 *   "UPI IN/004768578765 /harish15kaira@axl/Payment f/5722 / TFR" -> "Harish Kaira"
 * With a UPI id, only text *before* it can be the name; what follows is the payer's remark.
 */
export function extractCounterparty(desc: string): string | null {
  const text = desc.replace(/([.\-_])\s+(?=[a-z0-9._-]*@)/gi, '$1');
  const vpa = VPA.exec(text);
  const head = vpa ? text.slice(0, vpa.index) : text;
  const tokens = head.split(/[\/|:*#]|\s-\s|-(?=[A-Z])|(?<=[A-Z0-9])-|\s{2,}/);
  for (const t of tokens) {
    const name = nameFromToken(t.trim());
    if (name) return name;
  }
  if (vpa) {
    const handle = vpa[1].replace(/[._-]+$/, '');
    // A phone-number id is still the best key for "the same person paid again".
    return nameFromHandle(handle) ?? `${handle}@${vpa[2]}`.slice(0, 60);
  }
  return null;
}

/** Normalized key for grouping "the same" narration across months (digits and refs removed). */
export function descriptionKey(desc: string) {
  return desc
    .toUpperCase()
    .replace(/[a-z0-9._-]+@[a-z]+/gi, (m) => m.split('@')[0])
    .replace(/\d+/g, '')
    .replace(/[^A-Z ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80);
}
