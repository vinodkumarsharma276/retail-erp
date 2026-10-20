import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useForm, useFieldArray, FormProvider } from 'react-hook-form';
import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  Check,
  Loader2,
  Plus,
  Search,
  Trash2,
} from 'lucide-react';
import { cn } from '../../lib/utils';
import { FormSection, FormGrid, Field } from '../../components/ui/form';
import { Input } from '../../components/ui/input';
import { Select } from '../../components/ui/select';
import { Textarea } from '../../components/ui/textarea';
import { Button } from '../../components/ui/button';
import { Badge } from '../../components/ui/badge';
import { useDebounce } from '../../hooks/useDebounce';
import { useDistributorsQuery } from '../../hooks/useDistributors';
import {
  useCreateUnbilledPurchaseMutation,
  useStartUnbilledSeriesMutation,
  useUnbilledTypesQuery,
} from '../../hooks/usePurchases';
import { DynamicAttributeFields } from '../../components/DynamicAttributeFields';
import { BrandInput } from '../../components/BrandInput';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { AddDistributorDialog } from '../../components/AddDistributorDialog';
import { AddCategoryDialog } from '../../components/AddCategoryDialog';
import { useCanCheck } from '../../hooks/usePermission';
import { useToast } from '../../stores/toast-store';
import { formatINR } from '@retailerp/shared-utils';
import type {
  CreateUnbilledPurchaseRequest,
  Distributor,
  DistributorListItem,
  UnbilledType,
  UnbilledTypeChoice,
} from '@retailerp/shared-types';

/**
 * Recording a purchase made without a bill.
 *
 * Furniture and almirahs are often bought with no supplier invoice at all.
 * The goods are real stock from a real supplier, so the screen asks the same
 * things as an ordinary purchase; what it does not ask for is tax, and it
 * does not ask the user what to call the invoice. The shop numbers these
 * itself, one running series per product type, and nobody should have to go
 * and look up where FURN had reached.
 */

const STEPS = ['Select Supplier', 'Invoice Details', 'Add Items', 'Review'] as const;

interface UnbilledItemValues {
  /** The kind of goods this is — a leaf under the chosen type, e.g. Wardrobe. */
  categoryId: string;
  brand: string;
  modelNumber: string;
  /** One per line. Furniture rarely has any, so this stays empty. */
  serialNumbers: string;
  quantity: number | '';
  purchasePrice: number | '';
  mrp: number | '';
  color: string;
  warrantyMonths: number | '';
  dynamicAttributes: Record<string, unknown>;
}

interface UnbilledFormValues {
  invoiceDate: string;
  notes: string;
  items: UnbilledItemValues[];
}

const emptyItem = (categoryId: string): UnbilledItemValues => ({
  categoryId,
  brand: '',
  modelNumber: '',
  serialNumbers: '',
  quantity: 1,
  purchasePrice: '',
  mrp: '',
  color: '',
  warrantyMonths: '',
  dynamicAttributes: {},
});

export interface UnbilledPurchaseFormProps {
  /** Back to the choice between a billed purchase and one without a bill. */
  onBack: () => void;
}

