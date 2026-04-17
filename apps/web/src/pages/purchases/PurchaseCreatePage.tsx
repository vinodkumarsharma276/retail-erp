import { useState, useMemo } from 'react';
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
  ChevronDown,
} from 'lucide-react';
import { cn } from '../../lib/utils';
import { useDebounce } from '../../hooks/useDebounce';
import { useDistributorsQuery } from '../../hooks/useDistributors';
import { useCreatePurchaseMutation } from '../../hooks/usePurchases';
import { CategoryCascader } from '../../components/CategoryCascader';
import { DynamicAttributeFields } from '../../components/DynamicAttributeFields';
import { formatINR } from '@retailerp/shared-utils';
import { PaymentMode } from '@retailerp/shared-types';
import type { DistributorListItem } from '@retailerp/shared-types';
import { apiClient } from '../../lib/api-client';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
interface ProductItem {
  categoryId: string;
  brand: string;
  modelNumber: string;
  serialNumber: string;
  mrp: number | '';
  purchasePrice: number | '';
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
  gstAmount: number | '';
  discountAmount: number | '';
  amountPaid: number | '';
  paymentMode: string;
  paymentReference: string;
}

const emptyProductItem: ProductItem = {
  categoryId: '',
  brand: '',
  modelNumber: '',
  serialNumber: '',
  mrp: '',
  purchasePrice: '',
  color: '',
  warrantyMonths: '',
  barcode: '',
  dynamicAttributes: {},
};

