import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { isAllShops, useShopStore } from '../../../stores/shop-store';
import { useMeta } from './queries';

/** Safe localStorage access — storage can be blocked (private mode, policies). */
export function readLocal<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}
export function writeLocal(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* ignore */
  }
}

export type DatePreset = 'all' | 'this-month' | 'last-month' | '3m' | '6m' | 'fy' | 'custom';

export interface GlobalFilters {
  /** Narrows the header shop scope in "All Shops" mode; empty = every accessible shop. */
  shopIds: string[];
  preset: DatePreset;
  from?: string;
  to?: string;
}

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

export function presetRange(preset: DatePreset, custom?: { from?: string; to?: string }): { from?: string; to?: string } {
  const now = new Date();
  switch (preset) {
    case 'this-month':
      return { from: iso(new Date(now.getFullYear(), now.getMonth(), 1)), to: iso(now) };
    case 'last-month':
      return { from: iso(new Date(now.getFullYear(), now.getMonth() - 1, 1)), to: iso(new Date(now.getFullYear(), now.getMonth(), 0)) };
    case '3m':
      return { from: iso(new Date(now.getFullYear(), now.getMonth() - 2, 1)), to: iso(now) };
    case '6m':
      return { from: iso(new Date(now.getFullYear(), now.getMonth() - 5, 1)), to: iso(now) };
    case 'fy': {
      // Indian financial year: 1 Apr – 31 Mar
      const startYear = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
      return { from: `${startYear}-04-01`, to: `${startYear + 1}-03-31` };
    }
    case 'custom':
      return { from: custom?.from, to: custom?.to };
    default:
      return {};
  }
}

export const PRESET_LABEL: Record<DatePreset, string> = {
  all: 'All time',
  'this-month': 'This month',
  'last-month': 'Last month',
  '3m': 'Last 3 months',
  '6m': 'Last 6 months',
  fy: 'This financial year',
  custom: 'Custom range',
};

interface Ctx {
  filters: GlobalFilters;
  setFilters: (f: Partial<GlobalFilters>) => void;
  range: { from?: string; to?: string };
}

const GlobalCtx = createContext<Ctx | null>(null);

/** Bank-statement section filters (date range + shop narrowing), remembered per browser. */
export function GlobalProvider({ children }: { children: ReactNode }) {
  const [filters, setState] = useState<GlobalFilters>(() => readLocal('bank.filters', { shopIds: [], preset: 'all' as DatePreset }));

  const setFilters = useCallback((f: Partial<GlobalFilters>) => {
    setState((prev) => {
      const next = { ...prev, ...f };
      writeLocal('bank.filters', next);
      return next;
    });
  }, []);

  const range = useMemo(() => presetRange(filters.preset, filters), [filters]);
  const value = useMemo(() => ({ filters, setFilters, range }), [filters, setFilters, range]);
  return <GlobalCtx.Provider value={value}>{children}</GlobalCtx.Provider>;
}

export function useGlobal() {
  const ctx = useContext(GlobalCtx);
  if (!ctx) throw new Error('useGlobal outside provider');
  return ctx;
}

/**
 * Filters every data view should apply (shop + date range). Shop narrowing only
 * applies in the header's "All Shops" mode, and only to shops still accessible —
 * otherwise a stale selection could hide everything after a shop switch.
 */
export function useScope() {
  const { filters, range } = useGlobal();
  const allShops = isAllShops(useShopStore((s) => s.currentShopId));
  const { data: meta } = useMeta();
  const shopIds = useMemo(() => {
    if (!allShops) return [];
    if (!meta) return filters.shopIds;
    return filters.shopIds.filter((id) => meta.shops.some((s) => s.id === id));
  }, [allShops, meta, filters.shopIds]);
  return useMemo(() => ({ shopIds, from: range.from, to: range.to }), [shopIds, range]);
}
