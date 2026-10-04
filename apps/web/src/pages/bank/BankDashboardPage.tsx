import { ArrowDownLeft, ArrowRight, ArrowUpRight, FileStack, ListChecks, Receipt, UploadCloud } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  CashflowChart,
  ChartCard,
  DataTable,
  Donut,
  Legend,
  NetTrendChart,
  PairedBars,
  RankedBars,
  sliceTable,
  WeekdayChart,
  type Slice,
} from './components/charts';
import { Amount, CategoryLabel, Dot, REASON_LABEL, ReviewBadge } from './components/domain';
import { PageHeader } from './components/BankLayout';
import { TransactionDrawer } from './components/TransactionDrawer';
import { Button, Card, EmptyState, Segmented, Skeleton, useToast } from './components/ui';
import type { Transaction } from './lib/api';
import { api, downloadExport } from './lib/api';
import { isAllShops, useShopStore } from '../../stores/shop-store';
import { CHANNEL_COLOR, FLOW, GROUP_COLOR, INCOME_COLOR, OTHER } from './lib/colors';
import { compactMoney, count, date, money, month, pct, WEEKDAYS } from './lib/format';
import { useAnalytics, useMeta } from './lib/queries';
import { PRESET_LABEL, useGlobal, useScope } from './lib/store';

function StatTile({ label, value, sub, icon, to }: { label: string; value: string; sub?: React.ReactNode; icon: React.ReactNode; to?: string }) {
  const body = (
    <Card className="h-full p-4 transition-colors hover:border-border-strong">
      <div className="flex items-center justify-between text-[13px] text-muted-foreground">
        {label}
        <span className="text-muted-foreground">{icon}</span>
      </div>
      <div className="mt-2 text-2xl font-semibold tracking-tight">{value}</div>
      {sub && <div className="mt-1 text-xs text-muted-foreground">{sub}</div>}
    </Card>
  );
  return to ? (
    <Link to={to} className="block">
      {body}
    </Link>
  ) : (
    body
  );
}

function txLink(params: Record<string, string>) {
  return `/bank/transactions?${new URLSearchParams(params).toString()}`;
}

