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
]);

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

/**
 * Pull the most likely payee / payer name out of a bank narration, e.g.
 *   "UPI/DR/412345678901/RAMESH KUMAR/SBIN/ramesh@oksbi/Payment" -> "Ramesh Kumar"
 *   "NEFT-HDFCR52024031512345-SAMSUNG INDIA ELECTRONICS PVT LTD-..." -> "Samsung India Electronics Pvt Ltd"
 */
export function extractCounterparty(desc: string): string | null {
  const vpa = desc.match(/([a-z0-9._-]{3,})@[a-z]{2,}/i);
  const tokens = desc
    .replace(/[a-z0-9._-]+@[a-z]+/gi, ' ')
    .split(/[\/|:*#]|\s-\s|-(?=[A-Z])|(?<=[A-Z0-9])-|\s{2,}/)
    .map((t) => t.trim())
    .filter((t) => t && !/^[A-Z]{4}0[A-Z0-9]{6}$/i.test(t)) // drop IFSC codes before digits are stripped
    .map((t) => t.replace(/[^A-Za-z&.' ]/g, ' ').replace(/\s+/g, ' ').trim())
    .filter(Boolean);

  for (const t of tokens) {
    const words = t.split(' ').filter((w) => w.length > 1);
    if (!words.length) continue;
    if (words.every((w) => STOP.has(w.toUpperCase()))) continue;
    // Drop leading filler words ("To TRF ...", "By CLR CTS ...") and trailing cheque noise.
    let start = 0;
    while (start < words.length && STOP.has(words[start].toUpperCase())) start++;
    const cleaned = words.slice(start).join(' ').replace(/\s+(CHQ|CHEQUE)\b.*$/i, '');
    if (cleaned.replace(/[^A-Za-z]/g, '').length < 3) continue;
    return titleCase(cleaned).slice(0, 60);
  }
  if (vpa) return vpa[1].replace(/[._-]+/g, ' ').replace(/\d+/g, '').trim() || null;
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
