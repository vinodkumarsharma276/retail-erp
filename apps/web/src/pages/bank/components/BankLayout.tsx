import clsx from 'clsx';
import { Calendar, Check, ChevronDown, Store } from 'lucide-react';
import { Suspense, useEffect, useRef, useState, type ReactNode } from 'react';
import { Outlet } from 'react-router-dom';
import { PageHeader as AppPageHeader } from '../../../components/PageHeader';
import { isAllShops, useShopStore } from '../../../stores/shop-store';
import { SHOP_COLOR } from '../lib/colors';
import { useMeta } from '../lib/queries';
import { GlobalProvider, PRESET_LABEL, useGlobal, type DatePreset } from '../lib/store';
import { Input, Skeleton } from './ui';
import { useEscapeKey } from '../../../hooks/useEscapeKey';

function initials(name: string) {
  return name
    .split(/\s+/)
    .filter((w) => /^[A-Za-z]/.test(w))
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join('');
}

export function ShopAvatar({ name, index, size = 22 }: { name: string; index: number; size?: number }) {
  return (
    <span
      aria-hidden
      className="grid shrink-0 place-items-center rounded-md font-semibold text-white"
      style={{ width: size, height: size, background: SHOP_COLOR(Math.max(0, index)), fontSize: size * 0.42 }}
    >
      {initials(name)}
    </span>
  );
}

function usePopover() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);
  useEscapeKey(open, () => setOpen(false));
  return { open, setOpen, ref };
}

function TriggerButton({ children, onClick, open }: { children: ReactNode; onClick: () => void; open: boolean }) {
  return (
    <button
      onClick={onClick}
      aria-expanded={open}
      className="flex h-9 items-center gap-2 rounded-lg border border-border bg-card px-3 text-[13px] font-medium shadow-xs hover:bg-subtle cursor-pointer"
    >
      {children}
      <ChevronDown className="size-3.5 text-muted-foreground" />
    </button>
  );
}

/**
 * Only shown in the header's "All Shops" mode: focus one shop or tick several
 * to combine them. In single-shop mode the header switcher already scopes data.
 */
function ShopPicker() {
  const { data: meta } = useMeta();
  const { filters, setFilters } = useGlobal();
  const { open, setOpen, ref } = usePopover();
  const shops = meta?.shops ?? [];
  const selected = filters.shopIds.filter((id) => shops.some((s) => s.id === id));
  const label =
    selected.length === 0 ? 'All shops' : selected.length === 1 ? (shops.find((s) => s.id === selected[0])?.name ?? '1 shop') : `${selected.length} shops`;

  const toggle = (id: string) => {
    const next = selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id];
    setFilters({ shopIds: next.length === shops.length ? [] : next });
  };

  return (
    <div className="relative" ref={ref}>
      <TriggerButton open={open} onClick={() => setOpen(!open)}>
        {selected.length === 1 ? (
          <ShopAvatar name={label} index={shops.findIndex((s) => s.id === selected[0])} size={20} />
        ) : (
          <Store className="size-4 text-muted-foreground" />
        )}
        <span className="max-w-44 truncate">{label}</span>
      </TriggerButton>
      {open && (
        <div className="absolute left-0 z-dropdown mt-1.5 w-72 rounded-xl border border-border bg-popover p-1.5 shadow-lg">
          <button
            onClick={() => {
              setFilters({ shopIds: [] });
              setOpen(false);
            }}
            className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[13px] hover:bg-subtle cursor-pointer"
          >
            <Store className="size-4 text-muted-foreground" />
            <span className="flex-1 font-medium">All shops</span>
            {selected.length === 0 && <Check className="size-4 text-primary" strokeWidth={3} />}
          </button>
          <div className="my-1 h-px bg-border" />
          {shops.map((s, i) => (
            <div key={s.id} className="flex items-center rounded-lg hover:bg-subtle">
              <button
                onClick={() => {
                  setFilters({ shopIds: [s.id] });
                  setOpen(false);
                }}
                className="flex flex-1 items-center gap-2.5 px-2.5 py-2 text-left text-[13px] cursor-pointer"
              >
                <ShopAvatar name={s.name} index={i} />
                <span className="flex-1">{s.name}</span>
              </button>
              <label className="grid size-9 place-items-center cursor-pointer" title="Include in comparison">
                <input type="checkbox" className="size-4 accent-primary" checked={selected.includes(s.id)} onChange={() => toggle(s.id)} />
              </label>
            </div>
          ))}
          <p className="px-2.5 pt-1.5 pb-1 text-[11px] text-muted-foreground">Click a name to focus one shop · tick boxes to combine several.</p>
        </div>
      )}
    </div>
  );
}

