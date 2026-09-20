import { InstallmentStatus, Prisma } from '@prisma/client';
import { DEFAULT_TENANT_INSTALLMENT_SETTINGS, type TenantInstallmentSettings } from '@retailerp/shared-types';

const D = (value: Prisma.Decimal | number | string) => new Prisma.Decimal(value);

export function toDateOnly(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

export function daysBetween(from: Date, to: Date): number {
  const fromDay = toDateOnly(from).getTime();
  const toDay = toDateOnly(to).getTime();
  return Math.floor((toDay - fromDay) / (1000 * 60 * 60 * 24));
}

export function computeDaysOverdue(dueDate: Date, asOf: Date = new Date()): number {
  return Math.max(0, daysBetween(dueDate, asOf));
}

export function computeInstallmentStatus(
  installment: {
    dueDate: Date;
    amountPaid: Prisma.Decimal | number | string;
    remainingAmount: Prisma.Decimal | number | string;
  },
  asOf: Date = new Date(),
): InstallmentStatus {
  const remaining = D(installment.remainingAmount);
  const paid = D(installment.amountPaid);
  if (remaining.lte(0)) return InstallmentStatus.paid;

  const daysOverdue = daysBetween(installment.dueDate, asOf);
  if (paid.gt(0)) return InstallmentStatus.partially_paid;
  if (daysOverdue > 0) return InstallmentStatus.overdue;
  if (daysOverdue === 0) return InstallmentStatus.due_today;
  return InstallmentStatus.upcoming;
}

export function suggestPenalty(
  remainingAmount: Prisma.Decimal | number | string,
  monthlyRatePercent: number,
  daysOverdue: number,
): Prisma.Decimal {
  if (daysOverdue <= 0) return D(0);
  return D(remainingAmount).mul(monthlyRatePercent).div(100).div(30).mul(daysOverdue).toDecimalPlaces(2);
}

export function resolvePenalRate(
  saleOverride: Prisma.Decimal | number | string | null | undefined,
  tenantSettings?: Partial<TenantInstallmentSettings> | null,
): number {
  if (saleOverride !== null && saleOverride !== undefined) return Number(saleOverride);
  return tenantSettings?.defaultPenalRateMonthly ?? DEFAULT_TENANT_INSTALLMENT_SETTINGS.defaultPenalRateMonthly;
}

export function mergeInstallmentSettings(settings: unknown): TenantInstallmentSettings {
  if (!settings || typeof settings !== 'object') return DEFAULT_TENANT_INSTALLMENT_SETTINGS;
  const root = settings as { installment?: Partial<TenantInstallmentSettings> };
  return {
    ...DEFAULT_TENANT_INSTALLMENT_SETTINGS,
    ...(root.installment ?? {}),
  };
}
