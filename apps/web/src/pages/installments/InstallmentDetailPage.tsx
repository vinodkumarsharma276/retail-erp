import { useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import {
  ArrowLeft,
  Loader2,
  AlertCircle,
  Banknote,
  CalendarClock,
  Phone,
  ExternalLink,
} from 'lucide-react';
import { cn } from '../../lib/utils';
import { useScheduleDetailQuery } from '../../hooks/useInstallments';
import { StatusBadge } from '../../components/StatusBadge';
import { PaymentTimeline } from '../../components/PaymentTimeline';
import { RecordPaymentDialog } from '../../components/RecordPaymentDialog';
import { formatINR, formatDateIN } from '@retailerp/shared-utils';
import { InstallmentStatus } from '@retailerp/shared-types';
import { formatInstallmentLabel } from '../../lib/installment-label';

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
export function InstallmentDetailPage() {
  const { scheduleId } = useParams<{ scheduleId: string }>();
  const navigate = useNavigate();

  const { data, isLoading, isError } = useScheduleDetailQuery(scheduleId);

  // Payment dialog state
  const [paymentTarget, setPaymentTarget] = useState<{
    id: string;
    amount: number;
    number: number;
  } | null>(null);

  // Loading
  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  // Error
  if (isError || !data) {
    return (
      <div className="flex flex-col items-center justify-center py-20">
        <AlertCircle className="h-12 w-12 text-destructive mb-4" />
        <h2 className="text-lg font-medium mb-2">Schedule Not Found</h2>
        <p className="text-sm text-muted-foreground mb-4">
          The installment schedule you are looking for does not exist.
        </p>
        <button
          onClick={() => navigate(-1)}
          className="flex items-center gap-2 text-sm text-primary hover:underline"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Installments
        </button>
      </div>
    );
  }

  const { schedule, installments, sale, customer, product } = data;

  const actionableStatuses: string[] = [
    InstallmentStatus.UPCOMING,
    InstallmentStatus.OVERDUE,
    InstallmentStatus.DUE_TODAY,
    InstallmentStatus.PARTIALLY_PAID,
  ];

  return (
    <div>
      {/* Header */}
      <div className="flex items-center gap-4 mb-6">
        <button
          onClick={() => navigate(-1)}
          className="rounded-md p-2 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
        >
          <ArrowLeft className="h-5 w-5" />
        </button>
        <div>
          <h1 className="text-2xl font-semibold">Installment Schedule</h1>
          <div className="flex items-center gap-2 mt-1">
            <StatusBadge status={schedule.status} />
            <span className="text-sm text-muted-foreground">
              {schedule.numInstallments} EMIs
            </span>
          </div>
        </div>
      </div>

      {/* Top section: Sale summary */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-5 mb-6">
        {/* Sale + Finance details */}
        <div className="lg:col-span-3 rounded-lg border bg-card p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-medium">Sale Summary</h2>
            <Link
              to={`/sales/${sale.id}`}
              className="flex items-center gap-1 text-sm text-primary hover:underline"
            >
              View Sale
              <ExternalLink className="h-3.5 w-3.5" />
            </Link>
          </div>
          <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <InfoRow label="Sale Number" value={sale.saleNumber} />
            <InfoRow label="Sale Date" value={formatDateIN(sale.saleDate)} />
            <InfoRow label="Total Amount" value={formatINR(sale.totalAmount)} />
            <InfoRow label="Down Payment" value={formatINR(sale.downPayment)} />
            <InfoRow
              label="Interest Rate"
              value={`${sale.interestRate}% / month`}
            />
            <InfoRow label="File Charge" value={formatINR(sale.fileCharge)} />
            <InfoRow label="EMI Amount" value={formatINR(sale.emiAmount)} />
            <InfoRow
              label="Installments"
              value={String(sale.numInstallments)}
            />
            <InfoRow
              label="Total Payable"
              value={formatINR(schedule.totalPayable)}
            />
          </dl>
        </div>

        {/* Customer + Product cards */}
        <div className="lg:col-span-2 space-y-6">
          {/* Customer */}
          <div className="rounded-lg border bg-card p-6">
            <h2 className="text-lg font-medium mb-3">Customer</h2>
            <dl className="space-y-2">
              <InfoRow label="Name" value={customer.name} />
              <div>
                <dt className="text-sm font-medium text-muted-foreground">
                  Phone
                </dt>
                <dd className="mt-0.5">
                  <a
                    href={`tel:${customer.phone}`}
                    className="flex items-center gap-1 text-sm text-primary hover:underline"
                  >
                    <Phone className="h-3.5 w-3.5" />
                    {customer.phone}
                  </a>
                </dd>
              </div>
              <InfoRow label="Code" value={customer.customerCode} />
              {customer.city && (
                <InfoRow label="City" value={customer.city} />
              )}
            </dl>
            <Link
              to={`/customers/${customer.id}`}
              className="mt-3 inline-block text-sm text-primary hover:underline"
            >
              View Customer
            </Link>
          </div>

          {/* Product */}
          <div className="rounded-lg border bg-card p-6">
            <h2 className="text-lg font-medium mb-3">Product</h2>
            <dl className="space-y-2">
              <InfoRow label="Brand" value={product.brand} />
              <InfoRow label="Model" value={product.modelNumber} />
              {product.serialNumber && (
                <InfoRow label="Serial Number" value={product.serialNumber} />
              )}
            </dl>
            <Link
              to={`/products/${product.id}`}
              className="mt-3 inline-block text-sm text-primary hover:underline"
            >
              View Product
            </Link>
          </div>
        </div>
      </div>

      {/* Middle section: Payment Timeline */}
      <div className="rounded-lg border bg-card p-6 mb-6">
        <h2 className="text-lg font-medium mb-4">Payment Timeline</h2>
        <PaymentTimeline scheduleId={scheduleId!} />
      </div>

      {/* Bottom section: Installment table */}
      <div className="rounded-lg border bg-card p-6">
        <h2 className="text-lg font-medium mb-4">All Installments</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/50">
                <th className="px-3 py-2.5 text-left font-medium text-muted-foreground">
                  #
                </th>
                <th className="px-3 py-2.5 text-left font-medium text-muted-foreground">
                  Due Date
                </th>
                <th className="px-3 py-2.5 text-right font-medium text-muted-foreground">
                  Amount Due
                </th>
                <th className="px-3 py-2.5 text-right font-medium text-muted-foreground">
                  Amount Paid
                </th>
                <th className="px-3 py-2.5 text-right font-medium text-muted-foreground">
                  Remaining
                </th>
                <th className="px-3 py-2.5 text-left font-medium text-muted-foreground">
                  Status
                </th>
                <th className="px-3 py-2.5 text-left font-medium text-muted-foreground">
                  Payment Date
                </th>
                <th className="px-3 py-2.5 text-left font-medium text-muted-foreground">
                  Mode
                </th>
                <th className="px-3 py-2.5 text-left font-medium text-muted-foreground">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody>
              {installments.map((inst) => {
                const canPay = actionableStatuses.includes(inst.status);
                const canReschedule =
                  inst.status === InstallmentStatus.UPCOMING ||
                  inst.status === InstallmentStatus.OVERDUE ||
                  inst.status === InstallmentStatus.DUE_TODAY;
                const lastPayment =
                  inst.payments?.length > 0
                    ? inst.payments[inst.payments.length - 1]
                    : null;

                return (
                  <tr
                    key={inst.id}
                    className={cn(
                      'border-b last:border-0 transition-colors',
                      inst.status === InstallmentStatus.OVERDUE &&
                        'bg-red-50/50 dark:bg-red-950/20',
                      inst.status === InstallmentStatus.RESCHEDULED &&
                        'bg-gray-50/50 dark:bg-gray-800/30 opacity-60',
                    )}
                  >
                    <td className="px-3 py-2.5 font-medium">
                      {formatInstallmentLabel(inst).replace(/^#/, '')}
                      {inst.rescheduledFromId && (
                        <span className="ml-1 text-xs text-amber-600 font-normal">(Remainder)</span>
                      )}
                    </td>
                    <td className="px-3 py-2.5">
                      {formatDateIN(inst.dueDate)}
                    </td>
                    <td className="px-3 py-2.5 text-right font-medium">
                      {formatINR(inst.amountDue)}
                    </td>
                    <td className="px-3 py-2.5 text-right text-green-600">
                      {formatINR(inst.amountPaid)}
                    </td>
                    <td
                      className={cn(
                        'px-3 py-2.5 text-right',
                        inst.remainingAmount > 0
                          ? 'text-red-600 font-medium'
                          : 'text-muted-foreground',
                      )}
                    >
                      {formatINR(inst.remainingAmount)}
                    </td>
                    <td className="px-3 py-2.5">
                      <StatusBadge status={inst.status} />
                    </td>
                    <td className="px-3 py-2.5 text-muted-foreground">
                      {lastPayment
                        ? formatDateIN(lastPayment.paymentDate)
                        : '--'}
                    </td>
                    <td className="px-3 py-2.5 capitalize text-muted-foreground">
                      {lastPayment
                        ? lastPayment.paymentMode.replace(/_/g, ' ')
                        : '--'}
                    </td>
                    <td className="px-3 py-2.5">
                      <div className="flex items-center gap-1.5">
                        {canPay && (
                          <button
                            onClick={() =>
                              setPaymentTarget({
                                id: inst.id,
                                amount: inst.remainingAmount,
                                number: inst.installmentNumber,
                              })
                            }
                            className={cn(
                              'flex items-center gap-1 rounded-md bg-green-600 px-2 py-1 text-xs font-medium text-white',
                              'hover:bg-green-700 transition-colors',
                            )}
                          >
                            <Banknote className="h-3 w-3" />
                            Pay
                          </button>
                        )}
                        {canReschedule && (
                          <button
                            onClick={() =>
                              setPaymentTarget({
                                id: inst.id,
                                amount: inst.remainingAmount,
                                number: inst.installmentNumber,
                              })
                            }
                            className={cn(
                              'flex items-center gap-1 rounded-md border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-950/30 px-2 py-1 text-xs font-medium text-amber-700 dark:text-amber-400',
                              'hover:bg-amber-100 dark:hover:bg-amber-900/40 transition-colors',
                            )}
                          >
                            <CalendarClock className="h-3 w-3" />
                            Reschedule
                          </button>
                        )}
                        {inst.isRescheduled && inst.rescheduledTo && (
                          <span className="text-xs text-muted-foreground flex items-center gap-1">
                            <ExternalLink className="h-3 w-3" />
                            Moved to #{inst.rescheduledTo.installmentNumber}
                          </span>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Payment dialog */}
      {paymentTarget && (
        <RecordPaymentDialog
          installmentId={paymentTarget.id}
          amountDue={paymentTarget.amount}
          installmentNumber={paymentTarget.number}
          onSuccess={() => setPaymentTarget(null)}
          onClose={() => setPaymentTarget(null)}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------
function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-sm font-medium text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 text-sm">{value}</dd>
    </div>
  );
}
