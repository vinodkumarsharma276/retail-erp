import { useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { Loader2, Save, ArrowLeft, AlertCircle, ChevronDown } from 'lucide-react';
import { cn } from '../../lib/utils';
import {
  useExpenseDetailQuery,
  useCreateExpenseMutation,
  useUpdateExpenseMutation,
} from '../../hooks/useExpenses';
import { ExpenseCategory } from '@retailerp/shared-types';

// ---------------------------------------------------------------------------
// Form values
// ---------------------------------------------------------------------------
interface ExpenseFormValues {
  expenseDate: string;
  category: string;
  vendorName: string;
  description: string;
  amount: number | '';
  gstAmount: number | '';
  invoiceNumber: string;
  isGstClaimable: boolean;
}

const defaultValues: ExpenseFormValues = {
  expenseDate: new Date().toISOString().split('T')[0],
  category: '',
  vendorName: '',
  description: '',
  amount: '',
  gstAmount: '',
  invoiceNumber: '',
  isGstClaimable: false,
};

const CATEGORY_OPTIONS = Object.values(ExpenseCategory);

const CATEGORY_LABELS: Record<string, string> = {
  rent: 'Rent',
  electricity: 'Electricity',
  salary: 'Salary',
  transport: 'Transport',
  maintenance: 'Maintenance',
  marketing: 'Marketing',
  purchase: 'Purchase',
  misc: 'Misc',
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
export function ExpenseFormPage() {
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const isEditMode = !!id;

  // Load existing expense in edit mode
  const { data: existingExpense, isLoading: isLoadingExpense } =
    useExpenseDetailQuery(id);

  // Mutations
  const createMutation = useCreateExpenseMutation();
  const updateMutation = useUpdateExpenseMutation();
  const isSaving = createMutation.isPending || updateMutation.isPending;

  // Form
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<ExpenseFormValues>({ defaultValues });

  // Pre-fill form when editing
  useEffect(() => {
    if (existingExpense && isEditMode) {
      reset({
        expenseDate: existingExpense.expenseDate
          ? new Date(existingExpense.expenseDate).toISOString().split('T')[0]
          : '',
        category: existingExpense.category,
        vendorName: existingExpense.vendorName ?? '',
        description: existingExpense.description ?? '',
        amount: existingExpense.amount,
        gstAmount: existingExpense.gstAmount,
        invoiceNumber: existingExpense.invoiceNumber ?? '',
        isGstClaimable: existingExpense.isGstClaimable,
      });
    }
  }, [existingExpense, isEditMode, reset]);

  const onSubmit = (formData: ExpenseFormValues) => {
    const payload: Record<string, unknown> = {
      expenseDate: formData.expenseDate,
      category: formData.category,
      vendorName: formData.vendorName.trim() || undefined,
      description: formData.description.trim() || undefined,
      amount: Number(formData.amount),
      gstAmount: formData.gstAmount ? Number(formData.gstAmount) : 0,
      invoiceNumber: formData.invoiceNumber.trim() || undefined,
      isGstClaimable: formData.isGstClaimable,
    };

    if (isEditMode && id) {
      updateMutation.mutate(
        { id, payload },
        {
          onSuccess: () => {
            navigate('/expenses', { replace: true });
          },
        },
      );
    } else {
      createMutation.mutate(payload, {
        onSuccess: () => {
          navigate('/expenses', { replace: true });
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
  if (isEditMode && isLoadingExpense) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

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
        <h1 className="text-2xl font-semibold">
          {isEditMode ? 'Edit Expense' : 'Add Expense'}
        </h1>
      </div>

      <form onSubmit={handleSubmit(onSubmit)} className="space-y-8">
        {/* Expense details section */}
        <section className="rounded-lg border bg-card p-6">
          <h2 className="text-lg font-medium mb-4">Expense Details</h2>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {/* Expense Date */}
            <div>
              <label htmlFor="expenseDate" className="block text-sm font-medium mb-1.5">
                Expense Date <span className="text-destructive">*</span>
              </label>
              <input
                id="expenseDate"
                type="date"
                {...register('expenseDate', {
                  required: 'Expense date is required',
                })}
                className={cn(
                  'w-full rounded-md border bg-background px-3 py-2.5 text-sm',
                  'focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2',
                  errors.expenseDate && 'border-destructive',
                )}
              />
              {errors.expenseDate && (
                <p className="mt-1 text-xs text-destructive">
                  {errors.expenseDate.message}
                </p>
              )}
            </div>

            {/* Category */}
            <div>
              <label htmlFor="category" className="block text-sm font-medium mb-1.5">
                Category <span className="text-destructive">*</span>
              </label>
              <div className="relative">
                <select
                  id="category"
                  {...register('category', {
                    required: 'Category is required',
                  })}
                  className={cn(
                    'w-full appearance-none rounded-md border bg-background px-3 py-2.5 pr-8 text-sm',
                    'focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2',
                    errors.category && 'border-destructive',
                  )}
                >
                  <option value="">Select Category...</option>
                  {CATEGORY_OPTIONS.map((cat) => (
                    <option key={cat} value={cat}>
                      {CATEGORY_LABELS[cat] ?? cat}
                    </option>
                  ))}
                </select>
                <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              </div>
              {errors.category && (
                <p className="mt-1 text-xs text-destructive">
                  {errors.category.message}
                </p>
              )}
            </div>

            {/* Vendor Name */}
            <div>
              <label htmlFor="vendorName" className="block text-sm font-medium mb-1.5">
                Vendor Name
              </label>
              <input
                id="vendorName"
                type="text"
                {...register('vendorName')}
                placeholder="e.g. Electrician Raju"
                className={cn(
                  'w-full rounded-md border bg-background px-3 py-2.5 text-sm',
                  'placeholder:text-muted-foreground',
                  'focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2',
                )}
              />
            </div>

            {/* Invoice Number */}
            <div>
              <label htmlFor="invoiceNumber" className="block text-sm font-medium mb-1.5">
                Invoice Number
              </label>
              <input
                id="invoiceNumber"
                type="text"
                {...register('invoiceNumber')}
                placeholder="e.g. INV-2026-001"
                className={cn(
                  'w-full rounded-md border bg-background px-3 py-2.5 text-sm',
                  'placeholder:text-muted-foreground',
                  'focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2',
                )}
              />
            </div>

            {/* Description */}
            <div className="sm:col-span-2">
              <label htmlFor="description" className="block text-sm font-medium mb-1.5">
                Description
              </label>
              <textarea
                id="description"
                rows={3}
                {...register('description')}
                placeholder="Details about the expense..."
                className={cn(
                  'w-full rounded-md border bg-background px-3 py-2.5 text-sm',
                  'placeholder:text-muted-foreground',
                  'focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2',
                )}
              />
            </div>
          </div>
        </section>

        {/* Amount section */}
        <section className="rounded-lg border bg-card p-6">
          <h2 className="text-lg font-medium mb-4">Amount Details</h2>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            {/* Amount */}
            <div>
              <label htmlFor="amount" className="block text-sm font-medium mb-1.5">
                Amount <span className="text-destructive">*</span>
              </label>
              <input
                id="amount"
                type="number"
                step="0.01"
                {...register('amount', {
                  required: 'Amount is required',
                  min: { value: 0.01, message: 'Amount must be greater than 0' },
                })}
                placeholder="0.00"
                className={cn(
                  'w-full rounded-md border bg-background px-3 py-2.5 text-sm',
                  'placeholder:text-muted-foreground',
                  'focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2',
                  errors.amount && 'border-destructive',
                )}
              />
              {errors.amount && (
                <p className="mt-1 text-xs text-destructive">
                  {errors.amount.message}
                </p>
              )}
            </div>

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
                  min: { value: 0, message: 'GST amount cannot be negative' },
                })}
                placeholder="0.00"
                className={cn(
                  'w-full rounded-md border bg-background px-3 py-2.5 text-sm',
                  'placeholder:text-muted-foreground',
                  'focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2',
                  errors.gstAmount && 'border-destructive',
                )}
              />
              {errors.gstAmount && (
                <p className="mt-1 text-xs text-destructive">
                  {errors.gstAmount.message}
                </p>
              )}
            </div>

            {/* GST Claimable */}
            <div className="flex items-end">
              <label
                htmlFor="isGstClaimable"
                className={cn(
                  'flex items-center gap-2.5 rounded-md border p-3 cursor-pointer transition-colors',
                  'hover:bg-muted',
                )}
              >
                <input
                  id="isGstClaimable"
                  type="checkbox"
                  {...register('isGstClaimable')}
                  className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary"
                />
                <span className="text-sm font-medium">GST Claimable</span>
              </label>
            </div>
          </div>
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
            disabled={isSaving}
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
                {isEditMode ? 'Update Expense' : 'Save Expense'}
              </>
            )}
          </button>
          <button
            type="button"
            onClick={() => navigate(-1)}
            className="rounded-md border px-6 py-2.5 text-sm font-medium text-muted-foreground hover:bg-muted transition-colors"
          >
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}
