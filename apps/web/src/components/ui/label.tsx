import * as React from 'react';
import { cn } from '../../lib/utils';

export interface LabelProps extends React.ComponentProps<'label'> {
  required?: boolean;
}

export const Label = React.forwardRef<HTMLLabelElement, LabelProps>(
  ({ className, required, children, ...props }, ref) => (
    <label
      ref={ref}
      className={cn(
        'mb-1 block text-xs font-medium text-muted-foreground',
        'peer-disabled:cursor-not-allowed peer-disabled:opacity-60',
        className,
      )}
      {...props}
    >
      {children}
      {required && (
        <span aria-hidden className="ml-0.5 text-destructive">
          *
        </span>
      )}
    </label>
  ),
);
Label.displayName = 'Label';
