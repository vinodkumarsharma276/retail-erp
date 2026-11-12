import { useMemo, useState } from 'react';
import { Copy, Plus, Trash2 } from 'lucide-react';
import type { ProductCategory } from '@retailerp/shared-types';
import { AddCategoryDialog } from '../../components/AddCategoryDialog';
import { BrandInput } from '../../components/BrandInput';
import { ModelInput } from '../../components/ModelInput';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Select } from '../../components/ui/select';
import { useCategoryTreeQuery } from '../../hooks/useProducts';
import { useCanCheck } from '../../hooks/usePermission';
import { cn } from '../../lib/utils';

/** One product bought under the account number; `quantity` of them make that many entries. */
export interface ItemRow {
  key: string;
  categoryId: string;
  brand: string;
  model: string;
  quantity: number;
  /** The entry being edited (one entry: no quantity, can't be removed). */
  existing?: boolean;
  /** Its type when the editor opened ('' for imports without one, which may stay blank). */
  originalCategoryId?: string;
}

export const MAX_QUANTITY = 100;
export const MAX_UNITS = 200;

let seq = 0;
export const newItemRow = (from?: Partial<ItemRow>): ItemRow => ({
  categoryId: '',
  brand: '',
  model: '',
  quantity: 1,
  ...from,
  existing: false,
  originalCategoryId: undefined,
  key: `item-${++seq}`,
});

/** A row is ready when it has a type — or is an imported entry that never had one. */
export const rowReady = (r: ItemRow) => !!r.categoryId || (!!r.existing && !r.originalCategoryId);

/** Every type of the tree, by its full path ("Refrigerator › Deep Freezer"), in tree order. */
function typeOptions(tree: ProductCategory[] | undefined) {
  const out: Array<{ id: string; label: string }> = [];
  const walk = (nodes: ProductCategory[], path: string[]) => {
    for (const n of nodes) {
      if (n.isActive === false) continue;
      const label = [...path, n.name];
      out.push({ id: n.id, label: label.join(' › ') });
      if (n.children?.length) walk(n.children, label);
    }
  };
  walk(tree ?? [], []);
  return out;
}

/**
 * The products of one purchase, laid out like a spreadsheet: a row per
 * product, with its type, brand, model and how many. Rows can be added,
 * duplicated and removed. Each unit is saved as its own entry under the same
 * account number, customer, date and shop.
 */
