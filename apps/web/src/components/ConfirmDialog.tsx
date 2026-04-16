import { useEffect, useRef } from 'react';
import { AlertTriangle } from 'lucide-react';
import { cn } from '../lib/utils';

interface ConfirmDialogProps {
  isOpen: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  variant?: 'danger' | 'default';
  loading?: boolean;
}

export function ConfirmDialog({
  isOpen,
  onConfirm,
  onCancel,
  title,
  message,
  confirmText = 'Confirm',
  cancelText = 'Cancel',
  variant = 'default',
  loading = false,
}: ConfirmDialogProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const confirmBtnRef = useRef<HTMLButtonElement>(null);

  // Focus management and Escape key
  useEffect(() => {
    if (!isOpen) return;

    const previousFocus = document.activeElement as HTMLElement;
    confirmBtnRef.current?.focus();

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        onCancel();
      }
    }

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      previousFocus?.focus();
    };
  }, [isOpen, onCancel]);

  if (!isOpen) return null;

  const isDanger = variant === 'danger';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/50"
        onClick={onCancel}
      />

      {/* Dialog */}
      <div
        ref={dialogRef}
        role="alertdialog"
        aria-labelledby="confirm-title"
        aria-describedby="confirm-message"
        className="relative z-10 mx-4 w-full max-w-md rounded-lg border bg-card p-6 shadow-xl"
      >
        <div className="flex gap-4">
          {isDanger && (
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-destructive/10">
              <AlertTriangle className="h-5 w-5 text-destructive" />
            </div>
          )}
          <div className="flex-1">
            <h2
              id="confirm-title"
              className="text-lg font-semibold text-foreground"
            >
              {title}
            </h2>
            <p
              id="confirm-message"
              className="mt-2 text-sm text-muted-foreground"
            >
              {message}
            </p>
          </div>
        </div>

        <div className="mt-6 flex justify-end gap-3">
          <button
            onClick={onCancel}
            disabled={loading}
            className="rounded-md border px-4 py-2 text-sm font-medium text-foreground hover:bg-muted transition-colors disabled:opacity-50"
          >
            {cancelText}
          </button>
          <button
            ref={confirmBtnRef}
            onClick={onConfirm}
            disabled={loading}
            className={cn(
              'rounded-md px-4 py-2 text-sm font-medium transition-colors disabled:opacity-50',
              isDanger
                ? 'bg-destructive text-destructive-foreground hover:bg-destructive/90'
                : 'bg-primary text-primary-foreground hover:bg-primary/90',
            )}
          >
            {loading ? 'Processing...' : confirmText}
          </button>
        </div>
      </div>
    </div>
  );
}
