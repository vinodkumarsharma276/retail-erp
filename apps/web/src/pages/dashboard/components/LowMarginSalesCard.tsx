import { useState } from 'react';
import { Link } from 'react-router-dom';
import { TrendingDown, ExternalLink, ChevronDown } from 'lucide-react';
import { useLowMarginSalesQuery } from '../../../hooks/useDashboard';
import { DateInput } from '../../../components/DateInput';
import {
  formatINR,
  getCurrentFinancialYearRange,
  getLastFinancialYearRange,
} from '@retailerp/shared-utils';
import { cn } from '../../../lib/utils';

const THRESHOLDS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 12, 15, 18, 20];

type RangeMode = 'current_fy' | 'last_fy' | 'custom';

interface CardState {
  threshold: number;
  rangeMode: RangeMode;
  dateFrom: string;
  dateTo: string;
}

function defaultState(): CardState {
  const fy = getCurrentFinancialYearRange();
  return {
    threshold: 5,
    rangeMode: 'current_fy',
    dateFrom: fy.dateFrom,
    dateTo: fy.dateTo,
  };
}

/**
 * Dashboard tile: count + total profit of sales whose net-profit % is at
 * most the selected threshold for the chosen date range. Clicking the link
 * icon takes the user to the Sales list page with the same filters applied.
 */
export function LowMarginSalesCard() {
  const [state, setState] = useState<CardState>(defaultState);
  const { data, isLoading, isError } = useLowMarginSalesQuery(
    state.threshold,
    state.dateFrom,
    state.dateTo,
  );

  const setRange = (mode: RangeMode) => {
    if (mode === 'current_fy') {
      const fy = getCurrentFinancialYearRange();
      setState((s) => ({ ...s, rangeMode: mode, dateFrom: fy.dateFrom, dateTo: fy.dateTo }));
    } else if (mode === 'last_fy') {
      const fy = getLastFinancialYearRange();
      setState((s) => ({ ...s, rangeMode: mode, dateFrom: fy.dateFrom, dateTo: fy.dateTo }));
    } else {
      setState((s) => ({ ...s, rangeMode: 'custom' }));
    }
  };

  const linkParams = new URLSearchParams();
  linkParams.set('maxProfitPct', String(state.threshold));
  if (state.dateFrom) linkParams.set('dateFrom', state.dateFrom);
  if (state.dateTo) linkParams.set('dateTo', state.dateTo);

  return (
    <div className="rounded-xl border bg-card p-5 shadow-sm">
      <div className="flex items-start justify-between mb-3 gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <div className="h-9 w-9 rounded-lg bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center shrink-0">
            <TrendingDown className="h-5 w-5 text-amber-700 dark:text-amber-400" />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-medium truncate">Low Margin Sales</p>
            <p className="text-xs text-muted-foreground truncate">
              Net profit % ≤ {state.threshold}%
            </p>
          </div>
        </div>
        <Link
          to={`/sales?${linkParams.toString()}`}
          title="Open in Sales list"
          className="shrink-0 rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
        >
          <ExternalLink className="h-4 w-4" />
        </Link>
      </div>

      <div className="flex items-center gap-2 mb-3">
        {/* Threshold selector */}
        <div className="relative">
          <select
            value={state.threshold}
            onChange={(e) => setState((s) => ({ ...s, threshold: Number(e.target.value) }))}
            className={cn(
              'appearance-none rounded-md border bg-background pl-2 pr-7 py-1 text-xs font-medium',
              'focus:outline-none focus:ring-2 focus:ring-ring',
            )}
          >
            {THRESHOLDS.map((t) => (
              <option key={t} value={t}>
                ≤ {t}%
              </option>
            ))}
          </select>
          <ChevronDown className="pointer-events-none absolute right-1.5 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground" />
        </div>
        {/* Range mode */}
        <div className="relative">
          <select
            value={state.rangeMode}
            onChange={(e) => setRange(e.target.value as RangeMode)}
            className={cn(
              'appearance-none rounded-md border bg-background pl-2 pr-7 py-1 text-xs',
              'focus:outline-none focus:ring-2 focus:ring-ring',
            )}
          >
            <option value="current_fy">Current FY</option>
            <option value="last_fy">Last FY</option>
            <option value="custom">Custom range</option>
          </select>
          <ChevronDown className="pointer-events-none absolute right-1.5 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground" />
        </div>
      </div>

      {state.rangeMode === 'custom' && (
        <div className="flex items-center gap-2 mb-3">
          <DateInput
            value={state.dateFrom}
            onChange={(v) => setState((s) => ({ ...s, dateFrom: v }))}
            className="w-36"
          />
          <span className="text-xs text-muted-foreground">to</span>
          <DateInput
            value={state.dateTo}
            onChange={(v) => setState((s) => ({ ...s, dateTo: v }))}
            className="w-36"
          />
        </div>
      )}

      <div className="mt-2">
        {isLoading ? (
          <div className="h-9 w-20 skeleton rounded" />
        ) : isError ? (
          <p className="text-sm text-destructive">Failed to load.</p>
        ) : (
          <>
            <p className="text-2xl font-bold">{data?.count ?? 0}</p>
            <p className="text-xs text-muted-foreground">
              Total profit:{' '}
              <span
                className={cn(
                  'font-medium',
                  (data?.totalProfit ?? 0) < 0 ? 'text-destructive' : 'text-foreground',
                )}
              >
                {formatINR(data?.totalProfit ?? 0)}
              </span>
              {' · '}
              Total revenue:{' '}
              <span className="font-medium text-foreground">
                {formatINR(data?.totalAmount ?? 0)}
              </span>
            </p>
          </>
        )}
      </div>
    </div>
  );
}
