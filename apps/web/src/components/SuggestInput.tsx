import * as React from 'react';
import { ChevronDown, Loader2 } from 'lucide-react';
import { Input, type InputProps } from './ui/input';
import { cn } from '../lib/utils';

type Props = Omit<InputProps, 'list' | 'type' | 'icon'> & {
  /** Values to offer, in the order to show them. */
  options: readonly string[];
  /** Most rows shown at once; the rest are reached by typing. */
  maxShown?: number;
  /** Shown when the typed text is not on the list. */
  newHint?: (typed: string) => string;
  /** Shown when there is nothing to offer (e.g. "Pick a product type first"). */
  emptyText?: string;
  loading?: boolean;
  /** Extra text on the right of a row (e.g. a person's mobile and area). */
  optionHint?: (index: number) => React.ReactNode;
  /** Called after a row is picked, with its index in `options`. */
  onPick?: (value: string, index: number) => void;
  /** Leave the list as given (already filtered by the server). */
  serverFiltered?: boolean;
};

const setNativeValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;

/**
 * Type-or-pick text field: a compact list that narrows as you type (matches
 * at the start first), with keyboard support, and free text allowed.
 *
 * Works controlled (`value` + `onChange`) and with react-hook-form's
 * `register(...)`: picking a row sets the input and fires a normal change
 * event. Replaces `<datalist>`, whose browser popup can't be sized or
 * styled and mixes in the browser's saved addresses.
 */
export const SuggestInput = React.forwardRef<HTMLInputElement, Props>(function SuggestInput(
  { options, maxShown = 50, newHint, emptyText, loading, optionHint, onPick, serverFiltered, className, onChange, onFocus, onBlur, onKeyDown, disabled, ...props },
  ref,
) {
  const input = React.useRef<HTMLInputElement | null>(null);
  const listRef = React.useRef<HTMLUListElement>(null);
  const listId = React.useId();
  const [open, setOpen] = React.useState(false);
  /** What has been typed since the field was focused; '' lists everything. */
  const [query, setQuery] = React.useState('');
  const [active, setActive] = React.useState(-1);

  const setRefs = (el: HTMLInputElement | null) => {
    input.current = el;
    if (typeof ref === 'function') ref(el);
    else if (ref) ref.current = el;
  };

  const typed = query.trim().toUpperCase();
  /** Indexes into `options`, start matches first. */
  const matches = React.useMemo(() => {
    const all = options.map((_, i) => i);
    if (!typed || serverFiltered) return all;
    const starts: number[] = [];
    const contains: number[] = [];
    for (const i of all) {
      const u = options[i].toUpperCase();
      if (u.startsWith(typed)) starts.push(i);
      else if (u.includes(typed)) contains.push(i);
    }
    return [...starts, ...contains];
  }, [options, typed, serverFiltered]);
  const shown = matches.slice(0, maxShown);
  const isNew = !!typed && matches.length === 0;

  React.useEffect(() => {
    if (active >= 0) listRef.current?.children[active]?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  const pick = (index: number) => {
    const el = input.current;
    if (!el) return;
    const value = options[index];
    setNativeValue.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    setQuery('');
    setOpen(false);
    setActive(-1);
    onPick?.(value, index);
  };

  const showPanel = open && !disabled && (loading || shown.length > 0 || !!emptyText || (isNew && !!newHint));

  return (
    <div className="relative">
      <Input
        ref={setRefs}
        type="text"
        autoComplete="off"
        role="combobox"
        aria-expanded={showPanel}
        aria-controls={listId}
        aria-autocomplete="list"
        disabled={disabled}
        className={cn('pr-8', className)}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
          setActive(-1);
          onChange?.(e);
        }}
        onFocus={(e) => {
          setQuery('');
          setOpen(true);
          onFocus?.(e);
        }}
        onBlur={(e) => {
          setOpen(false);
          setActive(-1);
          onBlur?.(e);
        }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            setOpen(true);
            setActive((i) => Math.min(i + 1, shown.length - 1));
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setActive((i) => Math.max(i - 1, 0));
          } else if (e.key === 'Enter' && showPanel && active >= 0 && shown[active] !== undefined) {
            e.preventDefault();
            pick(shown[active]);
          } else if (e.key === 'Escape' && showPanel) {
            e.preventDefault();
            e.stopPropagation();
            setOpen(false);
          }
          onKeyDown?.(e);
        }}
        {...props}
      />
      <button
        type="button"
        tabIndex={-1}
        aria-label="Show list"
        disabled={disabled}
        onMouseDown={(e) => {
          e.preventDefault();
          if (document.activeElement !== input.current) input.current?.focus();
          else setOpen((o) => !o);
        }}
        className="absolute right-1 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground hover:text-foreground disabled:opacity-50"
      >
        {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ChevronDown className="h-3.5 w-3.5" />}
      </button>
      {showPanel && (
        <div
          className="absolute left-0 top-full z-50 mt-1 w-full min-w-[12rem] overflow-hidden rounded-md border border-border bg-card text-sm shadow-lg"
          onMouseDown={(e) => e.preventDefault()}
        >
          {shown.length > 0 ? (
            <ul ref={listRef} id={listId} role="listbox" className="max-h-60 overflow-y-auto py-1">
              {shown.map((index, i) => (
                <li
                  key={index}
                  role="option"
                  aria-selected={i === active}
                  onMouseEnter={() => setActive(i)}
                  onClick={() => pick(index)}
                  className={cn(
                    'flex cursor-pointer items-baseline justify-between gap-3 px-2.5 py-1',
                    i === active ? 'bg-primary/10 text-foreground' : 'hover:bg-muted',
                  )}
                >
                  <span className="truncate">{options[index]}</span>
                  {optionHint && <span className="shrink-0 text-xs text-muted-foreground">{optionHint(index)}</span>}
                </li>
              ))}
            </ul>
          ) : (
            !isNew && (
              <p id={listId} className="px-2.5 py-2 text-xs text-muted-foreground">
                {loading ? 'Loading…' : emptyText}
              </p>
            )
          )}
          {matches.length > shown.length && (
            <p className="border-t px-2.5 py-1.5 text-xs text-muted-foreground">
              Showing {shown.length} of {matches.length} — type to narrow
            </p>
          )}
          {isNew && newHint && <p className="border-t px-2.5 py-1.5 text-xs text-muted-foreground">{newHint(query.trim())}</p>}
        </div>
      )}
    </div>
  );
});
