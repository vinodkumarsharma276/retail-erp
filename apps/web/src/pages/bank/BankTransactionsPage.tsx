import clsx from 'clsx';
import { ArrowDown, ArrowUp, CheckCircle2, ChevronLeft, ChevronRight, Download, Flag, Search, ShieldAlert, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Amount, CategoryLabel, FlagChips, ReviewBadge } from './components/domain';
import { PageHeader } from './components/BankLayout';
import { CategorySelect, TransactionDrawer } from './components/TransactionDrawer';
import { Badge, Button, Card, EmptyState, Input, Segmented, Select, Spinner, useToast } from './components/ui';
import { downloadExport, type api, type Transaction, type TxFilters } from './lib/api';
import { count, date, money } from './lib/format';
import { useBulkUpdate, useFacets, useMeta, useTransactions } from './lib/queries';
import { useScope } from './lib/store';
import { useCanCheck } from '../../hooks/usePermission';

const PAGE_SIZE = 50;

function useDebounced<T>(value: T, ms = 300) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

export default function BankTransactionsPage() {
  const [sp, setSp] = useSearchParams();
  const scope = useScope();
  const canEdit = useCanCheck()('bank.reconcile');
  const { data: meta } = useMeta();
  const { data: facets } = useFacets();
  const toast = useToast();
  const bulk = useBulkUpdate();

  const get = (k: string) => sp.get(k) ?? '';
  const set = (k: string, v: string) =>
    setSp(
      (prev) => {
        const n = new URLSearchParams(prev);
        if (v) n.set(k, v);
        else n.delete(k);
        if (k !== 'page') n.delete('page');
        return n;
      },
      { replace: true },
    );

  const [search, setSearch] = useState(get('q'));
  const debounced = useDebounced(search);
  useEffect(() => {
    if (debounced !== get('q')) set('q', debounced);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debounced]);

  const categories = get('categories') ? get('categories').split(',') : [];
  const filters: TxFilters = {
    ...scope,
    q: get('q') || undefined,
    direction: (get('direction') as TxFilters['direction']) || '',
    categories,
    channels: get('channels') ? get('channels').split(',') : [],
    banks: get('bank') ? [get('bank')] : [],
    flagged: (get('flagged') as TxFilters['flagged']) || '',
    review: (get('review') as TxFilters['review']) || '',
    statementIds: get('statementIds') ? get('statementIds').split(',') : [],
  };
  const page = Number(get('page') || 1);
  const sort = get('sort') || 'date';
  const dir = (get('dir') as 'asc' | 'desc') || 'desc';
  const { data, isFetching, isLoading } = useTransactions({ ...filters, page, pageSize: PAGE_SIZE, sort, dir });

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [openTx, setOpenTx] = useState<Transaction | null>(null);
  useEffect(() => setSelected(new Set()), [data?.page, sp]);

  const rows = data?.rows ?? [];
  const pages = Math.max(1, Math.ceil((data?.total ?? 0) / PAGE_SIZE));
  const allChecked = rows.length > 0 && rows.every((r) => selected.has(r.id));
  const activeChips = useMemo(() => {
    const chips: { key: string; label: string }[] = [];
    if (categories.length) chips.push({ key: 'categories', label: categories.length === 1 ? categories[0] : `${categories.length} categories` });
    if (get('channels')) chips.push({ key: 'channels', label: `Channel: ${get('channels')}` });
    if (get('statementIds')) chips.push({ key: 'statementIds', label: 'One statement' });
    return chips;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sp]);

  const toggleSort = (key: string) => {
    setSp(
      (prev) => {
        const n = new URLSearchParams(prev);
        if (sort === key) n.set('dir', dir === 'desc' ? 'asc' : 'desc');
        else {
          n.set('sort', key);
          n.set('dir', 'desc');
        }
        return n;
      },
      { replace: true },
    );
  };

  const runBulk = (patch: Parameters<typeof api.bulkUpdate>[1], msg: string) =>
    bulk.mutate(
      { ids: [...selected], patch },
      {
        onSuccess: (r) => {
          toast(`${msg} · ${r.updated} transaction${r.updated === 1 ? '' : 's'}`, 'good');
          setSelected(new Set());
        },
        onError: (e: Error) => toast(e.message, 'critical'),
      },
    );

  const exportAs = (format: 'csv' | 'xlsx') => downloadExport(filters, format).catch((e: Error) => toast(e.message, 'critical'));

  const SortHead = ({ k, label, className }: { k: string; label: string; className?: string }) => (
    <th className={clsx('px-3 py-2.5 font-medium', className)}>
      <button onClick={() => toggleSort(k)} className="inline-flex items-center gap-1 hover:text-foreground cursor-pointer">
        {label}
        {sort === k && (dir === 'desc' ? <ArrowDown className="size-3.5" /> : <ArrowUp className="size-3.5" />)}
      </button>
    </th>
  );

  return (
    <div className="pb-10">
      <PageHeader
        title="Transactions"
        subtitle={data ? `${count(data.total)} transactions · in ${money(data.inflow, 'INR', 0)} · out ${money(data.outflow, 'INR', 0)}` : ' '}
        actions={
          <>
            <Button icon={<Download className="size-4" />} onClick={() => exportAs('csv')}>
              CSV
            </Button>
            <Button icon={<Download className="size-4" />} onClick={() => exportAs('xlsx')}>
              Excel
            </Button>
          </>
        }
      />

      <div className="space-y-3">
        {/* ---------------------------------------------------------------- filters */}
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-60 flex-1">
            <Search className="pointer-events-none absolute top-2.5 left-3 size-4 text-muted-foreground" />
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search description, payee, reference or exact amount…" className="pl-9" />
          </div>
          <Segmented
            value={get('direction') || 'all'}
            onChange={(v) => set('direction', v === 'all' ? '' : v)}
            options={[
              { value: 'all', label: 'All' },
              { value: 'credit', label: 'Money in' },
              { value: 'debit', label: 'Money out' },
            ]}
          />
          <Select value={categories.length === 1 ? categories[0] : ''} onChange={(e) => set('categories', e.target.value)} aria-label="Category">
            <option value="">All categories</option>
            {meta?.groups.map((g) => (
              <optgroup key={g.id} label={g.label}>
                {meta.categories
                  .filter((c) => c.group === g.id)
                  .map((c) => (
                    <option key={c.name}>{c.name}</option>
                  ))}
              </optgroup>
            ))}
          </Select>
          <Select value={get('bank')} onChange={(e) => set('bank', e.target.value)} aria-label="Bank">
            <option value="">All banks</option>
            {facets?.banks.map((b) => (
              <option key={b}>{b}</option>
            ))}
          </Select>
          <Select value={get('review') || (get('flagged') === 'true' ? 'flagged' : '')} onChange={(e) => {
            const v = e.target.value;
            setSp((prev) => {
              const n = new URLSearchParams(prev);
              n.delete('review');
              n.delete('flagged');
              n.delete('page');
              if (v === 'flagged') n.set('flagged', 'true');
              else if (v) n.set('review', v);
              return n;
            }, { replace: true });
          }} aria-label="Review status">
            <option value="">Any status</option>
            <option value="flagged">All flagged</option>
            <option value="pending">Needs review</option>
            <option value="verified">Verified</option>
            <option value="suspicious">Suspicious</option>
          </Select>
          {isFetching && <Spinner />}
        </div>
        {activeChips.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {activeChips.map((c) => (
              <button key={c.key} onClick={() => set(c.key, '')} className="inline-flex items-center gap-1 rounded-full bg-primary-muted px-2.5 py-1 text-xs font-medium text-primary cursor-pointer">
                {c.label} <X className="size-3" />
              </button>
            ))}
          </div>
        )}

        {/* ---------------------------------------------------------------- bulk bar */}
        {canEdit && selected.size > 0 && (
          <Card className="sticky top-2 z-20 flex flex-wrap items-center gap-2 border-primary/40 px-4 py-2.5">
            <span className="text-[13px] font-medium">{selected.size} selected</span>
            <div className="w-64">
              <CategorySelectBulk onPick={(category) => runBulk({ category }, `Category set to ${category}`)} />
            </div>
            <Button size="sm" variant="good" icon={<CheckCircle2 className="size-4" />} onClick={() => runBulk({ review_status: 'verified' }, 'Verified')}>
              Verify
            </Button>
            <Button size="sm" variant="danger" icon={<ShieldAlert className="size-4" />} onClick={() => runBulk({ review_status: 'suspicious' }, 'Marked suspicious')}>
              Suspicious
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>
              Clear
            </Button>
          </Card>
        )}

        {/* ---------------------------------------------------------------- table */}
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] text-[13px]">
              <thead className="border-b border-border bg-subtle text-left text-muted-foreground">
                <tr>
                  <th className="w-10 px-3 py-2.5">
                    <input
                      type="checkbox"
                      className="size-4 accent-primary"
                      checked={allChecked}
                      onChange={() => setSelected(allChecked ? new Set() : new Set(rows.map((r) => r.id)))}
                      aria-label="Select all on page"
                    />
                  </th>
                  <SortHead k="date" label="Date" />
                  <th className="px-3 py-2.5 font-medium">Description</th>
                  <SortHead k="category" label="Category" />
                  <SortHead k="shop" label="Shop · Bank" />
                  <th className="px-3 py-2.5 font-medium">Status</th>
                  <SortHead k="amount" label="Amount" className="text-right" />
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr
                    key={r.id}
                    onClick={() => setOpenTx(r)}
                    className={clsx('cursor-pointer border-b border-border/70 last:border-0 hover:bg-subtle', selected.has(r.id) && 'bg-primary-muted/60')}
                  >
                    <td className="px-3 py-2.5" onClick={(e) => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        className="size-4 accent-primary"
                        checked={selected.has(r.id)}
                        onChange={() =>
                          setSelected((s) => {
                            const n = new Set(s);
                            if (n.has(r.id)) n.delete(r.id);
                            else n.add(r.id);
                            return n;
                          })
                        }
                        aria-label="Select transaction"
                      />
                    </td>
                    <td className="num px-3 py-2.5 whitespace-nowrap text-foreground/80">{date(r.date)}</td>
                    <td className="max-w-0 px-3 py-2.5" style={{ width: '38%' }}>
                      <div className="flex items-center gap-1.5">
                        {r.flagged && r.review_status === 'pending' && <Flag className="size-3.5 shrink-0 text-warning" aria-label="Flagged" />}
                        <span className="truncate font-medium">{r.counterparty ?? '—'}</span>
                        <Badge className="shrink-0">{r.channel}</Badge>
                      </div>
                      <div className="truncate text-xs text-muted-foreground" title={r.description}>
                        {r.description}
                      </div>
                    </td>
                    <td className="px-3 py-2.5">
                      <CategoryLabel category={r.category} group={r.group} />
                    </td>
                    <td className="px-3 py-2.5 text-foreground/80">
                      <div className="truncate">{r.shop_name}</div>
                      <div className="truncate text-xs text-muted-foreground">{r.bank}</div>
                    </td>
                    <td className="px-3 py-2.5">
                      <div className="flex flex-col items-start gap-1">
                        <ReviewBadge status={r.review_status} />
                        {r.review_status === 'pending' && <FlagChips reasons={r.flag_reasons} max={1} />}
                      </div>
                    </td>
                    <td className="px-3 py-2.5 text-right">
                      <Amount value={r.amount} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!isLoading && rows.length === 0 && <EmptyState icon={<Search className="size-6" />} title="No transactions match" body="Try clearing a filter or widening the date range." />}
          {(data?.total ?? 0) > PAGE_SIZE && (
            <div className="flex items-center justify-between border-t border-border px-4 py-2.5 text-[13px] text-muted-foreground">
              <span className="num">
                {count((page - 1) * PAGE_SIZE + 1)}–{count(Math.min(page * PAGE_SIZE, data!.total))} of {count(data!.total)}
              </span>
              <div className="flex items-center gap-1">
                <Button size="sm" variant="ghost" disabled={page <= 1} onClick={() => set('page', String(page - 1))} aria-label="Previous page">
                  <ChevronLeft className="size-4" />
                </Button>
                <span className="num px-2">
                  {page} / {pages}
                </span>
                <Button size="sm" variant="ghost" disabled={page >= pages} onClick={() => set('page', String(page + 1))} aria-label="Next page">
                  <ChevronRight className="size-4" />
                </Button>
              </div>
            </div>
          )}
        </Card>
      </div>
      <TransactionDrawer tx={openTx} onClose={() => setOpenTx(null)} />
    </div>
  );
}

function CategorySelectBulk({ onPick }: { onPick: (c: string) => void }) {
  return <CategorySelect value="" placeholder="Set category…" onChange={onPick} />;
}
