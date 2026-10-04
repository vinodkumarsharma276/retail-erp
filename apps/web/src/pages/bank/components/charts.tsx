import clsx from 'clsx';
import { BarChart3, Table2 } from 'lucide-react';
import { useMemo, useState, type ReactNode } from 'react';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  type TooltipProps,
} from 'recharts';
import type { NameType, ValueType } from 'recharts/types/component/DefaultTooltipContent';
import { FLOW } from '../lib/colors';
import { compactMoney, compactNumber, count, date, money, month, pct } from '../lib/format';
import { Dot } from './domain';
import { Card, CardHeader } from './ui';

// ---------------------------------------------------------------- shell

/** A chart card with a Chart ⇄ Table toggle — every chart has an accessible table view. */
export function ChartCard({
  title,
  subtitle,
  chart,
  table,
  actions,
  className,
  legend,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  chart: ReactNode;
  table?: ReactNode;
  actions?: ReactNode;
  className?: string;
  legend?: ReactNode;
}) {
  const [view, setView] = useState<'chart' | 'table'>('chart');
  return (
    <Card className={clsx('flex flex-col', className)}>
      <CardHeader
        title={title}
        subtitle={subtitle}
        actions={
          <>
            {actions}
            {table && (
              <button
                onClick={() => setView(view === 'chart' ? 'table' : 'chart')}
                className="grid size-8 place-items-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground cursor-pointer"
                aria-label={view === 'chart' ? 'Show as table' : 'Show as chart'}
                title={view === 'chart' ? 'Show as table' : 'Show as chart'}
              >
                {view === 'chart' ? <Table2 className="size-4" /> : <BarChart3 className="size-4" />}
              </button>
            )}
          </>
        }
      />
      {legend && view === 'chart' && <div className="px-5 pb-1">{legend}</div>}
      <div className="flex-1 px-5 pb-4">{view === 'chart' ? chart : <div className="scroll-thin max-h-80 overflow-auto">{table}</div>}</div>
    </Card>
  );
}

export function Legend({ items }: { items: { label: string; color: string }[] }) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-foreground/80">
      {items.map((i) => (
        <span key={i.label} className="inline-flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: i.color }} />
          {i.label}
        </span>
      ))}
    </div>
  );
}

