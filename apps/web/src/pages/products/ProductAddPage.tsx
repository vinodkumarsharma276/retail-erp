import { useState, useEffect } from 'react';
import { useNavigate, useParams, Link } from 'react-router-dom';
import { useForm, FormProvider } from 'react-hook-form';
import { Loader2, Save, ArrowLeft, AlertCircle } from 'lucide-react';
import { cn } from '../../lib/utils';
import { CategoryCascader } from '../../components/CategoryCascader';
import { DynamicAttributeFields } from '../../components/DynamicAttributeFields';
import {
  useProductDetailQuery,
  useCreateProductMutation,
  useUpdateProductMutation,
} from '../../hooks/useProducts';

interface ProductFormValues {
  brand: string;
  modelNumber: string;
  serialNumber: string;
  mrp: number | '';
  sellingPrice: number | '';
  purchasePrice: number | '';
  color: string;
  weightKg: number | '';
  warrantyMonths: number | '';
  barcode: string;
  notes: string;
  dynamicAttributes: Record<string, unknown>;
}

const defaultValues: ProductFormValues = {
  brand: '',
  modelNumber: '',
  serialNumber: '',
  mrp: '',
  sellingPrice: '',
  purchasePrice: '',
  color: '',
  weightKg: '',
  warrantyMonths: '',
  barcode: '',
  notes: '',
  dynamicAttributes: {},
};