export default function BankDashboardPage() {
  const scope = useScope();
  const { filters } = useGlobal();
  const { data: meta } = useMeta();
  const { data, isLoading } = useAnalytics(scope);
  const navigate = useNavigate();
  const toast = useToast();
  const allShops = isAllShops(useShopStore((s) => s.currentShopId));
  const currentShopName = useShopStore((s) => s.currentShopName);
  const [payeeMode, setPayeeMode] = useState<'out' | 'in'>('out');
  const [openTx, setOpenTx] = useState<Transaction | null>(null);

  const cur = data?.currency ?? 'INR';

  const groupSlices: Slice[] = useMemo(
    () =>
      (data?.groups ?? [])
        .filter((g) => g.outflow > 0 && g.id !== 'income')
        .map((g) => ({ key: g.id, label: g.label, value: g.outflow, color: GROUP_COLOR[g.id], count: g.count }))
        .sort((a, b) => b.value - a.value),
    [data],
  );
  const incomeSlices: Slice[] = useMemo(() => {
    const credits = (data?.categories ?? []).filter((c) => c.direction === 'credit');
    const known = credits.filter((c) => INCOME_COLOR[c.category]);
    const rest = credits.filter((c) => !INCOME_COLOR[c.category]);
    const slices: Slice[] = known.map((c) => ({ key: c.category, label: c.category, value: c.amount, color: INCOME_COLOR[c.category], count: c.count }));
    if (rest.length)
      slices.push({ key: 'other', label: 'Other', value: rest.reduce((a, b) => a + b.amount, 0), color: OTHER, count: rest.reduce((a, b) => a + b.count, 0) });
    return slices.sort((a, b) => b.value - a.value);
  }, [data]);
  const channelSlices: Slice[] = useMemo(() => {
    const m = new Map<string, { value: number; count: number }>();
    for (const c of data?.channels ?? []) {
      if (c.direction !== 'debit') continue;
      m.set(c.channel, { value: (m.get(c.channel)?.value ?? 0) + c.amount, count: (m.get(c.channel)?.count ?? 0) + c.count });
    }
    return [...m.entries()].map(([k, v]) => ({ key: k, label: k, value: v.value, count: v.count, color: CHANNEL_COLOR[k] ?? OTHER })).sort((a, b) => b.value - a.value);
  }, [data]);
  const spendCats = useMemo(() => (data?.categories ?? []).filter((c) => c.direction === 'debit').slice(0, 10), [data]);
  const weekday = useMemo(
    () =>
      WEEKDAYS.map((day, i) => {
        const w = data?.weekday.find((x) => x.dow === i + 1);
        return { day, inflow: w?.inflow ?? 0, outflow: w?.outflow ?? 0, count: w?.count ?? 0 };
      }),
    [data],
  );

  const scopeLabel = !allShops
    ? (currentShopName ?? 'This shop')
    : scope.shopIds.length === 0
      ? 'All shops'
      : scope.shopIds.map((id) => meta?.shops.find((s) => s.id === id)?.name).filter(Boolean).join(', ');

  const exportExcel = () => downloadExport(scope, 'xlsx').catch((e: Error) => toast(e.message, 'critical'));

  if (isLoading || !data) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-60" />
        <div className="grid gap-4 md:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-28" />
          ))}
        </div>
        <Skeleton className="h-80" />
      </div>
    );
  }

  const t = data.totals;
  if (!t.count) {
    return (
      <>
        <PageHeader title="Overview" subtitle={`${scopeLabel} · ${PRESET_LABEL[filters.preset]}`} />
        <Card>
          <EmptyState
            icon={<UploadCloud className="size-6" />}
            title="No transactions in this view yet"
            body="Upload bank statements (PDF, Excel, CSV or a photo) for any of your shops. We'll parse, categorize and flag anything unusual for review."
            action={
              <Link to="/bank/upload">
                <Button variant="primary" icon={<UploadCloud className="size-4" />}>
                  Upload statements
                </Button>
              </Link>
            }
          />
        </Card>
      </>
    );
  }

  const net = t.inflow - t.outflow;
  const reviewedShare = t.flagged ? (t.verified + t.suspicious) / t.flagged : 1;

  return (
    <div className="pb-10">
      <PageHeader
        title="Overview"
        subtitle={
          <>
            {scopeLabel} · {date(t.date_from)} – {date(t.date_to)} · {count(t.statements)} statement{t.statements === 1 ? '' : 's'}
          </>
        }
        actions={
          <>
            <Button icon={<FileStack className="size-4" />} onClick={exportExcel}>
              Export Excel
            </Button>
            <Link to="/bank/upload">
              <Button variant="primary" icon={<UploadCloud className="size-4" />}>
                Upload
              </Button>
            </Link>
          </>
        }
      />

      <div className="space-y-4">
        {/* ---------------------------------------------------------------- headline */}
        <div className="grid gap-4 sm:grid-cols-3 xl:grid-cols-5">
          <Card className="p-5 sm:col-span-3 xl:col-span-2">
            <div className="text-[13px] text-muted-foreground">Net cash flow</div>
            <div className="mt-1 text-5xl font-semibold tracking-tight">
              {net < 0 ? '−' : ''}
              {compactMoney(Math.abs(net), cur)}
            </div>
            <div className="mt-3 flex items-center gap-2 text-[13px] text-foreground/80">
              <Dot color={FLOW.inflow} /> In {compactMoney(t.inflow, cur)}
              <span className="text-muted-foreground">·</span>
              <Dot color={FLOW.outflow} /> Out {compactMoney(t.outflow, cur)}
            </div>
            <div className="mt-3 flex h-2 overflow-hidden rounded-full bg-muted" aria-hidden>
              <div style={{ width: `${(t.inflow / (t.inflow + t.outflow || 1)) * 100}%`, background: FLOW.inflow }} />
              <div className="w-0.5 bg-card" />
              <div className="flex-1" style={{ background: FLOW.outflow }} />
            </div>
          </Card>
          <StatTile label="Money in" value={compactMoney(t.inflow, cur)} sub={`${count(t.credit_count)} credits`} icon={<ArrowDownLeft className="size-4" />} to={txLink({ direction: 'credit' })} />
          <StatTile label="Money out" value={compactMoney(t.outflow, cur)} sub={`${count(t.debit_count)} debits`} icon={<ArrowUpRight className="size-4" />} to={txLink({ direction: 'debit' })} />
          <StatTile
            label="Needs review"
            value={count(t.pending)}
            sub={
              <span className="flex items-center gap-2">
                <span className="h-1.5 w-16 overflow-hidden rounded-full bg-muted">
                  <span className="block h-full bg-success" style={{ width: pct(reviewedShare) }} />
                </span>
                {pct(reviewedShare)} of {count(t.flagged)} flagged reviewed
              </span>
            }
            icon={<ListChecks className="size-4" />}
            to="/bank/review"
          />
        </div>

        {/* ---------------------------------------------------------------- flow */}
        <div className="grid gap-4 xl:grid-cols-3">
          <ChartCard
            className="xl:col-span-2"
            title="Cash flow by month"
            subtitle="Money in vs. money out"
            legend={<Legend items={[{ label: 'Money in', color: FLOW.inflow }, { label: 'Money out', color: FLOW.outflow }]} />}
            chart={<CashflowChart data={data.monthly} currency={cur} />}
            table={
              <DataTable
                head={['Month', 'Money in', 'Money out', 'Net']}
                align={['left', 'right', 'right', 'right']}
                rows={data.monthly.map((m) => [month(m.month), money(m.inflow, cur, 0), money(m.outflow, cur, 0), money(m.inflow - m.outflow, cur, 0)])}
              />
            }
          />
          <ChartCard
            title="Where money went"
            subtitle="Money out by group · click to drill in"
            chart={
              <Donut
                data={groupSlices}
                currency={cur}
                centerLabel="Total out"
                onSelect={(s) => {
                  const cats = meta?.categories.filter((c) => c.group === s.key).map((c) => c.name) ?? [];
                  navigate(txLink({ direction: 'debit', categories: cats.join(',') }));
                }}
              />
            }
            table={sliceTable(groupSlices, cur)}
          />
        </div>

        {/* ---------------------------------------------------------------- categories */}
        <div className="grid gap-4 xl:grid-cols-2">
          <ChartCard
            title="Top spending categories"
            subtitle="Bar colour shows the category's group"
            chart={
              <RankedBars
                currency={cur}
                onSelect={(k) => navigate(txLink({ categories: k, direction: 'debit' }))}
                items={spendCats.map((c) => ({
                  key: c.category,
                  label: <CategoryLabel category={c.category} group={c.group} />,
                  value: c.amount,
                  color: GROUP_COLOR[c.group],
                  meta: `${count(c.count)}×`,
                }))}
              />
            }
            table={
              <DataTable
                head={['Category', 'Transactions', 'Amount']}
                align={['left', 'right', 'right']}
                rows={spendCats.map((c) => [c.category, count(c.count), money(c.amount, cur, 0)])}
              />
            }
          />
          <ChartCard
            title="Where money came from"
            subtitle="Money in by source"
            chart={<Donut data={incomeSlices} currency={cur} centerLabel="Total in" onSelect={(s) => s.key !== 'other' && navigate(txLink({ categories: s.key, direction: 'credit' }))} />}
            table={sliceTable(incomeSlices, cur)}
          />
        </div>

        {/* ---------------------------------------------------------------- counterparties */}
        <div className="grid gap-4 xl:grid-cols-3">
          <ChartCard
            className="xl:col-span-2"
            title={payeeMode === 'out' ? 'Top payees' : 'Top payers'}
            subtitle={payeeMode === 'out' ? 'Who you paid the most' : 'Who paid you the most'}
            actions={
              <Segmented
                size="sm"
                value={payeeMode}
                onChange={(v) => setPayeeMode(v as 'out' | 'in')}
                options={[
                  { value: 'out', label: 'Paid to' },
                  { value: 'in', label: 'Received from' },
                ]}
              />
            }
            chart={
              <RankedBars
                currency={cur}
                onSelect={(k) => navigate(txLink({ q: k }))}
                items={(payeeMode === 'out' ? data.topPayees : data.topPayers).slice(0, 8).map((p) => ({
                  key: p.name,
                  label: p.name,
                  value: p.amount,
                  color: payeeMode === 'out' ? FLOW.outflow : FLOW.inflow,
                  meta: `${count(p.count)}×`,
                  title: p.category,
                }))}
              />
            }
            table={
              <DataTable
                head={['Name', 'Usual category', 'Transactions', 'Amount']}
                align={['left', 'left', 'right', 'right']}
                rows={(payeeMode === 'out' ? data.topPayees : data.topPayers).map((p) => [p.name, p.category, count(p.count), money(p.amount, cur, 0)])}
              />
            }
          />
          <ChartCard
            title="How you paid"
            subtitle="Money out by payment channel"
            chart={<Donut data={channelSlices} currency={cur} centerLabel="Total out" onSelect={(s) => navigate(txLink({ channels: s.key, direction: 'debit' }))} />}
            table={sliceTable(channelSlices, cur)}
          />
        </div>

        {/* ---------------------------------------------------------------- trend + weekday */}
        <div className="grid gap-4 xl:grid-cols-3">
          <ChartCard
            className="xl:col-span-2"
            title="Net position over time"
            subtitle="Running total of money in minus money out"
            chart={<NetTrendChart daily={data.daily} currency={cur} />}
            table={
              <DataTable
                head={['Date', 'Money in', 'Money out']}
                align={['left', 'right', 'right']}
                rows={data.daily.map((d) => [date(d.date), money(d.inflow, cur, 0), money(d.outflow, cur, 0)])}
              />
            }
          />
          <ChartCard
            title="Activity by weekday"
            subtitle="Totals per day of week"
            legend={<Legend items={[{ label: 'Money in', color: FLOW.inflow }, { label: 'Money out', color: FLOW.outflow }]} />}
            chart={<WeekdayChart data={weekday} currency={cur} />}
            table={
              <DataTable
                head={['Day', 'Transactions', 'Money in', 'Money out']}
                align={['left', 'right', 'right', 'right']}
                rows={weekday.map((w) => [w.day, count(w.count), money(w.inflow, cur, 0), money(w.outflow, cur, 0)])}
              />
            }
          />
        </div>

        {/* ---------------------------------------------------------------- shops & banks */}
        <div className="grid gap-4 xl:grid-cols-2">
          <ChartCard
            title="Shops compared"
            subtitle="Money in vs. out for each shop"
            legend={<Legend items={[{ label: 'Money in', color: FLOW.inflow }, { label: 'Money out', color: FLOW.outflow }]} />}
            chart={
              <PairedBars
                currency={cur}
                rows={data.shops.map((s) => ({
                  key: String(s.id),
                  label: s.name,
                  inflow: s.inflow,
                  outflow: s.outflow,
                  meta: `${count(s.count)} txns${s.pending ? ` · ${s.pending} to review` : ''}`,
                }))}
              />
            }
            table={
              <DataTable
                head={['Shop', 'Transactions', 'Money in', 'Money out', 'Net']}
                align={['left', 'right', 'right', 'right', 'right']}
                rows={data.shops.map((s) => [s.name, count(s.count), money(s.inflow, cur, 0), money(s.outflow, cur, 0), money(s.inflow - s.outflow, cur, 0)])}
              />
            }
          />
          <ChartCard
            title="Banks compared"
            subtitle="Money in vs. out for each bank account"
            legend={<Legend items={[{ label: 'Money in', color: FLOW.inflow }, { label: 'Money out', color: FLOW.outflow }]} />}
            chart={
              <PairedBars
                currency={cur}
                rows={data.banks.map((b) => ({ key: b.bank, label: b.bank, inflow: b.inflow, outflow: b.outflow, meta: `${count(b.count)} txns` }))}
              />
            }
            table={
              <DataTable
                head={['Bank', 'Transactions', 'Money in', 'Money out']}
                align={['left', 'right', 'right', 'right']}
                rows={data.banks.map((b) => [b.bank, count(b.count), money(b.inflow, cur, 0), money(b.outflow, cur, 0)])}
              />
            }
          />
        </div>

        {/* ---------------------------------------------------------------- largest + review */}
        <div className="grid gap-4 xl:grid-cols-3">
          <Card className="xl:col-span-2">
            <div className="flex items-center justify-between px-5 pt-4 pb-2">
              <div>
                <h3 className="text-[15px] font-semibold">Largest transactions</h3>
                <p className="text-[13px] text-muted-foreground">Click a row for details</p>
              </div>
              <Link to={txLink({ sort: 'abs' })} className="inline-flex items-center gap-1 text-[13px] font-medium text-primary hover:underline">
                View all <ArrowRight className="size-3.5" />
              </Link>
            </div>
            <div className="overflow-x-auto px-2 pb-3">
              <table className="w-full min-w-[560px] text-[13px]">
                <tbody>
                  {data.largest.map((l) => (
                    <tr
                      key={l.id}
                      className="cursor-pointer border-b border-border/60 last:border-0 hover:bg-subtle"
                      onClick={() => api.transaction(l.id).then(setOpenTx)}
                    >
                      <td className="num px-3 py-2.5 text-muted-foreground whitespace-nowrap">{date(l.date, false)}</td>
                      <td className="max-w-0 px-3 py-2.5">
                        <div className="truncate font-medium">{l.counterparty ?? l.description}</div>
                        <div className="truncate text-xs text-muted-foreground">
                          {l.shop_name} · {l.bank}
                        </div>
                      </td>
                      <td className="px-3 py-2.5">
                        <CategoryLabel category={l.category} group={l.group} />
                      </td>
                      <td className="px-3 py-2.5">
                        <ReviewBadge status={l.review_status} />
                      </td>
                      <td className="px-3 py-2.5 text-right">
                        <Amount value={l.amount} currency={cur} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
          <Card>
            <div className="px-5 pt-4 pb-2">
              <h3 className="text-[15px] font-semibold">Why items need review</h3>
              <p className="text-[13px] text-muted-foreground">Open items by flag reason</p>
            </div>
            <div className="px-5 pb-4">
              {data.reviewReasons.length ? (
                <ul className="space-y-2">
                  {data.reviewReasons.map((r) => (
                    <li key={r.code + r.severity}>
                      <Link to={`/bank/review?reason=${r.code}`} className="flex items-center justify-between rounded-lg px-2 py-1.5 text-[13px] hover:bg-subtle">
                        <span className="flex items-center gap-2">
                          <span
                            className="size-2 rounded-full"
                            style={{ background: r.severity === 'high' ? 'hsl(var(--destructive))' : r.severity === 'medium' ? 'hsl(var(--warning))' : 'hsl(var(--muted-foreground))' }}
                          />
                          {REASON_LABEL[r.code] ?? r.code}
                          <span className="text-xs text-muted-foreground capitalize">{r.severity}</span>
                        </span>
                        <span className="num font-medium">{count(r.count)}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              ) : (
                <EmptyState icon={<Receipt className="size-5" />} title="All clear" body="Nothing is waiting for review in this view." />
              )}
              {t.pending > 0 && (
                <Link to="/bank/review" className="mt-3 block">
                  <Button variant="primary" className="w-full" icon={<ListChecks className="size-4" />}>
                    Start reviewing {count(t.pending)} items
                  </Button>
                </Link>
              )}
            </div>
          </Card>
        </div>
      </div>
      <TransactionDrawer tx={openTx} onClose={() => setOpenTx(null)} />
    </div>
  );
}
