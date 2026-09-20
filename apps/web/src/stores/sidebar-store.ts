import { create } from 'zustand';

/**
 * Sidebar state has three independent parts:
 *   - `isOpen`       — mobile drawer visibility. Never persisted; the drawer
 *                      should always start closed on a fresh page load.
 *   - `isCollapsed`  — desktop icon-rail mode.
 *   - `collapsedSections` — which nav groups are folded away.
 *
 * The last two are per-user chrome preferences, persisted to localStorage so
 * they survive reloads without a server round-trip. They are namespaced by
 * user id so two accounts on a shared shop terminal don't inherit each
 * other's layout.
 */

const RAIL_KEY = 'sidebar:collapsed';
const SECTIONS_KEY = 'sidebar:collapsedSections';

function scopedKey(base: string, userId: string | null) {
  return userId ? `${base}:${userId}` : base;
}

function readBool(key: string): boolean {
  try {
    return localStorage.getItem(key) === 'true';
  } catch {
    // Private mode / blocked storage — fall back to the expanded default.
    return false;
  }
}

function readStringArray(key: string): string[] {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : [];
  } catch {
    return [];
  }
}

function write(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Non-fatal: the preference just won't survive this session.
  }
}

interface SidebarState {
  /** Mobile drawer. */
  isOpen: boolean;
  /** Desktop icon-rail mode. */
  isCollapsed: boolean;
  collapsedSections: string[];
  userId: string | null;

  open: () => void;
  close: () => void;
  toggle: () => void;
  toggleCollapsed: () => void;
  toggleSection: (id: string) => void;
  isSectionCollapsed: (id: string) => boolean;
  /** Re-read persisted chrome for the signed-in user. Call on login/hydrate. */
  hydrateForUser: (userId: string | null) => void;
}

export const useSidebarStore = create<SidebarState>((set, get) => ({
  isOpen: false,
  isCollapsed: readBool(RAIL_KEY),
  collapsedSections: readStringArray(SECTIONS_KEY),
  userId: null,

  open: () => set({ isOpen: true }),
  close: () => set({ isOpen: false }),
  toggle: () => set((state) => ({ isOpen: !state.isOpen })),

  toggleCollapsed: () => {
    const next = !get().isCollapsed;
    write(scopedKey(RAIL_KEY, get().userId), String(next));
    set({ isCollapsed: next });
  },

  toggleSection: (id) => {
    const current = get().collapsedSections;
    const next = current.includes(id)
      ? current.filter((s) => s !== id)
      : [...current, id];
    write(scopedKey(SECTIONS_KEY, get().userId), JSON.stringify(next));
    set({ collapsedSections: next });
  },

  isSectionCollapsed: (id) => get().collapsedSections.includes(id),

  hydrateForUser: (userId) => {
    set({
      userId,
      isCollapsed: readBool(scopedKey(RAIL_KEY, userId)),
      collapsedSections: readStringArray(scopedKey(SECTIONS_KEY, userId)),
    });
  },
}));