function DatePicker() {
  const { filters, setFilters } = useGlobal();
  const { open, setOpen, ref } = usePopover();
  const presets: DatePreset[] = ['all', 'this-month', 'last-month', '3m', '6m', 'fy'];
  return (
    <div className="relative" ref={ref}>
      <TriggerButton open={open} onClick={() => setOpen(!open)}>
        <Calendar className="size-4 text-muted-foreground" />
        <span>{filters.preset === 'custom' && filters.from ? `${filters.from} → ${filters.to ?? 'now'}` : PRESET_LABEL[filters.preset]}</span>
      </TriggerButton>
      {open && (
        <div className="absolute left-0 z-dropdown mt-1.5 w-64 rounded-xl border border-border bg-popover p-1.5 shadow-lg">
          {presets.map((p) => (
            <button
              key={p}
              onClick={() => {
                setFilters({ preset: p });
                setOpen(false);
              }}
              className="flex w-full items-center rounded-lg px-2.5 py-2 text-left text-[13px] hover:bg-subtle cursor-pointer"
            >
              <span className={clsx('flex-1', filters.preset === p && 'font-semibold')}>{PRESET_LABEL[p]}</span>
              {filters.preset === p && <Check className="size-4 text-primary" strokeWidth={3} />}
            </button>
          ))}
          <div className="my-1 h-px bg-border" />
          <div className="space-y-2 p-2.5">
            <div className="text-xs font-medium text-muted-foreground">Custom range</div>
            <Input type="date" value={filters.from ?? ''} onChange={(e) => setFilters({ preset: 'custom', from: e.target.value || undefined })} />
            <Input type="date" value={filters.to ?? ''} onChange={(e) => setFilters({ preset: 'custom', to: e.target.value || undefined })} />
          </div>
        </div>
      )}
    </div>
  );
}

function AiStatus() {
  const { data: meta } = useMeta();
  if (!meta) return null;
  return (
    <span
      className="inline-flex items-center gap-1.5 text-xs text-muted-foreground"
      title={meta.ai.enabled ? `Model: ${meta.ai.model}` : 'Set OPENAI_API_KEY on the API server to read photos and scanned PDFs.'}
    >
      <span className={clsx('size-2 rounded-full', meta.ai.enabled ? 'bg-success' : 'bg-muted-foreground')} />
      {meta.ai.enabled ? 'AI assist on' : 'AI assist off'}
    </span>
  );
}

function FilterBar() {
  const allShops = isAllShops(useShopStore((s) => s.currentShopId));
  const { data: meta } = useMeta();
  return (
    <div className="mb-4 flex flex-wrap items-center gap-2">
      {allShops && (meta?.shops.length ?? 0) > 1 && <ShopPicker />}
      <DatePicker />
      <div className="flex-1" />
      <AiStatus />
    </div>
  );
}

/** Page title for the bank-statement pages, in the app's standard header, with the section filters beneath. */
export function PageHeader({ title, subtitle, actions, filters = true }: { title: string; subtitle?: ReactNode; actions?: ReactNode; filters?: boolean }) {
  return (
    <>
      <AppPageHeader title={title} description={subtitle} actions={actions} />
      {filters && <FilterBar />}
    </>
  );
}

/** Route layout for /bank/*: shared filter state + scoped styles for the analytics views. */
export function BankLayout() {
  return (
    <GlobalProvider>
      <div className="bank-analytics">
        <Suspense
          fallback={
            <div className="space-y-4">
              <Skeleton className="h-8 w-60" />
              <Skeleton className="h-72" />
            </div>
          }
        >
          <Outlet />
        </Suspense>
      </div>
    </GlobalProvider>
  );
}