const STEPS = [
  'Select Distributor',
  'Invoice Details',
  'Add Products',
  'Payment',
  'Review',
] as const;

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
export function PurchaseCreatePage() {
  const navigate = useNavigate();
  const [currentStep, setCurrentStep] = useState(0);

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
      gstAmount: '',
      discountAmount: '',
      amountPaid: '',
      paymentMode: PaymentMode.BANK_TRANSFER,
      paymentReference: '',
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
  const watchedGst = watch('gstAmount');
  const watchedDiscount = watch('discountAmount');
  const watchedAmountPaid = watch('amountPaid');

  // Detect duplicate serial numbers within items
  const serialDuplicateMap = useMemo(() => {
    const map = new Map<number, string>();
    const seen = new Map<string, number>();
    for (let i = 0; i < watchedItems.length; i++) {
      const sn = watchedItems[i].serialNumber?.trim();
      if (!sn) continue;
      const prevIndex = seen.get(sn);
      if (prevIndex !== undefined) {
        map.set(i, `This serial number is already used in item #${prevIndex + 1}`);
        // Also mark the first occurrence if not already marked
        if (!map.has(prevIndex)) {
          map.set(prevIndex, `This serial number is also used in item #${i + 1}`);
        }
      } else {
        seen.set(sn, i);
      }
    }
    return map;
  }, [watchedItems]);

  // Computed totals
  const totalPurchasePrice = useMemo(
    () =>
      watchedItems.reduce(
        (sum, item) => sum + (Number(item.purchasePrice) || 0),
        0,
      ),
    [watchedItems],
  );

  const gstAmount = Number(watchedGst) || 0;
  const discountAmount = Number(watchedDiscount) || 0;
  const netAmount = totalPurchasePrice + gstAmount - discountAmount;
  const amountPaid = Number(watchedAmountPaid) || 0;

  // Mutation
  const createMutation = useCreatePurchaseMutation();

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
        return !invoiceCheckError && !isCheckingInvoice; // Block if duplicate detected
      case 2:
        return watchedItems.length > 0 && watchedItems.every((item) => (item.dynamicAttributes?.brand || item.brand) && item.modelNumber && item.purchasePrice) && serialDuplicateMap.size === 0;
      case 3:
        return true;
      default:
        return false;
    }
  };

  const goNext = async () => {
    if (currentStep === 1) {
      const valid = await trigger(['invoiceNumber', 'invoiceDate']);
      if (!valid) return;

      // Check invoice number duplicate against backend
      const invoiceNum = watch('invoiceNumber')?.trim();
      if (invoiceNum && selectedDistributor) {
        setIsCheckingInvoice(true);
        setInvoiceCheckError('');
        try {
          const { data } = await apiClient.get('/purchases', {
            params: { pageSize: 1, distributorId: selectedDistributor.id },
          });
          // Check all purchases for this distributor for matching invoice number
          const { data: allData } = await apiClient.get('/purchases', {
            params: { pageSize: 1000, distributorId: selectedDistributor.id, allShops: true },
          });
          const duplicate = (allData?.data ?? []).find(
            (p: any) => p.invoiceNumber?.toLowerCase() === invoiceNum.toLowerCase(),
          );
          if (duplicate) {
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
      if (!valid) return;
      // Check serial number duplicates (already blocked by canGoNext via serialDuplicateMap)
      if (serialDuplicateMap.size > 0) return;
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

    const payload: Record<string, unknown> = {
      distributorId: selectedDistributor.id,
      invoiceNumber: formData.invoiceNumber.trim(),
      invoiceDate: formData.invoiceDate,
      notes: formData.notes.trim() || undefined,
      gstAmount: Number(formData.gstAmount) || 0,
      discountAmount: Number(formData.discountAmount) || 0,
      amountPaid: Number(formData.amountPaid) || 0,
      paymentMode: formData.amountPaid ? formData.paymentMode : undefined,
      paymentReference: formData.paymentReference.trim() || undefined,
      items: formData.items.map((item, idx) => ({
        categoryId: itemCategoryIds[idx] || item.categoryId,
        brand: ((item.dynamicAttributes?.brand as string) || item.brand || '').trim(),
        modelNumber: item.modelNumber.trim(),
        serialNumber: item.serialNumber.trim() || undefined,
        mrp: Number(item.mrp) || 0,
        purchasePrice: Number(item.purchasePrice),
        color: item.color.trim() || undefined,
        warrantyMonths: item.warrantyMonths ? Number(item.warrantyMonths) : undefined,
        barcode: item.barcode.trim() || undefined,
        dynamicAttributes: item.dynamicAttributes,
      })),
    };

    createMutation.mutate(payload, {
      onSuccess: () => {
        navigate('/purchases', { replace: true });
      },
    });
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

  return (
    <div className="max-w-5xl">
      {/* Page header */}
      <div className="flex items-center gap-4 mb-6">
        <button
          onClick={() => navigate(-1)}
          className="rounded-md p-2 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
        >
          <ArrowLeft className="h-5 w-5" />
        </button>
        <h1 className="text-2xl font-semibold">New Purchase</h1>
      </div>

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
                <div className="mt-4 p-4 rounded-md bg-green-50 border border-green-200">
                  <p className="text-sm font-medium text-green-800">
                    Selected: {selectedDistributor.companyName}
                  </p>
                  <p className="text-xs text-green-600 mt-0.5">
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
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
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

                {/* Notes */}
                <div className="sm:col-span-2 lg:col-span-3">
                  <label htmlFor="notes" className="block text-sm font-medium mb-1.5">
                    Notes
                  </label>
                  <textarea
                    id="notes"
                    rows={3}
                    {...register('notes')}
                    placeholder="Any additional notes about this purchase..."
                    className={cn(
                      'w-full rounded-md border bg-background px-3 py-2.5 text-sm',
                      'placeholder:text-muted-foreground',
                      'focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2',
                    )}
                  />
                </div>
              </div>
            </section>
          )}

          {/* Step 3: Add Products */}
          {currentStep === 2 && (
            <section className="space-y-6">
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
                        className="flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-medium text-red-600 bg-red-50 hover:bg-red-100 transition-colors"
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
                    'grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3',
                    !itemCategoryIds[index] && 'opacity-40 pointer-events-none',
                  )}>
                    {/* Model */}
                    <div>
                      <label className="block text-sm font-medium mb-1.5">
                        Model <span className="text-destructive">*</span>
                      </label>
                      <input
                        type="text"
                        {...register(`items.${index}.modelNumber`, {
                          required: 'Model is required',
                        })}
                        placeholder="e.g. UA55AU7700"
                        className={cn(
                          'w-full rounded-md border bg-background px-3 py-2.5 text-sm',
                          'placeholder:text-muted-foreground',
                          'focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2',
                          errors.items?.[index]?.modelNumber && 'border-destructive',
                        )}
                      />
                      {errors.items?.[index]?.modelNumber && (
                        <p className="mt-1 text-xs text-destructive">
                          {errors.items[index].modelNumber?.message}
                        </p>
                      )}
                    </div>

                    {/* Serial Number */}
                    <div>
                      <label className="block text-sm font-medium mb-1.5">
                        Serial Number
                      </label>
                      <input
                        type="text"
                        {...register(`items.${index}.serialNumber`)}
                        placeholder="SN-12345678"
                        className={cn(
                          'w-full rounded-md border bg-background px-3 py-2.5 text-sm',
                          'placeholder:text-muted-foreground',
                          'focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2',
                          serialDuplicateMap.has(index) && 'border-destructive',
                        )}
                      />
                      {serialDuplicateMap.has(index) && (
                        <p className="mt-1 text-xs text-destructive">
                          {serialDuplicateMap.get(index)}
                        </p>
                      )}
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
            </section>
          )}

          {/* Step 4: Payment */}
          {currentStep === 3 && (
            <section className="rounded-lg border bg-card p-6">
              <h2 className="text-lg font-medium mb-4">Payment Details</h2>

              {/* Totals summary */}
              <div className="rounded-md bg-muted/50 p-4 mb-6">
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  <div>
                    <p className="text-xs font-medium text-muted-foreground">
                      Total (Dealer Prices)
                    </p>
                    <p className="text-lg font-semibold mt-0.5">
                      {formatINR(totalPurchasePrice)}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs font-medium text-muted-foreground">
                      GST Amount
                    </p>
                    <p className="text-lg font-semibold mt-0.5">
                      {formatINR(gstAmount)}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs font-medium text-muted-foreground">
                      Discount
                    </p>
                    <p className="text-lg font-semibold mt-0.5">
                      {formatINR(discountAmount)}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs font-medium text-muted-foreground">
                      Net Amount
                    </p>
                    <p className="text-lg font-bold text-primary mt-0.5">
                      {formatINR(netAmount)}
                    </p>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {/* GST Amount */}
                <div>
                  <label htmlFor="gstAmount" className="block text-sm font-medium mb-1.5">
                    GST Amount
                  </label>
                  <input
                    id="gstAmount"
                    type="number"
                    step="0.01"
                    {...register('gstAmount', {
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

                {/* Discount */}
                <div>
                  <label htmlFor="discountAmount" className="block text-sm font-medium mb-1.5">
                    Discount
                  </label>
                  <input
                    id="discountAmount"
                    type="number"
                    step="0.01"
                    {...register('discountAmount', {
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

                {/* Amount Paid */}
                <div>
                  <label htmlFor="amountPaid" className="block text-sm font-medium mb-1.5">
                    Amount Paid
                  </label>
                  <input
                    id="amountPaid"
                    type="number"
                    step="0.01"
                    {...register('amountPaid', {
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

                {/* Payment Mode */}
                <div>
                  <label htmlFor="paymentMode" className="block text-sm font-medium mb-1.5">
                    Payment Mode
                  </label>
                  <div className="relative">
                    <select
                      id="paymentMode"
                      {...register('paymentMode')}
                      className={cn(
                        'w-full appearance-none rounded-md border bg-background px-3 py-2.5 pr-8 text-sm',
                        'focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2',
                      )}
                    >
                      <option value={PaymentMode.CASH}>Cash</option>
                      <option value={PaymentMode.BANK_TRANSFER}>Bank Transfer</option>
                      <option value={PaymentMode.UPI}>UPI</option>
                      <option value={PaymentMode.CHEQUE}>Cheque</option>
                      <option value={PaymentMode.CREDIT_CARD}>Credit Card</option>
                      <option value={PaymentMode.DEBIT_CARD}>Debit Card</option>
                    </select>
                    <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  </div>
                </div>

                {/* Payment Reference */}
                <div>
                  <label htmlFor="paymentReference" className="block text-sm font-medium mb-1.5">
                    Reference Number
                  </label>
                  <input
                    id="paymentReference"
                    type="text"
                    {...register('paymentReference')}
                    placeholder="Transaction/Cheque number"
                    className={cn(
                      'w-full rounded-md border bg-background px-3 py-2.5 text-sm',
                      'placeholder:text-muted-foreground',
                      'focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2',
                    )}
                  />
                </div>
              </div>

              {/* Pending amount indicator */}
              {netAmount > 0 && (
                <div className="mt-4 p-3 rounded-md border">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">
                      Pending after this payment:
                    </span>
                    <span
                      className={cn(
                        'font-semibold',
                        netAmount - amountPaid > 0
                          ? 'text-red-600'
                          : 'text-green-600',
                      )}
                    >
                      {formatINR(Math.max(0, netAmount - amountPaid))}
                    </span>
                  </div>
                </div>
              )}
            </section>
          )}

          {/* Step 5: Review */}
          {currentStep === 4 && (
            <section className="space-y-6">
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

              {/* Products */}
              <div className="rounded-lg border bg-card p-6">
                <h3 className="text-base font-medium mb-3">
                  Products ({watchedItems.length})
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
                      </tr>
                    </thead>
                    <tbody>
                      {watchedItems.map((item, idx) => (
                        <tr key={idx} className="border-b last:border-0">
                          <td className="px-3 py-2">{idx + 1}</td>
                          <td className="px-3 py-2 font-medium">
                            {(item.dynamicAttributes?.brand as string) || item.brand || '-'}
                          </td>
                          <td className="px-3 py-2">{item.modelNumber}</td>
                          <td className="px-3 py-2 font-mono text-xs">
                            {item.serialNumber || '-'}
                          </td>
                          <td className="px-3 py-2 text-right">
                            {formatINR(Number(item.mrp) || 0)}
                          </td>
                          <td className="px-3 py-2 text-right font-medium">
                            {formatINR(Number(item.purchasePrice) || 0)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Payment Summary */}
              <div className="rounded-lg border bg-card p-6">
                <h3 className="text-base font-medium mb-3">Payment Summary</h3>
                <div className="space-y-2 text-sm max-w-sm">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Total (Dealer Prices)</span>
                    <span>{formatINR(totalPurchasePrice)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">GST</span>
                    <span>{formatINR(gstAmount)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Discount</span>
                    <span>- {formatINR(discountAmount)}</span>
                  </div>
                  <div className="flex justify-between border-t pt-2 font-semibold">
                    <span>Net Amount</span>
                    <span>{formatINR(netAmount)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Amount Paid</span>
                    <span className="text-green-600">
                      {formatINR(amountPaid)}
                    </span>
                  </div>
                  <div className="flex justify-between border-t pt-2 font-semibold">
                    <span>Pending</span>
                    <span
                      className={
                        netAmount - amountPaid > 0
                          ? 'text-red-600'
                          : 'text-green-600'
                      }
                    >
                      {formatINR(Math.max(0, netAmount - amountPaid))}
                    </span>
                  </div>
                  {amountPaid > 0 && (
                    <div className="flex justify-between text-xs text-muted-foreground">
                      <span>Payment Mode</span>
                      <span className="capitalize">
                        {watch('paymentMode')?.replace(/_/g, ' ')}
                      </span>
                    </div>
                  )}
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
                  type="submit"
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
      </FormProvider>
    </div>
  );
}
