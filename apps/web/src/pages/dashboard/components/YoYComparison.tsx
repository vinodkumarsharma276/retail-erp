import { useState, useMemo } from 'react';
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  Legend,
} from 'recharts';
import { Loader2, TrendingUp } from 'lucide-react';
import { formatINR } from '@retailerp/shared-utils';
import { DateRangePicker, defaultNext30Days, type DateRange } from '../../../components/DateRangePicker';
import { useYoYComparisonQuery } from '../../../hooks/useDashboard';

interface MergedProduct {
  label: string;
  fullLabel: string;
  categoryName: string;
  lastYear: number;
  thisYear: number;
  lastYearRevenue: number;
  thisYearRevenue: number;
}

export function YoYComparison() {
  const [dateRange, setDateRange] = useState<DateRange>(defaultNext30Days);

  const { data, isLoading } = useYoYComparisonQuery(
    dateRange.dateFrom,
    dateRange.dateTo,
  );

  // Merge last year & this year data by product
  const chartData = useMemo(() => {
    if (!data) return [];

    const productMap = new Map<string, MergedProduct>();

    // Process this year's data — API returns { thisYear: { products: [...] }, lastYear: { products: [...] } }
    const thisYearItems = Array.isArray(data.thisYear) ? data.thisYear : (data.thisYear?.products ?? []);
    const lastYearItems = Array.isArray(data.lastYear) ? data.lastYear : (data.lastYear?.products ?? []);

    for (const item of thisYearItems) {
      const key = item.productId || `${item.brand}-${item.modelNumber}`;
      const existing = productMap.get(key);
      if (existing) {
        existing.thisYear = item.count;
        existing.thisYearRevenue = item.totalRevenue;
      } else {
        productMap.set(key, {
          label: truncate(`${item.brand} ${item.modelNumber}`, 18),
          fullLabel: `${item.brand} ${item.modelNumber}`,
          categoryName: item.categoryName,
          lastYear: 0,
          thisYear: item.count,
          lastYearRevenue: 0,
          thisYearRevenue: item.totalRevenue,
        });
      }
    }

    // Process last year's data
    for (const item of lastYearItems) {
      const key = item.productId || `${item.brand}-${item.modelNumber}`;
      const existing = productMap.get(key);
      if (existing) {
        existing.lastYear = item.count;
        existing.lastYearRevenue = item.totalRevenue;
      } else {
        productMap.set(key, {
          label: truncate(`${item.brand} ${item.modelNumber}`, 18),
          fullLabel: `${item.brand} ${item.modelNumber}`,
          categoryName: item.categoryName,
          lastYear: item.count,
          thisYear: 0,
          lastYearRevenue: item.totalRevenue,
          thisYearRevenue: 0,
        });
      }
    }

    // Sort by combined count and take top 10
    return Array.from(productMap.values())
      .sort((a, b) => b.lastYear + b.thisYear - (a.lastYear + a.thisYear))
      .slice(0, 10);
  }, [data]);

  return (
    <div className="rounded-xl border bg-card p-5 shadow-sm">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between mb-4">
        <div>
          <h3 className="text-base font-semibold">Year-over-Year Comparison</h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            Compare product sales with the same period last year
          </p>
        </div>
        <DateRangePicker value={dateRange} onChange={setDateRange} />
      </div>

      {/* Chart area */}
      <div className="h-[320px]">
        {isLoading ? (
          <div className="flex h-full items-center justify-center">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        ) : chartData.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center text-muted-foreground">
            <TrendingUp className="h-12 w-12 mb-2 opacity-40" />
            <p className="text-sm">No comparison data available</p>
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              data={chartData}
              margin={{ top: 5, right: 10, left: 5, bottom: 5 }}
            >
              <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
              <XAxis
                dataKey="label"
                tick={{ fontSize: 10 }}
                className="text-muted-foreground"
                interval={0}
                angle={-30}
                textAnchor="end"
                height={60}
              />
              <YAxis
                tick={{ fontSize: 11 }}
                className="text-muted-foreground"
                width={40}
              />
              <Tooltip content={<YoYTooltip />} />
              <Legend
                wrapperStyle={{ fontSize: 12 }}
                formatter={(value: string) =>
                  value === 'lastYear' ? 'Last Year' : 'This Year'
                }
              />
              <Bar
                dataKey="lastYear"
                fill="#9ca3af"
                radius={[4, 4, 0, 0]}
                animationDuration={800}
              />
              <Bar
                dataKey="thisYear"
                fill="hsl(var(--primary))"
                radius={[4, 4, 0, 0]}
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
function YoYTooltip({ active, payload }: any) {
  if (!active || !payload?.length) return null;
  const item = payload[0].payload as MergedProduct;

  return (
    <div className="rounded-lg border bg-card px-3 py-2 shadow-md text-sm max-w-[260px]">
      <p className="font-medium">{item.fullLabel}</p>
      <p className="text-xs text-muted-foreground mb-1">{item.categoryName}</p>
      <div className="space-y-0.5">
        <p className="text-muted-foreground">
          <span
            className="inline-block h-2 w-2 rounded-full mr-1.5"
            style={{ backgroundColor: '#9ca3af' }}
          />
          Last Year: <span className="font-semibold text-foreground">{item.lastYear} sold</span>
          {' '}({formatINR(item.lastYearRevenue)})
        </p>
        <p className="text-muted-foreground">
          <span
            className="inline-block h-2 w-2 rounded-full mr-1.5"
            style={{ backgroundColor: 'hsl(var(--primary))' }}
          />
          This Year: <span className="font-semibold text-foreground">{item.thisYear} sold</span>
          {' '}({formatINR(item.thisYearRevenue)})
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
