import { useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, Database, Globe, Loader2, RefreshCw, RotateCcw, Sparkles } from 'lucide-react';
import type { ItemClassification } from '@retailerp/shared-types';
import { cn } from '../../lib/utils';
import { Button } from '../../components/ui/button';
import { Badge } from '../../components/ui/badge';
import { Select } from '../../components/ui/select';
import { Input } from '../../components/ui/input';
import { StatCard } from '../../components/ui/card';
import {
  useClassifyItemsQuery,
  useForgetClassificationsMutation,
  useLookupItemMutation,
  useSaveClassificationsMutation,
} from '../../hooks/usePurchases';
import { useCreateCategoryMutation } from '../../hooks/useProducts';

/**
 * Saying what each item on the sheet actually is.
 *
 * A Tally purchase register is read with no guesswork, but it names products
 * in the shop's own shorthand and carries no category, brand or colour
 * column. This step fills that in, shows every answer for checking, and keeps
 * whatever gets corrected so the same names are right next month.
 */

export interface IdentifyResult {
  classifications: ItemClassification[];
}

interface Props {
  /** Distinct item names from the sheet. */
  itemNames: string[];
  /** How many units each name accounts for, for sorting by importance. */
  unitsByName: Map<string, number>;
  categoryOptions: Array<{ id: string; label: string }>;
  /** Top-level categories, so an approved new one can be filed under one. */
  topLevelCategories: Array<{ id: string; name: string }>;
  onBack: () => void;
  onContinue: (result: IdentifyResult) => void;
  continuing: boolean;
}

type Edited = Record<
  string,
  Partial<Pick<ItemClassification, 'categoryId' | 'brand' | 'modelNumber' | 'color' | 'isDemoUnit' | 'attributes'>>
>;

const LOW_CONFIDENCE = 0.6;

/**
 * Whether a real model number is known.
 *
 * The classifier falls back to the sheet’s own wording when it cannot pick
 * a model out, so a model identical to the raw name means it found none.
 */
function hasModel(item: ItemClassification): boolean {
  const model = item.modelNumber.trim();
  return model.length > 0 && model.toLowerCase() !== item.rawName.trim().toLowerCase();
}

