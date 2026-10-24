import { useCallback, useState, type ReactNode } from 'react';
import { AlertCircle, AlertTriangle, ArrowRight } from 'lucide-react';
import { cn } from '../lib/utils';
import { Button } from './ui/button';
import { useEscapeKey } from '../hooks/useEscapeKey';

/**
 * Telling somebody why their Save did nothing.
 *
 * A panel at the foot of a long form is invisible: the button is at the
 * top, the reason is a screen and a half below it, and from where the
 * person is sitting the app simply ignored them. So anything that stops a
 * save is said in front of them, where the click happened.
 *
 * Two kinds of problem, and the difference decides what the dialog offers:
 *
 *   - `block` — this cannot be saved as it stands. Nothing to do but go and
 *     change something, so the dialog only offers to take them there.
 *   - `warn` — this looks wrong but might be right, and only the person can
 *     say. The dialog offers to carry on.
 *
 * A warning with a block beside it is still blocked: the dialog shows both
 * and offers no way through.
 */
export type IssueSeverity = 'block' | 'warn';

export interface ValidationIssue {
  severity: IssueSeverity;
  /** One line, in plain words: what is wrong. */
  title: string;
  /** Anything more that helps — what it clashes with, what to do. */
  detail?: ReactNode;
  /**
   * The form field at fault, by its `name`. Lets the dialog put the cursor
   * where the problem is rather than leaving it to be hunted for.
   */
  field?: string;
}

interface ValidationDialogProps {
  title?: string;
  issues: ValidationIssue[];
  /** Offered only when nothing is blocking. */
  onProceed?: () => void;
  proceedLabel?: string;
  onClose: () => void;
  busy?: boolean;
}

/** Put the cursor on the first field at fault, if the issues name one. */
function focusField(field: string | undefined) {
  if (!field) return;
  const el = document.querySelector<HTMLElement>(
    `[name="${CSS.escape(field)}"], #${CSS.escape(field)}`,
  );
  if (!el) return;
  el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  // After the scroll, or the focus ring lands somewhere nobody is looking.
  setTimeout(() => el.focus({ preventScroll: true }), 300);
}

export function ValidationDialog({
  title,
  issues,
  onProceed,
  proceedLabel = 'Save anyway',
  onClose,
  busy = false,
}: ValidationDialogProps) {
  useEscapeKey(true, () => {
    if (!busy) onClose();
  });

  const blocking = issues.filter((i) => i.severity === 'block');
  const warnings = issues.filter((i) => i.severity === 'warn');
  const isBlocked = blocking.length > 0;
  const firstField = issues.find((i) => i.field)?.field;

  const heading =
    title ??
    (isBlocked
      ? blocking.length === 1
        ? 'This cannot be saved yet'
        : `${blocking.length} things to fix before saving`
      : 'Worth a look before saving');

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-foreground/40 backdrop-blur-sm" onClick={onClose} />

      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="validation-title"
        className="relative z-10 flex max-h-[85vh] w-full max-w-lg flex-col overflow-hidden rounded-xl border bg-popover shadow-lg"
      >
        <header className="flex gap-3 border-b px-5 py-4">
          <div
            className={cn(
              'mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full',
              isBlocked ? 'bg-destructive/10' : 'bg-warning/10',
            )}
          >
            {isBlocked ? (
              <AlertCircle className="h-5 w-5 text-destructive" />
            ) : (
              <AlertTriangle className="h-5 w-5 text-warning" />
            )}
          </div>
          <div className="min-w-0">
            <h2 id="validation-title" className="text-lg font-semibold">
              {heading}
            </h2>
            <p className="mt-0.5 text-sm text-muted-foreground">
              {isBlocked
                ? 'Nothing has been saved.'
                : 'Nothing has been saved yet — have a look, then carry on if it is right.'}
            </p>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          <ul className="space-y-3">
            {[...blocking, ...warnings].map((issue, index) => (
              <li
                key={`${issue.severity}-${issue.title}-${index}`}
                className={cn(
                  'rounded-lg border-l-2 py-0.5 pl-3',
                  issue.severity === 'block' ? 'border-l-destructive' : 'border-l-warning',
                )}
              >
                <p className="text-sm font-medium">{issue.title}</p>
                {issue.detail && (
                  <div className="mt-1 text-sm text-muted-foreground">{issue.detail}</div>
                )}
              </li>
            ))}
          </ul>
        </div>

        <footer className="flex flex-wrap items-center justify-end gap-2 border-t px-5 py-4">
          {/* A way through only exists when nothing is blocking. */}
          {!isBlocked && onProceed && (
            <Button variant="outline" onClick={onProceed} disabled={busy} loading={busy}>
              {proceedLabel}
            </Button>
          )}
          <Button
            onClick={() => {
              onClose();
              focusField(firstField);
            }}
            disabled={busy}
          >
            {firstField ? (
              <>
                Take me to it
                <ArrowRight className="ml-1.5 h-4 w-4" />
              </>
            ) : isBlocked ? (
              'Let me fix it'
            ) : (
              'Let me check'
            )}
          </Button>
        </footer>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Driving it from a form
// ---------------------------------------------------------------------------

/**
 * Hold a set of issues and show them over the form.
 *
 * Render `dialog` anywhere inside the component; it puts itself in front of
 * everything. `show` returns nothing and saves nothing — the caller decides
 * what carrying on means.
 */
export function useValidationDialog() {
  const [state, setState] = useState<{
    issues: ValidationIssue[];
    title?: string;
    proceedLabel?: string;
    onProceed?: () => void;
  } | null>(null);

  const close = useCallback(() => setState(null), []);

  const show = useCallback(
    (
      issues: ValidationIssue[],
      options?: { title?: string; proceedLabel?: string; onProceed?: () => void },
    ) => {
      if (issues.length === 0) return false;
      setState({ issues, ...options });
      return true;
    },
    [],
  );

  return {
    show,
    close,
    isOpen: state != null,
    dialog: state ? (
      <ValidationDialog
        title={state.title}
        issues={state.issues}
        proceedLabel={state.proceedLabel}
        onProceed={
          state.onProceed
            ? () => {
                const go = state.onProceed!;
                setState(null);
                go();
              }
            : undefined
        }
        onClose={close}
      />
    ) : null,
  };
}

/** What react-hook-form says is wrong, as issues this dialog can show. */
export function issuesFromFormErrors(
  errors: Record<string, unknown>,
  labels: Record<string, string> = {},
): ValidationIssue[] {
  const out: ValidationIssue[] = [];

  const walk = (node: Record<string, unknown>, path: string[] = []) => {
    for (const [key, value] of Object.entries(node ?? {})) {
      if (!value || typeof value !== 'object') continue;
      const here = [...path, key];
      const entry = value as { message?: string; type?: string };
      if (typeof entry.message === 'string' && entry.message) {
        const name = here.join('.');
        out.push({
          severity: 'block',
          title: labels[name] ?? labels[key] ?? prettyFieldName(key),
          detail: entry.message,
          field: name,
        });
      } else {
        walk(value as Record<string, unknown>, here);
      }
    }
  };
  walk(errors);

  return out;
}

/** "bankAccountNumber" → "Bank account number" */
function prettyFieldName(key: string): string {
  const spaced = key
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .toLowerCase()
    .trim();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}
