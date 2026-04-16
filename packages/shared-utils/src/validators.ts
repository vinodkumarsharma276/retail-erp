/** Validates Indian phone number (10 digits, starts with 6-9) */
export function isValidPhone(phone: string): boolean {
  return /^[6-9]\d{9}$/.test(phone.replace(/\s|-/g, ''));
}

/** Validates GSTIN format (15 chars) */
export function isValidGST(gst: string): boolean {
  return /^\d{2}[A-Z]{5}\d{4}[A-Z]{1}\d{1}[A-Z]{1}\d{1}$/.test(gst.toUpperCase());
}

/** Validates PAN number format (10 chars) */
export function isValidPAN(pan: string): boolean {
  return /^[A-Z]{5}\d{4}[A-Z]{1}$/.test(pan.toUpperCase());
}

/** Validates Aadhaar number (12 digits) */
export function isValidAadhaar(aadhaar: string): boolean {
  return /^\d{12}$/.test(aadhaar.replace(/\s|-/g, ''));
}

/** Validates IMEI number (15 digits) */
export function isValidIMEI(imei: string): boolean {
  return /^\d{15}$/.test(imei);
}

/** Validates Indian pincode (6 digits) */
export function isValidPincode(pincode: string): boolean {
  return /^[1-9]\d{5}$/.test(pincode);
}

/** Validates IFSC code */
export function isValidIFSC(ifsc: string): boolean {
  return /^[A-Z]{4}0[A-Z0-9]{6}$/.test(ifsc.toUpperCase());
}
