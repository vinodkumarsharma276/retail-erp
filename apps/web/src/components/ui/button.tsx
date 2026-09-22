import * as React from 'react';
import { Loader2 } from 'lucide-react';
import { cn } from '../../lib/utils';

/**
 * `solid` variants carry the action's weight; `soft` variants are the tinted
 * equivalents used for row-level and secondary actions, where a wall of solid
 * colour would fight with the data. Every page should have exactly one
 * `default` button visible at a time.
 */
export type ButtonVariant =
  | 'default'
  | 'secondary'
  | 'outline'
  | 'ghost'
  | 'destructive'
  | 'destructive-soft'
  | 'success-soft'
  | 'link';

export type ButtonSize = 'xs' | 'sm' | 'md' | 'lg' | 'icon' | 'icon-sm';

const variantClasses: Record<ButtonVariant, string> = {
  default:
    'bg-brand-gradient text-white shadow-glow hover:brightness-110 hover:-translate-y-px active:translate-y-0 active:brightness-95 transition-[filter,transform,box-shadow]',
  secondary: 'bg-secondary text-secondary-foreground hover:bg-muted',
  outline:
    'border border-border-strong/70 bg-card text-foreground shadow-xs hover:bg-muted hover:border-border-strong',
  ghost: 'text-muted-foreground hover:bg-muted hover:text-foreground',
  destructive: 'bg-destructive text-destructive-foreground shadow-xs hover:bg-destructive/90',
  'destructive-soft': 'bg-destructive-muted text-destructive hover:bg-destructive/15',
  'success-soft': 'bg-success-muted text-success hover:bg-success/15',
  link: 'text-primary underline-offset-4 hover:underline',
};

const sizeClasses: Record<ButtonSize, string> = {
  xs: 'h-7 gap-1.5 rounded-md px-2 text-xs',
  sm: 'h-8 gap-1.5 rounded-md px-2.5 text-xs',
  md: 'h-9 gap-2 rounded-md px-3 text-sm',
  lg: 'h-10 gap-2 rounded-md px-4 text-sm',
  icon: 'h-9 w-9 rounded-md p-0',
  'icon-sm': 'h-7 w-7 rounded-md p-0',
};

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Shows a spinner and blocks interaction without changing the button's width. */
  loading?: boolean;
  /** Icon rendered before the label. Omitted while `loading`. */
  icon?: React.ReactNode;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      className,
      variant = 'default',
      size = 'md',
      type = 'button',
      loading = false,
      icon,
      disabled,
      children,
      ...props
    },
    ref,
  ) => (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cn(
        'press inline-flex shrink-0 items-center justify-center whitespace-nowrap font-medium',
        'transition-[background-color,border-color,color,box-shadow,transform] duration-150',
        'disabled:pointer-events-none disabled:opacity-50',
        variantClasses[variant],
        sizeClasses[size],
        className,
      )}
      {...props}
    >
      {loading ? (
        <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" />
      ) : (
        icon
      )}
      {children}
    </button>
  ),
);
Button.displayName = 'Button';
