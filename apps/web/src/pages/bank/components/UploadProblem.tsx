import clsx from 'clsx';
import { AlertTriangle, Copy, Landmark, Plus, Store } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { count, date, relativeTime } from '../lib/format';
import { KNOWN_BANKS } from './BankAccountsCard';
import { Button, Field, Input, Select, useToast } from './ui';

/** Body the API sends when an upload needs a decision (see `resolveAccount` / overlap in the service). */
export interface UploadProblem {
  code:
    | 'no_accounts'
    | 'account_not_registered'
    | 'account_number_missing'
    | 'choose_account'
    | 'account_mismatch'
    | 'account_other_shop'
    | 'overlap';
  error: string;
  shopId?: string;
  shopName?: string;
  last4?: string | null;
  detectedBank?: string | null;
  detectedIfsc?: string | null;
  accounts?: { id: string; bank_name: string; last4: string }[];
  otherShopId?: string;
  otherShopName?: string;
  canSwitch?: boolean;
  // overlap
  total?: number;
  duplicates?: number;
  fresh?: number;
  from?: string | null;
  to?: string | null;
  account?: { bank: string; last4: string };
  statements?: { file_name: string; period_start: string | null; period_end: string | null; tx_count: number; uploaded_at: string; uploaded_by: string | null }[];
}

export interface RetryChanges {
  bankAccountId?: string;
  shopId?: string;
  duplicates?: 'skip' | 'keep';
}

function Panel({ tone, icon, title, children }: { tone: 'warning' | 'critical'; icon: ReactNode; title: ReactNode; children: ReactNode }) {
  return (
    <div
      role="alert"
      className={clsx(
        'mt-3 rounded-xl border-2 p-4 sm:ml-12',
        tone === 'critical' ? 'border-destructive/50 bg-destructive-muted' : 'border-warning/50 bg-warning-muted',
      )}
    >
      <div className={clsx('flex items-start gap-2.5', tone === 'critical' ? 'text-destructive' : 'text-warning')}>
        <span className="mt-0.5 shrink-0">{icon}</span>
        <div className="min-w-0 flex-1">
          <div className="text-[15px] font-semibold">{title}</div>
          <div className="mt-1 text-[13px] text-foreground">{children}</div>
        </div>
      </div>
    </div>
  );
}

/** Register an account inline and import straight away. */
function AddAccountForm({ problem, onAdded }: { problem: UploadProblem; onAdded: (id: string) => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [bankName, setBank] = useState(problem.detectedBank ?? '');
  const [accountNumber, setNumber] = useState('');
  const [ifscCode, setIfsc] = useState(problem.detectedIfsc ?? '');
  const digits = accountNumber.replace(/[\s-]/g, '');
  const endsRight = !problem.last4 || digits.endsWith(problem.last4);
  const valid = bankName.trim().length >= 2 && /^\d{4,20}$/.test(digits) && endsRight;
  const add = useMutation({
    mutationFn: () => api.createAccount({ shopId: problem.shopId!, bankName, accountNumber: digits, ifscCode: ifscCode || undefined, accountType: 'current' }),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ['bank-accounts'] });
      toast(`Account added for ${problem.shopName}`, 'good');
      onAdded(r.id);
    },
    onError: (e: Error) => toast(e.message, 'critical'),
  });
  return (
    <div className="mt-3 grid gap-2 rounded-lg border border-border bg-card p-3 sm:grid-cols-4">
      <Field label="Bank">
        <Input list="upload-known-banks" value={bankName} onChange={(e) => setBank(e.target.value)} />
        <datalist id="upload-known-banks">
          {KNOWN_BANKS.map((b) => (
            <option key={b} value={b} />
          ))}
        </datalist>
      </Field>
      <Field
        label="Full account number"
        hint={problem.last4 && digits.length >= 4 && !endsRight ? <span className="text-destructive">Must end in {problem.last4}</span> : undefined}
      >
        <Input
          value={accountNumber}
          onChange={(e) => setNumber(e.target.value)}
          inputMode="numeric"
          autoComplete="off"
          placeholder={problem.last4 ? `…${problem.last4}` : 'Account number'}
        />
      </Field>
      <Field label="IFSC (optional)">
        <Input value={ifscCode} onChange={(e) => setIfsc(e.target.value.toUpperCase())} maxLength={11} />
      </Field>
      <div className="flex items-end">
        <Button variant="primary" className="w-full" icon={<Plus className="size-4" />} onClick={() => add.mutate()} loading={add.isPending} disabled={!valid}>
          Add account & import
        </Button>
      </div>
    </div>
  );
}

function NoPermissionNote() {
  return (
    <p className="mt-2 text-[13px] text-foreground/80">
      Ask an owner or admin to add it under{' '}
      <Link to="/bank/rules" className="font-medium text-primary hover:underline">
        Rules & settings → Bank accounts
      </Link>
      , then retry.
    </p>
  );
}

