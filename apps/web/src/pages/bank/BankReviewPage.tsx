import clsx from 'clsx';
import { CheckCircle2, ListChecks, PartyPopper, ShieldAlert, SkipForward, UserRound } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Amount, CategoryLabel, FlagChips, REASON_LABEL, ReviewBadge, SourceBadge } from './components/domain';
import { PageHeader } from './components/BankLayout';
import { CategorySelect, TransactionDrawer } from './components/TransactionDrawer';
import { Button, Card, EmptyState, Input, Kbd, Segmented, Select, Spinner, useToast } from './components/ui';
import type { ReviewStatus, Transaction } from './lib/api';
import { count, date, pct } from './lib/format';
import { useAnalytics, useTransactions, useUpdateTx } from './lib/queries';
import { useScope } from './lib/store';
import { useAuthStore } from '../../stores/auth-store';
import { useCanCheck } from '../../hooks/usePermission';

type Tab = 'pending' | 'verified' | 'suspicious';

export default function BankReviewPage() {
  const [sp, setSp] = useSearchParams();
  const scope = useScope();
  const reviewer = useAuthStore((s) => s.user?.fullName ?? '');
  const canEdit = useCanCheck()('bank.reconcile');
  const toast = useToast();
  const update = useUpdateTx();
  const tab = (sp.get('tab') as Tab) || 'pending';
  const reason = sp.get('reason') ?? '';
  const statementIds = sp.get('statementIds') ? sp.get('statementIds')!.split(',') : [];

  const { data, isLoading, isFetching } = useTransactions({ ...scope, statementIds, review: tab, reason, sort: 'abs', dir: 'desc', pageSize: 200 });
  const { data: analytics } = useAnalytics(scope);
  const rows = useMemo(() => data?.rows ?? [], [data]);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const lastIndex = useRef(0);
  const [note, setNote] = useState('');
  const [detail, setDetail] = useState<Transaction | null>(null);

  // Keep a valid selection as the list changes (items leave the queue after a decision).
  useEffect(() => {
    if (!rows.length) {
      setSelectedId(null);
      return;
    }
    if (selectedId == null || !rows.some((r) => r.id === selectedId)) {
      setSelectedId(rows[Math.min(lastIndex.current, rows.length - 1)].id);
    }
  }, [rows, selectedId]);

  const index = rows.findIndex((r) => r.id === selectedId);
  const current = index >= 0 ? rows[index] : null;
  useEffect(() => {
    if (index >= 0) lastIndex.current = index;
    setNote(current?.reviewer_note ?? '');
  }, [current?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const move = useCallback(
    (delta: number) => {
      if (!rows.length) return;
      const next = Math.max(0, Math.min(rows.length - 1, (index < 0 ? 0 : index) + delta));
      setSelectedId(rows[next].id);
      document.getElementById(`rq-${rows[next].id}`)?.scrollIntoView({ block: 'nearest' });
    },
    [rows, index],
  );

  const decide = useCallback(
    (status: ReviewStatus, category?: string) => {
      if (!current || !canEdit) return;
      update.mutate(
        { id: current.id, patch: { review_status: status, reviewer_note: note || null, ...(category ? { category } : {}) } },
        {
          onSuccess: () => toast(status === 'verified' ? 'Verified ✓' : status === 'suspicious' ? 'Marked suspicious' : 'Reopened', status === 'suspicious' ? 'critical' : 'good'),
          onError: (e: Error) => toast(e.message, 'critical'),
        },
      );
    },
    [current, canEdit, note, update, toast],
  );

  // Keyboard: J/K or arrows to move, V verify, S suspicious.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (el.closest('input, textarea, select') || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === 'j' || e.key === 'ArrowDown') {
        e.preventDefault();
        move(1);
      } else if (e.key === 'k' || e.key === 'ArrowUp') {
        e.preventDefault();
        move(-1);
      } else if (e.key === 'v' && tab !== 'verified') decide('verified');
      else if (e.key === 's' && tab !== 'suspicious') decide('suspicious');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [move, decide, tab]);

  const t = analytics?.totals;
  const reviewed = t ? t.verified + t.suspicious : 0;
  const progress = t && t.flagged ? reviewed / t.flagged : 0;

  const setParam = (k: string, v: string) =>
    setSp(
      (prev) => {
        const n = new URLSearchParams(prev);
        if (v) n.set(k, v);
        else n.delete(k);
        return n;
      },
      { replace: true },
    );

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title="Review queue"
        subtitle="Transactions the system couldn't confidently explain. Verify them or mark them for follow-up."
        actions={
          reviewer && (
            <span className="flex items-center gap-2 text-[13px] whitespace-nowrap text-foreground/80">
              <UserRound className="size-4 text-muted-foreground" />
              Reviewing as <b className="font-medium text-foreground">{reviewer}</b>
            </span>
          )
        }
      />

      <div>
        <Card className="mb-4 flex flex-wrap items-center gap-x-6 gap-y-3 px-5 py-3.5">
          <div className="min-w-56 flex-1">
            <div className="mb-1.5 flex justify-between text-[13px]">
              <span className="font-medium">
                {count(reviewed)} of {count(t?.flagged ?? 0)} flagged items reviewed
              </span>
              <span className="num text-muted-foreground">{pct(progress)}</span>
            </div>
            <div className="flex h-2 overflow-hidden rounded-full bg-muted">
              <div className="bg-success" style={{ width: pct(t && t.flagged ? t.verified / t.flagged : 0) }} />
              <div className="bg-destructive" style={{ width: pct(t && t.flagged ? t.suspicious / t.flagged : 0) }} />
            </div>
          </div>
          <div className="flex gap-5 text-[13px]">
            <span>
              <b className="num">{count(t?.pending ?? 0)}</b> <span className="text-muted-foreground">waiting</span>
            </span>
            <span>
              <b className="num text-success">{count(t?.verified ?? 0)}</b> <span className="text-muted-foreground">verified</span>
            </span>
            <span>
              <b className="num text-destructive">{count(t?.suspicious ?? 0)}</b> <span className="text-muted-foreground">suspicious</span>
            </span>
          </div>
        </Card>

        <div className="mb-3 flex flex-wrap items-center gap-2">
          <Segmented
            value={tab}
            onChange={(v) => setParam('tab', v === 'pending' ? '' : v)}
            options={[
              { value: 'pending', label: 'Needs review' },
              { value: 'verified', label: 'Verified' },
              { value: 'suspicious', label: 'Suspicious' },
            ]}
          />
          <Select value={reason} onChange={(e) => setParam('reason', e.target.value)} aria-label="Flag reason">
            <option value="">All reasons</option>
            {Object.entries(REASON_LABEL).map(([code, label]) => (
              <option key={code} value={code}>
                {label}
              </option>
            ))}
          </Select>
          {statementIds.length > 0 && (
            <Button size="sm" variant="ghost" onClick={() => setParam('statementIds', '')}>
              Showing one statement · show all
            </Button>
          )}
          {isFetching && <Spinner />}
          <div className="ml-auto hidden items-center gap-1.5 text-xs text-muted-foreground md:flex">
            <Kbd>J</Kbd>/<Kbd>K</Kbd> move · <Kbd>V</Kbd> verify · <Kbd>S</Kbd> suspicious
          </div>
        </div>
      </div>

      {!isLoading && rows.length === 0 ? (
        <div>
          <Card>
            <EmptyState
              icon={tab === 'pending' ? <PartyPopper className="size-6" /> : <ListChecks className="size-6" />}
              title={tab === 'pending' ? 'Inbox zero — nothing to review' : `No ${tab} transactions yet`}
              body={tab === 'pending' ? 'New flags appear here automatically when statements are uploaded.' : undefined}
            />
          </Card>
        </div>
      ) : (
        <div className="grid min-h-0 flex-1 gap-4 pb-6 lg:grid-cols-[minmax(320px,420px)_1fr]">
          {/* ---------------------------------------------------------------- list */}
          <Card className="scroll-thin max-h-[70vh] overflow-y-auto lg:max-h-none">
            <ul role="listbox" aria-label="Review queue">
              {rows.map((r) => (
                <li
                  key={r.id}
                  id={`rq-${r.id}`}
                  role="option"
                  aria-selected={r.id === selectedId}
                  onClick={() => setSelectedId(r.id)}
                  className={clsx(
                    'cursor-pointer border-b border-border/70 border-l-2 px-4 py-3 last:border-b-0',
                    r.id === selectedId ? 'border-l-primary bg-primary-muted/70' : 'border-l-transparent hover:bg-subtle',
                  )}
                >
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="truncate text-[13.5px] font-medium">{r.counterparty ?? r.description}</span>
                    <Amount value={r.amount} className="text-[13px]" />
                  </div>
                  <div className="mt-0.5 flex items-center justify-between gap-2 text-xs text-muted-foreground">
                    <span className="truncate">
                      {date(r.date)} · {r.shop_name}
                    </span>
                    <CategoryLabel category={r.category} group={r.group} className="!text-xs" />
                  </div>
                  <div className="mt-1.5">
                    <FlagChips reasons={r.flag_reasons} max={2} />
                  </div>
                </li>
              ))}
            </ul>
          </Card>

          {/* ---------------------------------------------------------------- detail */}
          {current && (
            <Card className="order-first h-fit p-6 lg:order-none lg:sticky lg:top-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-[13px] text-muted-foreground">
                    {date(current.date)} · {current.shop_name} · {current.bank} · {current.channel}
                  </div>
                  <div className="mt-1 text-xl font-semibold">{current.counterparty ?? 'Unknown counterparty'}</div>
                </div>
                <div className="text-right">
                  <Amount value={current.amount} className="text-3xl font-semibold tracking-tight" />
                  <div className="mt-1">
                    <ReviewBadge status={current.review_status} />
                  </div>
                </div>
              </div>

              <p className="mt-4 rounded-lg bg-subtle p-3 font-mono text-[12.5px] leading-relaxed break-all text-foreground/80">{current.description}</p>

              <div className="mt-5">
                <div className="mb-2 text-[13px] font-medium text-foreground/80">Why this needs a look</div>
                <ul className="space-y-1.5">
                  {current.flag_reasons.map((f) => (
                    <li key={f.code + f.label} className="flex items-center gap-2 text-[13.5px]">
                      <span
                        className="size-2 shrink-0 rounded-full"
                        style={{ background: f.severity === 'high' ? 'hsl(var(--destructive))' : f.severity === 'medium' ? 'hsl(var(--warning))' : 'hsl(var(--muted-foreground))' }}
                      />
                      {f.label}
                      <span className="text-xs text-muted-foreground capitalize">{f.severity}</span>
                    </li>
                  ))}
                </ul>
              </div>

              <div className="mt-5 grid gap-4 sm:grid-cols-2">
                <div>
                  <div className="mb-1 text-[13px] font-medium text-foreground/80">Category</div>
                  <CategorySelect disabled={!canEdit} value={current.category} onChange={(c) => update.mutate({ id: current.id, patch: { category: c } }, { onSuccess: () => toast(`Category set to ${c}`, 'good') })} />
                  <div className="mt-1.5 flex items-center gap-2 text-xs text-muted-foreground">
                    <SourceBadge source={current.category_source} confidence={current.confidence} />
                    {current.ai_note && <span className="truncate">{current.ai_note.replace(/^⚠\s*/, '')}</span>}
                  </div>
                </div>
                <div>
                  <div className="mb-1 text-[13px] font-medium text-foreground/80">Note (optional)</div>
                  <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="What did you confirm?" disabled={!canEdit} />
                  {current.reviewed_by && <div className="mt-1.5 text-xs text-muted-foreground">Last reviewed by {current.reviewed_by}</div>}
                </div>
              </div>

              <div className="mt-6 flex flex-wrap items-center gap-2 border-t border-border pt-5">
                {canEdit && tab !== 'verified' && (
                  <Button variant="good" icon={<CheckCircle2 className="size-4" />} onClick={() => decide('verified')} loading={update.isPending}>
                    Verify <Kbd>V</Kbd>
                  </Button>
                )}
                {canEdit && tab !== 'suspicious' && (
                  <Button variant="danger" icon={<ShieldAlert className="size-4" />} onClick={() => decide('suspicious')}>
                    Suspicious <Kbd>S</Kbd>
                  </Button>
                )}
                {canEdit && tab !== 'pending' && <Button onClick={() => decide('pending')}>Move back to queue</Button>}
                <Button variant="ghost" icon={<SkipForward className="size-4" />} onClick={() => move(1)}>
                  Skip <Kbd>J</Kbd>
                </Button>
                <div className="flex-1" />
                <Button variant="ghost" onClick={() => setDetail(current)}>
                  More details & rules
                </Button>
              </div>
            </Card>
          )}
        </div>
      )}
      <TransactionDrawer tx={detail} onClose={() => setDetail(null)} />
    </div>
  );
}
