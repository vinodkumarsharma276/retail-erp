import { useState } from 'react';
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from 'recharts';
import { BarChart3, LineChart as LineChartIcon, Loader2 } from 'lucide-react';
import { cn } from '../../../lib/utils';
import { formatINR, formatDateIN } from '@retailerp/shared-utils';
import { DateRangePicker, defaultLast30Days, type DateRange } from '../../../components/DateRangePicker';
import { useSalesGraphQuery, type SalesGraphPoint } from '../../../hooks/useDashboard';

type ChartMode = 'bar' | 'line';

export function SalesChart() {
  const [chartMode, setChartMode] = useState<ChartMode>('bar');
  const [dateRange, setDateRange] = useState<DateRange>(defaultLast30Days);

  const { data, isLoading } = useSalesGraphQuery(dateRange.dateFrom, dateRange.dateTo);

  // Format x-axis date label as DD/MM
  const formatXDate = (dateStr: string) => {
    const d = new Date(dateStr);
    return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`;
  };

  // Format y-axis amount (shortened)
  const formatYAmount = (val: number) => {
    if (val >= 100_000) return `${(val / 100_000).toFixed(1)}L`;
    if (val >= 1_000) return `${(val / 1_000).toFixed(0)}K`;
    return String(val);
  };

  return (
    <div className="rounded-xl border bg-card p-5 shadow-sm">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between mb-4">
        <h3 className="text-base font-semibold">Sales Trend</h3>
        <div className="flex items-center gap-3">
          {/* Chart mode toggle */}
          <div className="flex rounded-lg bg-muted p-0.5">
            <button
              onClick={() => setChartMode('bar')}
              className={cn(
                'rounded-md p-1.5 transition-colors',
                chartMode === 'bar'
                  ? 'bg-background text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground',
              )}
              title="Bar chart"
            >
              <BarChart3 className="h-4 w-4" />
            </button>
            <button
              onClick={() => setChartMode('line')}
              className={cn(
                'rounded-md p-1.5 transition-colors',
                chartMode === 'line'
                  ? 'bg-background text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground',
              )}
              title="Line chart"
            >
              <LineChartIcon className="h-4 w-4" />
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
        ) : !data || data.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center text-muted-foreground">
            <BarChart3 className="h-12 w-12 mb-2 opacity-40" />
            <p className="text-sm">No sales data for this period</p>
          </div>
        ) : chartMode === 'bar' ? (
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} margin={{ top: 5, right: 5, left: 5, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
              <XAxis
                dataKey="date"
                tickFormatter={formatXDate}
                tick={{ fontSize: 11 }}
                className="text-muted-foreground"
              />
              <YAxis
                tickFormatter={formatYAmount}
                tick={{ fontSize: 11 }}
                className="text-muted-foreground"
                width={50}
              />
              <Tooltip content={<SalesChartTooltip />} />
              <Bar
                dataKey="totalAmount"
                fill="hsl(var(--primary))"
                radius={[4, 4, 0, 0]}
                animationDuration={800}
              />
            </BarChart>
          </ResponsiveContainer>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data} margin={{ top: 5, right: 5, left: 5, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
              <XAxis
                dataKey="date"
                tickFormatter={formatXDate}
                tick={{ fontSize: 11 }}
                className="text-muted-foreground"
              />
              <YAxis
                tickFormatter={formatYAmount}
                tick={{ fontSize: 11 }}
                className="text-muted-foreground"
                width={50}
              />
              <Tooltip content={<SalesChartTooltip />} />
              <Line
                type="monotone"
                dataKey="totalAmount"
                stroke="hsl(var(--primary))"
                strokeWidth={2}
                dot={{ r: 3, fill: 'hsl(var(--primary))' }}
                activeDot={{ r: 5 }}
                animationDuration={800}
              />
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Custom tooltip
// ---------------------------------------------------------------------------
function SalesChartTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  const point = payload[0].payload as SalesGraphPoint;

  return (
    <div className="rounded-lg border bg-card px-3 py-2 shadow-md text-sm">
      <p className="font-medium">{formatDateIN(point.date)}</p>
      <p className="text-muted-foreground mt-1">
        Amount: <span className="font-semibold text-foreground">{formatINR(point.totalAmount)}</span>
      </p>
      <p className="text-muted-foreground">
        Sales: <span className="font-semibold text-foreground">{point.count}</span>
      </p>
    </div>
  );
}
