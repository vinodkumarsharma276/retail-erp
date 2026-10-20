import { useEffect, useMemo, useState } from 'react';
import { X, FolderPlus, Loader2 } from 'lucide-react';
import type { ProductCategory } from '@retailerp/shared-types';
import { slugify, useCreateCategoryMutation } from '../hooks/useProducts';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Select } from './ui/select';
import { Label } from './ui/label';

export type PurchaseMode = 'billed' | 'unbilled' | 'both';

/** Whatever the server said went wrong, or a plain fallback. */
function errorText(error: unknown): string {
  const e = error as { response?: { data?: { error?: string; message?: string } }; message?: string };
  return e?.response?.data?.error ?? e?.response?.data?.message ?? e?.message ?? 'Something went wrong.';
}

interface AddCategoryDialogProps {
  /** Categories this one may be filed under. Empty means top level only. */
  parentChoices?: Array<{ id: string; label: string }>;
  /** Pre-selected parent; the user can still change it unless locked. */
  parentId?: string | null;
  /** Hide the parent picker when the caller has already settled it. */
  lockParent?: boolean;
  /** How goods of this type arrive, when the caller knows. */
  defaultPurchaseMode?: PurchaseMode;
  /** Seeds the name from whatever the user had already typed. */
  initialName?: string;
  onCreated: (category: ProductCategory) => void;
  onClose: () => void;
}

const MODE_LABELS: Array<{ value: PurchaseMode; label: string; hint: string }> = [
  { value: 'billed', label: 'With a bill', hint: 'Arrives on a supplier invoice, with tax.' },
  { value: 'unbilled', label: 'Without a bill', hint: 'No supplier invoice; the shop numbers it itself.' },
  { value: 'both', label: 'Either way', hint: 'Sometimes billed, sometimes not.' },
];

/**
 * Add a product type without leaving the form you are filling in.
 *
 * The shop takes on a kind of goods it has never sold before while a
 * purchase is being booked in, and sending someone to Settings and back
 * loses the half-filled form. How it is bought is asked here because a type
 * bought without a bill is invisible to that workflow until it is marked,
 * and nothing else in the app could say so.
 */
export function AddCategoryDialog({
  parentChoices = [],
  parentId: initialParentId = null,
  lockParent = false,
  defaultPurchaseMode = 'billed',
  initialName = '',
  onCreated,
  onClose,
}: AddCategoryDialogProps) {
  const [name, setName] = useState(initialName);
  const [parentId, setParentId] = useState<string>(initialParentId ?? '');
  const [mode, setMode] = useState<PurchaseMode>(defaultPurchaseMode);
  const create = useCreateCategoryMutation();

  // Escape closes it, as it does every other dialog here.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const slug = useMemo(() => slugify(name), [name]);
  const parentLabel = parentChoices.find((choice) => choice.id === initialParentId)?.label;

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed || !slug) return;
    create.mutate(
      {
        name: trimmed,
        slug,
        parentId: parentId || null,
        // Nothing is filed under it yet, so it is where products go.
        isLeaf: true,
        purchaseModes: mode,
      },
      { onSuccess: onCreated },
    );
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="flex w-full max-w-lg flex-col overflow-hidden rounded-lg border border-border bg-popover shadow-lg">
        <div className="flex items-center justify-between border-b px-4 py-3">
          <div className="flex items-center gap-2 font-semibold">
            <FolderPlus className="h-4 w-4 text-primary" />
            New product type
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <form onSubmit={submit} className="space-y-4 p-4">
          <div>
            <Label htmlFor="new-category-name">
              Name <span className="text-destructive">*</span>
            </Label>
            <Input
              id="new-category-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="e.g. Office Chair"
              autoFocus
            />
            {slug && <p className="mt-1 text-xs text-muted-foreground">Filed as {slug}</p>}
          </div>

          {lockParent ? (
            parentLabel && (
              <p className="text-sm text-muted-foreground">
                Goes under <span className="font-medium text-foreground">{parentLabel}</span>.
              </p>
            )
          ) : (
            <div>
              <Label htmlFor="new-category-parent">Goes under</Label>
              <Select
                id="new-category-parent"
                value={parentId}
                onChange={(event) => setParentId(event.target.value)}
              >
                <option value="">Nothing — it stands on its own</option>
                {parentChoices.map((choice) => (
                  <option key={choice.id} value={choice.id}>
                    {choice.label}
                  </option>
                ))}
              </Select>
            </div>
          )}

          <div>
            <Label htmlFor="new-category-mode">How is it bought?</Label>
            <Select
              id="new-category-mode"
              value={mode}
              onChange={(event) => setMode(event.target.value as PurchaseMode)}
            >
              {MODE_LABELS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </Select>
            <p className="mt-1 text-xs text-muted-foreground">
              {MODE_LABELS.find((option) => option.value === mode)?.hint}
            </p>
          </div>

          {create.isError && (
            <p className="text-sm text-destructive">{errorText(create.error)}</p>
          )}

          <div className="flex justify-end gap-2 border-t border-border pt-4">
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={!name.trim() || create.isPending}>
              {create.isPending && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />}
              Add type
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
