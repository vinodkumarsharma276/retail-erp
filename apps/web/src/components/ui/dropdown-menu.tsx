import * as React from 'react';
import { MoreHorizontal } from 'lucide-react';
import { cn } from '../../lib/utils';
import { Button, type ButtonProps } from './button';
import { useEscapeKey } from '../../hooks/useEscapeKey';

/**
 * Minimal dependency-free dropdown. Replaces the per-row button clusters
 * ("Sell" + "Transfer", "Pay" + "View") that were repeated on every table row
 * and competed with the data for attention.
 *
 * Closes on outside click, Escape, and item activation. Focus returns to the
 * trigger on close so keyboard users aren't dropped at the top of the page.
 */

interface DropdownContextValue {
  open: boolean;
  setOpen: (open: boolean) => void;
  triggerRef: React.RefObject<HTMLButtonElement>;
}

const DropdownContext = React.createContext<DropdownContextValue | null>(null);

function useDropdown(component: string) {
  const ctx = React.useContext(DropdownContext);
  if (!ctx) throw new Error(`<${component}> must be used inside <DropdownMenu>`);
  return ctx;
}

export function DropdownMenu({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = React.useState(false);
  const triggerRef = React.useRef<HTMLButtonElement>(null);
  const value = React.useMemo(() => ({ open, setOpen, triggerRef }), [open]);

  return (
    <DropdownContext.Provider value={value}>
      <div className="relative inline-block text-left">{children}</div>
    </DropdownContext.Provider>
  );
}

export const DropdownMenuTrigger = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ onClick, ...props }, forwardedRef) => {
    const { open, setOpen, triggerRef } = useDropdown('DropdownMenuTrigger');
    React.useImperativeHandle(forwardedRef, () => triggerRef.current as HTMLButtonElement);

    return (
      <Button
        ref={triggerRef}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={(e) => {
          onClick?.(e);
          if (!e.defaultPrevented) setOpen(!open);
        }}
        {...props}
      />
    );
  },
);
DropdownMenuTrigger.displayName = 'DropdownMenuTrigger';

/** Convenience trigger for table row actions. */
export function DropdownMenuIconTrigger({ label = 'Actions' }: { label?: string }) {
  return (
    <DropdownMenuTrigger variant="ghost" size="icon-sm" aria-label={label}>
      <MoreHorizontal className="h-4 w-4" />
    </DropdownMenuTrigger>
  );
}

export function DropdownMenuContent({
  className,
  align = 'end',
  children,
}: {
  className?: string;
  align?: 'start' | 'end';
  children: React.ReactNode;
}) {
  const { open, setOpen, triggerRef } = useDropdown('DropdownMenuContent');
  const contentRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (!open) return;

    function onPointerDown(e: MouseEvent) {
      const target = e.target as Node;
      if (contentRef.current?.contains(target)) return;
      if (triggerRef.current?.contains(target)) return;
      setOpen(false);
    }

    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, [open, setOpen, triggerRef]);

  useEscapeKey(open, () => {
    setOpen(false);
    triggerRef.current?.focus();
  });

  if (!open) return null;

  return (
    <div
      ref={contentRef}
      role="menu"
      className={cn(
        'animate-scale-in absolute z-dropdown mt-1 min-w-[11rem] overflow-hidden rounded-lg border border-border bg-popover p-1 text-popover-foreground shadow-lg',
        // Scale from the corner the menu is anchored to, so it reads as
        // growing out of the trigger rather than appearing beside it.
        align === 'end' ? 'right-0 origin-top-right' : 'left-0 origin-top-left',
        className,
      )}
    >
      {children}
    </div>
  );
}

export interface DropdownMenuItemProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  icon?: React.ReactNode;
  tone?: 'default' | 'danger';
}

export function DropdownMenuItem({
  className,
  icon,
  tone = 'default',
  onClick,
  children,
  ...props
}: DropdownMenuItemProps) {
  const { setOpen, triggerRef } = useDropdown('DropdownMenuItem');

  return (
    <button
      type="button"
      role="menuitem"
      onClick={(e) => {
        onClick?.(e);
        if (e.defaultPrevented) return;
        setOpen(false);
        triggerRef.current?.focus();
      }}
      className={cn(
        'flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-left text-sm transition-colors',
        'disabled:pointer-events-none disabled:opacity-50',
        tone === 'danger'
          ? 'text-destructive hover:bg-destructive-muted'
          : 'text-foreground hover:bg-muted',
        className,
      )}
      {...props}
    >
      {icon && <span className="shrink-0 text-muted-foreground">{icon}</span>}
      {children}
    </button>
  );
}

export function DropdownMenuLabel({ children }: { children: React.ReactNode }) {
  return <div className="px-2.5 py-1.5 text-overline">{children}</div>;
}

export function DropdownMenuSeparator() {
  return <div role="separator" className="my-1 h-px bg-border" />;
}
