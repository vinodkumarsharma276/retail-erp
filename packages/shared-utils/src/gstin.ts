/**
 * GSTIN helpers.
 *
 * A GSTIN is 15 characters: a 2-digit state code, the holder's 10-character
 * PAN, a 1-digit entity number, the letter Z, and a checksum character that
 * may be a digit OR a letter (e.g. 09AEYFS8829M1ZM). Treating the checksum
 * as numeric rejects perfectly valid numbers, so it is matched as
 * alphanumeric here.
 */

const GSTIN_RE = /^(\d{2})([A-Z]{5}\d{4}[A-Z])(\d)(Z)([A-Z\d])$/;

/** GST state codes → state name, as used on invoices. */
export const GST_STATE_CODES: Record<string, string> = {
  '01': 'Jammu and Kashmir', '02': 'Himachal Pradesh', '03': 'Punjab', '04': 'Chandigarh',
  '05': 'Uttarakhand', '06': 'Haryana', '07': 'Delhi', '08': 'Rajasthan',
  '09': 'Uttar Pradesh', '10': 'Bihar', '11': 'Sikkim', '12': 'Arunachal Pradesh',
  '13': 'Nagaland', '14': 'Manipur', '15': 'Mizoram', '16': 'Tripura',
  '17': 'Meghalaya', '18': 'Assam', '19': 'West Bengal', '20': 'Jharkhand',
  '21': 'Odisha', '22': 'Chhattisgarh', '23': 'Madhya Pradesh', '24': 'Gujarat',
  '25': 'Daman and Diu', '26': 'Dadra and Nagar Haveli and Daman and Diu', '27': 'Maharashtra',
  '28': 'Andhra Pradesh', '29': 'Karnataka', '30': 'Goa', '31': 'Lakshadweep',
  '32': 'Kerala', '33': 'Tamil Nadu', '34': 'Puducherry', '35': 'Andaman and Nicobar Islands',
  '36': 'Telangana', '37': 'Andhra Pradesh', '38': 'Ladakh', '97': 'Other Territory',
};

/** Upper-cased with all spacing removed; '' when there is nothing usable. */
export function normalizeGstin(value: string | null | undefined): string {
  return String(value ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

/** True for a well-formed 15-character GSTIN with a known state code. */
export function isValidGstin(value: string | null | undefined): boolean {
  const gstin = normalizeGstin(value);
  const match = GSTIN_RE.exec(gstin);
  return match != null && GST_STATE_CODES[match[1]] != null;
}

/**
 * The PAN, state code and state name a GSTIN carries, or null when it is not
 * a valid GSTIN. Saves asking for details the number already tells us.
 */
export function describeGstin(value: string | null | undefined): {
  gstin: string;
  stateCode: string;
  state: string;
  pan: string;
} | null {
  const gstin = normalizeGstin(value);
  const match = GSTIN_RE.exec(gstin);
  if (!match) return null;
  const state = GST_STATE_CODES[match[1]];
  if (!state) return null;
  return { gstin, stateCode: match[1], state, pan: match[2] };
}