export function UnbilledPurchaseForm({ onBack }: UnbilledPurchaseFormProps) {
  const navigate = useNavigate();
  const toast = useToast();
  const [currentStep, setCurrentStep] = useState(0);

  // Step 1 — supplier
  const [selectedDistributor, setSelectedDistributor] = useState<DistributorListItem | null>(null);
  const [distributorSearchText, setDistributorSearchText] = useState('');
  const [isAddDistributorOpen, setIsAddDistributorOpen] = useState(false);
  // A kind of goods the shop has only just taken on.
  const [isAddTypeOpen, setIsAddTypeOpen] = useState(false);
  const can = useCanCheck();
  const mayAddType = can('categories.create');
  const debouncedDistSearch = useDebounce(distributorSearchText, 300);

  const distributorsQuery = useDistributorsQuery({
    page: 1,
    pageSize: 20,
    search: debouncedDistSearch.length >= 3 ? debouncedDistSearch : undefined,
  });
  const distributorOptions = distributorsQuery.data?.data ?? [];

  const handleDistributorCreated = (created: Distributor) => {
    setSelectedDistributor({
      ...created,
      totalProductsPurchased: 0,
      totalPaymentPaid: 0,
      pendingPayment: 0,
    });
    setDistributorSearchText(created.companyName);
    setIsAddDistributorOpen(false);
  };

  // Step 2 — product type, its numbering, and the date
  const typesQuery = useUnbilledTypesQuery();
  const types = typesQuery.data ?? [];
  const [selectedTypeId, setSelectedTypeId] = useState<string | null>(null);
  const [selectedChoiceId, setSelectedChoiceId] = useState<string | null>(null);

  const selectedType = useMemo<UnbilledType | null>(
    () => types.find((t) => t.series.categoryId === selectedTypeId) ?? null,
    [types, selectedTypeId],
  );
  const choiceById = useMemo(() => {
    const map = new Map<string, UnbilledTypeChoice>();
    for (const choice of selectedType?.choices ?? []) map.set(choice.categoryId, choice);
    return map;
  }, [selectedType]);

  const startSeries = useStartUnbilledSeriesMutation();
  const [seriesPrefix, setSeriesPrefix] = useState('');
  const [seriesStartNumber, setSeriesStartNumber] = useState('');
  const [seriesError, setSeriesError] = useState('');

  const handleStartSeries = () => {
    if (!selectedType) return;
    setSeriesError('');
    startSeries.mutate(
      {
        categoryId: selectedType.series.categoryId,
        prefix: seriesPrefix.trim().toUpperCase(),
        startNumber: Number(seriesStartNumber) || 1,
      },
      {
        onError: (error) => {
          setSeriesError(
            (error as any)?.response?.data?.error
              ?? (error as any)?.response?.data?.message
              ?? 'Could not save the numbering.',
          );
        },
      },
    );
  };

  // Form
  const methods = useForm<UnbilledFormValues>({
    defaultValues: {
      invoiceDate: new Date().toISOString().split('T')[0],
      notes: '',
      items: [emptyItem('')],
    },
  });
  const {
    register,
    handleSubmit,
    watch,
    control,
    trigger,
    formState: { errors },
  } = methods;

  const { fields, append, remove, replace } = useFieldArray({ control, name: 'items' });
  const watchedItems = watch('items');

  const pickType = (type: UnbilledType, choice: UnbilledTypeChoice) => {
    setSelectedTypeId(type.series.categoryId);
    setSelectedChoiceId(choice.categoryId);
    setSeriesPrefix(type.series.prefix);
    setSeriesStartNumber(String(type.series.nextNumber));
    setSeriesError('');
    // Every item on this purchase belongs to the type just chosen, so the
    // rows start again rather than carrying a kind from another type.
    replace([emptyItem(choice.categoryId)]);
  };

  const parsedSerials = useMemo(
    () =>
      watchedItems.map((item) =>
        (item.serialNumbers || '')
          .split('\n')
          .map((s) => s.trim())
          .filter(Boolean),
      ),
    [watchedItems],
  );

  /** Serials drive the unit count when there are any; otherwise Quantity does. */
  const unitCount = (index: number) => {
    const serials = parsedSerials[index]?.length ?? 0;
    if (serials > 0) return serials;
    const quantity = Number(watchedItems[index]?.quantity);
    return Number.isFinite(quantity) && quantity > 0 ? Math.floor(quantity) : 1;
  };

  const duplicateSerial = useMemo(() => {
    const map = new Map<number, string>();
    const seen = new Map<string, number>();
    parsedSerials.forEach((serials, index) => {
      const local = new Set<string>();
      for (const serial of serials) {
        if (local.has(serial)) {
          map.set(index, `Serial “${serial}” is on this item twice`);
          continue;
        }
        local.add(serial);
        const previous = seen.get(serial);
        if (previous !== undefined) {
          map.set(index, `Serial “${serial}” is also on item #${previous + 1}`);
          if (!map.has(previous)) map.set(previous, `Serial “${serial}” is also on item #${index + 1}`);
        } else {
          seen.set(serial, index);
        }
      }
    });
    return map;
  }, [parsedSerials]);

  const totalUnits = watchedItems.reduce((sum, _item, index) => sum + unitCount(index), 0);
  const totalPaid = watchedItems.reduce(
    (sum, item, index) => sum + (Number(item.purchasePrice) || 0) * unitCount(index),
    0,
  );

  const createMutation = useCreateUnbilledPurchaseMutation();
  const [isConfirmOpen, setIsConfirmOpen] = useState(false);

  // -------------------------------------------------------------------------
  // Navigation
  // -------------------------------------------------------------------------
  const canGoNext = () => {
    switch (currentStep) {
      case 0:
        return Boolean(selectedDistributor);
      case 1:
        // A type whose numbering has not been started has no number to offer,
        // so there is nothing to go on with until somebody sets it.
        return Boolean(selectedChoiceId && selectedType?.series.started && watch('invoiceDate'));
      case 2:
        return (
          watchedItems.length > 0 &&
          watchedItems.every((item) => item.categoryId && item.modelNumber && item.purchasePrice) &&
          duplicateSerial.size === 0
        );
      default:
        return false;
    }
  };

  const goNext = async () => {
    if (currentStep === 1) {
      if (!(await trigger('invoiceDate'))) return;
    }
    if (currentStep === 2) {
      if (!(await trigger('items')) || duplicateSerial.size > 0) return;
    }
    setCurrentStep((step) => Math.min(step + 1, STEPS.length - 1));
  };

  const goBack = () => {
    if (currentStep === 0) {
      onBack();
      return;
    }
    setCurrentStep((step) => Math.max(step - 1, 0));
  };

  // -------------------------------------------------------------------------
  // Submit
  // -------------------------------------------------------------------------
  const onSubmit = (formData: UnbilledFormValues) => {
    if (!selectedDistributor || !selectedType) return;

    // Each unit becomes its own product record, the same as a billed purchase
    // and the same as the sheet import.
    const items = formData.items.flatMap((item, index) => {
      const serials = parsedSerials[index] ?? [];
      const base = {
        categoryId: item.categoryId,
        brand: item.brand.trim(),
        modelNumber: item.modelNumber.trim(),
        purchasePrice: Number(item.purchasePrice),
        mrp: Number(item.mrp) > 0 ? Number(item.mrp) : undefined,
        color: item.color.trim() || undefined,
        warrantyMonths: item.warrantyMonths ? Number(item.warrantyMonths) : undefined,
        dynamicAttributes: item.dynamicAttributes,
      };
      if (serials.length === 0) {
        return Array.from({ length: unitCount(index) }, () => ({ ...base }));
      }
      return serials.map((serialNumber) => ({ ...base, serialNumber }));
    });

    const payload: CreateUnbilledPurchaseRequest = {
      distributorId: selectedDistributor.id,
      seriesCategoryId: selectedType.series.categoryId,
      invoiceDate: formData.invoiceDate,
      notes: formData.notes.trim() || undefined,
      items,
    };

    createMutation.mutate(payload, {
      onSuccess: (purchase) => {
        setIsConfirmOpen(false);
        // The number was issued as it saved, so say which one it got.
        toast.success(`Recorded without a bill as ${purchase.invoiceNumber}`);
        navigate(`/purchases/${purchase.id}`, { replace: true });
      },
    });
  };

  const errorMessage = createMutation.error
    ? (createMutation.error as any)?.response?.data?.error
      ?? (createMutation.error as any)?.response?.data?.message
      ?? 'Something went wrong. Please try again.'
    : null;

  const addItem = () => append(emptyItem(selectedChoiceId ?? ''));

  return (
    <div className="mx-auto max-w-[1600px]">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <button
            onClick={onBack}
            className="rounded-md p-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
          <div>
            <h1 className="text-display">Purchase without a bill</h1>
            <p className="text-caption mt-0.5">
              No supplier invoice, no tax. The invoice number comes from the shop’s own series.
            </p>
          </div>
        </div>
      </div>

      {isAddDistributorOpen && (
        <AddDistributorDialog
          initialCompanyName={distributorSearchText.trim() || undefined}
          onCreated={handleDistributorCreated}
          onClose={() => setIsAddDistributorOpen(false)}
        />
      )}

      {/* Reached from this screen, so it is offered as bought without a
          bill; the list here shows nothing else. */}
      {isAddTypeOpen && (
        <AddCategoryDialog
          parentChoices={types.map((type) => ({
            id: type.series.categoryId,
            label: type.series.categoryName,
          }))}
          defaultPurchaseMode="unbilled"
          onCreated={() => {
            setIsAddTypeOpen(false);
            typesQuery.refetch();
          }}
          onClose={() => setIsAddTypeOpen(false)}
        />
      )}

      {/* Step indicator */}
      <div className="mb-8 flex items-center gap-2 overflow-x-auto pb-2">
        {STEPS.map((step, index) => (
          <div key={step} className="flex items-center gap-2">
            <button
              onClick={() => {
                if (index < currentStep) setCurrentStep(index);
              }}
              disabled={index > currentStep}
              className={cn(
                'flex items-center gap-2 whitespace-nowrap rounded-full px-4 py-1.5 text-sm font-medium transition-colors',
                index === currentStep
                  ? 'bg-primary text-primary-foreground'
                  : index < currentStep
                    ? 'cursor-pointer bg-primary/10 text-primary hover:bg-primary/20'
                    : 'bg-muted text-muted-foreground',
              )}
            >
              {index < currentStep ? (
                <Check className="h-4 w-4" />
              ) : (
                <span className="flex h-5 w-5 items-center justify-center rounded-full border text-xs">
                  {index + 1}
                </span>
              )}
              {step}
            </button>
            {index < STEPS.length - 1 && <div className="h-px w-8 bg-border" />}
          </div>
        ))}
      </div>

      <FormProvider {...methods}>
        <form onSubmit={handleSubmit(onSubmit)}>
          {/* Step 1 — supplier */}
          {currentStep === 0 && (
            <FormSection
              title="Who was it bought from?"
              description="There is no bill, but there is still a supplier."
            >
              <div className="mb-4 flex flex-wrap items-center gap-2">
                <div className="relative w-full max-w-md">
                  <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <input
                    type="text"
                    value={distributorSearchText}
                    onChange={(event) => setDistributorSearchText(event.target.value)}
                    placeholder="Search suppliers by name (min 3 chars)..."
                    className={cn(
                      'w-full rounded-md border bg-field py-2.5 pl-9 pr-3 text-sm',
                      'placeholder:text-muted-foreground',
                      'focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2',
                    )}
                  />
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="lg"
                  icon={<Plus className="h-4 w-4" />}
                  onClick={() => setIsAddDistributorOpen(true)}
                >
                  New Supplier
                </Button>
              </div>

              {distributorsQuery.isLoading ? (
                <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Loading suppliers...
                </div>
              ) : distributorOptions.length === 0 ? (
                <p className="py-4 text-sm text-muted-foreground">
                  {debouncedDistSearch.length >= 3
                    ? 'No suppliers match that search.'
                    : 'Type at least 3 characters to search.'}
                </p>
              ) : null}

              <div className="grid max-h-80 grid-cols-1 gap-3 overflow-y-auto sm:grid-cols-2">
                {distributorOptions.map((distributor) => (
                  <button
                    key={distributor.id}
                    type="button"
                    onClick={() => setSelectedDistributor(distributor)}
                    className={cn(
                      'rounded-lg border p-4 text-left transition-colors',
                      selectedDistributor?.id === distributor.id
                        ? 'border-primary bg-primary/5 ring-1 ring-primary'
                        : 'hover:bg-muted',
                    )}
                  >
                    <p className="text-sm font-medium">{distributor.companyName}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {distributor.contactPerson} &middot; {distributor.phone}
                    </p>
                  </button>
                ))}
              </div>
            </FormSection>
          )}

          {/* Step 2 — product type, the number it will take, and the date */}
          {currentStep === 1 && (
            <div className="space-y-4">
              <FormSection
                title="What kind of goods?"
                description="Only the types the shop buys without a bill are shown."
              >
                {typesQuery.isLoading ? (
                  <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Loading product types...
                  </div>
                ) : types.length === 0 ? (
                  <div className="rounded-md border border-dashed p-4 text-sm">
                    <p className="text-muted-foreground">
                      No product type is marked as bought without a bill yet.
                    </p>
                    {mayAddType ? (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="mt-3"
                        onClick={() => setIsAddTypeOpen(true)}
                      >
                        <Plus className="mr-1 h-3.5 w-3.5" />
                        Add the first one
                      </Button>
                    ) : (
                      <p className="mt-1 text-muted-foreground">
                        Someone who can change categories has to mark one first.
                      </p>
                    )}
                  </div>
                ) : (
                  <div className="space-y-4">
                    {types.map((type) => (
                      <div key={type.series.categoryId}>
                        <div className="mb-2 flex items-center gap-2">
                          <h4 className="text-overline">{type.series.categoryName}</h4>
                          <Badge tone={type.series.started ? 'neutral' : 'warning'}>
                            {type.series.started
                              ? `next ${type.series.nextInvoiceNumber}`
                              : 'numbering not started'}
                          </Badge>
                        </div>
                        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                          {type.choices.map((choice) => (
                            <button
                              key={choice.categoryId}
                              type="button"
                              onClick={() => pickType(type, choice)}
                              className={cn(
                                'rounded-lg border px-3 py-2.5 text-left text-sm transition-colors',
                                selectedChoiceId === choice.categoryId
                                  ? 'border-primary bg-primary/5 ring-1 ring-primary'
                                  : 'hover:bg-muted',
                              )}
                            >
                              {choice.categoryName}
                            </button>
                          ))}
                        </div>
                      </div>
                    ))}
                    {mayAddType && (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => setIsAddTypeOpen(true)}
                      >
                        <Plus className="mr-1 h-3.5 w-3.5" />
                        New type
                      </Button>
                    )}
                  </div>
                )}
              </FormSection>

              {selectedType && (
                <FormSection
                  title="Invoice number"
                  description={`Taken from the ${selectedType.series.categoryName} series — the shop’s own numbering, not the supplier’s.`}
                >
                  {selectedType.series.started ? (
                    <div className="flex flex-wrap items-center gap-4">
                      <div className="rounded-lg border-2 border-primary/30 bg-primary/5 px-5 py-3">
                        <p className="text-xs font-medium text-muted-foreground">
                          This purchase will be
                        </p>
                        <p className="font-mono text-2xl font-semibold text-primary">
                          {selectedType.series.nextInvoiceNumber}
                        </p>
                      </div>
                      <p className="max-w-sm text-xs text-muted-foreground">
                        The number is issued when you save, so it is always the next one
                        free. If somebody else records a {selectedType.series.prefix}{' '}
                        purchase first, this one moves on by itself.
                      </p>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      <p className="text-sm text-muted-foreground">
                        Nobody has numbered {selectedType.series.categoryName} purchases in
                        the system yet. Say where the written books have reached and the
                        numbering carries on from there.
                      </p>
                      <FormGrid>
                        <Field label="Letters" span={3} hint="e.g. FURN">
                          <Input
                            value={seriesPrefix}
                            onChange={(event) => setSeriesPrefix(event.target.value.toUpperCase())}
                            placeholder="FURN"
                            className="font-mono"
                          />
                        </Field>
                        <Field label="First number" span={3} hint="The next one you would write">
                          <Input
                            type="number"
                            min={1}
                            value={seriesStartNumber}
                            onChange={(event) => setSeriesStartNumber(event.target.value)}
                            placeholder="1"
                          />
                        </Field>
                        <Field label="" span={6}>
                          <Button
                            type="button"
                            className="mt-1"
                            loading={startSeries.isPending}
                            disabled={!seriesPrefix.trim() || !Number(seriesStartNumber)}
                            onClick={handleStartSeries}
                          >
                            Start at {seriesPrefix.trim() || '—'}
                            {Number(seriesStartNumber) || ''}
                          </Button>
                        </Field>
                      </FormGrid>
                      {seriesError && (
                        <p className="flex items-center gap-2 text-sm text-destructive">
                          <AlertCircle className="h-4 w-4 shrink-0" />
                          {seriesError}
                        </p>
                      )}
                    </div>
                  )}
                </FormSection>
              )}

              <FormSection title="When was it bought?">
                <FormGrid>
                  <Field
                    label="Purchase date"
                    required
                    span={3}
                    htmlFor="invoiceDate"
                    error={errors.invoiceDate?.message}
                  >
                    <Input
                      id="invoiceDate"
                      type="date"
                      {...register('invoiceDate', { required: 'Purchase date is required' })}
                    />
                  </Field>
                  <Field label="Notes" span={9} htmlFor="notes">
                    <Textarea
                      id="notes"
                      rows={2}
                      {...register('notes')}
                      placeholder="Anything worth remembering about this purchase..."
                    />
                  </Field>
                </FormGrid>
              </FormSection>
            </div>
          )}

          {/* Step 3 — the items themselves */}
          {currentStep === 2 && (
            <section className="space-y-4">
              {fields.map((field, index) => {
                const categoryId = watchedItems[index]?.categoryId || '';
                return (
                  <FormSection
                    key={field.id}
                    title={`Item ${index + 1}`}
                    actions={
                      fields.length > 1 && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => remove(index)}
                          icon={<Trash2 className="h-3.5 w-3.5" />}
                          className="text-destructive hover:bg-destructive-muted hover:text-destructive"
                        >
                          Remove
                        </Button>
                      )
                    }
                  >
                    <FormGrid>
                      {/* The type was chosen already; this only picks which kind
                          of it this item is, so one invoice can hold a wardrobe
                          and a sofa on the same FURN number. A type with only
                          one kind beneath it has nothing to ask, but the field
                          is still registered so the answer reaches the server. */}
                      {(selectedType?.choices.length ?? 0) > 1 ? (
                        <Field label="Kind" required span={4}>
                          <Select {...register(`items.${index}.categoryId`, { required: true })}>
                            {selectedType?.choices.map((choice) => (
                              <option key={choice.categoryId} value={choice.categoryId}>
                                {choice.categoryName}
                              </option>
                            ))}
                          </Select>
                        </Field>
                      ) : (
                        <input type="hidden" {...register(`items.${index}.categoryId`)} />
                      )}

                      <Field
                        label="Item"
                        required
                        span={(selectedType?.choices.length ?? 0) > 1 ? 5 : 6}
                        hint="What it is, as the shop would write it down"
                        error={errors.items?.[index]?.modelNumber?.message}
                      >
                        <Input
                          {...register(`items.${index}.modelNumber`, {
                            required: 'Say what the item is',
                          })}
                          placeholder="e.g. 3-door sliding wardrobe"
                        />
                      </Field>

                      <Field
                        label="Maker / brand"
                        span={3}
                        required
                        error={errors.items?.[index]?.brand?.message}
                      >
                        <BrandInput
                          categoryId={categoryId}
                          placeholder="e.g. Nilkamal"
                          aria-invalid={!!errors.items?.[index]?.brand || undefined}
                          {...register(`items.${index}.brand`, {
                            required: 'Say which brand it is',
                            setValueAs: (value: unknown) => String(value ?? '').trim(),
                          })}
                        />
                      </Field>

                      <Field
                        label="Quantity"
                        span={2}
                        hint={parsedSerials[index]?.length > 0 ? 'Set by serial count' : undefined}
                      >
                        <Input
                          type="number"
                          min={1}
                          step={1}
                          disabled={parsedSerials[index]?.length > 0}
                          {...register(`items.${index}.quantity`, { valueAsNumber: true })}
                        />
                      </Field>

                      <Field
                        label="Paid per unit"
                        required
                        span={3}
                        error={errors.items?.[index]?.purchasePrice?.message}
                      >
                        <Input
                          type="number"
                          step="0.01"
                          {...register(`items.${index}.purchasePrice`, {
                            required: 'What was paid is required',
                            min: { value: 0.01, message: 'Must be more than zero' },
                          })}
                          placeholder="0.00"
                        />
                      </Field>

                      <Field label="MRP" span={2} hint="Optional">
                        <Input
                          type="number"
                          step="0.01"
                          {...register(`items.${index}.mrp`)}
                          placeholder="0.00"
                        />
                      </Field>

                      <Field label="Colour" span={3}>
                        <Input {...register(`items.${index}.color`)} placeholder="e.g. Walnut" />
                      </Field>

                      <Field label="Warranty (months)" span={2}>
                        <Input
                          type="number"
                          min={0}
                          {...register(`items.${index}.warrantyMonths`)}
                          placeholder="e.g. 12"
                        />
                      </Field>

                      <Field
                        label="Serial numbers"
                        span={7}
                        hint="One per line. Most furniture has none — leave it blank."
                        error={duplicateSerial.get(index)}
                      >
                        <Textarea
                          rows={2}
                          {...register(`items.${index}.serialNumbers`)}
                          className="font-mono"
                        />
                        {parsedSerials[index]?.length > 0 && (
                          <Badge tone="primary" className="mt-1.5">
                            {parsedSerials[index].length} unit
                            {parsedSerials[index].length !== 1 ? 's' : ''}
                          </Badge>
                        )}
                      </Field>
                    </FormGrid>

                    {/* The rest of the form is whatever the category says it is,
                        the same as every other product form in the app. */}
                    {categoryId && (
                      <div className="mt-4 border-t border-border pt-4">
                        <h4 className="text-overline mb-3">Category details</h4>
                        <DynamicAttributeFields
                          categoryId={categoryId}
                          fieldPrefix={`items.${index}.dynamicAttributes`}
                        />
                      </div>
                    )}
                  </FormSection>
                );
              })}

              <button
                type="button"
                onClick={addItem}
                className={cn(
                  'flex w-full items-center justify-center gap-2 rounded-lg border-2 border-dashed border-border px-4 py-3 text-sm font-medium',
                  'text-muted-foreground transition-colors hover:border-primary/60 hover:bg-primary-muted/40 hover:text-primary',
                )}
              >
                <Plus className="h-4 w-4" />
                Add another item
              </button>

              <div className="sticky bottom-2 z-10 rounded-lg border-2 border-primary/20 bg-card/95 p-3 shadow-lg backdrop-blur">
                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <p className="text-xs font-medium text-muted-foreground">Units</p>
                    <p className="mt-0.5 text-lg font-semibold">{totalUnits}</p>
                  </div>
                  <div>
                    <p className="text-xs font-medium text-muted-foreground">Tax</p>
                    <p className="mt-0.5 text-lg font-semibold">None</p>
                  </div>
                  <div>
                    <p className="text-xs font-medium text-muted-foreground">Total paid</p>
                    <p className="mt-0.5 text-lg font-bold text-primary">{formatINR(totalPaid)}</p>
                  </div>
                </div>
              </div>
            </section>
          )}

          {/* Step 4 — review */}
          {currentStep === 3 && (
            <section className="space-y-4">
              <FormSection title="Purchase" bare={false}>
                <div className="grid grid-cols-2 gap-4 text-sm sm:grid-cols-4">
                  <div>
                    <p className="text-muted-foreground">Supplier</p>
                    <p className="font-medium">{selectedDistributor?.companyName}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Product type</p>
                    <p className="font-medium">{selectedType?.series.categoryName}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Invoice number</p>
                    <p className="font-mono font-medium">
                      {selectedType?.series.nextInvoiceNumber}
                    </p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Date</p>
                    <p className="font-medium">{watch('invoiceDate')}</p>
                  </div>
                  {watch('notes') && (
                    <div className="col-span-2 sm:col-span-4">
                      <p className="text-muted-foreground">Notes</p>
                      <p className="font-medium">{watch('notes')}</p>
                    </div>
                  )}
                </div>
              </FormSection>

              <FormSection title={`Items (${totalUnits} unit${totalUnits === 1 ? '' : 's'})`}>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b bg-muted/50">
                        <th className="px-3 py-2 text-left font-medium text-muted-foreground">#</th>
                        <th className="px-3 py-2 text-left font-medium text-muted-foreground">Kind</th>
                        <th className="px-3 py-2 text-left font-medium text-muted-foreground">Item</th>
                        <th className="px-3 py-2 text-right font-medium text-muted-foreground">Units</th>
                        <th className="px-3 py-2 text-right font-medium text-muted-foreground">Paid each</th>
                        <th className="px-3 py-2 text-right font-medium text-muted-foreground">Line total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {watchedItems.map((item, index) => (
                        <tr key={index} className="border-b last:border-0">
                          <td className="px-3 py-2">{index + 1}</td>
                          <td className="px-3 py-2">
                            {choiceById.get(item.categoryId)?.categoryName ?? '-'}
                          </td>
                          <td className="px-3 py-2 font-medium">
                            {[item.brand, item.modelNumber].filter(Boolean).join(' ')}
                          </td>
                          <td className="px-3 py-2 text-right">{unitCount(index)}</td>
                          <td className="px-3 py-2 text-right">
                            {formatINR(Number(item.purchasePrice) || 0)}
                          </td>
                          <td className="px-3 py-2 text-right font-medium">
                            {formatINR((Number(item.purchasePrice) || 0) * unitCount(index))}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </FormSection>

              <FormSection title="Summary">
                <div className="max-w-sm space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Goods</span>
                    <span>{formatINR(totalPaid)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Tax</span>
                    <span>No bill, so none</span>
                  </div>
                  <div className="flex justify-between border-t pt-2 font-semibold">
                    <span>Total</span>
                    <span>{formatINR(totalPaid)}</span>
                  </div>
                  <div className="flex justify-between text-xs text-muted-foreground">
                    <span>Payment status</span>
                    <span className="font-medium text-amber-600">Pending</span>
                  </div>
                </div>
              </FormSection>
            </section>
          )}

          {errorMessage && (
            <div className="mt-6 flex items-center gap-2 rounded-md bg-destructive/10 px-4 py-3 text-sm text-destructive">
              <AlertCircle className="h-4 w-4 shrink-0" />
              {errorMessage}
            </div>
          )}

          {/* Navigation footer */}
          <div className="mt-6 flex items-center justify-between border-t pt-6">
            <Button type="button" variant="outline" size="lg" onClick={goBack} icon={<ArrowLeft className="h-4 w-4" />}>
              Back
            </Button>

            <div className="flex items-center gap-4">
              <Button type="button" variant="ghost" size="lg" onClick={() => navigate('/purchases')}>
                Cancel
              </Button>
              {currentStep < STEPS.length - 1 ? (
                <Button type="button" size="lg" disabled={!canGoNext()} onClick={goNext}>
                  Next
                  <ArrowRight className="h-4 w-4" />
                </Button>
              ) : (
                <Button
                  type="button"
                  size="lg"
                  loading={createMutation.isPending}
                  icon={<Check className="h-4 w-4" />}
                  onClick={() => setIsConfirmOpen(true)}
                >
                  Record purchase
                </Button>
              )}
            </div>
          </div>
        </form>

        <ConfirmDialog
          isOpen={isConfirmOpen}
          title="Record this purchase?"
          message={[
            `Supplier: ${selectedDistributor?.companyName ?? '-'}`,
            `Invoice: ${selectedType?.series.nextInvoiceNumber ?? '-'} (the shop's own number)  •  Date: ${methods.getValues('invoiceDate') || '-'}`,
            `Units: ${totalUnits}  •  Total: ${formatINR(totalPaid)}  •  No tax`,
            '',
            'The invoice number is issued as this saves, so it may land one further on if somebody else records one first. Proceed?',
          ].join('\n')}
          confirmText={createMutation.isPending ? 'Recording…' : 'Record purchase'}
          cancelText="Review again"
          loading={createMutation.isPending}
          onConfirm={() => handleSubmit(onSubmit)()}
          onCancel={() => {
            if (!createMutation.isPending) setIsConfirmOpen(false);
          }}
        />
      </FormProvider>
    </div>
  );
}
