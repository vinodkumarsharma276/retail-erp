/** Format number as Indian Rupees: ₹12,34,567.00 */
export function formatINR(amount: number): string {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

/** Format date as DD/MM/YYYY (Indian standard) */
export function formatDateIN(dateStr: string): string {
  const date = new Date(dateStr);
  const dd = String(date.getDate()).padStart(2, '0');
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const yyyy = date.getFullYear();
  return `${dd}/${mm}/${yyyy}`;
}

/** Format Aadhaar as XXXX-XXXX-XXXX */
export function formatAadhaar(aadhaar: string): string {
  const clean = aadhaar.replace(/\s|-/g, '');
  return `${clean.slice(0, 4)}-${clean.slice(4, 8)}-${clean.slice(8, 12)}`;
}

/** Format phone as +91 XXXXX XXXXX */
export function formatPhone(phone: string): string {
  const clean = phone.replace(/\s|-/g, '');
  if (clean.length === 10) {
    return `+91 ${clean.slice(0, 5)} ${clean.slice(5)}`;
  }
  return phone;
}