/** Explains why an upload was stopped and offers the fix. */
export function UploadProblemPanel({
  problem,
  canAddAccount,
  busy,
  onRetry,
  onRemove,
}: {
  problem: UploadProblem;
  canAddAccount: boolean;
  busy: boolean;
  onRetry: (changes: RetryChanges) => void;
  onRemove: () => void;
}) {
  const [picked, setPicked] = useState(problem.accounts?.[0]?.id ?? '');
  const [adding, setAdding] = useState(false);

  switch (problem.code) {
    case 'overlap': {
      const all = !problem.fresh;
      return (
        <Panel
          tone={all ? 'critical' : 'warning'}
          icon={all ? <Copy className="size-5" /> : <AlertTriangle className="size-5" />}
          title={
            all
              ? `Already imported: all ${count(problem.total ?? 0)} transactions in this file`
              : `${count(problem.duplicates ?? 0)} of ${count(problem.total ?? 0)} transactions are already imported`
          }
        >
          <p>
            {problem.account && (
              <b>
                {problem.account.bank} ••{problem.account.last4}
              </b>
            )}
            {problem.from && (
              <>
                {' '}
                · overlapping dates {date(problem.from)} – {date(problem.to)}
              </>
            )}
            . They came from:
          </p>
          <ul className="mt-1.5 space-y-1">
            {problem.statements?.map((s) => (
              <li key={s.file_name + s.uploaded_at} className="rounded-md bg-card px-2.5 py-1.5 text-[12.5px]">
                <span className="font-medium">{s.file_name}</span>
                <span className="text-muted-foreground">
                  {' '}
                  · {date(s.period_start)} – {date(s.period_end)} · {count(s.tx_count)} transactions · uploaded {relativeTime(s.uploaded_at)}
                  {s.uploaded_by ? ` by ${s.uploaded_by}` : ''}
                </span>
              </li>
            ))}
          </ul>
          <div className="mt-3 flex flex-wrap gap-2">
            {!all && (
              <>
                <Button variant="primary" onClick={() => onRetry({ duplicates: 'skip' })} loading={busy}>
                  Import only the {count(problem.fresh ?? 0)} new transaction{problem.fresh === 1 ? '' : 's'}
                </Button>
                <Button onClick={() => onRetry({ duplicates: 'keep' })} disabled={busy} title="Repeated transactions will be flagged as possible duplicates">
                  Import all {count(problem.total ?? 0)} anyway
                </Button>
              </>
            )}
            <Button variant="ghost" onClick={onRemove}>
              Remove this file
            </Button>
          </div>
        </Panel>
      );
    }

    case 'account_other_shop':
      return (
        <Panel tone="warning" icon={<Store className="size-5" />} title={`This statement belongs to ${problem.otherShopName}`}>
          <p>{problem.error}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {problem.canSwitch ? (
              <Button variant="primary" onClick={() => onRetry({ shopId: problem.otherShopId, bankAccountId: '' })} loading={busy}>
                Import into {problem.otherShopName}
              </Button>
            ) : (
              <span className="text-[13px] text-foreground/80">Switch to {problem.otherShopName} in the header to upload it.</span>
            )}
            <Button variant="ghost" onClick={onRemove}>
              Remove this file
            </Button>
          </div>
        </Panel>
      );

    case 'no_accounts':
    case 'account_not_registered':
      return (
        <Panel
          tone="warning"
          icon={<Landmark className="size-5" />}
          title={problem.code === 'no_accounts' ? `Register ${problem.shopName}'s bank account first` : 'This bank account is not registered'}
        >
          <p>
            {problem.error} Each shop's accounts are saved once; after that, every statement from the account is matched automatically.
          </p>
          {canAddAccount ? <AddAccountForm problem={problem} onAdded={(id) => onRetry({ bankAccountId: id })} /> : <NoPermissionNote />}
        </Panel>
      );

    default: {
      // account_number_missing, choose_account, account_mismatch: pick the account by hand.
      const accounts = problem.accounts ?? [];
      return (
        <Panel tone={problem.code === 'account_mismatch' ? 'critical' : 'warning'} icon={<Landmark className="size-5" />} title="Which account is this statement for?">
          <p>{problem.error}</p>
          {problem.code === 'account_number_missing' && (
            <p className="mt-1 text-xs text-muted-foreground">Choosing the account here is enough. There's no need to convert the file.</p>
          )}
          {accounts.length > 0 && (
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <Select value={picked} onChange={(e) => setPicked(e.target.value)} className="w-64" aria-label="Bank account">
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.bank_name} ••{a.last4}
                  </option>
                ))}
              </Select>
              <Button variant="primary" onClick={() => onRetry({ bankAccountId: picked })} disabled={!picked} loading={busy}>
                Import to this account
              </Button>
              {canAddAccount && !adding && (
                <Button variant="ghost" icon={<Plus className="size-4" />} onClick={() => setAdding(true)}>
                  It's a different account
                </Button>
              )}
            </div>
          )}
          {canAddAccount && (adding || !accounts.length) && <AddAccountForm problem={problem} onAdded={(id) => onRetry({ bankAccountId: id })} />}
          {!canAddAccount && !accounts.length && <NoPermissionNote />}
        </Panel>
      );
    }
  }
}
