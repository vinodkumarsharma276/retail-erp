import { CheckCircle2, HandCoins, Search, Truck, X } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useDistributorsQuery } from '../../../hooks/useDistributors';
import { useDebounce } from '../../../hooks/useDebounce';
import { useCanCheck } from '../../../hooks/usePermission';
import { api, type SupplierPaymentMode, type Transaction } from '../lib/api';
import { date, money } from '../lib/format';
import { useInvalidateData, useUpdateTx } from '../lib/queries';
import { Badge, Button, Field, Input, Select, useToast } from './ui';

const MODES: { value: SupplierPaymentMode; label: string }[] = [
  { value: 'cheque', label: 'Cheque' },
  { value: 'bank_transfer', label: 'Bank transfer (NEFT/RTGS/IMPS)' },
  { value: 'upi', label: 'UPI' },
  { value: 'cash', label: 'Cash' },
  { value: 'debit_card', label: 'Debit card' },
  { value: 'credit_card', label: 'Credit card' },
];

function modeFor(channel: string): SupplierPaymentMode {
  if (channel === 'Cheque') return 'cheque';
  if (channel === 'UPI') return 'upi';
  if (channel === 'ATM/Cash') return 'cash';
  if (channel === 'Card') return 'debit_card';
  return 'bank_transfer';
}

const SOURCE_LABEL: Record<NonNullable<Transaction['distributor_source']>, string> = {
  match: 'Name found in the narration',
  ai: 'Suggested by AI',
  user: 'Chosen by a person',
};

/** Search the supplier list and pick one. */
function SupplierSearch({ onPick, onCancel }: { onPick: (id: string) => void; onCancel: () => void }) {
  const [term, setTerm] = useState('');
  const search = useDebounce(term.trim(), 250);
  const { data, isFetching } = useDistributorsQuery({ search: search || undefined, pageSize: 8, sortBy: 'companyName', sortDir: 'asc' });
  const rows = data?.data ?? [];
  return (
    <div className="space-y-2">
      <div className="relative">
        <Search className="pointer-events-none absolute top-2.5 left-2.5 size-4 text-muted-foreground" />
        <Input autoFocus className="pl-8" value={term} onChange={(e) => setTerm(e.target.value)} placeholder="Search suppliers…" aria-label="Search suppliers" />
      </div>
      <ul className="max-h-56 overflow-y-auto rounded-lg border border-border">
        {rows.map((d) => (
          <li key={d.id}>
            <button className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-[13px] hover:bg-subtle cursor-pointer" onClick={() => onPick(d.id)}>
              <span className="truncate">{d.companyName}</span>
              {Number(d.pendingPayment) > 0 && <span className="shrink-0 text-xs text-muted-foreground">{money(Number(d.pendingPayment))} due</span>}
            </button>
          </li>
        ))}
        {!rows.length && <li className="px-3 py-2 text-[13px] text-muted-foreground">{isFetching ? 'Searching…' : 'No supplier matches.'}</li>}
      </ul>
      <Button variant="ghost" size="sm" onClick={onCancel}>
        Cancel
      </Button>
    </div>
  );
}

/**
 * For money paid out: which supplier it went to, and — with one click — record it as a payment
 * against that supplier's unpaid bills at this shop.
 */
