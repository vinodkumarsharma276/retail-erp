import { useState } from 'react';
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from 'recharts';
import { Loader2, ShoppingBag } from 'lucide-react';
import { cn } from '../../../lib/utils';
import { formatINR } from '@retailerp/shared-utils';
import { DateRangePicker, defaultLast30Days, type DateRange } from '../../../components/DateRangePicker';
import { useTopProductsQuery, type TopProductItem } from '../../../hooks/useDashboard';

type Metric = 'count' | 'totalRevenue';

export function TopProductsChart() {
  const [dateRange, setDateRange] = useState<DateRange>(defaultLast30Days);
  const [metric, setMetric] = useState<Metric>('count');

  const { data, isLoading } = useTopProductsQuery(
    dateRange.dateFrom,
    dateRange.dateTo,
    10,
  );

  // Build chart data with truncated labels
  const chartData = (data ?? []).map((item) => ({
    ...item,
    label: truncate(`${item.brand} ${item.modelNumber}`, 20),
    fullLabel: `${item.brand} ${item.modelNumber}`,
  }));

  return (
    <div className="rounded-xl border bg-card p-5 shadow-sm">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between mb-4">
        <h3 className="text-base font-semibold">Top 10 Products</h3>
        <div className="flex items-center gap-3">
          {/* Metric toggle */}
          <div className="flex rounded-lg bg-muted p-0.5">
            <button
              onClick={() => setMetric('count')}
              className={cn(
                'rounded-md px-2.5 py-1 text-xs font-medium transition-colors',
                metric === 'count'
                  ? 'bg-background text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              Quantity
            </button>
            <button
              onClick={() => setMetric('totalRevenue')}
              className={cn(
                'rounded-md px-2.5 py-1 text-xs font-medium transition-colors',
                metric === 'totalRevenue'
                  ? 'bg-background text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              Revenue
            </button>
          </div>
          <DateRangePicker value={dateRange} onChange={setDateRange} />
        </div>
      </div>

      {/* Chart area */}
      <div className="h-[300px]">
        {isLoading ? (
          <div className="flex h-full items-center justify-center">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        ) : chartData.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center text-muted-foreground">
            <ShoppingBag className="h-12 w-12 mb-2 opacity-40" />
            <p className="text-sm">No product sales data for this period</p>
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              data={chartData}
              layout="vertical"
              margin={{ top: 5, right: 20, left: 5, bottom: 5 }}
            >
              <CartesianGrid strokeDasharray="3 3" className="stroke-muted" horizontal={false} />
              <XAxis
                type="number"
                tickFormatter={metric === 'totalRevenue' ? formatShortAmount : undefined}
                tick={{ fontSize: 11 }}
                className="text-muted-foreground"
              />
              <YAxis
                type="category"
                dataKey="label"
                width={130}
                tick={{ fontSize: 11 }}
                className="text-muted-foreground"
              />
              <Tooltip content={<TopProductTooltip metric={metric} />} />
              <Bar
                dataKey={metric}
                fill="hsl(var(--primary))"
                radius={[0, 4, 4, 0]}
                animationDuration={800}
              />
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Custom tooltip
// ---------------------------------------------------------------------------
function TopProductTooltip({ active, payload }: any) {
  if (!active || !payload?.length) return null;
  const item = payload[0].payload as TopProductItem & { fullLabel: string };

  return (
    <div className="rounded-lg border bg-card px-3 py-2 shadow-md text-sm max-w-[240px]">
      <p className="font-medium">{item.fullLabel}</p>
      <p className="text-xs text-muted-foreground">{item.categoryName}</p>
      <div className="mt-1 space-y-0.5">
        <p className="text-muted-foreground">
          Quantity: <span className="font-semibold text-foreground">{item.count}</span>
        </p>
        <p className="text-muted-foreground">
          Revenue: <span className="font-semibold text-foreground">{formatINR(item.totalRevenue)}</span>
        </p>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function truncate(str: string, max: number): string {
  return str.length > max ? `${str.slice(0, max)}...` : str;
}

function formatShortAmount(val: number): string {
  if (val >= 100_000) return `${(val / 100_000).toFixed(1)}L`;
  if (val >= 1_000) return `${(val / 1_000).toFixed(0)}K`;
  return String(val);
}
