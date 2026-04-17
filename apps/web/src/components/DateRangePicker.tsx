import { cn } from '../lib/utils';

export interface DateRange {
  dateFrom: string;
  dateTo: string;
}

interface DateRangePickerProps {
  value: DateRange;
  onChange: (range: DateRange) => void;
  className?: string;
}

function todayISO(): string {
  return new Date().toISOString().split('T')[0];
}

function daysAgoISO(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().split('T')[0];
}

function monthStartISO(): string {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().split('T')[0];
}

const presets: { label: string; getRange: () => DateRange }[] = [
  { label: '7 Days', getRange: () => ({ dateFrom: daysAgoISO(7), dateTo: todayISO() }) },
  { label: '30 Days', getRange: () => ({ dateFrom: daysAgoISO(30), dateTo: todayISO() }) },
  { label: '90 Days', getRange: () => ({ dateFrom: daysAgoISO(90), dateTo: todayISO() }) },
  { label: 'This Month', getRange: () => ({ dateFrom: monthStartISO(), dateTo: todayISO() }) },
];

export function DateRangePicker({ value, onChange, className }: DateRangePickerProps) {
  return (
    <div className={cn('flex flex-wrap items-center gap-2', className)}>
      {/* Preset buttons */}
      <div className="flex gap-1">
        {presets.map((preset) => {
          const range = preset.getRange();
          const isActive =
            value.dateFrom === range.dateFrom && value.dateTo === range.dateTo;
          return (
            <button
              key={preset.label}
              onClick={() => onChange(preset.getRange())}
              className={cn(
                'rounded-md px-2.5 py-1 text-xs font-medium transition-colors',
                isActive
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-muted text-muted-foreground hover:bg-muted/80',
              )}
            >
              {preset.label}
            </button>
          );
        })}
      </div>

      {/* Custom date inputs */}
      <div className="flex items-center gap-1.5">
        <input
          type="date"
          value={value.dateFrom}
          onChange={(e) => onChange({ ...value, dateFrom: e.target.value })}
          className={cn(
            'rounded-md border bg-background px-2 py-1 text-xs',
            'focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-1',
          )}
        />
        <span className="text-xs text-muted-foreground">to</span>
        <input
          type="date"
          value={value.dateTo}
          onChange={(e) => onChange({ ...value, dateTo: e.target.value })}
          className={cn(
            'rounded-md border bg-background px-2 py-1 text-xs',
            'focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-1',
          )}
        />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Utility: default date range helpers for external consumers
// ---------------------------------------------------------------------------
export function defaultLast30Days(): DateRange {
  return { dateFrom: daysAgoISO(30), dateTo: todayISO() };
}

export function defaultLastWeek(): DateRange {
  return { dateFrom: daysAgoISO(7), dateTo: todayISO() };
}

export function defaultNext30Days(): DateRange {
  const today = todayISO();
  const d = new Date();
  d.setDate(d.getDate() + 30);
  return { dateFrom: today, dateTo: d.toISOString().split('T')[0] };
}
