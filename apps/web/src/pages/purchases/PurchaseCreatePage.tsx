import { useState, useMemo, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useForm, useFieldArray, FormProvider } from 'react-hook-form';
import {
  ArrowLeft,
  ArrowRight,
  Loader2,
  AlertCircle,
  Trash2,
  Plus,
  Check,
  Search,
  ScanLine,
} from 'lucide-react';
import { cn } from '../../lib/utils';
import { useDebounce } from '../../hooks/useDebounce';
import { useDistributorsQuery } from '../../hooks/useDistributors';
import { useCreatePurchaseMutation } from '../../hooks/usePurchases';
import { CategoryCascader } from '../../components/CategoryCascader';
import { DynamicAttributeFields } from '../../components/DynamicAttributeFields';
import { ModelAutocomplete } from '../../components/ModelAutocomplete';
import { ScanInvoiceDialog } from '../../components/ScanInvoiceDialog';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { formatINR } from '@retailerp/shared-utils';
import type { DistributorListItem } from '@retailerp/shared-types';
import { apiClient } from '../../lib/api-client';
import type { InvoiceParseResult } from '../../api/ocr-api';
import { useOcrStatusQuery } from '../../hooks/useOcr';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
type GstType = 'GST' | 'CGST_SGST'; // kept for potential future use
const GST_SLABS = [0, 5, 12, 18, 28] as const;

interface ProductItem {
  categoryId: string;
  brand: string;
  modelNumber: string;
  serialNumbers: string; // textarea: one serial per line, supports multiple
  mrp: number | '';
  purchasePrice: number | '';
  sellingPrice: number | '';
  gstPercent: number;
  color: string;
  warrantyMonths: number | '';
  barcode: string;
  dynamicAttributes: Record<string, unknown>;
}

interface PurchaseFormValues {
  invoiceNumber: string;
  invoiceDate: string;
  notes: string;
  items: ProductItem[];
}

const emptyProductItem: ProductItem = {
  categoryId: '',
  brand: '',
  modelNumber: '',
  serialNumbers: '',
  mrp: '',
  purchasePrice: '',
  sellingPrice: '',
  gstPercent: 18,
  color: '',
  warrantyMonths: '',
  barcode: '',
  dynamicAttributes: {},
};

