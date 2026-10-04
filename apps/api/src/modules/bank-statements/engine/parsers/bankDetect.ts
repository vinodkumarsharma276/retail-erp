/** Guess the issuing bank from statement text or a file name. */
const BANKS: [string, RegExp][] = [
  ['HDFC Bank', /\bHDFC\s*BANK\b|\bHDFC0\d{6}|hdfcbank/i],
  ['ICICI Bank', /\bICICI\s*BANK\b|\bICIC0\d{6}|icicibank/i],
  ['State Bank of India', /\bSTATE BANK OF INDIA\b|\bSBIN0\d{6}|\bonlinesbi\b/i],
  ['Axis Bank', /\bAXIS\s*BANK\b|\bUTIB0\d{6}/i],
  ['Kotak Mahindra Bank', /\bKOTAK\b|\bKKBK0\d{6}/i],
  ['Punjab National Bank', /\bPUNJAB NATIONAL BANK\b|\bPUNB0\d{6}/i],
  ['Bank of Baroda', /\bBANK OF BARODA\b|\bBARB0\w{6}/i],
  ['Canara Bank', /\bCANARA BANK\b|\bCNRB0\d{6}/i],
  ['Union Bank of India', /\bUNION BANK OF INDIA\b|\bUBIN0\d{6}/i],
  ['IndusInd Bank', /\bINDUSIND\b|\bINDB0\d{6}/i],
  ['Yes Bank', /\bYES BANK\b|\bYESB0\d{6}/i],
  ['IDFC FIRST Bank', /\bIDFC\s*FIRST\b|\bIDFB0\d{6}/i],
  ['Bank of India', /\bBANK OF INDIA\b|\bBKID0\d{6}/i],
  ['Indian Bank', /\bINDIAN BANK\b|\bIDIB0\d{5}/i],
  ['Central Bank of India', /\bCENTRAL BANK OF INDIA\b|\bCBIN0\d{6}/i],
  ['IDBI Bank', /\bIDBI BANK\b|\bIBKL0\d{6}/i],
  ['Federal Bank', /\bFEDERAL BANK\b|\bFDRL0\d{6}/i],
  ['AU Small Finance Bank', /\bAU SMALL FINANCE\b|\bAUBL0\d{6}/i],
  ['RBL Bank', /\bRBL BANK\b|\bRATN0\d{6}/i],
  ['Chase', /\bJPMorgan Chase\b|\bChase\b/i],
  ['Bank of America', /\bBank of America\b/i],
  ['Wells Fargo', /\bWells Fargo\b/i],
  ['Citibank', /\bCiti(bank)?\b/i],
  ['HSBC', /\bHSBC\b/i],
];

/**
 * The bank's own name near the top of the statement wins. IFSC codes are only a fallback,
 * because narrations are full of other banks' IFSCs (NEFT-HDFC0000123-...).
 */
export function detectBank(text: string): string | null {
  const head = text.slice(0, 4000);
  let best: { name: string; at: number } | null = null;
  for (const [name, re] of BANKS) {
    const nameOnly = new RegExp(re.source.split('|')[0], 'i');
    const m = nameOnly.exec(head);
    if (m && (!best || m.index < best.at)) best = { name, at: m.index };
  }
  if (best) return best.name;
  const counts = BANKS.map(([name, re]) => ({ name, n: (text.slice(0, 30000).match(new RegExp(re.source, 'gi')) ?? []).length }));
  const top = counts.sort((a, b) => b.n - a.n)[0];
  return top.n > 0 ? top.name : null;
}

export function detectAccountHint(text: string): string | null {
  const m = text
    .slice(0, 4000)
    .match(/(?:A\/?c(?:count)?\.?\s*(?:No|Number|#)?\.?\s*[:,\-]*\s*)([X*\d][X*\d\s-]{5,22}\d)/i);
  if (!m) return null;
  const digits = m[1].replace(/[^\dX*]/gi, '');
  return digits.length >= 4 ? `••${digits.slice(-4)}` : null;
}