export function ItemsTable({ rows, onChange, sheetText }: { rows: ItemRow[]; onChange: (rows: ItemRow[]) => void; sheetText?: string | null }) {
  const { data: tree } = useCategoryTreeQuery();
  const options = useMemo(() => typeOptions(tree), [tree]);
  const can = useCanCheck();
  const [adding, setAdding] = useState<string | null>(null);
  const units = rows.reduce((n, r) => n + (r.existing ? 1 : r.quantity), 0);

  const update = (key: string, change: Partial<ItemRow>) => onChange(rows.map((r) => (r.key === key ? { ...r, ...change } : r)));
  const duplicate = (index: number) => {
    const copy = newItemRow({ categoryId: rows[index].categoryId, brand: rows[index].brand, model: rows[index].model, quantity: rows[index].existing ? 1 : rows[index].quantity });
    onChange([...rows.slice(0, index + 1), copy, ...rows.slice(index + 1)]);
  };
  const remove = (key: string) => onChange(rows.filter((r) => r.key !== key));

  return (
    <div>
      <div className="overflow-x-auto md:overflow-visible">
        <table className="w-full min-w-[720px] border-collapse text-sm">
          <thead>
            <tr className="border-b text-left text-xs text-muted-foreground">
              <th className="w-8 py-2 pr-2 font-medium">#</th>
              <th className="py-2 pr-2 font-medium">
                Product type <span className="text-destructive">*</span>
              </th>
              <th className="w-44 py-2 pr-2 font-medium">Brand</th>
              <th className="w-52 py-2 pr-2 font-medium">Model</th>
              <th className="w-20 py-2 pr-2 font-medium">Qty</th>
              <th className="w-20 py-2 text-right font-medium">
                <span className="sr-only">Row actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => {
              const missing = !rowReady(r);
              return (
                <tr key={r.key} className="border-b align-top last:border-0">
                  <td className="py-2 pr-2 pt-4 text-xs tabular-nums text-muted-foreground">{i + 1}</td>
                  <td className="py-2 pr-2">
                    <Select
                      aria-label={`Product type, item ${i + 1}`}
                      value={r.categoryId}
                      onChange={(e) => {
                        if (e.target.value === '__new__') setAdding(r.key);
                        else update(r.key, { categoryId: e.target.value });
                      }}
                      className={cn(missing && 'border-warning')}
                    >
                      <option value="">{r.existing && !r.originalCategoryId ? '— No type yet —' : 'Choose…'}</option>
                      {options.map((o) => (
                        <option key={o.id} value={o.id}>
                          {o.label}
                        </option>
                      ))}
                      {can('categories.create') && <option value="__new__">+ New type…</option>}
                    </Select>
                    {r.existing && sheetText && !r.originalCategoryId && (
                      <p className="mt-1 text-xs text-muted-foreground">The sheet said “{sheetText}”.</p>
                    )}
                  </td>
                  <td className="py-2 pr-2">
                    <BrandInput
                      aria-label={`Brand, item ${i + 1}`}
                      categoryId={r.categoryId || undefined}
                      value={r.brand}
                      onChange={(e) => update(r.key, { brand: e.target.value })}
                    />
                  </td>
                  <td className="py-2 pr-2">
                    <ModelInput
                      aria-label={`Model, item ${i + 1}`}
                      categoryId={r.categoryId || undefined}
                      brand={r.brand}
                      value={r.model}
                      onChange={(e) => update(r.key, { model: e.target.value })}
                      placeholder="Model…"
                    />
                  </td>
                  <td className="py-2 pr-2">
                    <Input
                      aria-label={`Quantity, item ${i + 1}`}
                      type="number"
                      min={1}
                      max={MAX_QUANTITY}
                      value={r.existing ? 1 : r.quantity}
                      disabled={r.existing}
                      title={r.existing ? 'This entry is one item; add rows for more' : undefined}
                      onChange={(e) => update(r.key, { quantity: Math.min(MAX_QUANTITY, Math.max(1, Math.floor(Number(e.target.value) || 1))) })}
                      className="text-right tabular-nums"
                    />
                  </td>
                  <td className="py-2 text-right">
                    <div className="flex justify-end gap-0.5 pt-1">
                      <button
                        type="button"
                        onClick={() => duplicate(i)}
                        className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                        title="Duplicate this row"
                        aria-label={`Duplicate item ${i + 1}`}
                      >
                        <Copy className="h-4 w-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => remove(r.key)}
                        disabled={r.existing || rows.length === 1}
                        className="rounded-md p-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive disabled:pointer-events-none disabled:opacity-30"
                        title={r.existing ? 'Delete the entry from its page instead' : 'Remove this row'}
                        aria-label={`Remove item ${i + 1}`}
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <Button type="button" variant="secondary" size="sm" onClick={() => onChange([...rows, newItemRow()])} icon={<Plus className="h-3.5 w-3.5" />}>
          Add item
        </Button>
        <p className={cn('text-xs', units > MAX_UNITS ? 'text-destructive' : 'text-muted-foreground')}>
          {rows.some((r) => r.existing)
            ? units === 1
              ? 'Only this entry is saved.'
              : `This entry is saved and ${units - 1} new ${units - 1 === 1 ? 'entry is' : 'entries are'} added under the same account number.`
            : units === 1
              ? '1 entry will be saved under this account number.'
              : `${units} entries will be saved (one per item) under this account number.`}
          {units > MAX_UNITS ? ` At most ${MAX_UNITS} at once.` : ''}
        </p>
      </div>
      {adding && (
        <AddCategoryDialog
          parentChoices={(tree ?? []).map((n) => ({ id: n.id, label: n.name }))}
          parentId={null}
          onCreated={(category) => {
            update(adding, { categoryId: category.id });
            setAdding(null);
          }}
          onClose={() => setAdding(null)}
        />
      )}
    </div>
  );
}
