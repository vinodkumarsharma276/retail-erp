import type { InstallmentPromiseRecord } from '@retailerp/shared-types';

/**
 * Register-style promise labels. The k-th promise on EMI N reads "N.k":
 * the first follow-up date on EMI 1 is "1.1", the next "1.2". Cancelled
 * promises (shop mistakes) take no number — the server numbers them the
 * same way.
 */
export function nextPromiseLabels(
  promises: InstallmentPromiseRecord[] | undefined,
  covered: Array<{ installmentId: string; installmentNumber: number }>,
): string {
  const counts = new Map<string, number>();
  for (const promise of promises ?? []) {
    if (promise.status === 'cancelled') continue;
    for (const id of promise.coveredInstallmentIds) counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  return [...covered]
    .sort((a, b) => a.installmentNumber - b.installmentNumber)
    .map((row) => `${row.installmentNumber}.${(counts.get(row.installmentId) ?? 0) + 1}`)
    .join(', ');
}

/** All labels a promise carries, in EMI order ("1.2, 2.1"). */
export function promiseLabel(promise: InstallmentPromiseRecord): string {
  return Object.values(promise.labels ?? {})
    .sort((a, b) => {
      const [an, ak] = a.split('.').map(Number);
      const [bn, bk] = b.split('.').map(Number);
      return an - bn || ak - bk;
    })
    .join(', ');
}
