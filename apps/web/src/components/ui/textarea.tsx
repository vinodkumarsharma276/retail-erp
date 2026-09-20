import * as React from 'react';
import { cn } from '../../lib/utils';
import { fieldBase } from './input';

export const Textarea = React.forwardRef<
  HTMLTextAreaElement,
  React.ComponentProps<'textarea'>
>(({ className, rows = 3, ...props }, ref) => (
  <textarea
    ref={ref}
    rows={rows}
    className={cn(fieldBase, 'min-h-[4.5rem] resize-y px-3 py-2', className)}
    {...props}
  />
));
Textarea.displayName = 'Textarea';
