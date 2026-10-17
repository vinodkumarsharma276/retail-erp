import { Landmark, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCanCheck } from '../../../hooks/usePermission';
import { api, type BankAccount } from '../lib/api';
import { useInvalidateData, useMeta } from '../lib/queries';
import { ShopAvatar } from './BankLayout';
import { AccountFeedLine } from './BankFeedControls';
import { Badge, Button, Card, CardHeader, ConfirmDialog, EmptyState, Field, Input, Select, useToast } from './ui';

export const KNOWN_BANKS = [
  'HDFC Bank', 'ICICI Bank', 'State Bank of India', 'Axis Bank', 'Kotak Mahindra Bank', 'Punjab National Bank', 'Bank of Baroda',
  'Canara Bank', 'Union Bank of India', 'IndusInd Bank', 'Yes Bank', 'IDFC FIRST Bank', 'Bank of India', 'Indian Bank', 'Federal Bank',
  'IDBI Bank', 'AU Small Finance Bank', 'RBL Bank', 'Central Bank of India',
];

const TYPE_LABEL: Record<BankAccount['account_type'], string> = {
  current: 'Current',
  savings: 'Savings',
  overdraft: 'Overdraft',
  cash_credit: 'Cash credit',
};

/** Show only the last 4 digits; the full number is on hover for people who can see this page. */
const masked = (n: string) => `XXXX${n.slice(-4)}`;

/**
 * Each shop's bank accounts. Statements print the last digits of the account number,
 * so a registered account tells us which shop and bank a statement belongs to.
 */
export function BankAccountsCard() {
  const { data: meta } = useMeta();
  const canEdit = useCanCheck()('bank.reconcile');
  const qc = useQueryClient();
  const toast = useToast();
  const invalidate = useInvalidateData();
  const accounts = useQuery({ queryKey: ['bank-accounts'], queryFn: api.accounts });
  const shops = meta?.shops ?? [];

  const [shopId, setShopId] = useState('');
  const [bankName, setBankName] = useState('');
  const [accountNumber, setAccountNumber] = useState('');
  const [ifscCode, setIfsc] = useState('');
  const [accountType, setType] = useState<BankAccount['account_type']>('current');
  const [toRemove, setToRemove] = useState<BankAccount | null>(null);
  const shop = shopId || (shops.length === 1 ? shops[0].id : '');

  const add = useMutation({
    mutationFn: () => api.createAccount({ shopId: shop, bankName, accountNumber, ifscCode: ifscCode || undefined, accountType }),
    onSuccess: (r) => {
      toast(r.linked ? `Account added · linked ${r.linked} earlier statement${r.linked === 1 ? '' : 's'}` : 'Account added', 'good');
      setAccountNumber('');
      setIfsc('');
      qc.invalidateQueries({ queryKey: ['bank-accounts'] });
      if (r.linked) invalidate();
    },
    onError: (e: Error) => toast(e.message, 'critical'),
  });
  const remove = useMutation({
    mutationFn: (id: string) => api.deleteAccount(id),
    onSuccess: () => {
      toast('Account removed', 'good');
      setToRemove(null);
      qc.invalidateQueries({ queryKey: ['bank-accounts'] });
    },
    onError: (e: Error) => toast(e.message, 'critical'),
  });

  const digits = accountNumber.replace(/[\s-]/g, '');
  const valid = !!shop && bankName.trim().length >= 2 && /^\d{4,20}$/.test(digits);

  return (
    <Card>
      <CardHeader
        title="Bank accounts"
        subtitle="Register each shop's current account. Uploaded statements are matched by the last 4 digits of the account number, so they're filed under the right shop and bank automatically."
      />
      {canEdit && (
        <div className="grid gap-3 border-b border-border px-5 pb-4 sm:grid-cols-2 lg:grid-cols-6">
          <Field label="Shop">
            <Select value={shop} onChange={(e) => setShopId(e.target.value)} className="w-full">
              <option value="" disabled>
                Choose shop…
              </option>
              {shops.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Bank">
            <Input list="bank-account-banks" value={bankName} onChange={(e) => setBankName(e.target.value)} placeholder="e.g. Federal Bank" />
            <datalist id="bank-account-banks">
              {KNOWN_BANKS.map((b) => (
                <option key={b} value={b} />
              ))}
            </datalist>
          </Field>
          <Field label="Account number">
            <Input value={accountNumber} onChange={(e) => setAccountNumber(e.target.value)} inputMode="numeric" placeholder="Full number" autoComplete="off" />
          </Field>
          <Field label="IFSC (optional)">
            <Input value={ifscCode} onChange={(e) => setIfsc(e.target.value.toUpperCase())} placeholder="FDRL0001340" maxLength={11} />
          </Field>
          <Field label="Type">
            <Select value={accountType} onChange={(e) => setType(e.target.value as BankAccount['account_type'])} className="w-full">
              {Object.entries(TYPE_LABEL).map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </Select>
          </Field>
          <div className="flex items-end">
            <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => add.mutate()} loading={add.isPending} disabled={!valid} className="w-full">
              Add account
            </Button>
          </div>
        </div>
      )}
      {accounts.data?.length ? (
        <ul className="divide-y divide-border">
          {accounts.data.map((a) => (
            <li key={a.id} className="flex items-start gap-3 px-5 py-3">
              <ShopAvatar name={a.shop_name} index={Math.max(0, shops.findIndex((s) => s.id === a.shop_id))} size={26} />
              <div className="min-w-0 flex-1">
                <div className="truncate text-[13.5px] font-medium">
                  {a.bank_name} <span className="num font-normal text-muted-foreground" title={a.account_number}>{masked(a.account_number)}</span>
                </div>
                <div className="mt-0.5 text-xs text-muted-foreground">
                  {a.shop_name} · {TYPE_LABEL[a.account_type] ?? a.account_type}
                  {a.ifsc_code ? ` · ${a.ifsc_code}` : ''}
                </div>
                <AccountFeedLine account={a} />
              </div>
              <Badge tone={a.statements ? 'good' : 'neutral'}>
                {a.statements} statement{a.statements === 1 ? '' : 's'}
              </Badge>
              {canEdit && (
                <Button variant="ghost" size="sm" onClick={() => setToRemove(a)} aria-label="Remove account">
                  <Trash2 className="size-4" />
                </Button>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState icon={<Landmark className="size-6" />} title="No accounts registered" body="Add each shop's current account so statements are matched automatically." />
      )}
      <ConfirmDialog
        open={!!toRemove}
        title="Remove this account?"
        body={
          <>
            New statements for <b>{toRemove?.bank_name} {toRemove ? masked(toRemove.account_number) : ''}</b> won't be matched to {toRemove?.shop_name} any
            more. Statements already uploaded stay as they are.
          </>
        }
        confirmLabel="Remove"
        danger
        loading={remove.isPending}
        onConfirm={() => toRemove && remove.mutate(toRemove.id)}
        onCancel={() => setToRemove(null)}
      />
    </Card>
  );
}
