import { useEffect, useState } from 'react';
import { X, CheckCircle2, AlertCircle, Info, AlertTriangle } from 'lucide-react';
import { useToastStore, type ToastType } from '../stores/toast-store';
import { cn } from '../lib/utils';

const icons: Record<ToastType, typeof CheckCircle2> = {
  success: CheckCircle2,
  error: AlertCircle,
  info: Info,
  warning: AlertTriangle,
};

// Semantic tokens instead of raw palette steps, so toasts follow the theme
// and no longer need a parallel set of dark-mode classes.
const styles: Record<ToastType, string> = {
  success: 'border-success/30 bg-success-muted text-success',
  error: 'border-destructive/30 bg-destructive-muted text-destructive',
  info: 'border-info/30 bg-info-muted text-info',
  warning: 'border-warning/30 bg-warning-muted text-warning',
};

const iconStyles: Record<ToastType, string> = {
  success: 'text-success',
  error: 'text-destructive',
  info: 'text-info',
  warning: 'text-warning',
};

function ToastItem({
  id,
  type,
  message,
}: {
  id: string;
  type: ToastType;
  message: string;
}) {
  const removeToast = useToastStore((s) => s.removeToast);
  const [visible, setVisible] = useState(false);

  const Icon = icons[type];

  useEffect(() => {
    // Trigger enter animation
    const frame = requestAnimationFrame(() => setVisible(true));
    return () => cancelAnimationFrame(frame);
  }, []);

  const handleDismiss = () => {
    setVisible(false);
    setTimeout(() => removeToast(id), 150);
  };

  return (
    <div
      className={cn(
        'pointer-events-auto flex w-80 items-start gap-3 rounded-lg border p-3 shadow-lg',
        'transition-[transform,opacity] duration-200 ease-[cubic-bezier(0.16,1,0.3,1)]',
        styles[type],
        visible
          ? 'translate-x-0 scale-100 opacity-100'
          : 'translate-x-6 scale-95 opacity-0',
      )}
    >
      <Icon className={cn('mt-0.5 h-4 w-4 shrink-0', iconStyles[type])} />
      <p className="flex-1 text-sm font-medium">{message}</p>
      <button
        onClick={handleDismiss}
        className="shrink-0 rounded p-0.5 opacity-70 hover:opacity-100 transition-opacity"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

/**
 * Toast container — render once at the app root.
 * Displays all active toasts in the top-right corner.
 */
export function ToastContainer() {
  const toasts = useToastStore((s) => s.toasts);

  if (toasts.length === 0) return null;

  return (
    <div className="pointer-events-none fixed inset-0 z-[100] flex flex-col items-end gap-2 p-4 pt-4 sm:p-6">
      {toasts.map((toast) => (
        <ToastItem key={toast.id} {...toast} />
      ))}
    </div>
  );
}
