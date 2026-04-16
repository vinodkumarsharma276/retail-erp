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

const styles: Record<ToastType, string> = {
  success: 'border-green-200 bg-green-50 text-green-900 dark:border-green-800 dark:bg-green-950 dark:text-green-100',
  error: 'border-red-200 bg-red-50 text-red-900 dark:border-red-800 dark:bg-red-950 dark:text-red-100',
  info: 'border-blue-200 bg-blue-50 text-blue-900 dark:border-blue-800 dark:bg-blue-950 dark:text-blue-100',
  warning: 'border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100',
};

const iconStyles: Record<ToastType, string> = {
  success: 'text-green-600 dark:text-green-400',
  error: 'text-red-600 dark:text-red-400',
  info: 'text-blue-600 dark:text-blue-400',
  warning: 'text-amber-600 dark:text-amber-400',
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
        'pointer-events-auto flex w-80 items-start gap-3 rounded-lg border p-3 shadow-lg transition-all duration-200',
        styles[type],
        visible
          ? 'translate-x-0 opacity-100'
          : 'translate-x-4 opacity-0',
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