export function SupplierPaymentCard({ t, onChange }: { t: Transaction; onChange: (next: Transaction) => void }) {
  const can = useCanCheck();
  const canChoose = can('bank.reconcile');
  const canRecord = can('purchases.record_payment');
  const toast = useToast();
  const qc = useQueryClient();
  const update = useUpdateTx();
  const invalidate = useInvalidateData();
  const [picking, setPicking] = useState(false);
  const [mode, setMode] = useState<SupplierPaymentMode>(() => modeFor(t.channel));
  const [reference, setReference] = useState(t.reference ?? '');

  const record = useMutation({
    mutationFn: () => api.recordSupplierPayment(t.id, { paymentMode: mode, referenceNumber: reference.trim() || null }),
    onSuccess: (r) => {
      onChange(r.transaction);
      invalidate();
      qc.invalidateQueries({ queryKey: ['distributors'] });
      qc.invalidateQueries({ queryKey: ['purchases'] });
      const bills = r.invoicesPaidFull + r.invoicesPaidPartial;
      toast(
        r.remainingAmount > 0
          ? `Recorded ${money(r.totalDistributed)} against ${bills} bill${bills === 1 ? '' : 's'}; ${money(r.remainingAmount)} was more than the unpaid bills and was not recorded`
          : `Recorded ${money(r.totalDistributed)} against ${bills} bill${bills === 1 ? '' : 's'}`,
        r.remainingAmount > 0 ? 'neutral' : 'good',
      );
    },
    onError: (e: Error) => toast(e.message, 'critical'),
  });

  const choose = (distributorId: string | null) =>
    update.mutate(
      { id: t.id, patch: { distributor_id: distributorId } },
      {
        onSuccess: (next) => {
          onChange(next);
          setPicking(false);
          toast(distributorId ? `Supplier set to ${next.distributor_name}` : 'Marked as not a supplier payment', 'good');
        },
        onError: (e: Error) => toast(e.message, 'critical'),
      },
    );

  if (t.direction !== 'debit') return null;
  const recorded = t.supplier_paid_amount != null;

  return (
    <div className="space-y-3 rounded-xl border border-border p-4">
      <div className="flex items-center gap-1.5 text-[13px] font-medium text-foreground/80">
        <Truck className="size-4" /> Supplier payment
      </div>

      {recorded ? (
        <div className="flex items-start gap-2 rounded-lg bg-success-muted p-3 text-[13px]">
          <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" />
          <div>
            Recorded <b>{money(t.supplier_paid_amount!)}</b> as a payment to{' '}
            {t.distributor_id ? (
              <Link to={`/distributors/${t.distributor_id}`} className="font-medium text-primary hover:underline">
                {t.distributor_name}
              </Link>
            ) : (
              'a supplier'
            )}
            {t.supplier_paid_at ? ` on ${date(t.supplier_paid_at)}` : ''}.
          </div>
        </div>
      ) : picking ? (
        <SupplierSearch onPick={(id) => choose(id)} onCancel={() => setPicking(false)} />
      ) : t.distributor_id ? (
        <>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="min-w-0">
              <div className="truncate text-[15px] font-semibold">{t.distributor_name}</div>
              {t.distributor_source && <Badge className="mt-1">{SOURCE_LABEL[t.distributor_source]}</Badge>}
            </div>
            {canChoose && (
              <div className="flex gap-1">
                <Button variant="ghost" size="sm" onClick={() => setPicking(true)}>
                  Change
                </Button>
                <Button variant="ghost" size="sm" icon={<X className="size-3.5" />} onClick={() => choose(null)} loading={update.isPending}>
                  Not a supplier
                </Button>
              </div>
            )}
          </div>
          {canRecord && (
            <>
              <div className="grid gap-2 sm:grid-cols-2">
                <Field label="Paid by">
                  <Select value={mode} onChange={(e) => setMode(e.target.value as SupplierPaymentMode)} className="w-full" aria-label="Payment mode">
                    {MODES.map((m) => (
                      <option key={m.value} value={m.value}>
                        {m.label}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Reference">
                  <Input value={reference} onChange={(e) => setReference(e.target.value)} placeholder="Cheque / UTR no." maxLength={100} />
                </Field>
              </div>
              <Button variant="primary" className="w-full" icon={<HandCoins className="size-4" />} onClick={() => record.mutate()} loading={record.isPending}>
                Record {money(Math.abs(t.amount))} as payment to {t.distributor_name}
              </Button>
              <p className="text-xs text-muted-foreground">Settles {t.shop_name}&apos;s oldest unpaid bills from this supplier first, dated {date(t.date)}.</p>
            </>
          )}
        </>
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-2 text-[13px] text-muted-foreground">
          <span>{t.distributor_source === 'user' ? 'Marked as not a supplier payment.' : 'No supplier recognised in this entry.'}</span>
          {canChoose && (
            <Button size="sm" onClick={() => setPicking(true)}>
              Choose supplier
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
