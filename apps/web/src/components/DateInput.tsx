import { forwardRef, useId, useRef, useState, useEffect } from 'react';
import { Calendar as CalendarIcon, X } from 'lucide-react';
import { cn } from '../lib/utils';
import { usePreferencesStore } from '../stores/preferences-store';

const MONTHS_SHORT = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

/**
 * Convert a YYYY-MM-DD value into the user's preferred display string.
 * Mirrors `formatDateIN` from shared-utils but operates on the canonical
 * YYYY-MM-DD value to avoid timezone shifts.
 */
function formatForDisplay(iso: string, dateFormat: string): string {
  if (!iso) return '';
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return iso;
  const [, yyyy, mm, dd] = m;
  const monthIdx = Number(mm) - 1;
  const mmm = MONTHS_SHORT[monthIdx] ?? mm;
  switch (dateFormat) {
    case 'MM/DD/YYYY':
      return `${mm}/${dd}/${yyyy}`;
    case 'YYYY-MM-DD':
      return `${yyyy}-${mm}-${dd}`;
    case 'DD-MMM-YYYY':
      return `${dd}-${mmm}-${yyyy}`;
    case 'DD MMM YYYY':
      return `${dd} ${mmm} ${yyyy}`;
    case 'DD/MM/YYYY':
    default:
      return `${dd}/${mm}/${yyyy}`;
  }
}

/**
 * Parse what the user typed into the text field back into YYYY-MM-DD.
 * Accepts the active dateFormat and a few permissive variants so the user
 * isn't punished for typing slashes vs dashes etc. Returns '' if invalid.
 */
function parseInput(text: string, dateFormat: string): string {
  const t = text.trim();
  if (!t) return '';
  // Already canonical
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(t);
  if (iso) {
    const [, y, m, d] = iso;
    return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }
  // YYYY/MM/DD
  const isoSlash = /^(\d{4})[/-](\d{1,2})[/-](\d{1,2})$/.exec(t);
  if (isoSlash) {
    const [, y, m, d] = isoSlash;
    return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }
  // DD-MMM-YYYY / DD MMM YYYY
  const monthName = /^(\d{1,2})[\s-]([A-Za-z]{3})[\s-](\d{4})$/.exec(t);
  if (monthName) {
    const [, d, mon, y] = monthName;
    const idx = MONTHS_SHORT.findIndex(
      (mm) => mm.toLowerCase() === mon.toLowerCase(),
    );
    if (idx >= 0) {
      const m = String(idx + 1).padStart(2, '0');
      return `${y}-${m}-${d.padStart(2, '0')}`;
    }
    return '';
  }
  // dd/mm/yyyy or mm/dd/yyyy depending on preference
  const numeric = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/.exec(t);
  if (numeric) {
    const [, a, b, y] = numeric;
    const dayFirst = dateFormat !== 'MM/DD/YYYY';
    const dd = dayFirst ? a : b;
    const mm = dayFirst ? b : a;
    const dn = Number(dd);
    const mn = Number(mm);
    if (mn < 1 || mn > 12 || dn < 1 || dn > 31) return '';
    return `${y}-${mm.padStart(2, '0')}-${dd.padStart(2, '0')}`;
  }
  return '';
}

interface Props {
  /** YYYY-MM-DD canonical value (matches `<input type="date">`). */
  value?: string;
  onChange?: (value: string) => void;
  /** YYYY-MM-DD min/max bounds (passed straight to the hidden picker). */
  min?: string;
  max?: string;
  id?: string;
  name?: string;
  placeholder?: string;
  className?: string;
  disabled?: boolean;
  required?: boolean;
  ariaLabel?: string;
}

/**
 * Drop-in replacement for `<input type="date">` that ALWAYS displays in the
 * user's preferred date format (DD/MM/YYYY by default), regardless of
 * browser/OS locale. Internally still uses the native date picker for the
 * calendar UI, but renders the value as a text input so display formatting
 * is fully under our control.
 */