export function ItemIdentifyStep(props: Props) {
  const [refreshToken, setRefreshToken] = useState(0);
  const [forceReask, setForceReask] = useState(false);
  const classify = useClassifyItemsQuery(props.itemNames, { refreshToken, forceReask });
  const saveCorrections = useSaveClassificationsMutation();
  const lookup = useLookupItemMutation();
  const forget = useForgetClassificationsMutation();
  const createCategory = useCreateCategoryMutation();

  const [edited, setEdited] = useState<Edited>({});
  const [approved, setApproved] = useState<Record<string, boolean>>({});
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [onlyProblems, setOnlyProblems] = useState(false);
  /** The row a web lookup is running for, and what each lookup reported. */
  const [lookingUp, setLookingUp] = useState<string | null>(null);
  const [forgetting, setForgetting] = useState<string | null>(null);
  const [lookupNotes, setLookupNotes] = useState<Record<string, string>>({});

  const items: ItemClassification[] = classify.data?.classifications ?? [];

  const suggestions = classify.data?.suggestedCategories ?? [];

  /** Ask the model again, even for names already answered. */
  const reaskEverything = () => {
    setEdited({});
    setForceReask(true);
    setRefreshToken((token) => token + 1);
  };

  /**
   * Run the step again without re-asking about names already settled —
   * what is wanted after new categories are added, when only the items that
   * had nowhere to go need looking at again.
   */
  const recheck = () => {
    setForceReask(false);
    setRefreshToken((token) => token + 1);
  };

  /** An item as it now stands, with any correction applied. */
  const resolve = (item: ItemClassification): ItemClassification => {
    const change = edited[item.nameKey];
    if (!change) return item;
    const categoryId = change.categoryId !== undefined ? change.categoryId : item.categoryId;
    return {
      ...item,
      ...change,
      categoryId,
      categoryLabel:
        change.categoryId !== undefined
          ? props.categoryOptions.find((option) => option.id === change.categoryId)?.label ?? null
          : item.categoryLabel,
    };
  };

  const resolved = useMemo(() => items.map(resolve), [items, edited, props.categoryOptions]);

  const counts = useMemo(() => {
    let ready = 0;
    let noCategory = 0;
    let noModel = 0;
    let lowConfidence = 0;
    let demo = 0;
    for (const item of resolved) {
      if (!item.categoryId) noCategory += 1;
      // The sheet is sometimes too terse to carry a model. Without one there
      // is nothing to look the product up by, so it has to be typed in.
      if (!hasModel(item)) noModel += 1;
      if (item.categoryId && hasModel(item)) {
        ready += 1;
        if (item.decidedBy === 'ai' && item.confidence < LOW_CONFIDENCE) lowConfidence += 1;
      }
      if (item.isDemoUnit) demo += 1;
    }
    return { ready, noCategory, noModel, lowConfidence, demo };
  }, [resolved]);

  const rows = useMemo(() => {
    const sorted = [...resolved].sort((a, b) => {
      // Anything needing attention first, then the biggest quantities.
      const weight = (item: ItemClassification) =>
        !item.categoryId || !hasModel(item)
          ? 0
          : item.decidedBy === 'ai' && item.confidence < LOW_CONFIDENCE
            ? 1
            : 2;
      const byWeight = weight(a) - weight(b);
      if (byWeight !== 0) return byWeight;
      const units = (props.unitsByName.get(b.rawName) ?? 0) - (props.unitsByName.get(a.rawName) ?? 0);
      if (units !== 0) return units;
      return a.rawName.localeCompare(b.rawName);
    });
    if (!onlyProblems) return sorted;
    return sorted.filter(
      (item) =>
        !item.categoryId ||
        !hasModel(item) ||
        (item.decidedBy === 'ai' && item.confidence < LOW_CONFIDENCE),
    );
  }, [resolved, onlyProblems, props.unitsByName]);

  const change = (nameKey: string, patch: Edited[string]) =>
    setEdited((current) => ({ ...current, [nameKey]: { ...current[nameKey], ...patch } }));

  /**
   * Drop the stored answer for this name and work it out again.
   *
   * Only the forgotten name costs a call — every other name on the sheet
   * still comes back from the store.
   */
  const reaskOne = (item: ItemClassification) => {
    setForgetting(item.nameKey);
    forget.mutate(
      { nameKeys: [item.nameKey] },
      {
        onSuccess: () => {
          setEdited((current) => {
            const next = { ...current };
            delete next[item.nameKey];
            return next;
          });
          setLookupNotes((notes) => {
            const next = { ...notes };
            delete next[item.nameKey];
            return next;
          });
          recheck();
        },
        onSettled: () => setForgetting(null),
      },
    );
  };

  /** Fetch this product’s specifications from the web and fill them in. */
  const findDetails = (item: ItemClassification) => {
    if (!item.categoryId || !hasModel(item)) return;
    setLookingUp(item.nameKey);
    lookup.mutate(
      {
        nameKey: item.nameKey,
        rawName: item.rawName,
        brand: item.brand,
        modelNumber: item.modelNumber,
        categoryId: item.categoryId,
      },
      {
        onSuccess: (result) => {
          // Only fill what is still empty. The item name is the shop's own
          // record of what it bought — "(4+128)" means 128GB — so a search
          // that reads the model differently must not overwrite it.
          const added: Record<string, string> = {};
          const alreadyKnown: string[] = [];
          for (const [name, value] of Object.entries(result.attributes)) {
            if (String(item.attributes[name] ?? '').trim()) alreadyKnown.push(name);
            else added[name] = value;
          }
          if (Object.keys(added).length > 0) {
            change(item.nameKey, { attributes: { ...item.attributes, ...added } });
          }
          setLookupNotes((notes) => ({
            ...notes,
            [item.nameKey]: Object.keys(added).length
              ? `Added ${Object.keys(added).join(', ')}.${alreadyKnown.length ? ` Kept ${alreadyKnown.join(', ')} from the item name.` : ''}`
              : alreadyKnown.length
                ? `Nothing new — the item name already gives ${alreadyKnown.join(', ')}.`
                : result.message ?? 'Nothing was found for this model.',
          }));
        },
        onError: (error) => {
          const e = error as { response?: { data?: { error?: string } }; message?: string };
          setLookupNotes((notes) => ({
            ...notes,
            [item.nameKey]: e?.response?.data?.error ?? e?.message ?? 'The lookup failed.',
          }));
        },
        onSettled: () => setLookingUp(null),
      },
    );
  };

  /** Create the categories ticked for approval, then re-identify. */
  const createApproved = async () => {
    const wanted = suggestions.filter((suggestion) => approved[suggestion.name]);
    if (wanted.length === 0) return;
    setCreating(true);
    setCreateError(null);
    try {
      for (const suggestion of wanted) {
        const parent = suggestion.parentName
          ? props.topLevelCategories.find(
              (category) => category.name.toLowerCase() === suggestion.parentName!.toLowerCase(),
            )
          : undefined;
        await createCategory.mutateAsync({
          name: suggestion.name,
          // A new category added here holds products directly.
          isLeaf: true,
          parentId: parent?.id ?? null,
        });
      }
      setApproved({});
      recheck();
    } catch (error) {
      const e = error as { response?: { data?: { error?: string } }; message?: string };
      setCreateError(e?.response?.data?.error ?? e?.message ?? 'Could not create the categories.');
    } finally {
      setCreating(false);
    }
  };

  const continueOn = async () => {
    // Keep every correction so these names come back right next time.
    const corrections = resolved.filter((item) => edited[item.nameKey] && item.categoryId);
    if (corrections.length > 0) {
      try {
        await saveCorrections.mutateAsync({
          classifications: corrections.map((item) => ({
            nameKey: item.nameKey,
            rawName: item.rawName,
            categoryId: item.categoryId,
            brand: item.brand,
            modelNumber: item.modelNumber,
            color: item.color,
            attributes: item.attributes,
            isDemoUnit: item.isDemoUnit,
          })),
        });
      } catch {
        // Not worth stopping the import over; the choice still applies to it.
      }
    }
    props.onContinue({ classifications: resolved });
  };

  if (classify.isPending) {
    return (
      <div className="flex flex-col items-center gap-3 rounded-lg border border-border bg-card py-16">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        <p className="text-sm font-medium">Working out what these {props.itemNames.length} items are…</p>
        <p className="max-w-md text-center text-xs text-muted-foreground">
          The sheet names products in your own shorthand, with no category or brand column. Names seen on an earlier
          import are answered straight away.
        </p>
      </div>
    );
  }

  if (classify.isError) {
    const e = classify.error as { response?: { data?: { error?: string } }; message?: string };
    return (
      <div className="space-y-4 rounded-lg border border-destructive/40 bg-destructive/5 p-6">
        <div className="flex items-start gap-3">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-destructive" />
          <div>
            <p className="font-medium">The items could not be identified</p>
            <p className="mt-1 text-sm text-muted-foreground">
              {e?.response?.data?.error ?? e?.message ?? 'Something went wrong.'}
            </p>
          </div>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={props.onBack}>
            Back
          </Button>
          <Button onClick={reaskEverything}>Try again</Button>
        </div>
      </div>
    );
  }

  const blocked = counts.noCategory > 0 || counts.noModel > 0;

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label="Identified" value={counts.ready} tone="success" />
        <StatCard label="Need a category" value={counts.noCategory} tone={blocked ? 'destructive' : 'default'} />
        <StatCard label="Need a model" value={counts.noModel} tone={counts.noModel ? 'warning' : 'default'} />
        <StatCard label="Worth checking" value={counts.lowConfidence} tone={counts.lowConfidence ? 'warning' : 'default'} />
        <StatCard label="Display pieces" value={counts.demo} />
      </div>

      {classify.data && (
        <p className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1.5">
            <Database className="h-3.5 w-3.5" />
            {classify.data.fromCache} from earlier imports
          </span>
          <span className="inline-flex items-center gap-1.5">
            <Sparkles className="h-3.5 w-3.5" />
            {classify.data.fromModel} identified now
          </span>
          <button type="button" onClick={reaskEverything} className="inline-flex items-center gap-1.5 underline hover:text-foreground">
            <RefreshCw className={cn('h-3.5 w-3.5', classify.isFetching && 'animate-spin')} />
            Identify all again
          </button>
        </p>
      )}

      {classify.data?.error && (
        <p className="rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-sm">{classify.data.error}</p>
      )}

      {suggestions.length > 0 && (
        <div className="space-y-3 rounded-lg border border-border bg-muted/30 p-4">
          <div>
            <p className="text-sm font-medium">
              {suggestions.length} product type{suggestions.length === 1 ? '' : 's'} in this sheet have no category yet
            </p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Tick the ones to add to your categories. Nothing is created until you press Add.
            </p>
          </div>
          <ul className="space-y-2">
            {suggestions.map((suggestion) => (
              <li key={suggestion.name} className="flex items-start gap-3 text-sm">
                <input
                  type="checkbox"
                  id={`new-cat-${suggestion.name}`}
                  checked={Boolean(approved[suggestion.name])}
                  onChange={(event) =>
                    setApproved((current) => ({ ...current, [suggestion.name]: event.target.checked }))
                  }
                  className="mt-1 h-4 w-4 rounded border-border"
                />
                <label htmlFor={`new-cat-${suggestion.name}`} className="cursor-pointer">
                  <span className="font-medium">{suggestion.name}</span>
                  {suggestion.parentName && (
                    <span className="text-muted-foreground"> under {suggestion.parentName}</span>
                  )}
                  <span className="text-muted-foreground">
                    {' '}
                    — {suggestion.items} item{suggestion.items === 1 ? '' : 's'}
                  </span>
                  <span className="mt-0.5 block text-xs text-muted-foreground">{suggestion.examples.join(', ')}</span>
                </label>
              </li>
            ))}
          </ul>
          {createError && <p className="text-sm text-destructive">{createError}</p>}
          <Button
            size="sm"
            onClick={createApproved}
            loading={creating}
            disabled={!Object.values(approved).some(Boolean)}
          >
            Add the ticked categories
          </Button>
        </div>
      )}

      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          {rows.length} of {resolved.length} item name{resolved.length === 1 ? '' : 's'}
        </p>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={onlyProblems}
            onChange={(event) => setOnlyProblems(event.target.checked)}
            className="h-4 w-4 rounded border-border"
          />
          Only those needing attention
        </label>
      </div>

      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-left text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="px-3 py-2 font-medium">Item on the sheet</th>
              <th className="px-3 py-2 font-medium">Category</th>
              <th className="px-3 py-2 font-medium">Brand</th>
              <th className="px-3 py-2 font-medium">Model</th>
              <th className="px-3 py-2 font-medium">Colour</th>
              <th className="px-3 py-2 text-center font-medium">Display</th>
              <th className="px-3 py-2 font-medium">Details</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.map((item) => {
              const units = props.unitsByName.get(item.rawName) ?? 0;
              const unsure = item.decidedBy === 'ai' && item.confidence < LOW_CONFIDENCE;
              return (
                <tr key={item.nameKey} className={cn(!item.categoryId && 'bg-destructive/5')}>
                  <td className="max-w-[22rem] px-3 py-2 align-top">
                    <p className="font-medium leading-snug">{item.rawName}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {units} unit{units === 1 ? '' : 's'}
                      {item.modelNumber && item.modelNumber !== item.rawName && <> · model {item.modelNumber}</>}
                    </p>
                    {item.note && <p className="mt-0.5 text-xs text-warning">{item.note}</p>}
                  </td>
                  <td className="px-3 py-2 align-top">
                    <Select
                      value={item.categoryId ?? ''}
                      onChange={(event) => change(item.nameKey, { categoryId: event.target.value || null })}
                      className={cn('min-w-[13rem]', !item.categoryId && 'border-destructive')}
                    >
                      <option value="">Choose a category…</option>
                      {props.categoryOptions.map((option) => (
                        <option key={option.id} value={option.id}>
                          {option.label}
                        </option>
                      ))}
                    </Select>
                    <div className="mt-1 flex flex-wrap items-center gap-1">
                      {item.decidedBy === 'user' && <Badge tone="neutral">Your choice</Badge>}
                      {item.decidedBy === 'cache' && <Badge tone="neutral">From an earlier import</Badge>}
                      {edited[item.nameKey]?.categoryId !== undefined && <Badge tone="neutral">Changed</Badge>}
                      {unsure && <Badge tone="warning">Please check</Badge>}
                      {/* A stored answer can be plainly wrong. Correcting it above is
                          kept as your decision; this instead throws the stored one away
                          so it is worked out afresh. */}
                      {(item.decidedBy === 'cache' || item.decidedBy === 'user') && (
                        <button
                          type="button"
                          onClick={() => reaskOne(item)}
                          disabled={forgetting === item.nameKey}
                          className="inline-flex items-center gap-1 text-xs text-muted-foreground underline hover:text-foreground disabled:opacity-50"
                          title="Forget the stored answer and work this name out again"
                        >
                          <RotateCcw className={cn('h-3 w-3', forgetting === item.nameKey && 'animate-spin')} />
                          Work out again
                        </button>
                      )}
                    </div>
                  </td>
                  <td className="px-3 py-2 align-top">
                    <Input
                      value={item.brand}
                      onChange={(event) => change(item.nameKey, { brand: event.target.value })}
                      className="min-w-[8rem]"
                      placeholder="Brand"
                    />
                  </td>
                  <td className="px-3 py-2 align-top">
                    <Input
                      value={hasModel(item) ? item.modelNumber : ''}
                      onChange={(event) => change(item.nameKey, { modelNumber: event.target.value })}
                      className={cn('min-w-[9rem]', !hasModel(item) && 'border-warning')}
                      placeholder="Model number"
                    />
                    {!hasModel(item) && (
                      <p className="mt-1 text-xs text-warning">
                        The sheet does not say — type it in to look the details up.
                      </p>
                    )}
                  </td>
                  <td className="px-3 py-2 align-top">
                    <Input
                      value={item.color ?? ''}
                      onChange={(event) => change(item.nameKey, { color: event.target.value || null })}
                      className="min-w-[8rem]"
                      placeholder="—"
                    />
                  </td>
                  <td className="px-3 py-2 text-center align-top">
                    <input
                      type="checkbox"
                      checked={item.isDemoUnit}
                      onChange={(event) => change(item.nameKey, { isDemoUnit: event.target.checked })}
                      className="mt-2 h-4 w-4 rounded border-border"
                      aria-label={`${item.rawName} is a display piece`}
                    />
                  </td>
                  <td className="px-3 py-2 align-top">
                    <Button
                      size="xs"
                      variant="outline"
                      onClick={() => findDetails(item)}
                      disabled={!item.categoryId || !hasModel(item) || lookingUp === item.nameKey}
                      loading={lookingUp === item.nameKey}
                      title={
                        !hasModel(item)
                          ? 'Enter the model number first'
                          : !item.categoryId
                            ? 'Choose a category first'
                            : 'Search the web for this product’s details'
                      }
                    >
                      <Globe className="mr-1 h-3 w-3" />
                      Find details
                    </Button>
                    {Object.keys(item.attributes).length > 0 && (
                      <p className="mt-1 max-w-[12rem] text-xs text-muted-foreground">
                        {Object.entries(item.attributes).map(([k, v]) => `${k}: ${v}`).join(', ')}
                      </p>
                    )}
                    {lookupNotes[item.nameKey] && (
                      <p className="mt-1 max-w-[12rem] text-xs text-muted-foreground">{lookupNotes[item.nameKey]}</p>
                    )}
                  </td>
                </tr>
              );
            })}
            {rows.length === 0 && (
              <tr>
                <td colSpan={7} className="px-3 py-8 text-center text-sm text-muted-foreground">
                  <CheckCircle2 className="mx-auto mb-2 h-5 w-5 text-success" />
                  Nothing needs attention.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Button variant="outline" onClick={props.onBack}>
          Back
        </Button>
        <Button onClick={continueOn} loading={props.continuing || saveCorrections.isPending} disabled={blocked}>
          Check the invoices
        </Button>
        {blocked && (
          <p className="text-sm text-destructive">
            {[
              counts.noCategory > 0 && `${counts.noCategory} still need a category`,
              counts.noModel > 0 && `${counts.noModel} still need a model number`,
            ]
              .filter(Boolean)
              .join(', ')}
            .
          </p>
        )}
      </div>
    </div>
  );
}