export function DataTable({ head, rows, align }: { head: string[]; rows: ReactNode[][]; align?: ('left' | 'right')[] }) {
  return (
    <table className="w-full text-[13px]">
      <thead>
        <tr className="border-b border-border text-muted-foreground">
          {head.map((h, i) => (
            <th key={h} className={clsx('py-1.5 font-medium', align?.[i] === 'right' ? 'text-right' : 'text-left')}>
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={i} className="border-b border-border/60 last:border-0">
            {r.map((c, j) => (
              <td key={j} className={clsx('num py-1.5', align?.[j] === 'right' ? 'text-right' : 'text-left')}>
                {c}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// ---------------------------------------------------------------- tooltip
function TipShell({ title, rows }: { title: ReactNode; rows: { label: string; value: string; color?: string }[] }) {
  return (
    <div className="min-w-44 rounded-lg border border-border bg-card px-3 py-2 text-xs shadow-xl">
      <div className="mb-1 font-semibold text-foreground">{title}</div>
      {rows.map((r) => (
        <div key={r.label} className="flex items-center justify-between gap-4 py-0.5">
          <span className="inline-flex items-center gap-1.5 text-foreground/80">
            {r.color && <Dot color={r.color} />}
            {r.label}
          </span>
          <span className="num font-medium text-foreground">{r.value}</span>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------- cash flow
export function CashflowChart({ data, currency }: { data: { month: string; inflow: number; outflow: number }[]; currency: string }) {
  const tip = ({ active, payload, label }: TooltipProps<ValueType, NameType>) => {
    if (!active || !payload?.length) return null;
    const p = payload[0].payload as { inflow: number; outflow: number };
    return (
      <TipShell
        title={month(String(label))}
        rows={[
          { label: 'Money in', value: money(p.inflow, currency, 0), color: FLOW.inflow },
          { label: 'Money out', value: money(p.outflow, currency, 0), color: FLOW.outflow },
          { label: 'Net', value: money(p.inflow - p.outflow, currency, 0) },
        ]}
      />
    );
  };
  return (
    <div className="h-72">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} barGap={2} barCategoryGap="28%" margin={{ top: 8, right: 4, left: 0, bottom: 0 }}>
          <CartesianGrid vertical={false} />
          <XAxis dataKey="month" tickFormatter={month} tickLine={false} axisLine={{ stroke: 'hsl(var(--border-strong))' }} />
          <YAxis tickFormatter={(v) => compactNumber(v, currency)} tickLine={false} axisLine={false} width={48} />
          <Tooltip content={tip} cursor={{ fill: 'hsl(var(--muted))', opacity: 0.6 }} />
          <Bar dataKey="inflow" name="Money in" fill={FLOW.inflow} radius={[4, 4, 0, 0]} maxBarSize={24} />
          <Bar dataKey="outflow" name="Money out" fill={FLOW.outflow} radius={[4, 4, 0, 0]} maxBarSize={24} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

// ---------------------------------------------------------------- net position trend
export function NetTrendChart({ daily, currency }: { daily: { date: string; inflow: number; outflow: number }[]; currency: string }) {
  const data = useMemo(() => {
    let run = 0;
    return daily.map((d) => ({ date: d.date, net: (run += d.inflow - d.outflow), dayNet: d.inflow - d.outflow }));
  }, [daily]);
  const last = data[data.length - 1]?.net ?? 0;
  const tip = ({ active, payload }: TooltipProps<ValueType, NameType>) => {
    if (!active || !payload?.length) return null;
    const p = payload[0].payload as { date: string; net: number; dayNet: number };
    return (
      <TipShell
        title={date(p.date)}
        rows={[
          { label: 'Cumulative net', value: money(p.net, currency, 0), color: 'var(--chart-1)' },
          { label: 'That day', value: money(p.dayNet, currency, 0) },
        ]}
      />
    );
  };
  return (
    <div className="relative h-72">
      <div className="absolute top-0 right-1 z-10 text-right text-xs text-muted-foreground">
        Net to date
        <div className="num text-sm font-semibold text-foreground">{money(last, currency, 0)}</div>
      </div>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 8, right: 4, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id="netFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--chart-1)" stopOpacity={0.14} />
              <stop offset="100%" stopColor="var(--chart-1)" stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <CartesianGrid vertical={false} />
          <XAxis dataKey="date" tickFormatter={(d) => date(d, false)} tickLine={false} axisLine={{ stroke: 'hsl(var(--border-strong))' }} minTickGap={40} />
          <YAxis tickFormatter={(v) => compactNumber(v, currency)} tickLine={false} axisLine={false} width={48} />
          <Tooltip content={tip} cursor={{ stroke: 'hsl(var(--border-strong))' }} />
          <Area
            type="monotone"
            dataKey="net"
            stroke="var(--chart-1)"
            strokeWidth={2}
            fill="url(#netFill)"
            activeDot={{ r: 5, stroke: 'hsl(var(--card))', strokeWidth: 2, fill: 'var(--chart-1)' }}
            dot={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

// ---------------------------------------------------------------- donut
export interface Slice {
  key: string;
  label: string;
  value: number;
  color: string;
  count?: number;
}

export function Donut({ data, currency, centerLabel, onSelect }: { data: Slice[]; currency: string; centerLabel: string; onSelect?: (s: Slice) => void }) {
  const [hover, setHover] = useState<number | null>(null);
  const total = data.reduce((a, b) => a + b.value, 0);
  const active = hover != null ? data[hover] : null;
  if (!total) return <div className="grid h-56 place-items-center text-sm text-muted-foreground">No data for this period</div>;
  return (
    <div className="flex flex-col items-center gap-4 sm:flex-row sm:items-center">
      <div className="relative size-52 shrink-0">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={data}
              dataKey="value"
              nameKey="label"
              innerRadius="64%"
              outerRadius="96%"
              stroke="hsl(var(--card))"
              strokeWidth={2}
              startAngle={90}
              endAngle={-270}
              isAnimationActive={false}
              onMouseEnter={(_, i) => setHover(i)}
              onMouseLeave={() => setHover(null)}
              onClick={(_, i) => onSelect?.(data[i])}
              style={{ cursor: onSelect ? 'pointer' : 'default' }}
            >
              {data.map((s, i) => (
                <Cell key={s.key} fill={s.color} opacity={hover == null || hover === i ? 1 : 0.35} />
              ))}
            </Pie>
          </PieChart>
        </ResponsiveContainer>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
          <span className="max-w-28 truncate text-xs text-muted-foreground">{active ? active.label : centerLabel}</span>
          <span className="text-lg font-semibold">{compactMoney(active ? active.value : total, currency)}</span>
          {active && <span className="text-xs text-muted-foreground">{pct(active.value / total, 1)}</span>}
        </div>
      </div>
      <ul className="w-full min-w-0 flex-1 space-y-0.5">
        {data.map((s, i) => (
          <li key={s.key}>
            <button
              onMouseEnter={() => setHover(i)}
              onMouseLeave={() => setHover(null)}
              onFocus={() => setHover(i)}
              onBlur={() => setHover(null)}
              onClick={() => onSelect?.(s)}
              className={clsx(
                'flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-[13px] cursor-pointer',
                hover === i ? 'bg-muted' : 'hover:bg-subtle',
              )}
            >
              <span className="inline-block h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: s.color }} />
              <span className="min-w-0 flex-1 truncate text-foreground">{s.label}</span>
              <span className="num text-muted-foreground">{pct(s.value / total)}</span>
              <span className="num w-20 text-right font-medium text-foreground">{compactMoney(s.value, currency)}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function sliceTable(data: Slice[], currency: string) {
  const total = data.reduce((a, b) => a + b.value, 0);
  return (
    <DataTable
      head={['Name', 'Transactions', 'Share', 'Amount']}
      align={['left', 'right', 'right', 'right']}
      rows={data.map((s) => [s.label, s.count != null ? count(s.count) : '—', pct(total ? s.value / total : 0, 1), money(s.value, currency, 0)])}
    />
  );
}

// ---------------------------------------------------------------- ranked bars (HTML — crisp labels, easy hover)
export function RankedBars({
  items,
  currency,
  onSelect,
}: {
  items: { key: string; label: ReactNode; value: number; color: string; meta?: ReactNode; title?: string }[];
  currency: string;
  onSelect?: (key: string) => void;
}) {
  const max = Math.max(...items.map((i) => i.value), 1);
  if (!items.length) return <div className="grid h-40 place-items-center text-sm text-muted-foreground">No data for this period</div>;
  return (
    <ul className="space-y-2.5">
      {items.map((i) => (
        <li key={i.key}>
          <button
            className={clsx('group block w-full text-left', onSelect && 'cursor-pointer')}
            onClick={() => onSelect?.(i.key)}
            title={i.title}
          >
            <div className="mb-1 flex items-baseline justify-between gap-3 text-[13px]">
              <span className="min-w-0 truncate text-foreground group-hover:underline">{i.label}</span>
              <span className="num shrink-0 font-medium text-foreground">
                {money(i.value, currency, 0)}
                {i.meta && <span className="ml-2 font-normal text-muted-foreground">{i.meta}</span>}
              </span>
            </div>
            <div className="h-2 w-full rounded-full bg-muted">
              <div className="h-2 rounded-full transition-[width] duration-500" style={{ width: `${Math.max(1.5, (i.value / max) * 100)}%`, background: i.color }} />
            </div>
          </button>
        </li>
      ))}
    </ul>
  );
}

// ---------------------------------------------------------------- paired bars (in vs out per entity)
export function PairedBars({ rows, currency }: { rows: { key: string; label: string; inflow: number; outflow: number; meta?: ReactNode }[]; currency: string }) {
  const max = Math.max(...rows.flatMap((r) => [r.inflow, r.outflow]), 1);
  return (
    <ul className="space-y-4">
      {rows.map((r) => (
        <li key={r.key}>
          <div className="mb-1.5 flex items-baseline justify-between gap-2 text-[13px]">
            <span className="font-medium text-foreground">{r.label}</span>
            <span className="text-xs text-muted-foreground">{r.meta}</span>
          </div>
          {(['inflow', 'outflow'] as const).map((k) => (
            <div key={k} className="mb-1 flex items-center gap-2" title={`${k === 'inflow' ? 'Money in' : 'Money out'}: ${money(r[k], currency, 0)}`}>
              <div className="h-2.5 flex-1 rounded-full bg-muted">
                <div className="h-2.5 rounded-full" style={{ width: `${Math.max(1, (r[k] / max) * 100)}%`, background: FLOW[k] }} />
              </div>
              <span className="num w-20 text-right text-xs text-foreground/80">{compactMoney(r[k], currency)}</span>
            </div>
          ))}
        </li>
      ))}
    </ul>
  );
}

// ---------------------------------------------------------------- weekday columns
export function WeekdayChart({ data, currency }: { data: { day: string; inflow: number; outflow: number; count: number }[]; currency: string }) {
  const tip = ({ active, payload, label }: TooltipProps<ValueType, NameType>) => {
    if (!active || !payload?.length) return null;
    const p = payload[0].payload as { inflow: number; outflow: number; count: number };
    return (
      <TipShell
        title={String(label)}
        rows={[
          { label: 'Money in', value: money(p.inflow, currency, 0), color: FLOW.inflow },
          { label: 'Money out', value: money(p.outflow, currency, 0), color: FLOW.outflow },
          { label: 'Transactions', value: count(p.count) },
        ]}
      />
    );
  };
  return (
    <div className="h-56">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} barGap={2} barCategoryGap="30%" margin={{ top: 8, right: 4, left: 0, bottom: 0 }}>
          <CartesianGrid vertical={false} />
          <XAxis dataKey="day" tickLine={false} axisLine={{ stroke: 'hsl(var(--border-strong))' }} />
          <YAxis tickFormatter={(v) => compactNumber(v, currency)} tickLine={false} axisLine={false} width={48} />
          <Tooltip content={tip} cursor={{ fill: 'hsl(var(--muted))', opacity: 0.6 }} />
          <Bar dataKey="inflow" fill={FLOW.inflow} radius={[4, 4, 0, 0]} maxBarSize={20} />
          <Bar dataKey="outflow" fill={FLOW.outflow} radius={[4, 4, 0, 0]} maxBarSize={20} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
