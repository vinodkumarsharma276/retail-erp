import * as React from 'react';
import { cn } from '../../lib/utils';

/** Shared field chrome so inputs, selects and textareas stay identical. */
export const fieldBase =
  'w-full rounded-md border border-input bg-field text-sm text-foreground shadow-xs transition-colors ' +
  'placeholder:text-muted-foreground/70 ' +
  'hover:border-border-strong ' +
  'focus:border-primary focus:outline-none focus:ring-2 focus:ring-ring/25 ' +
  'disabled:cursor-not-allowed disabled:bg-muted disabled:opacity-60 ' +
  'aria-[invalid=true]:border-destructive aria-[invalid=true]:focus:ring-destructive/25';

export interface InputProps extends React.ComponentProps<'input'> {
  /** Icon rendered inside the field's leading edge. */
  icon?: React.ReactNode;
}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type, icon, ...props }, ref) => {
    const field = (
      <input
        ref={ref}
        type={type}
        className={cn(fieldBase, 'h-9 px-3 py-1.5', icon && 'pl-9', className)}
        {...props}
      />
    );

    if (!icon) return field;

    return (
      <div className="relative">
        <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">
          {icon}
        </span>
        {field}
      </div>
    );
  },
);
Input.displayName = 'Input';
