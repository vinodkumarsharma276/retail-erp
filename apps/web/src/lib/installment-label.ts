/**
 * Format a human-readable installment label.
 *
 * - Primary row       → "#3"
 * - Sub row (2.1 etc) → "#2.1"
 */
export function formatInstallmentLabel(inst: {
  installmentNumber: number;
  parentInstallmentNumber?: number | null;
  subSequence?: number | null;
}): string {
  if (inst.parentInstallmentNumber != null && inst.subSequence != null) {
    return `#${inst.parentInstallmentNumber}.${inst.subSequence}`;
  }
  return `#${inst.installmentNumber}`;
}