export function ProductAddPage() {
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const isEditMode = !!id;

  // Category selection state
  const [selectedCategoryId, setSelectedCategoryId] = useState<string | undefined>();

  // Load existing product in edit mode
  const { data: existingProduct, isLoading: isLoadingProduct } =
    useProductDetailQuery(id);

  // Mutations
  const createMutation = useCreateProductMutation();
  const updateMutation = useUpdateProductMutation();
  const isSaving = createMutation.isPending || updateMutation.isPending;

  // Form
  const methods = useForm<ProductFormValues>({
    defaultValues,
  });
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = methods;

  // Pre-fill form when editing
  useEffect(() => {
    if (existingProduct && isEditMode) {
      setSelectedCategoryId(existingProduct.categoryId);
      reset({
        brand: existingProduct.brand,
        modelNumber: existingProduct.modelNumber,
        serialNumber: existingProduct.serialNumber ?? '',
        mrp: existingProduct.mrp,
        sellingPrice: existingProduct.sellingPrice,
        purchasePrice: existingProduct.purchasePrice,
        color: existingProduct.color ?? '',
        weightKg: existingProduct.weightKg ?? '',
        warrantyMonths: existingProduct.warrantyMonths ?? '',
        barcode: existingProduct.barcode ?? '',
        notes: existingProduct.notes ?? '',
        dynamicAttributes: existingProduct.dynamicAttributes ?? {},
      });
    }
  }, [existingProduct, isEditMode, reset]);

  const onSubmit = (formData: ProductFormValues) => {
    const payload: Record<string, unknown> = {
      categoryId: selectedCategoryId,
      brand: formData.brand.trim(),
      modelNumber: formData.modelNumber.trim(),
      serialNumber: formData.serialNumber.trim() || undefined,
      mrp: Number(formData.mrp),
      sellingPrice: Number(formData.sellingPrice),
      purchasePrice: Number(formData.purchasePrice),
      color: formData.color.trim() || undefined,
      weightKg: formData.weightKg ? Number(formData.weightKg) : undefined,
      warrantyMonths: formData.warrantyMonths
        ? Number(formData.warrantyMonths)
        : undefined,
      barcode: formData.barcode.trim() || undefined,
      notes: formData.notes.trim() || undefined,
      dynamicAttributes: formData.dynamicAttributes,
    };

    if (isEditMode && id) {
      updateMutation.mutate(
        { id, payload },
        {
          onSuccess: () => {
            navigate('/products', { replace: true });
          },
        },
      );
    } else {
      createMutation.mutate(payload, {
        onSuccess: () => {
          navigate('/products', { replace: true });
        },
      });
    }
  };

  // Error message from mutation
  const mutationError = createMutation.error || updateMutation.error;
  const errorMessage = mutationError
    ? (mutationError as any)?.response?.data?.error ??
      (mutationError as any)?.response?.data?.message ??
      'Something went wrong. Please try again.'
    : null;

  // Loading state for edit mode
  if (isEditMode && isLoadingProduct) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="max-w-6xl">
      {/* Page header */}
      <div className="flex items-center gap-4 mb-6">
        <Link
          to="/products"
          className="rounded-md p-2 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
        >
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <h1 className="text-display">
          {isEditMode ? 'Edit Product' : 'Add Product'}
        </h1>
      </div>

      <FormProvider {...methods}>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-8">
          {/* Section 1: Category Selection */}
          <section className="rounded-lg border bg-card p-6">
            <h2 className="text-lg font-medium mb-4">Category</h2>
            <CategoryCascader
              onCategorySelect={setSelectedCategoryId}
              initialCategoryId={existingProduct?.categoryId}
            />
            {!selectedCategoryId && (
              <p className="mt-2 text-xs text-muted-foreground">
                Select a category to continue.
              </p>
            )}
          </section>

          {/* Section 2: Common Fields */}
          <section className="rounded-lg border bg-card p-6">
            <h2 className="text-lg font-medium mb-4">Product Details</h2>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {/* Brand */}
              <div>
                <label htmlFor="brand" className="block text-sm font-medium mb-1.5">
                  Brand <span className="text-destructive">*</span>
                </label>
                <input
                  id="brand"
                  type="text"
                  {...register('brand', { required: 'Brand is required' })}
                  placeholder="e.g. Samsung, LG, Apple"
                  className={cn(
                    'w-full rounded-md border bg-field px-3 py-2.5 text-sm',
                    'placeholder:text-muted-foreground',
                    'focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2',
                    errors.brand && 'border-destructive',
                  )}
                />
                {errors.brand && (
                  <p className="mt-1 text-xs text-destructive">
                    {errors.brand.message}
                  </p>
                )}
              </div>

              {/* Model Number */}
              <div>
                <label htmlFor="modelNumber" className="block text-sm font-medium mb-1.5">
                  Model Number <span className="text-destructive">*</span>
                </label>
                <input
                  id="modelNumber"
                  type="text"
                  {...register('modelNumber', {
                    required: 'Model number is required',
                  })}
                  placeholder="e.g. UA55AU7700"
                  className={cn(
                    'w-full rounded-md border bg-field px-3 py-2.5 text-sm',
                    'placeholder:text-muted-foreground',
                    'focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2',
                    errors.modelNumber && 'border-destructive',
                  )}
                />
                {errors.modelNumber && (
                  <p className="mt-1 text-xs text-destructive">
                    {errors.modelNumber.message}
                  </p>
                )}
              </div>

              {/* Serial Number */}
              <div>
                <label htmlFor="serialNumber" className="block text-sm font-medium mb-1.5">
                  Serial Number
                </label>
                <input
                  id="serialNumber"
                  type="text"
                  {...register('serialNumber')}
                  placeholder="e.g. SN-12345678"
                  className={cn(
                    'w-full rounded-md border bg-field px-3 py-2.5 text-sm',
                    'placeholder:text-muted-foreground',
                    'focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2',
                  )}
                />
              </div>

              {/* MRP */}
              <div>
                <label htmlFor="mrp" className="block text-sm font-medium mb-1.5">
                  MRP <span className="text-destructive">*</span>
                </label>
                <input
                  id="mrp"
                  type="number"
                  step="0.01"
                  {...register('mrp', {
                    required: 'MRP is required',
                    min: { value: 0, message: 'MRP must be positive' },
                  })}
                  placeholder="0.00"
                  className={cn(
                    'w-full rounded-md border bg-field px-3 py-2.5 text-sm',
                    'placeholder:text-muted-foreground',
                    'focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2',
                    errors.mrp && 'border-destructive',
                  )}
                />
                {errors.mrp && (
                  <p className="mt-1 text-xs text-destructive">
                    {errors.mrp.message}
                  </p>
                )}
              </div>

              {/* Selling Price */}
              <div>
                <label htmlFor="sellingPrice" className="block text-sm font-medium mb-1.5">
                  Selling Price <span className="text-destructive">*</span>
                </label>
                <input
                  id="sellingPrice"
                  type="number"
                  step="0.01"
                  {...register('sellingPrice', {
                    required: 'Selling price is required',
                    min: { value: 0, message: 'Selling price must be positive' },
                  })}
                  placeholder="0.00"
                  className={cn(
                    'w-full rounded-md border bg-field px-3 py-2.5 text-sm',
                    'placeholder:text-muted-foreground',
                    'focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2',
                    errors.sellingPrice && 'border-destructive',
                  )}
                />
                {errors.sellingPrice && (
                  <p className="mt-1 text-xs text-destructive">
                    {errors.sellingPrice.message}
                  </p>
                )}
              </div>

              {/* Purchase Price */}
              <div>
                <label htmlFor="purchasePrice" className="block text-sm font-medium mb-1.5">
                  Purchase Price <span className="text-destructive">*</span>
                </label>
                <input
                  id="purchasePrice"
                  type="number"
                  step="0.01"
                  {...register('purchasePrice', {
                    required: 'Purchase price is required',
                    min: {
                      value: 0,
                      message: 'Purchase price must be positive',
                    },
                  })}
                  placeholder="0.00"
                  className={cn(
                    'w-full rounded-md border bg-field px-3 py-2.5 text-sm',
                    'placeholder:text-muted-foreground',
                    'focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2',
                    errors.purchasePrice && 'border-destructive',
                  )}
                />
                {errors.purchasePrice && (
                  <p className="mt-1 text-xs text-destructive">
                    {errors.purchasePrice.message}
                  </p>
                )}
              </div>

              {/* Color */}
              <div>
                <label htmlFor="color" className="block text-sm font-medium mb-1.5">
                  Color
                </label>
                <input
                  id="color"
                  type="text"
                  {...register('color')}
                  placeholder="e.g. Black, White"
                  className={cn(
                    'w-full rounded-md border bg-field px-3 py-2.5 text-sm',
                    'placeholder:text-muted-foreground',
                    'focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2',
                  )}
                />
              </div>

              {/* Weight */}
              <div>
                <label htmlFor="weightKg" className="block text-sm font-medium mb-1.5">
                  Weight (kg)
                </label>
                <input
                  id="weightKg"
                  type="number"
                  step="0.01"
                  {...register('weightKg', {
                    min: { value: 0, message: 'Weight must be positive' },
                  })}
                  placeholder="0.00"
                  className={cn(
                    'w-full rounded-md border bg-field px-3 py-2.5 text-sm',
                    'placeholder:text-muted-foreground',
                    'focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2',
                  )}
                />
              </div>

              {/* Warranty Months */}
              <div>
                <label htmlFor="warrantyMonths" className="block text-sm font-medium mb-1.5">
                  Warranty (months)
                </label>
                <input
                  id="warrantyMonths"
                  type="number"
                  {...register('warrantyMonths', {
                    min: { value: 0, message: 'Warranty must be positive' },
                  })}
                  placeholder="e.g. 12"
                  className={cn(
                    'w-full rounded-md border bg-field px-3 py-2.5 text-sm',
                    'placeholder:text-muted-foreground',
                    'focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2',
                  )}
                />
              </div>

              {/* Barcode */}
              <div>
                <label htmlFor="barcode" className="block text-sm font-medium mb-1.5">
                  Barcode
                </label>
                <input
                  id="barcode"
                  type="text"
                  {...register('barcode')}
                  placeholder="Scan or enter barcode"
                  className={cn(
                    'w-full rounded-md border bg-field px-3 py-2.5 text-sm',
                    'placeholder:text-muted-foreground',
                    'focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2',
                  )}
                />
              </div>

              {/* Notes — full width */}
              <div className="sm:col-span-2 lg:col-span-3">
                <label htmlFor="notes" className="block text-sm font-medium mb-1.5">
                  Notes
                </label>
                <textarea
                  id="notes"
                  rows={3}
                  {...register('notes')}
                  placeholder="Any additional notes about this product..."
                  className={cn(
                    'w-full rounded-md border bg-field px-3 py-2.5 text-sm',
                    'placeholder:text-muted-foreground',
                    'focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2',
                  )}
                />
              </div>
            </div>
          </section>

          {/* Section 3: Dynamic Attributes */}
          <section className="rounded-lg border bg-card p-6">
            <h2 className="text-lg font-medium mb-4">
              Category-Specific Attributes
            </h2>
            <DynamicAttributeFields
              categoryId={selectedCategoryId}
              values={isEditMode ? existingProduct?.dynamicAttributes : undefined}
            />
          </section>

          {/* Error */}
          {errorMessage && (
            <div className="flex items-center gap-2 rounded-md bg-destructive/10 px-4 py-3 text-sm text-destructive">
              <AlertCircle className="h-4 w-4 shrink-0" />
              {errorMessage}
            </div>
          )}

          {/* Footer */}
          <div className="flex items-center gap-4 pt-2">
            <button
              type="submit"
              disabled={isSaving || !selectedCategoryId}
              className={cn(
                'flex items-center gap-2 rounded-md bg-primary px-6 py-2.5 text-sm font-medium text-primary-foreground',
                'hover:bg-primary/90 transition-colors',
                'disabled:opacity-50 disabled:cursor-not-allowed',
              )}
            >
              {isSaving ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Saving...
                </>
              ) : (
                <>
                  <Save className="h-4 w-4" />
                  {isEditMode ? 'Update Product' : 'Save Product'}
                </>
              )}
            </button>
            <Link
              to="/products"
              className="rounded-md border px-6 py-2.5 text-sm font-medium text-muted-foreground hover:bg-muted transition-colors"
            >
              Cancel
            </Link>
          </div>
        </form>
      </FormProvider>
    </div>
  );
}
