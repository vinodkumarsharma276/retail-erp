export type InstallmentPromiseStatus = 'pending' | 'kept' | 'partially_kept' | 'broken';

export interface InstallmentPromiseRecord {
  id: string;
  tenantId: string;
  scheduleId: string;
  customerId: string;
  coveredInstallmentIds: string[];
  promisedDate: string;
  promisedAmount: number;
  status: InstallmentPromiseStatus;
  createdBy: string;
  createdAt: string;
  resolvedAt: string | null;
  collectedAmount: number;
  notes: string | null;
}

export interface CreateInstallmentPromiseInput {
  scheduleId: string;
  customerId: string;
  coveredInstallmentIds: string[];
  promisedDate: string;
  promisedAmount: number;
  notes?: string;
}