export const DateInput = forwardRef<HTMLInputElement, Props>(function DateInput(
  {
    value = '',
    onChange,
    min,
    max,
    id,
    name,
    placeholder,
    className,
    disabled,
    required,
    ariaLabel,
  },
  ref,
) {
  const generatedId = useId();
  const inputId = id ?? `date-${generatedId}`;
  const dateFormat =
    usePreferencesStore((s) => s.preferences.dateFormat) ?? 'DD/MM/YYYY';
  const placeholderHint = formatPlaceholder(dateFormat, placeholder);

  const [text, setText] = useState(() => formatForDisplay(value, dateFormat));
  const lastValueRef = useRef<string>(value);
  const hiddenRef = useRef<HTMLInputElement | null>(null);

  // Sync external value -> text whenever the canonical changes from outside
  // (e.g. form reset, parent setValue). Skip when the user is mid-type to
  // avoid clobbering their input.
  useEffect(() => {
    if (value !== lastValueRef.current) {
      lastValueRef.current = value;
      setText(formatForDisplay(value, dateFormat));
    }
  }, [value, dateFormat]);

  // Re-render display when the preference itself changes
  useEffect(() => {
    setText(formatForDisplay(value, dateFormat));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dateFormat]);

  const commit = (raw: string) => {
    const iso = parseInput(raw, dateFormat);
    if (iso) {
      // Re-format on blur so the field always shows canonical layout.
      setText(formatForDisplay(iso, dateFormat));
      if (iso !== value) {
        lastValueRef.current = iso;
        onChange?.(iso);
      }
    } else if (raw === '') {
      if (value !== '') {
        lastValueRef.current = '';
        onChange?.('');
      }
    } else {
      // Invalid — restore the previous valid display so the user isn't
      // stranded with garbage text.
      setText(formatForDisplay(value, dateFormat));
    }
  };

  const openPicker = () => {
    const el = hiddenRef.current;
    if (!el || disabled) return;
    // Chromium showPicker(); other browsers fall back to focus().
    if (typeof (el as any).showPicker === 'function') {
      try {
        (el as any).showPicker();
        return;
      } catch {
        /* fall through */
      }
    }
    el.focus();
    el.click();
  };

  return (
    <div className={cn('relative', className && '')}>
      <input
        ref={ref}
        id={inputId}
        name={name}
        type="text"
        inputMode="numeric"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={(e) => commit(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            commit((e.target as HTMLInputElement).value);
          }
        }}
        placeholder={placeholderHint}
        disabled={disabled}
        required={required}
        aria-label={ariaLabel}
        className={cn(
          'w-full rounded-md border bg-background pl-3 pr-9 py-2.5 text-sm',
          'placeholder:text-muted-foreground',
          'focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2',
          'disabled:opacity-50 disabled:cursor-not-allowed',
          className,
        )}
      />
      {/* Hidden native date input — provides the calendar UI */}
      <input
        ref={hiddenRef}
        type="date"
        tabIndex={-1}
        aria-hidden
        value={value}
        min={min}
        max={max}
        disabled={disabled}
        onChange={(e) => {
          const iso = e.target.value;
          if (iso !== value) {
            lastValueRef.current = iso;
            onChange?.(iso);
            setText(formatForDisplay(iso, dateFormat));
          }
        }}
        // Position absolutely over the icon (invisible) so showPicker()
        // anchors the calendar where the user clicks.
        className="absolute right-0 top-0 h-full w-9 opacity-0 pointer-events-none"
      />
      <div className="absolute right-0 top-0 h-full flex items-center pr-1 gap-0.5">
        {value && !disabled && (
          <button
            type="button"
            onClick={() => {
              setText('');
              lastValueRef.current = '';
              onChange?.('');
            }}
            tabIndex={-1}
            className="rounded p-1 text-muted-foreground hover:bg-muted"
            aria-label="Clear date"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
        <button
          type="button"
          onClick={openPicker}
          disabled={disabled}
          tabIndex={-1}
          className="rounded p-1 text-muted-foreground hover:bg-muted disabled:opacity-50"
          aria-label="Open date picker"
        >
          <CalendarIcon className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
});

function formatPlaceholder(dateFormat: string, custom?: string): string {
  if (custom) return custom;
  switch (dateFormat) {
    case 'MM/DD/YYYY':
      return 'mm/dd/yyyy';
    case 'YYYY-MM-DD':
      return 'yyyy-mm-dd';
    case 'DD-MMM-YYYY':
      return 'dd-mmm-yyyy';
    case 'DD MMM YYYY':
      return 'dd mmm yyyy';
    case 'DD/MM/YYYY':
    default:
      return 'dd/mm/yyyy';
  }
}
