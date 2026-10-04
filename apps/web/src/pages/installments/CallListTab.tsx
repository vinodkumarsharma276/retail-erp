import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertCircle, Banknote, CalendarClock, ChevronDown, ChevronRight, Loader2, Phone, PhoneCall } from 'lucide-react';
import { formatINR, formatDateIN } from '@retailerp/shared-utils';
import type { CallListRow } from '@retailerp/shared-types';
import { cn } from '../../lib/utils';
import { useCallListQuery } from '../../hooks/useInstallments';
import { usePermission } from '../../hooks/usePermission';
import { DateInput } from '../../components/DateInput';
import { EmptyState } from '../../components/EmptyState';
import { RecordPaymentDialog } from '../../components/RecordPaymentDialog';
import { ViewSaleButton } from '../../components/ViewSaleButton';
import { PromiseDialog } from '../../components/PromiseDialog';
import { Button } from '../../components/ui/button';

const ZONE_OPTIONS = ['East', 'West', 'North', 'South', 'Delhi', 'Ghaziabad', 'Noida'] as const;

function localTodayIso(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function ReasonBadge({ reason }: { reason: CallListRow['reasons'][number] }) {
  const base = 'inline-flex h-6 items-center rounded-md border px-2 text-xs font-semibold';
  switch (reason.kind) {
    case 'promise_due':
      return (
        <span className={cn(base, 'border-primary/30 bg-primary-muted text-primary')}>
          Promise {reason.label} due · {formatINR(reason.amount)}
        </span>
      );
    case 'due_today':
      return (
        <span className={cn(base, 'border-info/20 bg-info-muted text-info')}>
          EMI #{reason.installmentNumber} due · {formatINR(reason.amount)}
        </span>
      );
    case 'promise_broken':
      return (
        <span className={cn(base, 'border-destructive/30 bg-destructive-muted text-destructive')}>
          Promise {reason.label} broken · {formatDateIN(reason.promisedDate)}
        </span>
      );
    case 'overdue':
      return (
        <span className={cn(base, 'border-warning/30 bg-warning-muted text-warning')}>
          EMI #{reason.oldestInstallmentNumber} late {reason.daysLate} day{reason.daysLate === 1 ? '' : 's'}
        </span>
      );
  }
}

/**
 * Who the collector should call on a day. One row per sale. A customer who
 * promised a later date is left off (listed under "Waiting on a promise")
 * until that date — but still shows up the day another EMI falls due.
 */
export function CallListTab() {
  const navigate = useNavigate();
  const today = localTodayIso();
  const canSeeZone = usePermission('view.customer.address.zone');
  const [date, setDate] = useState(today);
  const [zone, setZone] = useState('');
  const [showSnoozed, setShowSnoozed] = useState(false);
  const { data, isLoading, isError, isFetching } = useCallListQuery(date, zone || undefined);

  const [payFor, setPayFor] = useState<CallListRow | null>(null);
  const [promiseFor, setPromiseFor] = useState<CallListRow | null>(null);

  const rows = data?.rows ?? [];
  const snoozed = data?.snoozed ?? [];
  const totalDue = rows.reduce((sum, r) => sum + r.totalDueNow, 0);
  const count = (kind: CallListRow['reasons'][number]['kind']) =>
    rows.filter((r) => r.reasons.some((x) => x.kind === kind)).length;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="w-44">
          <label className="text-sm font-medium">Date</label>
          <DateInput value={date} onChange={(v) => v && setDate(v)} />
        </div>
        {date !== today && (
          <Button variant="ghost" size="sm" onClick={() => setDate(today)}>
            Back to today
          </Button>
        )}
        {canSeeZone && (
          <div>
            <label className="text-sm font-medium">Zone</label>
            <select
              value={zone}
              onChange={(e) => setZone(e.target.value)}
              className="block h-9 rounded-md border bg-field px-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            >
              <option value="">All zones</option>
              {ZONE_OPTIONS.map((z) => (
                <option key={z} value={z}>{z}</option>
              ))}
            </select>
          </div>
        )}
        {isFetching && !isLoading && <Loader2 className="mb-2 h-4 w-4 animate-spin text-muted-foreground" />}
      </div>

      {data && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
          {[
            { label: 'To call', value: String(rows.length) },
            { label: 'Due now', value: formatINR(totalDue) },
            { label: 'Promises due', value: String(count('promise_due')) },
            { label: 'Broken promises', value: String(count('promise_broken')) },
            { label: 'Waiting on promise', value: String(snoozed.length) },
          ].map((s) => (
            <div key={s.label} className="rounded-lg border bg-card px-3 py-2">
              <p className="text-caption">{s.label}</p>
              <p className="font-mono text-xl font-semibold">{s.value}</p>
            </div>
          ))}
        </div>
      )}

      {isLoading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : isError ? (
        <div className="flex items-center gap-2 rounded-md border border-destructive/30 bg-destructive-muted px-3 py-2 text-sm text-destructive">
          <AlertCircle className="h-4 w-4" /> Could not load the call list.
        </div>
      ) : rows.length === 0 ? (
        <EmptyState
          icon={PhoneCall}
          title="No one to call"
          description={
            snoozed.length > 0
              ? `${snoozed.length} customer${snoozed.length === 1 ? ' is' : 's are'} waiting on a promise date.`
              : 'Nothing is due or overdue for this date.'
          }
        />
      ) : (
        <div className="overflow-x-auto rounded-lg border bg-card">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/50 text-left text-muted-foreground">
                <th className="px-3 py-2.5 font-medium">Customer</th>
                <th className="px-3 py-2.5 font-medium">Ledger / product</th>
                <th className="px-3 py-2.5 font-medium">Why</th>
                <th className="px-3 py-2.5 text-right font-medium">Due now</th>
                <th className="px-3 py-2.5 font-medium" />
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr
                  key={row.scheduleId}
                  onClick={() => navigate(`/installments/${row.scheduleId}`)}
                  title="Open installment history"
                  className="cursor-pointer border-b align-top last:border-0 hover:bg-muted/30"
                >
                  <td className="px-3 py-2.5">
                    <p className="font-medium">{row.customer.name}</p>
                    <a
                      href={`tel:${row.customer.phone}`}
                      onClick={(e) => e.stopPropagation()}
                      className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground hover:text-primary"
                    >
                      <Phone className="h-3 w-3" /> {row.customer.phone}
                    </a>
                    {(row.customer.zone || row.customer.city) && (
                      <p className="text-xs text-muted-foreground">
                        {[row.customer.zone, row.customer.city].filter(Boolean).join(' · ')}
                      </p>
                    )}
                  </td>
                  <td className="px-3 py-2.5">
                    <p className="tabular">{row.ledgerNumber || row.saleNumber}</p>
                    <p className="text-xs text-muted-foreground">
                      {row.product.brand} {row.product.modelNumber}
                    </p>
                  </td>
                  <td className="px-3 py-2.5">
                    <div className="flex flex-wrap gap-1">
                      {row.reasons.map((reason, i) => (
                        <ReasonBadge key={i} reason={reason} />
                      ))}
                    </div>
                    {row.openPromise && (
                      <p className="mt-1 text-xs text-muted-foreground">
                        Promise {row.openPromise.label} waiting for {formatDateIN(row.openPromise.promisedDate)}
                      </p>
                    )}
                  </td>
                  <td className="px-3 py-2.5 text-right">
                    <p className="tabular font-semibold">{formatINR(row.totalDueNow)}</p>
                    {row.dueNow.length > 1 && (
                      <p className="text-xs text-muted-foreground">{row.dueNow.length} EMIs</p>
                    )}
                    {row.dueNow.flatMap((d) => d.carriedIn).length > 0 && (
                      <p className="text-xs text-warning">
                        incl.{' '}
                        {row.dueNow
                          .flatMap((d) => d.carriedIn)
                          .map((c) => `${formatINR(c.amount)} short from #${c.fromInstallmentNumber}`)
                          .join(', ')}
                      </p>
                    )}
                  </td>
                  <td className="px-3 py-2.5">
                    <div className="flex justify-end gap-1.5" onClick={(e) => e.stopPropagation()}>
                      <Button size="sm" icon={<Banknote className="h-3.5 w-3.5" />} onClick={() => setPayFor(row)}>
                        Pay
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        icon={<CalendarClock className="h-3.5 w-3.5" />}
                        onClick={() => setPromiseFor(row)}
                      >
                        Promise
                      </Button>
                      <ViewSaleButton saleId={row.saleId} />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {snoozed.length > 0 && (
        <div className="rounded-lg border bg-card">
          <button
            type="button"
            onClick={() => setShowSnoozed((v) => !v)}
            className="flex w-full items-center gap-2 px-4 py-3 text-left text-sm font-medium"
          >
            {showSnoozed ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
            Waiting on a promise ({snoozed.length})
            <span className="text-caption font-normal">— not called until their promised date</span>
          </button>
          {showSnoozed && (
            <ul className="divide-y border-t">
              {snoozed.map((s) => (
                <li key={s.scheduleId} className="flex flex-wrap items-center gap-3 px-4 py-2 text-sm">
                  <button
                    type="button"
                    onClick={() => navigate(`/installments/${s.scheduleId}`)}
                    className="font-medium hover:underline"
                  >
                    {s.customerName}
                  </button>
                  <span className="text-muted-foreground">
                    Promise <span className="tabular">{s.label}</span> · {formatINR(s.amount)} on{' '}
                    {formatDateIN(s.promisedDate)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {payFor && (
        <RecordPaymentDialog
          installmentId={payFor.dueNow[0]?.installmentId ?? payFor.nextEmi!.installmentId}
          amountDue={payFor.totalDueNow}
          scheduleId={payFor.scheduleId}
          onSuccess={() => setPayFor(null)}
          onClose={() => setPayFor(null)}
        />
      )}
      {promiseFor && (
        <PromiseDialog
          scheduleId={promiseFor.scheduleId}
          customerId={promiseFor.customer.id}
          customerName={promiseFor.customer.name}
          installments={[
            ...promiseFor.dueNow,
            ...(promiseFor.nextEmi ? [promiseFor.nextEmi] : []),
          ].map((i) => ({
            id: i.installmentId,
            installmentNumber: i.installmentNumber,
            dueDate: i.dueDate,
            remainingAmount: i.remainingAmount,
          }))}
          onClose={() => setPromiseFor(null)}
        />
      )}
    </div>
  );
}