const STEPS = [
  'Select Distributor',
  'Invoice Details',
  'Add Products',
  'Review',
] as const;

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
export function PurchaseCreatePage() {
  const navigate = useNavigate();
  const [currentStep, setCurrentStep] = useState(0);
  const [isScanOpen, setIsScanOpen] = useState(false);
  const ocrStatus = useOcrStatusQuery();

  // Step 1: Distributor selection
  const [selectedDistributor, setSelectedDistributor] = useState<DistributorListItem | null>(null);
  const [distributorSearchText, setDistributorSearchText] = useState('');
  const debouncedDistSearch = useDebounce(distributorSearchText, 300);

  const distributorsQuery = useDistributorsQuery({
    page: 1,
    pageSize: 20,
    search: debouncedDistSearch.length >= 3 ? debouncedDistSearch : undefined,
  });
  const distributorOptions = distributorsQuery.data?.data ?? [];

  // Step 3: Category selections (one per product row)
  const [itemCategoryIds, setItemCategoryIds] = useState<(string | undefined)[]>([undefined]);

  // Form
  const methods = useForm<PurchaseFormValues>({
    defaultValues: {
      invoiceNumber: '',
      invoiceDate: new Date().toISOString().split('T')[0],
      notes: '',
      items: [{ ...emptyProductItem }],
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

  const { fields, append, remove } = useFieldArray({
    control,
    name: 'items',
  });

  const watchedItems = watch('items');

  // Parse serial numbers from textarea for each item
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

  // totalExpandedCount is computed inline below with totalPurchasePrice

  // Detect duplicate serial numbers across all items' parsed serials
  const serialDuplicateMap = useMemo(() => {
    const map = new Map<number, string>();
    // serial -> { itemIndex, lineIndex }
    const seen = new Map<string, { itemIdx: number; lineIdx: number }>();
    for (let i = 0; i < parsedSerials.length; i++) {
      const serials = parsedSerials[i];
      const localSeen = new Set<string>();
      for (let j = 0; j < serials.length; j++) {
        const sn = serials[j];
        if (localSeen.has(sn)) {
          // Duplicate within same item
          map.set(i, `Duplicate serial "${sn}" within this item`);
          continue;
        }
        localSeen.add(sn);
        const prev = seen.get(sn);
        if (prev !== undefined) {
          map.set(i, `Serial "${sn}" is also used in item #${prev.itemIdx + 1}`);
          if (!map.has(prev.itemIdx)) {
            map.set(prev.itemIdx, `Serial "${sn}" is also used in item #${i + 1}`);
          }
        } else {
          seen.set(sn, { itemIdx: i, lineIdx: j });
        }
      }
    }
    return map;
  }, [parsedSerials]);

  // Computed totals — per-product GST
  const totalPurchasePrice = watchedItems.reduce((sum, item, idx) => {
    const qty = Math.max(1, parsedSerials[idx]?.length ?? 1);
    return sum + (Number(item.purchasePrice) || 0) * qty;
  }, 0);

  const totalExpandedCount = watchedItems.reduce((sum, _item, idx) => {
    return sum + Math.max(1, parsedSerials[idx]?.length ?? 1);
  }, 0);

  const gstAmount = watchedItems.reduce((sum, item, idx) => {
    const qty = Math.max(1, parsedSerials[idx]?.length ?? 1);
    const itemTotal = (Number(item.purchasePrice) || 0) * qty;
    return sum + Math.round(itemTotal * (item.gstPercent ?? 18) / 100 * 100) / 100;
  }, 0);

  const netAmount = totalPurchasePrice + gstAmount;

  // Mutation
  const createMutation = useCreatePurchaseMutation();

  // Final confirmation dialog (shown on the Review step before actually creating)
  const [isConfirmOpen, setIsConfirmOpen] = useState(false);

  // Invoice duplicate check state
  const [invoiceCheckError, setInvoiceCheckError] = useState('');
  const [isCheckingInvoice, setIsCheckingInvoice] = useState(false);

  // ---------------------------------------------------------------------------
  // Navigation
  // ---------------------------------------------------------------------------
  const canGoNext = () => {
    switch (currentStep) {
      case 0:
        return !!selectedDistributor;
      case 1:
        return !invoiceCheckError && !isCheckingInvoice;
      case 2:
        return watchedItems.length > 0 && watchedItems.every((item) => (item.dynamicAttributes?.brand || item.brand) && item.modelNumber && item.purchasePrice) && serialDuplicateMap.size === 0;
      default:
        return false;
    }
  };

  const scrollToFirstError = () => {
    setTimeout(() => {
      const firstError = document.querySelector('.border-destructive');
      if (firstError) {
        firstError.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }, 100);
  };

  const goNext = async () => {
    if (currentStep === 1) {
      const valid = await trigger(['invoiceNumber', 'invoiceDate']);
      if (!valid) {
        scrollToFirstError();
        return;
      }

      // Check invoice number duplicate against backend
      const invoiceNum = watch('invoiceNumber')?.trim();
      if (invoiceNum && selectedDistributor) {
        setIsCheckingInvoice(true);
        setInvoiceCheckError('');
        try {
          const { data: resp } = await apiClient.get('/purchases/check-invoice', {
            params: { distributorId: selectedDistributor.id, invoiceNumber: invoiceNum },
          });
          if (resp?.data?.exists && resp.data.sameDistributor) {
            setInvoiceCheckError(`Invoice number "${invoiceNum}" already exists for this distributor`);
            setIsCheckingInvoice(false);
            return;
          }
        } catch {
          // If check fails, allow proceeding — backend will catch it at submit
        }
        setIsCheckingInvoice(false);
      }
    }
    if (currentStep === 2) {
      const valid = await trigger('items');
      if (!valid) {
        scrollToFirstError();
        return;
      }
      // Check serial number duplicates (already blocked by canGoNext via serialDuplicateMap)
      if (serialDuplicateMap.size > 0) {
        scrollToFirstError();
        return;
      }
    }
    setCurrentStep((prev) => Math.min(prev + 1, STEPS.length - 1));
  };

  const goBack = () => {
    setCurrentStep((prev) => Math.max(prev - 1, 0));
  };

  // ---------------------------------------------------------------------------
  // Submit
  // ---------------------------------------------------------------------------
  const onSubmit = (formData: PurchaseFormValues) => {
    if (!selectedDistributor) return;

    // Expand items: each serial number becomes a separate product
    const expandedItems = formData.items.flatMap((item, idx) => {
      const serials = (item.serialNumbers || '')
        .split('\n')
        .map((s) => s.trim())
        .filter(Boolean);
      const baseItem = {
        categoryId: itemCategoryIds[idx] || item.categoryId,
        brand: ((item.dynamicAttributes?.brand as string) || item.brand || '').trim(),
        modelNumber: item.modelNumber.trim(),
        mrp: Number(item.mrp) || 0,
        sellingPrice: Number(item.sellingPrice) || Number(item.mrp) || 0,
        purchasePrice: Number(item.purchasePrice),
        gstPercent: item.gstPercent ?? 18,
        color: item.color.trim() || undefined,
        warrantyMonths: item.warrantyMonths ? Number(item.warrantyMonths) : undefined,
        barcode: item.barcode.trim() || undefined,
        dynamicAttributes: item.dynamicAttributes,
      };
      if (serials.length === 0) {
        return [{ ...baseItem, serialNumber: undefined }];
      }
      return serials.map((sn) => ({ ...baseItem, serialNumber: sn }));
    });

    // Recalculate totals from expanded items
    const calcTotalPurchase = expandedItems.reduce(
      (sum, item) => sum + (Number(item.purchasePrice) || 0), 0,
    );
    const calcGst = expandedItems.reduce((sum, item) => {
      return sum + Math.round((Number(item.purchasePrice) || 0) * ((item as any).gstPercent ?? 18) / 100 * 100) / 100;
    }, 0);
    const calcNet = calcTotalPurchase + calcGst;

    const payload: Record<string, unknown> = {
      distributorId: selectedDistributor.id,
      invoiceNumber: formData.invoiceNumber.trim(),
      invoiceDate: formData.invoiceDate,
      notes: formData.notes.trim() || undefined,
      totalAmount: calcTotalPurchase,
      gstAmount: calcGst,
      discountAmount: 0,
      amountPaid: 0,
      items: expandedItems,
    };

    createMutation.mutate(payload, {
      onSuccess: () => {
        setIsConfirmOpen(false);
        navigate('/purchases', { replace: true });
      },
      onError: (err) => {
        // If the backend rejects because the invoice number was created
        // in the meantime (e.g. another tab), close the dialog and bounce
        // the user back to the invoice step with the error highlighted so
        // they can fix it instead of getting stuck on a silent failure.
        const msg = (err as any)?.response?.data?.error
          ?? (err as any)?.response?.data?.message
          ?? '';
        if (typeof msg === 'string' && /invoice number/i.test(msg) && /exist/i.test(msg)) {
          setInvoiceCheckError(msg);
          setIsConfirmOpen(false);
          setCurrentStep(1);
        }
      },
    });
  };

  /**
   * Final pre-submit gate fired from the confirmation dialog. We re-run
   * the duplicate-invoice check here too because the dialog may have been
   * sitting open for a while; if a duplicate appears we abort the submit
   * and send the user back to step 1 with the error visible.
   */
  const handleConfirmSubmit = async () => {
    if (!selectedDistributor) return;
    const invoiceNum = methods.getValues('invoiceNumber')?.trim();
    if (invoiceNum) {
      try {
        const { data: resp } = await apiClient.get('/purchases/check-invoice', {
          params: { distributorId: selectedDistributor.id, invoiceNumber: invoiceNum },
        });
        if (resp?.data?.exists && resp.data.sameDistributor) {
          setInvoiceCheckError(`Invoice number "${invoiceNum}" already exists for this distributor`);
          setIsConfirmOpen(false);
          setCurrentStep(1);
          return;
        }
      } catch {
        // Fall through — backend will still reject on duplicate at submit.
      }
    }
    handleSubmit(onSubmit)();
  };

  // Error message
  const errorMessage = createMutation.error
    ? (createMutation.error as any)?.response?.data?.error ??
      (createMutation.error as any)?.response?.data?.message ??
      'Something went wrong. Please try again.'
    : null;

  // ---------------------------------------------------------------------------
  // Category selection handler for product items
  // ---------------------------------------------------------------------------
  const handleItemCategorySelect = (index: number, categoryId: string | undefined) => {
    setItemCategoryIds((prev) => {
      const updated = [...prev];
      updated[index] = categoryId;
      return updated;
    });
  };

  const addProductItem = () => {
    append({ ...emptyProductItem });
    setItemCategoryIds((prev) => [...prev, undefined]);
  };

  const removeProductItem = (index: number) => {
    remove(index);
    setItemCategoryIds((prev) => prev.filter((_, i) => i !== index));
  };

  const applyInvoiceParse = (result: InvoiceParseResult, distributor: DistributorListItem) => {
    setSelectedDistributor(distributor);
    setDistributorSearchText(distributor.companyName);

    const isoToday = new Date().toISOString().split('T')[0];
    const normalizeDate = (raw: string | null | undefined): string => {
      if (!raw) return isoToday;
      const trimmed = raw.trim();
      if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;
      // dd/mm/yyyy or dd-mm-yyyy
      const dmy = trimmed.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})$/);
      if (dmy) {
        const [, d, m, y] = dmy;
        const year = y.length === 2 ? `20${y}` : y;
        return `${year}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
      }
      const parsed = new Date(trimmed);
      if (!Number.isNaN(parsed.getTime())) return parsed.toISOString().split('T')[0];
      return isoToday;
    };

    const parsedItems: ProductItem[] = result.items.length > 0
      ? result.items.map((item) => ({
          categoryId: item.categoryId || '',
          brand: item.brand || '',
          modelNumber: item.modelNumber || '',
          serialNumbers: item.serialNumbers.join('\n'),
          mrp: '', // Always blank — employee must fill MRP manually
          purchasePrice: item.purchasePrice ?? '',
          sellingPrice: item.sellingPrice ?? '',
          gstPercent: item.gstPercent ?? 18,
          color: item.color || '',
          warrantyMonths: item.warrantyMonths ?? '',
          barcode: item.barcode || '',
          dynamicAttributes: item.brand ? { brand: item.brand } : {},
        }))
      : [{ ...emptyProductItem }];

    // Reset whole form so registered + unmounted fields all hydrate consistently
    methods.reset({
      invoiceNumber: result.invoice.number || '',
      invoiceDate: normalizeDate(result.invoice.date),
      notes: result.warnings.length > 0 ? `OCR warnings: ${result.warnings.join(' ')}` : '',
      items: parsedItems,
    });

    setItemCategoryIds(parsedItems.map((p) => p.categoryId || undefined));
    setInvoiceCheckError('');
    setCurrentStep(2);
    setIsScanOpen(false);
  };

  // Ctrl+S / Cmd+S — submit on the last step, otherwise advance to next
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        if (currentStep === STEPS.length - 1) {
          if (!createMutation.isPending && !isConfirmOpen) {
            setIsConfirmOpen(true);
          }
        } else if (canGoNext()) {
          goNext();
        }
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [currentStep, createMutation.isPending, isConfirmOpen, canGoNext, goNext]);

  return (
    <div className="mx-auto max-w-[1600px]">
      {/* Page header */}
      <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
        <div className="flex items-center gap-4">
        <button
          onClick={() => navigate(-1)}
          className="rounded-md p-2 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
        >
          <ArrowLeft className="h-5 w-5" />
        </button>
        <h1 className="text-2xl font-semibold">New Purchase</h1>
        </div>
        <button
          type="button"
          onClick={() => setIsScanOpen(true)}
          className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground hover:bg-primary/90"
        >
          <ScanLine className="h-4 w-4" />
          Scan Invoice
        </button>
      </div>

      <ScanInvoiceDialog
        open={isScanOpen}
        onClose={() => setIsScanOpen(false)}
        onApply={applyInvoiceParse}
      />

      {/* Step indicator */}
      <div className="flex items-center gap-2 mb-8 overflow-x-auto pb-2">
        {STEPS.map((step, idx) => (
          <div key={step} className="flex items-center gap-2">
            <button
              onClick={() => {
                if (idx < currentStep) setCurrentStep(idx);
              }}
              disabled={idx > currentStep}
              className={cn(
                'flex items-center gap-2 rounded-full px-4 py-1.5 text-sm font-medium transition-colors whitespace-nowrap',
                idx === currentStep
                  ? 'bg-primary text-primary-foreground'
                  : idx < currentStep
                    ? 'bg-primary/10 text-primary cursor-pointer hover:bg-primary/20'
                    : 'bg-muted text-muted-foreground',
              )}
            >
              {idx < currentStep ? (
                <Check className="h-4 w-4" />
              ) : (
                <span className="flex h-5 w-5 items-center justify-center rounded-full border text-xs">
                  {idx + 1}
                </span>
              )}
              {step}
            </button>
            {idx < STEPS.length - 1 && (
              <div className="h-px w-8 bg-border" />
            )}
          </div>
        ))}
      </div>

      <FormProvider {...methods}>
        <form onSubmit={handleSubmit(onSubmit)}>
          {/* Step 1: Select Distributor */}
          {currentStep === 0 && (
            <section className="rounded-lg border bg-card p-6">
              <h2 className="text-lg font-medium mb-4">Select Distributor</h2>

              {/* Search */}
              <div className="relative max-w-md mb-4">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <input
                  type="text"
                  value={distributorSearchText}
                  onChange={(e) => setDistributorSearchText(e.target.value)}
                  placeholder="Search distributors by name (min 3 chars)..."
                  className={cn(
                    'w-full rounded-md border bg-background pl-9 pr-3 py-2.5 text-sm',
                    'placeholder:text-muted-foreground',
                    'focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2',
                  )}
                />
              </div>

              {/* Distributor list */}
              {distributorsQuery.isLoading ? (
                <div className="flex items-center gap-2 text-sm text-muted-foreground py-4">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Loading distributors...
                </div>
              ) : distributorOptions.length === 0 ? (
                <p className="text-sm text-muted-foreground py-4">
                  {debouncedDistSearch.length >= 3
                    ? 'No distributors found matching your search.'
                    : 'Type at least 3 characters to search, or all distributors are shown below.'}
                </p>
              ) : null}

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 max-h-80 overflow-y-auto">
                {distributorOptions.map((dist) => (
                  <button
                    key={dist.id}
                    type="button"
                    onClick={() => setSelectedDistributor(dist)}
                    className={cn(
                      'rounded-lg border p-4 text-left transition-colors',
                      selectedDistributor?.id === dist.id
                        ? 'border-primary bg-primary/5 ring-1 ring-primary'
                        : 'hover:bg-muted',
                    )}
                  >
                    <p className="font-medium text-sm">{dist.companyName}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {dist.contactPerson} &middot; {dist.phone}
                    </p>
                    {dist.gstNumber && (
                      <p className="text-xs text-muted-foreground font-mono mt-0.5">
                        GST: {dist.gstNumber}
                      </p>
                    )}
                  </button>
                ))}
              </div>

              {/* Selected distributor summary */}
              {selectedDistributor && (
                <div className="mt-4 p-4 rounded-md bg-green-50 dark:bg-green-950/30 border border-green-200 dark:border-green-800">
                  <p className="text-sm font-medium text-green-800 dark:text-green-200">
                    Selected: {selectedDistributor.companyName}
                  </p>
                  <p className="text-xs text-green-600 dark:text-green-400 mt-0.5">
                    {selectedDistributor.contactPerson} &middot;{' '}
                    {selectedDistributor.phone}
                    {selectedDistributor.gstNumber &&
                      ` | GST: ${selectedDistributor.gstNumber}`}
                  </p>
                </div>
              )}
            </section>
          )}

          {/* Step 2: Invoice Details */}
          {currentStep === 1 && (
            <section className="rounded-lg border bg-card p-6">
              <h2 className="text-lg font-medium mb-4">Invoice Details</h2>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {/* Invoice Number */}
                <div>
                  <label htmlFor="invoiceNumber" className="block text-sm font-medium mb-1.5">
                    Invoice Number <span className="text-destructive">*</span>
                  </label>
                  <input
                    id="invoiceNumber"
                    type="text"
                    {...register('invoiceNumber', {
                      required: 'Invoice number is required',
                      onChange: () => setInvoiceCheckError(''), // Clear error on change
                    })}
                    placeholder="e.g. INV-2026-001"
                    className={cn(
                      'w-full rounded-md border bg-background px-3 py-2.5 text-sm',
                      'placeholder:text-muted-foreground',
                      'focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2',
                      (errors.invoiceNumber || invoiceCheckError) && 'border-destructive',
                    )}
                  />
                  {errors.invoiceNumber && (
                    <p className="mt-1 text-xs text-destructive">
                      {errors.invoiceNumber.message}
                    </p>
                  )}
                  {invoiceCheckError && (
                    <p className="mt-1 text-xs text-destructive">
                      {invoiceCheckError}
                    </p>
                  )}
                </div>

                {/* Invoice Date */}
                <div>
                  <label htmlFor="invoiceDate" className="block text-sm font-medium mb-1.5">
                    Invoice Date <span className="text-destructive">*</span>
                  </label>
                  <input
                    id="invoiceDate"
                    type="date"
                    {...register('invoiceDate', {
                      required: 'Invoice date is required',
                    })}
                    className={cn(
                      'w-full rounded-md border bg-background px-3 py-2.5 text-sm',
                      'focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2',
                      errors.invoiceDate && 'border-destructive',
                    )}
                  />
                  {errors.invoiceDate && (
                    <p className="mt-1 text-xs text-destructive">
                      {errors.invoiceDate.message}
                    </p>
                  )}
                </div>

              </div>

              {/* Notes */}
              <div className="mt-4">
                <label htmlFor="notes" className="block text-sm font-medium mb-1.5">
                  Notes
                </label>
                <textarea
                  id="notes"
                  rows={2}
                  {...register('notes')}
                  placeholder="Any additional notes about this purchase..."
                  className={cn(
                    'w-full rounded-md border bg-background px-3 py-2.5 text-sm',
                    'placeholder:text-muted-foreground',
                    'focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2',
                  )}
                />
              </div>
            </section>
          )}

          {/* Step 3: Add Products */}
          {currentStep === 2 && (
            <section className="space-y-4">
              {fields.map((field, index) => (
                <div
                  key={field.id}
                  className="rounded-lg border bg-card p-6"
                >
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-base font-medium">
                      Product {index + 1}
                    </h3>
                    {fields.length > 1 && (
                      <button
                        type="button"
                        onClick={() => removeProductItem(index)}
                        className="flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-medium text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950/30 hover:bg-red-100 dark:hover:bg-red-900/40 transition-colors"
                      >
                        <Trash2 className="h-3 w-3" />
                        Remove
                      </button>
                    )}
                  </div>

                  {/* Category */}
                  <div className="mb-4">
                    <label className="block text-sm font-medium mb-1.5">
                      Category <span className="text-destructive">*</span>
                    </label>
                    <CategoryCascader
                      onCategorySelect={(catId) =>
                        handleItemCategorySelect(index, catId)
                      }
                      initialCategoryId={itemCategoryIds[index]}
                    />
                  </div>

                  {/* Product fields — disabled until category is selected */}
                  {!itemCategoryIds[index] && (
                    <div className="rounded-md border border-dashed border-muted-foreground/30 bg-muted/20 p-6 text-center mb-4">
                      <p className="text-sm text-muted-foreground">
                        Please select a category and subcategory above to enable product fields
                      </p>
                    </div>
                  )}
                  <div className={cn(
                    'grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4',
                    !itemCategoryIds[index] && 'opacity-40 pointer-events-none',
                  )}>
                    {/* Model */}
                    <div className="sm:col-span-2 lg:col-span-3">
                      <label className="block text-sm font-medium mb-1.5">
                        Model <span className="text-destructive">*</span>
                      </label>
                      <ModelAutocomplete
                        value={watch(`items.${index}.modelNumber`) || ''}
                        onChange={(val) => {
                          methods.setValue(`items.${index}.modelNumber`, val, { shouldValidate: true });
                        }}
                        onSelect={(product) => {
                          const { setValue } = methods;
                          // Auto-fill all fields from the selected product
                          setValue(`items.${index}.modelNumber`, product.modelNumber, { shouldValidate: true });
                          if (!watch(`items.${index}.mrp`)) setValue(`items.${index}.mrp`, Number(product.mrp) || '');
                          if (!watch(`items.${index}.purchasePrice`)) setValue(`items.${index}.purchasePrice`, Number(product.purchasePrice) || '');
                          if (!watch(`items.${index}.sellingPrice`)) setValue(`items.${index}.sellingPrice`, Number(product.sellingPrice) || '');
                          if (!watch(`items.${index}.color`) && product.color) setValue(`items.${index}.color`, product.color);
                          if (!watch(`items.${index}.warrantyMonths`) && product.warrantyMonths) setValue(`items.${index}.warrantyMonths`, product.warrantyMonths);

                          // Auto-fill dynamic attributes (brand, capacity, starRating, etc.)
                          // Must set each key individually so DynamicAttributeFields registered fields update
                          if (product.dynamicAttributes && typeof product.dynamicAttributes === 'object') {
                            const dynAttrs = product.dynamicAttributes as Record<string, unknown>;
                            for (const [key, val] of Object.entries(dynAttrs)) {
                              if (val !== undefined && val !== null && val !== '') {
                                const currentVal = watch(`items.${index}.dynamicAttributes.${key}`);
                                if (!currentVal && currentVal !== 0) {
                                  setValue(`items.${index}.dynamicAttributes.${key}`, val);
                                }
                              }
                            }
                          }
                        }}
                        placeholder="Type model number to search..."
                        error={!!errors.items?.[index]?.modelNumber}
                      />
                      <input type="hidden" {...register(`items.${index}.modelNumber`, { required: 'Model is required' })} />
                      {errors.items?.[index]?.modelNumber && (
                        <p className="mt-1 text-xs text-destructive">
                          {errors.items[index].modelNumber?.message}
                        </p>
                      )}
                    </div>

                    {/* Serial Numbers (multi-line) */}
                    <div className="sm:col-span-2 lg:col-span-3">
                      <label className="block text-sm font-medium mb-1.5">
                        Serial Numbers{' '}
                        <span className="text-xs text-muted-foreground font-normal">
                          (one per line)
                        </span>
                      </label>
                      <textarea
                        rows={3}
                        {...register(`items.${index}.serialNumbers`)}
                        placeholder={'SN-00001\nSN-00002\nSN-00003'}
                        className={cn(
                          'w-full rounded-md border bg-background px-3 py-2.5 text-sm font-mono',
                          'placeholder:text-muted-foreground',
                          'focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2',
                          serialDuplicateMap.has(index) && 'border-destructive',
                        )}
                      />
                      <div className="flex items-center gap-3 mt-1">
                        {parsedSerials[index]?.length > 0 && (
                          <span className="inline-flex items-center rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-medium text-primary">
                            {parsedSerials[index].length} serial{parsedSerials[index].length !== 1 ? 's' : ''} = {parsedSerials[index].length} product{parsedSerials[index].length !== 1 ? 's' : ''} will be created
                          </span>
                        )}
                        {serialDuplicateMap.has(index) && (
                          <p className="text-xs text-destructive">
                            {serialDuplicateMap.get(index)}
                          </p>
                        )}
                      </div>
                    </div>

                    {/* MRP */}
                    <div>
                      <label className="block text-sm font-medium mb-1.5">
                        MRP
                      </label>
                      <input
                        type="number"
                        step="0.01"
                        {...register(`items.${index}.mrp`, {
                          min: { value: 0, message: 'Must be positive' },
                        })}
                        placeholder="0.00"
                        className={cn(
                          'w-full rounded-md border bg-background px-3 py-2.5 text-sm',
                          'placeholder:text-muted-foreground',
                          'focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2',
                        )}
                      />
                    </div>

                    {/* DP (Dealer Price) */}
                    <div>
                      <label className="block text-sm font-medium mb-1.5">
                        DP (Dealer Price) <span className="text-destructive">*</span>
                      </label>
                      <input
                        type="number"
                        step="0.01"
                        {...register(`items.${index}.purchasePrice`, {
                          required: 'Purchase price is required',
                          min: { value: 0, message: 'Must be positive' },
                        })}
                        placeholder="0.00"
                        className={cn(
                          'w-full rounded-md border bg-background px-3 py-2.5 text-sm',
                          'placeholder:text-muted-foreground',
                          'focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2',
                          errors.items?.[index]?.purchasePrice && 'border-destructive',
                        )}
                      />
                      {errors.items?.[index]?.purchasePrice && (
                        <p className="mt-1 text-xs text-destructive">
                          {errors.items[index].purchasePrice?.message}
                        </p>
                      )}
                    </div>

                    {/* GST % per product */}
                    <div>
                      <label className="block text-sm font-medium mb-1.5">
                        GST %
                      </label>
                      <select
                        {...register(`items.${index}.gstPercent`, { valueAsNumber: true })}
                        className={cn(
                          'w-full appearance-none rounded-md border bg-background px-3 py-2.5 text-sm',
                          'focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2',
                        )}
                      >
                        {GST_SLABS.map((slab) => (
                          <option key={slab} value={slab}>
                            {slab}%
                          </option>
                        ))}
                      </select>
                    </div>

                    {/* Color */}
                    <div>
                      <label className="block text-sm font-medium mb-1.5">
                        Color
                      </label>
                      <input
                        type="text"
                        {...register(`items.${index}.color`)}
                        placeholder="e.g. Black"
                        className={cn(
                          'w-full rounded-md border bg-background px-3 py-2.5 text-sm',
                          'placeholder:text-muted-foreground',
                          'focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2',
                        )}
                      />
                    </div>

                    {/* Warranty */}
                    <div>
                      <label className="block text-sm font-medium mb-1.5">
                        Warranty (months)
                      </label>
                      <input
                        type="number"
                        {...register(`items.${index}.warrantyMonths`, {
                          min: { value: 0, message: 'Must be positive' },
                        })}
                        placeholder="e.g. 12"
                        className={cn(
                          'w-full rounded-md border bg-background px-3 py-2.5 text-sm',
                          'placeholder:text-muted-foreground',
                          'focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2',
                        )}
                      />
                    </div>

                    {/* Barcode */}
                    <div>
                      <label className="block text-sm font-medium mb-1.5">
                        Barcode
                      </label>
                      <input
                        type="text"
                        {...register(`items.${index}.barcode`)}
                        placeholder="Scan or enter barcode"
                        className={cn(
                          'w-full rounded-md border bg-background px-3 py-2.5 text-sm',
                          'placeholder:text-muted-foreground',
                          'focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2',
                        )}
                      />
                    </div>
                  </div>

                  {/* Dynamic attributes based on selected category */}
                  {itemCategoryIds[index] && (
                    <div className="mt-4 pt-4 border-t">
                      <h4 className="text-sm font-medium mb-3">
                        Category-Specific Fields
                      </h4>
                      <DynamicAttributeFields
                        categoryId={itemCategoryIds[index]}
                        fieldPrefix={`items.${index}.dynamicAttributes`}
                      />
                    </div>
                  )}
                </div>
              ))}

              <button
                type="button"
                onClick={addProductItem}
                className={cn(
                  'flex items-center gap-2 rounded-md border-2 border-dashed px-4 py-3 text-sm font-medium w-full justify-center',
                  'text-muted-foreground hover:border-primary hover:text-primary transition-colors',
                )}
              >
                <Plus className="h-4 w-4" />
                Add Another Product
              </button>

              {/* Totals summary — docked to viewport bottom while user scrolls a long product list */}
              <div className="sticky bottom-2 z-10 rounded-lg border-2 border-primary/20 bg-card/95 p-3 shadow-lg backdrop-blur">
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  <div>
                    <p className="text-xs font-medium text-muted-foreground">Products</p>
                    <p className="text-lg font-semibold mt-0.5">{totalExpandedCount}</p>
                  </div>
                  <div>
                    <p className="text-xs font-medium text-muted-foreground">Total (DP)</p>
                    <p className="text-lg font-semibold mt-0.5">{formatINR(totalPurchasePrice)}</p>
                  </div>
                  <div>
                    <p className="text-xs font-medium text-muted-foreground">GST Amount</p>
                    <p className="text-lg font-semibold mt-0.5">{formatINR(gstAmount)}</p>
                  </div>
                  <div>
                    <p className="text-xs font-medium text-muted-foreground">Net Amount</p>
                    <p className="text-lg font-bold text-primary mt-0.5">{formatINR(netAmount)}</p>
                  </div>
                </div>
              </div>
            </section>
          )}

          {/* Step 3: Review */}
          {currentStep === 3 && (
            <section className="space-y-4">
              {/* Distributor */}
              <div className="rounded-lg border bg-card p-6">
                <h3 className="text-base font-medium mb-3">Distributor</h3>
                <p className="text-sm font-medium">
                  {selectedDistributor?.companyName}
                </p>
                <p className="text-xs text-muted-foreground">
                  {selectedDistributor?.contactPerson} &middot;{' '}
                  {selectedDistributor?.phone}
                </p>
              </div>

              {/* Invoice */}
              <div className="rounded-lg border bg-card p-6">
                <h3 className="text-base font-medium mb-3">Invoice</h3>
                <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 text-sm">
                  <div>
                    <p className="text-muted-foreground">Invoice #</p>
                    <p className="font-medium font-mono">
                      {watch('invoiceNumber')}
                    </p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Date</p>
                    <p className="font-medium">{watch('invoiceDate')}</p>
                  </div>
                  {watch('notes') && (
                    <div className="col-span-2 sm:col-span-3">
                      <p className="text-muted-foreground">Notes</p>
                      <p className="font-medium">{watch('notes')}</p>
                    </div>
                  )}
                </div>
              </div>

              {/* Products (expanded view showing each serial as a row) */}
              <div className="rounded-lg border bg-card p-6">
                <h3 className="text-base font-medium mb-3">
                  Products ({totalExpandedCount} total)
                </h3>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b bg-muted/50">
                        <th className="px-3 py-2 text-left font-medium text-muted-foreground">
                          #
                        </th>
                        <th className="px-3 py-2 text-left font-medium text-muted-foreground">
                          Brand
                        </th>
                        <th className="px-3 py-2 text-left font-medium text-muted-foreground">
                          Model
                        </th>
                        <th className="px-3 py-2 text-left font-medium text-muted-foreground">
                          Serial
                        </th>
                        <th className="px-3 py-2 text-right font-medium text-muted-foreground">
                          MRP
                        </th>
                        <th className="px-3 py-2 text-right font-medium text-muted-foreground">
                          DP (Dealer Price)
                        </th>
                        <th className="px-3 py-2 text-right font-medium text-muted-foreground">
                          GST %
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {(() => {
                        let rowNum = 0;
                        return watchedItems.flatMap((item, idx) => {
                          const serials = parsedSerials[idx] ?? [];
                          const brand = (item.dynamicAttributes?.brand as string) || item.brand || '-';
                          if (serials.length === 0) {
                            rowNum++;
                            return [(
                              <tr key={`${idx}-0`} className="border-b last:border-0">
                                <td className="px-3 py-2">{rowNum}</td>
                                <td className="px-3 py-2 font-medium">{brand}</td>
                                <td className="px-3 py-2">{item.modelNumber}</td>
                                <td className="px-3 py-2 font-mono text-xs">-</td>
                                <td className="px-3 py-2 text-right">
                                  {formatINR(Number(item.mrp) || 0)}
                                </td>
                                <td className="px-3 py-2 text-right font-medium">
                                  {formatINR(Number(item.purchasePrice) || 0)}
                                </td>
                                <td className="px-3 py-2 text-right">
                                  {item.gstPercent ?? 18}%
                                </td>
                              </tr>
                            )];
                          }
                          return serials.map((sn, snIdx) => {
                            rowNum++;
                            return (
                              <tr key={`${idx}-${snIdx}`} className="border-b last:border-0">
                                <td className="px-3 py-2">{rowNum}</td>
                                <td className="px-3 py-2 font-medium">{brand}</td>
                                <td className="px-3 py-2">{item.modelNumber}</td>
                                <td className="px-3 py-2 font-mono text-xs">{sn}</td>
                                <td className="px-3 py-2 text-right">
                                  {formatINR(Number(item.mrp) || 0)}
                                </td>
                                <td className="px-3 py-2 text-right font-medium">
                                  {formatINR(Number(item.purchasePrice) || 0)}
                                </td>
                                <td className="px-3 py-2 text-right">
                                  {item.gstPercent ?? 18}%
                                </td>
                              </tr>
                            );
                          });
                        });
                      })()}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Payment Summary */}
              <div className="rounded-lg border bg-card p-6">
                <h3 className="text-base font-medium mb-3">Summary</h3>
                <div className="space-y-2 text-sm max-w-sm">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Total (Dealer Prices)</span>
                    <span>{formatINR(totalPurchasePrice)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">GST Amount</span>
                    <span>{formatINR(gstAmount)}</span>
                  </div>
                  <div className="flex justify-between border-t pt-2 font-semibold">
                    <span>Net Amount</span>
                    <span>{formatINR(netAmount)}</span>
                  </div>
                  <div className="flex justify-between text-xs text-muted-foreground">
                    <span>Payment Status</span>
                    <span className="text-amber-600 font-medium">Pending</span>
                  </div>
                </div>
                <div className="mt-4 p-3 rounded-md border bg-amber-50 dark:bg-amber-950/30 border-amber-200 dark:border-amber-800">
                  <p className="text-sm text-amber-800 dark:text-amber-200">
                    Payment will be recorded as pending. Use the distributor page to record lump-sum payments against invoices.
                  </p>
                </div>
              </div>
            </section>
          )}

          {/* Error */}
          {errorMessage && (
            <div className="flex items-center gap-2 rounded-md bg-destructive/10 px-4 py-3 text-sm text-destructive mt-6">
              <AlertCircle className="h-4 w-4 shrink-0" />
              {errorMessage}
            </div>
          )}

          {/* Navigation footer */}
          <div className="flex items-center justify-between pt-6 mt-6 border-t">
            <div>
              {currentStep > 0 && (
                <button
                  type="button"
                  onClick={goBack}
                  className={cn(
                    'flex items-center gap-2 rounded-md border px-4 py-2.5 text-sm font-medium',
                    'hover:bg-muted transition-colors',
                  )}
                >
                  <ArrowLeft className="h-4 w-4" />
                  Back
                </button>
              )}
            </div>

            <div className="flex items-center gap-4">
              <button
                type="button"
                onClick={() => navigate(-1)}
                className="rounded-md border px-4 py-2.5 text-sm font-medium text-muted-foreground hover:bg-muted transition-colors"
              >
                Cancel
              </button>

              {currentStep < STEPS.length - 1 ? (
                <button
                  type="button"
                  onClick={goNext}
                  disabled={!canGoNext()}
                  className={cn(
                    'flex items-center gap-2 rounded-md bg-primary px-6 py-2.5 text-sm font-medium text-primary-foreground',
                    'hover:bg-primary/90 transition-colors',
                    'disabled:opacity-50 disabled:cursor-not-allowed',
                  )}
                >
                  Next
                  <ArrowRight className="h-4 w-4" />
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => setIsConfirmOpen(true)}
                  disabled={createMutation.isPending}
                  className={cn(
                    'flex items-center gap-2 rounded-md bg-green-600 px-6 py-2.5 text-sm font-medium text-white',
                    'hover:bg-green-700 transition-colors',
                    'disabled:opacity-50 disabled:cursor-not-allowed',
                  )}
                >
                  {createMutation.isPending ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Creating...
                    </>
                  ) : (
                    <>
                      <Check className="h-4 w-4" />
                      Confirm Purchase
                    </>
                  )}
                </button>
              )}
            </div>
          </div>
        </form>

        {/* Final confirmation — last guard before the purchase is committed */}
        <ConfirmDialog
          isOpen={isConfirmOpen}
          title="Create this purchase?"
          message={[
            `Distributor: ${selectedDistributor?.companyName ?? '-'}`,
            `Invoice: ${methods.getValues('invoiceNumber') || '-'}  •  Date: ${methods.getValues('invoiceDate') || '-'}`,
            `Units: ${totalExpandedCount}  •  Net: ${formatINR(netAmount)} (GST ${formatINR(gstAmount)})`,
            '',
            'Once created, individual units cannot be removed — only updated. Proceed?',
          ].join('\n')}
          confirmText={createMutation.isPending ? 'Creating…' : 'Create Purchase'}
          cancelText="Review again"
          loading={createMutation.isPending}
          onConfirm={handleConfirmSubmit}
          onCancel={() => {
            if (!createMutation.isPending) setIsConfirmOpen(false);
          }}
        />
      </FormProvider>
    </div>
  );
}
