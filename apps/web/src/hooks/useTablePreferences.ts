import { useCallback, useEffect, useState } from 'react';

/**
 * How one person likes a particular table laid out.
 *
 * Which columns they want to see and how wide they have dragged them is a
 * per-viewer convenience, not shop data: it belongs to the browser, not the
 * database. It does have to survive a reload, though — a column that
 * un-hides itself every visit is worse than not being able to hide it.
 *
 * Preferences are keyed by column key, so a column added to the code later
 * simply shows up (it is not in `hidden`), and one removed from the code
 * leaves a stale entry that nothing reads.
 */
export interface TablePreferences {
  /** Column keys the viewer has turned off. */
  hidden: string[];
  /** Column key → pixel width, for the ones they have dragged. */
  widths: Record<string, number>;
}

const EMPTY: TablePreferences = { hidden: [], widths: {} };

const storageKey = (tableId: string) => `table-prefs:${tableId}`;

function read(tableId: string): TablePreferences {
  try {
    const raw = localStorage.getItem(storageKey(tableId));
    if (!raw) return EMPTY;
    const parsed = JSON.parse(raw) as Partial<TablePreferences>;
    return {
      hidden: Array.isArray(parsed.hidden) ? parsed.hidden.filter((k) => typeof k === 'string') : [],
      widths:
        parsed.widths && typeof parsed.widths === 'object'
          ? Object.fromEntries(
              Object.entries(parsed.widths).filter(
                ([, v]) => typeof v === 'number' && Number.isFinite(v) && v > 0,
              ),
            )
          : {},
    };
  } catch {
    // Private windows, cleared site data, or something else's key under this
    // name. A table that renders normally beats one that throws.
    return EMPTY;
  }
}

function write(tableId: string, prefs: TablePreferences) {
  try {
    // Nothing customised is worth no row in storage.
    if (prefs.hidden.length === 0 && Object.keys(prefs.widths).length === 0) {
      localStorage.removeItem(storageKey(tableId));
      return;
    }
    localStorage.setItem(storageKey(tableId), JSON.stringify(prefs));
  } catch {
    // Storage full or blocked: the table still works for this session.
  }
}

export function useTablePreferences(tableId: string | undefined) {
  const [prefs, setPrefs] = useState<TablePreferences>(() =>
    tableId ? read(tableId) : EMPTY,
  );

  // Another tab of the same table should not be stale.
  useEffect(() => {
    if (!tableId) return;
    const onStorage = (event: StorageEvent) => {
      if (event.key === storageKey(tableId)) setPrefs(read(tableId));
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [tableId]);

  const update = useCallback(
    (change: (prev: TablePreferences) => TablePreferences) => {
      setPrefs((prev) => {
        const next = change(prev);
        if (tableId) write(tableId, next);
        return next;
      });
    },
    [tableId],
  );

  const toggleColumn = useCallback(
    (key: string, visible: boolean) =>
      update((prev) => ({
        ...prev,
        hidden: visible ? prev.hidden.filter((k) => k !== key) : [...new Set([...prev.hidden, key])],
      })),
    [update],
  );

  const setWidth = useCallback(
    (key: string, width: number | null) =>
      update((prev) => {
        const widths = { ...prev.widths };
        if (width == null) delete widths[key];
        else widths[key] = Math.round(width);
        return { ...prev, widths };
      }),
    [update],
  );

  /** Put every column back and forget every drag. */
  const reset = useCallback(() => update(() => EMPTY), [update]);

  return { prefs, toggleColumn, setWidth, reset };
}
