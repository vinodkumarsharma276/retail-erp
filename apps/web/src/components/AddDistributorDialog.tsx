import { X, Building2 } from 'lucide-react';
import type { Distributor } from '@retailerp/shared-types';
import { DistributorForm } from './DistributorForm';
import { useEscapeKey } from '../hooks/useEscapeKey';

interface AddDistributorDialogProps {
  /** Seeds the company name from whatever the user typed in the search box. */
  initialCompanyName?: string;
  onCreated: (distributor: Distributor) => void;
  onClose: () => void;
}

export function AddDistributorDialog({
  initialCompanyName,
  onCreated,
  onClose,
}: AddDistributorDialogProps) {
  useEscapeKey(true, onClose);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="flex max-h-[90vh] w-full max-w-4xl flex-col overflow-hidden rounded-lg border border-border bg-popover shadow-lg">
        <div className="flex items-center justify-between border-b px-4 py-3">
          <div className="flex items-center gap-2 font-semibold">
            <Building2 className="h-4 w-4 text-primary" />
            Add Distributor
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <DistributorForm
          layout="dialog"
          initialCompanyName={initialCompanyName}
          onSuccess={onCreated}
          onCancel={onClose}
        />
      </div>
    </div>
  );
}
