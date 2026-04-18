import { useState, useMemo, useEffect, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import {
  ArrowLeft,
  Loader2,
  AlertCircle,
  Search,
  X,
  ChevronDown,
  Plus,
  Check,
  ShoppingCart,
  Package,
  User,
  FileText,
  CreditCard,
  Shield,
} from 'lucide-react';
import { cn } from '../../lib/utils';
import { useDebounce } from '../../hooks/useDebounce';
import { useProductDetailQuery } from '../../hooks/useProducts';
import {
  useCustomerSearchQuery,
  useCreateCustomerMutation,
} from '../../hooks/useCustomers';
import { useCreateSaleMutation } from '../../hooks/useSales';
import { useFinanceCompaniesQuery } from '../../hooks/useFinanceCompanies';
import { useAuthStore } from '../../stores/auth-store';
import { StatusBadge } from '../../components/StatusBadge';
import { CustomerReliabilityCard } from '../../components/CustomerReliabilityCard';
import {
  formatINR,
  calculateEMI,
  INTEREST_RATES,
  INSTALLMENT_MONTHS,
} from '@retailerp/shared-utils';
import {
  UserRole,
  SaleType,
  PaymentMode,
} from '@retailerp/shared-types';
import type { Customer, Product } from '@retailerp/shared-types';
import type { EMICalculationResult } from '@retailerp/shared-types';

// ---------------------------------------------------------------------------
// GST types and slabs
// ---------------------------------------------------------------------------
type GstType = 'GST' | 'CGST_SGST' | 'IGST';
const GST_SLABS = [0, 5, 12, 18, 28] as const;

// ---------------------------------------------------------------------------
// Form values
// ---------------------------------------------------------------------------
interface SaleFormValues {
  ledgerNumber: string;
  saleType: SaleType;
  // Pricing
  sellingPrice: number | '';
  gstRate: number | '';
  // Payment
  downPayment: number | '';
  // Partial with promise
  promiseDate: string;
  // Self finance
  interestRate: number;
  fileCharge: number | '';
  numInstallments: number;
  // Company finance
  financeCompanyId: string;
  financedAmount: number | '';
  expectedPaymentDate: string;
  // Notes
  notes: string;
}

const defaultValues: SaleFormValues = {
  ledgerNumber: '',
  saleType: SaleType.FULL_PAYMENT,
  sellingPrice: '',
  gstRate: 18,
  downPayment: '',
  promiseDate: getDateDaysFromNow(7),
  interestRate: 1,
  fileCharge: '',
  numInstallments: 6,
  financeCompanyId: '',
  financedAmount: '',
  expectedPaymentDate: getTomorrowDate(),
  notes: '',
};

// ---------------------------------------------------------------------------
// New customer inline form values
// ---------------------------------------------------------------------------
interface NewCustomerFormValues {
  name: string;
  phone: string;
  altPhone: string;
  aadhaarNumber: string;
  addressLine1: string;
  city: string;
  state: string;
  pincode: string;
}

const emptyNewCustomer: NewCustomerFormValues = {
  name: '',
  phone: '',
  altPhone: '',
  aadhaarNumber: '',
  addressLine1: '',
  city: '',
  state: '',
  pincode: '',
};

interface NewGuarantorFormValues {
  name: string;
  phone: string;
  altPhone: string;
  aadhaarNumber: string;
  addressLine1: string;
  city: string;
}

const emptyNewGuarantor: NewGuarantorFormValues = {
  name: '',
  phone: '',
  altPhone: '',
  aadhaarNumber: '',
  addressLine1: '',
  city: '',
};

// ---------------------------------------------------------------------------
// Payment mode options
// ---------------------------------------------------------------------------
const PAYMENT_MODES = [
  { value: PaymentMode.CASH, label: 'Cash' },
  { value: PaymentMode.CREDIT_CARD, label: 'Credit Card' },
  { value: PaymentMode.DEBIT_CARD, label: 'Debit Card' },
  { value: PaymentMode.UPI, label: 'UPI' },
] as const;

// ---------------------------------------------------------------------------
// Indian states
// ---------------------------------------------------------------------------
const INDIAN_STATES = [
  'Andhra Pradesh', 'Arunachal Pradesh', 'Assam', 'Bihar', 'Chhattisgarh',
  'Delhi', 'Goa', 'Gujarat', 'Haryana', 'Himachal Pradesh', 'Jharkhand',
  'Karnataka', 'Kerala', 'Madhya Pradesh', 'Maharashtra', 'Manipur',
  'Meghalaya', 'Mizoram', 'Nagaland', 'Odisha', 'Punjab', 'Rajasthan',
  'Sikkim', 'Tamil Nadu', 'Telangana', 'Tripura', 'Uttar Pradesh',
  'Uttarakhand', 'West Bengal',
];

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------
function getTomorrowDate(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return d.toISOString().split('T')[0];
}

function getDateDaysFromNow(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().split('T')[0];
}

// ===========================================================================
// COMPONENT
// ===========================================================================
export function SaleCreatePage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const productIdFromUrl = searchParams.get('productId');
  const user = useAuthStore((s) => s.user);
  const userRole = user?.role;

  const isOthersRole = userRole === UserRole.OTHERS;

  // -----------------------------------------------------------------------
  // Product state
  // -----------------------------------------------------------------------
  const { data: preSelectedProduct, isLoading: isProductLoading } =
    useProductDetailQuery(productIdFromUrl ?? undefined);
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [productSearchText, setProductSearchText] = useState('');

  // If product is preselected from URL, use it
  useEffect(() => {
    if (preSelectedProduct) {
      setSelectedProduct(preSelectedProduct);
    }
  }, [preSelectedProduct]);

  // -----------------------------------------------------------------------
  // Customer state
  // -----------------------------------------------------------------------
  const [customerSearchText, setCustomerSearchText] = useState('');
  const debouncedCustomerSearch = useDebounce(customerSearchText, 300);
  const customerSearchQuery = useCustomerSearchQuery(debouncedCustomerSearch);
  const customerResults = customerSearchQuery.data ?? [];
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
  const [showCustomerDropdown, setShowCustomerDropdown] = useState(false);
  const [showNewCustomerForm, setShowNewCustomerForm] = useState(false);
  const [newCustomer, setNewCustomer] = useState<NewCustomerFormValues>(emptyNewCustomer);
  const createCustomerMutation = useCreateCustomerMutation();

  // -----------------------------------------------------------------------
  // Guarantor state (for self-finance)
  // -----------------------------------------------------------------------
  const [guarantorSearchText, setGuarantorSearchText] = useState('');
  const debouncedGuarantorSearch = useDebounce(guarantorSearchText, 300);
  const guarantorSearchQuery = useCustomerSearchQuery(debouncedGuarantorSearch);
  const guarantorResults = guarantorSearchQuery.data ?? [];
  const [selectedGuarantor, setSelectedGuarantor] = useState<Customer | null>(null);
  const [showGuarantorDropdown, setShowGuarantorDropdown] = useState(false);
  const [showNewGuarantorForm, setShowNewGuarantorForm] = useState(false);
  const [newGuarantor, setNewGuarantor] = useState<NewGuarantorFormValues>(emptyNewGuarantor);
  const createGuarantorMutation = useCreateCustomerMutation();

  // -----------------------------------------------------------------------
  // Finance companies
  // -----------------------------------------------------------------------
  const { data: financeCompanies } = useFinanceCompaniesQuery();

  // -----------------------------------------------------------------------
  // GST type state
  // -----------------------------------------------------------------------
  const [saleGstType, setSaleGstType] = useState<GstType>('GST');

  // -----------------------------------------------------------------------
  // Track whether user has manually edited down payment
  // -----------------------------------------------------------------------
  const [downPaymentManuallySet, setDownPaymentManuallySet] = useState(false);

  // -----------------------------------------------------------------------
  // Payment splits — up to 3 modes that add up to down payment (or full amount)
  // -----------------------------------------------------------------------
  const [paymentSplits, setPaymentSplits] = useState<Array<{mode: PaymentMode; amount: number | ''}>>([
    { mode: PaymentMode.CASH, amount: '' },
  ]);

  // -----------------------------------------------------------------------
  // Sale form
  // -----------------------------------------------------------------------
  const {
    register,
    handleSubmit,
    watch,
    setValue,
    formState: { errors },
  } = useForm<SaleFormValues>({ defaultValues });

  const saleType = watch('saleType');
  const sellingPrice = Number(watch('sellingPrice')) || 0;
  const gstRate = Number(watch('gstRate')) || 0;
  const downPayment = Number(watch('downPayment')) || 0;
  const interestRate = watch('interestRate');
  const fileCharge = Number(watch('fileCharge')) || 0;
  const numInstallments = watch('numInstallments');
  const financedAmount = Number(watch('financedAmount')) || 0;

  // Pre-fill selling price with MRP and down payment with 50% when product is selected
  useEffect(() => {
    if (selectedProduct && !watch('sellingPrice')) {
      setValue('sellingPrice', selectedProduct.mrp);
      // Set initial down payment to 50% of MRP
      setValue('downPayment', Math.round(selectedProduct.mrp / 2));
      setDownPaymentManuallySet(false);
    }
  }, [selectedProduct, setValue, watch]);

  // Auto-select GST rate from purchase invoice
  useEffect(() => {
    if (selectedProduct) {
      const purchase = (selectedProduct as any).purchase;
      if (purchase && purchase.totalAmount > 0) {
        const totalAmt = Number(purchase.totalAmount);
        const discAmt = Number(purchase.discountAmount || 0);
        const gstAmt = Number(purchase.gstAmount || 0);
        const base = totalAmt - discAmt;
        if (base > 0 && gstAmt > 0) {
          const rawRate = (gstAmt / base) * 100;
          // Snap to nearest standard slab
          const slabs = [0, 5, 12, 18, 28];
          const nearest = slabs.reduce((prev, curr) =>
            Math.abs(curr - rawRate) < Math.abs(prev - rawRate) ? curr : prev
          );
          setValue('gstRate', nearest);
        }
      }
    }
  }, [selectedProduct, setValue]);

  // Auto-update down payment when SP changes (only if user hasn't manually edited)
  // Company finance: default 0, others: default 50%
  useEffect(() => {
    if (!downPaymentManuallySet && sellingPrice > 0) {
      if (saleType === SaleType.COMPANY_FINANCE) {
        setValue('downPayment', 0);
        setValue('financedAmount', sellingPrice);
      } else {
        setValue('downPayment', Math.round(sellingPrice / 2));
      }
    }
  }, [sellingPrice, downPaymentManuallySet, saleType, setValue]);

  // Auto-adjust financed amount = SP - down payment (for company finance)
  useEffect(() => {
    if (saleType === SaleType.COMPANY_FINANCE && sellingPrice > 0) {
      setValue('financedAmount', Math.max(0, sellingPrice - downPayment));
    }
  }, [saleType, sellingPrice, downPayment, setValue]);

  // Reset payment splits and down payment defaults when sale type changes
  useEffect(() => {
    setPaymentSplits([{ mode: PaymentMode.CASH, amount: '' }]);
    setDownPaymentManuallySet(false);
    if (saleType === SaleType.COMPANY_FINANCE) {
      setValue('downPayment', 0);
      if (sellingPrice > 0) setValue('financedAmount', sellingPrice);
    } else if (sellingPrice > 0) {
      setValue('downPayment', Math.round(sellingPrice / 2));
    }
  }, [saleType]); // eslint-disable-line react-hooks/exhaustive-deps

  // -----------------------------------------------------------------------
  // Computed amounts
  // -----------------------------------------------------------------------
  // Selling price is GST-inclusive — extract GST via reverse calculation
  const gstAmount = gstRate > 0 ? Math.round(sellingPrice * gstRate / (100 + gstRate)) : 0;
  const totalAmount = sellingPrice; // SP is already the total (GST-inclusive)

  // Pending amount depends on sale type
  const pendingAmount = useMemo(() => {
    switch (saleType) {
      case SaleType.FULL_PAYMENT:
        return 0;
      case SaleType.PARTIAL_WITH_PROMISE:
        return Math.max(0, totalAmount - downPayment);
      case SaleType.SELF_FINANCE:
        return 0; // Tracked via installment schedule
      case SaleType.COMPANY_FINANCE:
        return Math.max(0, totalAmount - downPayment - financedAmount);
      default:
        return 0;
    }
  }, [saleType, totalAmount, downPayment, financedAmount]);

  // -----------------------------------------------------------------------
  // EMI calculation (for self-finance)
  // -----------------------------------------------------------------------
  const emiResult: EMICalculationResult | null = useMemo(() => {
    if (saleType !== SaleType.SELF_FINANCE) return null;
    if (sellingPrice <= 0 || downPayment < 0) return null;
    const principal = sellingPrice - downPayment;
    if (principal <= 0) return null;

    return calculateEMI({
      sellingPrice,
      downPayment,
      interestRate,
      fileCharge,
      numInstallments,
    });
  }, [saleType, sellingPrice, downPayment, interestRate, fileCharge, numInstallments]);

  // -----------------------------------------------------------------------
  // Create sale mutation
  // -----------------------------------------------------------------------
  const createSaleMutation = useCreateSaleMutation();

  const onSubmit = (formData: SaleFormValues) => {
    if (!selectedProduct || !selectedCustomer) return;

    // Discount is auto-calculated as MRP - Selling Price
    const autoDiscount = selectedProduct.mrp - Number(formData.sellingPrice);

    // Build payment breakdown from splits
    const breakdown = paymentSplits
      .filter(s => Number(s.amount) > 0)
      .map(s => ({ mode: s.mode, amount: Number(s.amount) }));

    // Primary payment mode = the largest split (or first)
    const primaryMode = breakdown.length > 0
      ? breakdown.reduce((a, b) => b.amount > a.amount ? b : a).mode
      : PaymentMode.CASH;

    const payload: Record<string, unknown> = {
      productId: selectedProduct.id,
      customerId: selectedCustomer.id,
      ledgerNumber: formData.ledgerNumber.trim(),
      saleType: formData.saleType,
      sellingPrice: Number(formData.sellingPrice),
      discountAmount: autoDiscount > 0 ? autoDiscount : 0,
      gstRate: Number(formData.gstRate) || 0,
      paymentMode: primaryMode,
      paymentBreakdown: breakdown.length > 1 ? breakdown : undefined,
      notes: formData.notes.trim()
        ? `${formData.notes.trim()} | GST Type: ${saleGstType}`
        : `GST Type: ${saleGstType}`,
    };

    // Type-specific fields
    switch (formData.saleType) {
      case SaleType.FULL_PAYMENT:
        payload.downPayment = totalAmount;
        break;
      case SaleType.PARTIAL_WITH_PROMISE:
        payload.downPayment = Number(formData.downPayment) || 0;
        payload.promiseDate = formData.promiseDate || undefined;
        break;
      case SaleType.SELF_FINANCE:
        payload.downPayment = Number(formData.downPayment) || 0;
        payload.interestRate = formData.interestRate;
        payload.fileCharge = Number(formData.fileCharge) || 0;
        payload.numInstallments = formData.numInstallments;
        payload.guarantorId = selectedGuarantor?.id;
        break;
      case SaleType.COMPANY_FINANCE:
        payload.downPayment = Number(formData.downPayment) || 0;
        if (formData.financeCompanyId && formData.financeCompanyId.trim()) {
          payload.financeCompanyId = formData.financeCompanyId.trim();
        }
        payload.financedAmount = Number(formData.financedAmount) || 0;
        payload.expectedPaymentDate = formData.expectedPaymentDate || undefined;
        break;
    }

    createSaleMutation.mutate(payload, {
      onSuccess: (data) => {
        navigate(`/sales/${data.id}`, { replace: true });
      },
    });
  };

  // -----------------------------------------------------------------------
  // Create inline customer
  // -----------------------------------------------------------------------
  const handleCreateNewCustomer = () => {
    const payload: Record<string, unknown> = {
      name: newCustomer.name.trim(),
      phone: newCustomer.phone.trim(),
      altPhone: newCustomer.altPhone.trim() || undefined,
      aadhaarNumber: newCustomer.aadhaarNumber.trim() || undefined,
      addressLine1: newCustomer.addressLine1.trim() || undefined,
      city: newCustomer.city.trim() || undefined,
      state: newCustomer.state || undefined,
      pincode: newCustomer.pincode.trim() || undefined,
    };

    createCustomerMutation.mutate(payload, {
      onSuccess: (data) => {
        setSelectedCustomer(data);
        setShowNewCustomerForm(false);
        setNewCustomer(emptyNewCustomer);
      },
    });
  };

  // -----------------------------------------------------------------------
  // Create inline guarantor
  // -----------------------------------------------------------------------
  const handleCreateNewGuarantor = () => {
    const payload: Record<string, unknown> = {
      name: newGuarantor.name.trim(),
      phone: newGuarantor.phone.trim(),
      altPhone: newGuarantor.altPhone.trim() || undefined,
      aadhaarNumber: newGuarantor.aadhaarNumber.trim() || undefined,
      addressLine1: newGuarantor.addressLine1.trim() || undefined,
      city: newGuarantor.city.trim() || undefined,
      isGuarantor: true,
    };

    createGuarantorMutation.mutate(payload, {
      onSuccess: (data) => {
        setSelectedGuarantor(data);
        setShowNewGuarantorForm(false);
        setNewGuarantor(emptyNewGuarantor);
      },
    });
  };

  // -----------------------------------------------------------------------
  // Validation for submit
  // -----------------------------------------------------------------------
  const canSubmit = useMemo(() => {
    if (!selectedProduct || !selectedCustomer) return false;
    if (saleType === SaleType.SELF_FINANCE && !selectedGuarantor) return false;
    return true;
  }, [selectedProduct, selectedCustomer, saleType, selectedGuarantor]);

  // Error message from mutation
  const errorMessage = createSaleMutation.error
    ? (createSaleMutation.error as any)?.response?.data?.error ??
      (createSaleMutation.error as any)?.response?.data?.message ??
      'Something went wrong. Please try again.'
    : null;

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
        <h1 className="text-2xl font-semibold">New Sale</h1>
      </div>

      <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
        {/* =============================================================== */}
        {/* SECTION 1: PRODUCT */}
        {/* =============================================================== */}
        <section className="rounded-lg border bg-card p-6">
          <h2 className="text-lg font-medium mb-4 flex items-center gap-2">
            <Package className="h-5 w-5 text-primary" />
            Product
          </h2>

          {isProductLoading && productIdFromUrl ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading product...
            </div>
          ) : selectedProduct ? (
            <div className="rounded-md border-2 border-primary/20 bg-primary/5 p-4">
              {/* Header: name + change button */}
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-3">
                  <p className="font-semibold text-lg">
                    {selectedProduct.brand} {selectedProduct.modelNumber}
                  </p>
                  <StatusBadge status={selectedProduct.status} />
                </div>
                {!productIdFromUrl && (
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedProduct(null);
                      setProductSearchText('');
                    }}
                    className="text-sm text-primary hover:underline"
                  >
                    Change
                  </button>
                )}
              </div>

              {/* Product details grid */}
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-x-6 gap-y-3 text-sm">
                {selectedProduct.serialNumber && (
                  <div>
                    <span className="text-muted-foreground">Serial No.</span>
                    <p className="font-mono text-xs mt-0.5">{selectedProduct.serialNumber}</p>
                  </div>
                )}
                {(selectedProduct as any).category?.name && (
                  <div>
                    <span className="text-muted-foreground">Category</span>
                    <p className="font-medium mt-0.5">{(selectedProduct as any).category.name}</p>
                  </div>
                )}
                {selectedProduct.color && (
                  <div>
                    <span className="text-muted-foreground">Color</span>
                    <p className="font-medium mt-0.5">{selectedProduct.color}</p>
                  </div>
                )}
                {selectedProduct.barcode && (
                  <div>
                    <span className="text-muted-foreground">Barcode</span>
                    <p className="font-mono text-xs mt-0.5">{selectedProduct.barcode}</p>
                  </div>
                )}
                {selectedProduct.warrantyMonths && (
                  <div>
                    <span className="text-muted-foreground">Warranty</span>
                    <p className="font-medium mt-0.5">{selectedProduct.warrantyMonths} months</p>
                  </div>
                )}
              </div>

              {/* Pricing row */}
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 mt-4 pt-3 border-t border-primary/10">
                <div>
                  <span className="text-xs text-muted-foreground">MRP</span>
                  <p className="font-semibold">{formatINR(selectedProduct.mrp)}</p>
                </div>
                <div>
                  <span className="text-xs text-muted-foreground">DP (Dealer Price)</span>
                  <p className="font-semibold">{formatINR(selectedProduct.purchasePrice)}</p>
                </div>
              </div>
            </div>
          ) : (
            <div>
              <p className="text-sm text-muted-foreground mb-2">
                No product selected. Go to the product list and click "Sell Item"
                on an in-stock product, or search below.
              </p>
              <div className="relative max-w-md">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <input
                  type="text"
                  value={productSearchText}
                  onChange={(e) => setProductSearchText(e.target.value)}
                  placeholder="Search product by brand or model..."
                  className={cn(
                    'w-full rounded-md border bg-background pl-9 pr-3 py-2.5 text-sm',
                    'placeholder:text-muted-foreground',
                    'focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2',
                  )}
                />
              </div>
              <p className="mt-2 text-xs text-muted-foreground">
                Tip: Navigate to Products, find the item, and click "Sell Item"
              </p>
            </div>
          )}
        </section>

        {/* =============================================================== */}
        {/* SECTION 2: LEDGER NUMBER */}
        {/* =============================================================== */}
        <section className="rounded-lg border bg-card p-6">
          <h2 className="text-lg font-medium mb-4 flex items-center gap-2">
            <FileText className="h-5 w-5 text-primary" />
            Ledger Number
          </h2>
          <div className="max-w-sm">
            <label htmlFor="ledgerNumber" className="block text-sm font-medium mb-1.5">
              Office Register Number <span className="text-destructive">*</span>
            </label>
            <input
              id="ledgerNumber"
              type="text"
              {...register('ledgerNumber', {
                required: 'Ledger number is required',
              })}
              placeholder="e.g., VE001"
              className={cn(
                'w-full rounded-md border bg-background px-3 py-2.5 text-sm',
                'placeholder:text-muted-foreground',
                'focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2',
                errors.ledgerNumber && 'border-destructive',
              )}
            />
            <p className="mt-1 text-xs text-muted-foreground">
              Format: 2 capital letters + up to 5 digits (e.g., VE001, AB123, NE045)
            </p>
            {errors.ledgerNumber && (
              <p className="mt-1 text-xs text-destructive">
                {errors.ledgerNumber.message}
              </p>
            )}
          </div>
        </section>

        {/* =============================================================== */}
        {/* SECTION 3: SALE TYPE */}
        {/* =============================================================== */}
        <section className="rounded-lg border bg-card p-6">
          <h2 className="text-lg font-medium mb-4 flex items-center gap-2">
            <CreditCard className="h-5 w-5 text-primary" />
            Sale Type
          </h2>

          {/* Segmented control */}
          <div className="flex flex-wrap gap-2 mb-6">
            {/* Full Payment — always visible */}
            <SaleTypeButton
              active={saleType === SaleType.FULL_PAYMENT}
              onClick={() => setValue('saleType', SaleType.FULL_PAYMENT)}
              label="Full Payment"
            />
            {/* Partial with Promise — always visible */}
            <SaleTypeButton
              active={saleType === SaleType.PARTIAL_WITH_PROMISE}
              onClick={() => setValue('saleType', SaleType.PARTIAL_WITH_PROMISE)}
              label="Partial with Promise"
            />
            {/* Self Finance — hidden for "others" */}
            {!isOthersRole && (
              <SaleTypeButton
                active={saleType === SaleType.SELF_FINANCE}
                onClick={() => setValue('saleType', SaleType.SELF_FINANCE)}
                label="Self Finance (Installment)"
              />
            )}
            {/* Company Finance — hidden for "others" */}
            {!isOthersRole && (
              <SaleTypeButton
                active={saleType === SaleType.COMPANY_FINANCE}
                onClick={() => setValue('saleType', SaleType.COMPANY_FINANCE)}
                label="Company Finance"
              />
            )}
          </div>

          {/* ---- FULL PAYMENT ---- */}
          {saleType === SaleType.FULL_PAYMENT && (
            <div className="space-y-4">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {/* Selling Price */}
                <div>
                  <label className="block text-sm font-medium mb-1.5">
                    Selling Price <span className="text-destructive">*</span>
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    {...register('sellingPrice', {
                      required: 'Selling price is required',
                      min: { value: 1, message: 'Must be greater than 0' },
                    })}
                    placeholder="0.00"
                    className={cn(
                      'w-full rounded-md border bg-background px-3 py-2.5 text-sm',
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

                {/* GST Section */}
                <GstSelector
                  gstType={saleGstType}
                  onGstTypeChange={setSaleGstType}
                  gstPercent={gstRate}
                  onGstPercentChange={(val) => setValue('gstRate', val)}
                  sellingPrice={sellingPrice}
                />

                {/* Payment */}
                <div className="sm:col-span-2 lg:col-span-3">
                  <label className="block text-sm font-medium mb-1.5">
                    Payment
                  </label>
                  <PaymentSplitSection
                    splits={paymentSplits}
                    onChange={setPaymentSplits}
                    totalRequired={sellingPrice}
                  />
                </div>

                {/* Pricing calculations */}
                {selectedProduct && sellingPrice > 0 && (
                  <SellingPriceCalculations
                    sellingPrice={sellingPrice}
                    mrp={selectedProduct.mrp}
                    dp={selectedProduct.purchasePrice}
                    gstRate={gstRate}
                  />
                )}
              </div>
            </div>
          )}

          {/* ---- PARTIAL WITH PROMISE ---- */}
          {saleType === SaleType.PARTIAL_WITH_PROMISE && (
            <div className="space-y-4">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {/* Selling Price */}
                <div>
                  <label className="block text-sm font-medium mb-1.5">
                    Selling Price <span className="text-destructive">*</span>
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    {...register('sellingPrice', {
                      required: 'Selling price is required',
                      min: { value: 1, message: 'Must be greater than 0' },
                    })}
                    placeholder="0.00"
                    className={cn(
                      'w-full rounded-md border bg-background px-3 py-2.5 text-sm',
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

                {/* Down Payment */}
                <div>
                  <label className="block text-sm font-medium mb-1.5">
                    Down Payment <span className="text-destructive">*</span>
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    {...register('downPayment', {
                      required: 'Down payment is required',
                      min: { value: 0, message: 'Must be positive' },
                    })}
                    onChange={(e) => {
                      setDownPaymentManuallySet(true);
                      setValue('downPayment', Number(e.target.value) || '');
                    }}
                    placeholder="0.00"
                    className={cn(
                      'w-full rounded-md border bg-background px-3 py-2.5 text-sm',
                      'placeholder:text-muted-foreground',
                      'focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2',
                      errors.downPayment && 'border-destructive',
                    )}
                  />
                  {errors.downPayment && (
                    <p className="mt-1 text-xs text-destructive">
                      {errors.downPayment.message}
                    </p>
                  )}
                </div>

                {/* Promise Date */}
                <div>
                  <label className="block text-sm font-medium mb-1.5">
                    Promise Date <span className="text-destructive">*</span>
                  </label>
                  <input
                    type="date"
                    {...register('promiseDate', {
                      required: 'Promise date is required',
                    })}
                    className={cn(
                      'w-full rounded-md border bg-background px-3 py-2.5 text-sm',
                      'focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2',
                      errors.promiseDate && 'border-destructive',
                    )}
                  />
                  {errors.promiseDate && (
                    <p className="mt-1 text-xs text-destructive">
                      {errors.promiseDate.message}
                    </p>
                  )}
                </div>

                {/* Pending Amount (read-only) */}
                <div>
                  <label className="block text-sm font-medium mb-1.5">
                    Pending Amount
                  </label>
                  <div className="rounded-md border bg-muted/50 px-3 py-2.5 text-sm font-medium text-red-600">
                    {formatINR(pendingAmount)}
                  </div>
                </div>

                {/* GST Section */}
                <GstSelector
                  gstType={saleGstType}
                  onGstTypeChange={setSaleGstType}
                  gstPercent={gstRate}
                  onGstPercentChange={(val) => setValue('gstRate', val)}
                  sellingPrice={sellingPrice}
                />

                {/* Payment (Down Payment) */}
                <div className="sm:col-span-2 lg:col-span-3">
                  <label className="block text-sm font-medium mb-1.5">
                    Payment (Down Payment)
                  </label>
                  <PaymentSplitSection
                    splits={paymentSplits}
                    onChange={setPaymentSplits}
                    totalRequired={downPayment}
                  />
                </div>

                {/* Pricing calculations */}
                {selectedProduct && sellingPrice > 0 && (
                  <SellingPriceCalculations
                    sellingPrice={sellingPrice}
                    mrp={selectedProduct.mrp}
                    dp={selectedProduct.purchasePrice}
                    gstRate={gstRate}
                  />
                )}
              </div>
            </div>
          )}

          {/* ---- SELF FINANCE (INSTALLMENT) ---- */}
          {saleType === SaleType.SELF_FINANCE && !isOthersRole && (
            <div className="space-y-6">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {/* Selling Price */}
                <div>
                  <label className="block text-sm font-medium mb-1.5">
                    Selling Price <span className="text-destructive">*</span>
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    {...register('sellingPrice', {
                      required: 'Selling price is required',
                      min: { value: 1, message: 'Must be greater than 0' },
                    })}
                    placeholder="0.00"
                    className={cn(
                      'w-full rounded-md border bg-background px-3 py-2.5 text-sm',
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

                {/* Down Payment */}
                <div>
                  <label className="block text-sm font-medium mb-1.5">
                    Down Payment <span className="text-destructive">*</span>
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    {...register('downPayment', {
                      required: 'Down payment is required',
                      min: { value: 0, message: 'Must be positive' },
                    })}
                    onChange={(e) => {
                      setDownPaymentManuallySet(true);
                      setValue('downPayment', Number(e.target.value) || '');
                    }}
                    placeholder="0.00"
                    className={cn(
                      'w-full rounded-md border bg-background px-3 py-2.5 text-sm',
                      'placeholder:text-muted-foreground',
                      'focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2',
                      errors.downPayment && 'border-destructive',
                    )}
                  />
                  {errors.downPayment && (
                    <p className="mt-1 text-xs text-destructive">
                      {errors.downPayment.message}
                    </p>
                  )}
                </div>

                {/* Interest Rate */}
                <div>
                  <label className="block text-sm font-medium mb-1.5">
                    Interest Rate (% per month) <span className="text-destructive">*</span>
                  </label>
                  <div className="flex flex-wrap gap-2">
                    {INTEREST_RATES.map((rate) => (
                      <button
                        key={rate}
                        type="button"
                        onClick={() => setValue('interestRate', rate)}
                        className={cn(
                          'rounded-md border px-3 py-1.5 text-sm font-medium transition-colors',
                          interestRate === rate
                            ? 'border-primary bg-primary text-primary-foreground'
                            : 'hover:bg-muted',
                        )}
                      >
                        {rate}%
                      </button>
                    ))}
                  </div>
                </div>

                {/* File Charge */}
                <div>
                  <label className="block text-sm font-medium mb-1.5">
                    File Charge
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    {...register('fileCharge', {
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

                {/* Number of Months */}
                <div>
                  <label className="block text-sm font-medium mb-1.5">
                    Number of Months <span className="text-destructive">*</span>
                  </label>
                  <div className="relative">
                    <select
                      value={numInstallments}
                      onChange={(e) =>
                        setValue('numInstallments', Number(e.target.value))
                      }
                      className={cn(
                        'w-full appearance-none rounded-md border bg-background px-3 py-2.5 pr-8 text-sm',
                        'focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2',
                      )}
                    >
                      {INSTALLMENT_MONTHS.map((m) => (
                        <option key={m} value={m}>
                          {m} months
                        </option>
                      ))}
                    </select>
                    <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  </div>
                </div>

                {/* GST Section */}
                <GstSelector
                  gstType={saleGstType}
                  onGstTypeChange={setSaleGstType}
                  gstPercent={gstRate}
                  onGstPercentChange={(val) => setValue('gstRate', val)}
                  sellingPrice={sellingPrice}
                />

                {/* Payment (Down Payment) */}
                <div className="sm:col-span-2 lg:col-span-3">
                  <label className="block text-sm font-medium mb-1.5">
                    Payment (Down Payment)
                  </label>
                  <PaymentSplitSection
                    splits={paymentSplits}
                    onChange={setPaymentSplits}
                    totalRequired={downPayment}
                  />
                </div>

                {/* Pricing calculations */}
                {selectedProduct && sellingPrice > 0 && (
                  <SellingPriceCalculations
                    sellingPrice={sellingPrice}
                    mrp={selectedProduct.mrp}
                    dp={selectedProduct.purchasePrice}
                    gstRate={gstRate}
                  />
                )}
              </div>

              {/* EMI Preview Panel */}
              {emiResult && (
                <div className="rounded-lg border-2 border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-950/30 p-5">
                  <h3 className="text-base font-medium text-blue-900 dark:text-blue-100 mb-4">
                    EMI Preview
                  </h3>
                  <p className="text-xs text-blue-600 dark:text-blue-400 mb-3">
                    Principal = Selling Price ({formatINR(sellingPrice)}) - Down Payment ({formatINR(downPayment)}) = {formatINR(emiResult.principal)}
                  </p>
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6 mb-4">
                    <div>
                      <p className="text-xs font-medium text-blue-700 dark:text-blue-400">Principal</p>
                      <p className="text-lg font-semibold text-blue-900 dark:text-blue-100">
                        {formatINR(emiResult.principal)}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs font-medium text-blue-700 dark:text-blue-400">Total Interest</p>
                      <p className="text-lg font-semibold text-blue-900 dark:text-blue-100">
                        {formatINR(emiResult.totalInterest)}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs font-medium text-blue-700 dark:text-blue-400">File Charge</p>
                      <p className="text-lg font-semibold text-blue-900 dark:text-blue-100">
                        {formatINR(emiResult.fileCharge)}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs font-medium text-blue-700 dark:text-blue-400">
                        Total Payable
                      </p>
                      <p className="text-lg font-bold text-blue-900 dark:text-blue-100">
                        {formatINR(emiResult.totalPayable)}
                      </p>
                      <p className="text-[10px] text-blue-500 dark:text-blue-400">
                        (Principal + Interest + File)
                      </p>
                    </div>
                    <div>
                      <p className="text-xs font-medium text-blue-700 dark:text-blue-400">EMI / Month</p>
                      <p className="text-lg font-bold text-primary">
                        {formatINR(emiResult.emiAmount)}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs font-medium text-blue-700 dark:text-blue-400">
                        Customer Total
                      </p>
                      <p className="text-lg font-bold text-red-600">
                        {formatINR(downPayment + emiResult.totalPayable)}
                      </p>
                      <p className="text-[10px] text-blue-500 dark:text-blue-400">
                        (Down + Installments)
                      </p>
                    </div>
                  </div>

                  {/* Schedule table */}
                  <div className="max-h-64 overflow-y-auto rounded-md border border-blue-200 dark:border-blue-800 bg-card">
                    <table className="w-full text-sm">
                      <thead className="sticky top-0 bg-blue-100 dark:bg-blue-900/40">
                        <tr>
                          <th className="px-3 py-2 text-left font-medium text-blue-800 dark:text-blue-300">
                            Month #
                          </th>
                          <th className="px-3 py-2 text-left font-medium text-blue-800 dark:text-blue-300">
                            Due Date
                          </th>
                          <th className="px-3 py-2 text-right font-medium text-blue-800 dark:text-blue-300">
                            Amount
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {emiResult.schedule.map((item) => (
                          <tr
                            key={item.installmentNumber}
                            className="border-t border-blue-100 dark:border-blue-900"
                          >
                            <td className="px-3 py-1.5">
                              {item.installmentNumber}
                            </td>
                            <td className="px-3 py-1.5">{item.dueDate}</td>
                            <td className="px-3 py-1.5 text-right font-medium">
                              {formatINR(item.amount)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ---- COMPANY FINANCE ---- */}
          {saleType === SaleType.COMPANY_FINANCE && !isOthersRole && (
            <div className="space-y-4">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {/* Selling Price */}
                <div>
                  <label className="block text-sm font-medium mb-1.5">
                    Selling Price <span className="text-destructive">*</span>
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    {...register('sellingPrice', {
                      required: 'Selling price is required',
                      min: { value: 1, message: 'Must be greater than 0' },
                    })}
                    placeholder="0.00"
                    className={cn(
                      'w-full rounded-md border bg-background px-3 py-2.5 text-sm',
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

                {/* Finance Company */}
                <div>
                  <label className="block text-sm font-medium mb-1.5">
                    Finance Company <span className="text-destructive">*</span>
                  </label>
                  <div className="relative">
                    <select
                      {...register('financeCompanyId', {
                        required: 'Finance company is required',
                      })}
                      className={cn(
                        'w-full appearance-none rounded-md border bg-background px-3 py-2.5 pr-8 text-sm',
                        'focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2',
                        errors.financeCompanyId && 'border-destructive',
                      )}
                    >
                      <option value="">Select company...</option>
                      {financeCompanies?.map((fc) => (
                        <option key={fc.id} value={fc.id}>
                          {fc.name}
                        </option>
                      ))}
                    </select>
                    <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  </div>
                  {errors.financeCompanyId && (
                    <p className="mt-1 text-xs text-destructive">
                      {errors.financeCompanyId.message}
                    </p>
                  )}
                </div>

                {/* Down Payment */}
                <div>
                  <label className="block text-sm font-medium mb-1.5">
                    Down Payment
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    {...register('downPayment', {
                      min: { value: 0, message: 'Must be positive' },
                    })}
                    onChange={(e) => {
                      setDownPaymentManuallySet(true);
                      setValue('downPayment', Number(e.target.value) || '');
                    }}
                    placeholder="0.00"
                    className={cn(
                      'w-full rounded-md border bg-background px-3 py-2.5 text-sm',
                      'placeholder:text-muted-foreground',
                      'focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2',
                    )}
                  />
                </div>

                {/* Financed Amount */}
                <div>
                  <label className="block text-sm font-medium mb-1.5">
                    Financed Amount <span className="text-destructive">*</span>
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    {...register('financedAmount', {
                      required: 'Financed amount is required',
                      min: { value: 1, message: 'Must be greater than 0' },
                    })}
                    placeholder="0.00"
                    className={cn(
                      'w-full rounded-md border bg-background px-3 py-2.5 text-sm',
                      'placeholder:text-muted-foreground',
                      'focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2',
                      errors.financedAmount && 'border-destructive',
                    )}
                  />
                  {errors.financedAmount && (
                    <p className="mt-1 text-xs text-destructive">
                      {errors.financedAmount.message}
                    </p>
                  )}
                </div>

                {/* Expected Payment Date */}
                <div>
                  <label className="block text-sm font-medium mb-1.5">
                    Expected Payment Date
                  </label>
                  <input
                    type="date"
                    {...register('expectedPaymentDate')}
                    className={cn(
                      'w-full rounded-md border bg-background px-3 py-2.5 text-sm',
                      'focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2',
                    )}
                  />
                </div>

                {/* GST Section */}
                <GstSelector
                  gstType={saleGstType}
                  onGstTypeChange={setSaleGstType}
                  gstPercent={gstRate}
                  onGstPercentChange={(val) => setValue('gstRate', val)}
                  sellingPrice={sellingPrice}
                />

                {/* Payment (Down Payment) */}
                <div className="sm:col-span-2 lg:col-span-3">
                  <label className="block text-sm font-medium mb-1.5">
                    Payment (Down Payment)
                  </label>
                  <PaymentSplitSection
                    splits={paymentSplits}
                    onChange={setPaymentSplits}
                    totalRequired={downPayment}
                  />
                </div>

                {/* Pricing calculations */}
                {selectedProduct && sellingPrice > 0 && (
                  <SellingPriceCalculations
                    sellingPrice={sellingPrice}
                    mrp={selectedProduct.mrp}
                    dp={selectedProduct.purchasePrice}
                    gstRate={gstRate}
                  />
                )}
              </div>
            </div>
          )}
        </section>

        {/* =============================================================== */}
        {/* SECTION 4: CUSTOMER + GUARANTOR */}
        {/* =============================================================== */}
        <section className="rounded-lg border bg-card p-6">
          <h2 className="text-lg font-medium mb-4 flex items-center gap-2">
            <User className="h-5 w-5 text-primary" />
            Customer
          </h2>

          {selectedCustomer ? (
            <div className="space-y-3">
              <div className="rounded-md border p-4 bg-green-50 dark:bg-green-950/30 border-green-200 dark:border-green-800">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-medium text-green-800 dark:text-green-200">
                      {selectedCustomer.name}
                    </p>
                    <p className="text-sm text-green-600 dark:text-green-400 mt-0.5">
                      {selectedCustomer.phone}
                      {selectedCustomer.customerCode &&
                        ` | ${selectedCustomer.customerCode}`}
                      {selectedCustomer.city &&
                        ` | ${selectedCustomer.city}`}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedCustomer(null);
                      setCustomerSearchText('');
                      setShowNewCustomerForm(false);
                    }}
                    className="text-sm text-primary hover:underline"
                  >
                    Change Customer
                  </button>
                </div>
              </div>
              <CustomerReliabilityCard customerId={selectedCustomer.id} variant="banner" />
            </div>
          ) : showNewCustomerForm ? (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-medium">Create New Customer</h3>
                <button
                  type="button"
                  onClick={() => setShowNewCustomerForm(false)}
                  className="text-sm text-muted-foreground hover:text-foreground"
                >
                  Cancel
                </button>
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                <div>
                  <label className="block text-sm font-medium mb-1">
                    Name <span className="text-destructive">*</span>
                  </label>
                  <input
                    type="text"
                    value={newCustomer.name}
                    onChange={(e) =>
                      setNewCustomer({ ...newCustomer, name: e.target.value })
                    }
                    placeholder="Customer name"
                    className={cn(
                      'w-full rounded-md border bg-background px-3 py-2 text-sm',
                      'placeholder:text-muted-foreground',
                      'focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2',
                    )}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">
                    Phone <span className="text-destructive">*</span>
                  </label>
                  <input
                    type="tel"
                    value={newCustomer.phone}
                    onChange={(e) =>
                      setNewCustomer({ ...newCustomer, phone: e.target.value })
                    }
                    placeholder="10-digit number"
                    className={cn(
                      'w-full rounded-md border bg-background px-3 py-2 text-sm',
                      'placeholder:text-muted-foreground',
                      'focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2',
                    )}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">
                    Alt. Phone
                  </label>
                  <input
                    type="tel"
                    value={newCustomer.altPhone}
                    onChange={(e) =>
                      setNewCustomer({ ...newCustomer, altPhone: e.target.value })
                    }
                    placeholder="Optional"
                    className={cn(
                      'w-full rounded-md border bg-background px-3 py-2 text-sm',
                      'placeholder:text-muted-foreground',
                      'focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2',
                    )}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">
                    Aadhaar
                  </label>
                  <input
                    type="text"
                    value={newCustomer.aadhaarNumber}
                    onChange={(e) =>
                      setNewCustomer({
                        ...newCustomer,
                        aadhaarNumber: e.target.value,
                      })
                    }
                    placeholder="12-digit number"
                    className={cn(
                      'w-full rounded-md border bg-background px-3 py-2 text-sm',
                      'placeholder:text-muted-foreground',
                      'focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2',
                    )}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">
                    Address
                  </label>
                  <input
                    type="text"
                    value={newCustomer.addressLine1}
                    onChange={(e) =>
                      setNewCustomer({
                        ...newCustomer,
                        addressLine1: e.target.value,
                      })
                    }
                    placeholder="Street address"
                    className={cn(
                      'w-full rounded-md border bg-background px-3 py-2 text-sm',
                      'placeholder:text-muted-foreground',
                      'focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2',
                    )}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">City</label>
                  <input
                    type="text"
                    value={newCustomer.city}
                    onChange={(e) =>
                      setNewCustomer({ ...newCustomer, city: e.target.value })
                    }
                    placeholder="City"
                    className={cn(
                      'w-full rounded-md border bg-background px-3 py-2 text-sm',
                      'placeholder:text-muted-foreground',
                      'focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2',
                    )}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">State</label>
                  <select
                    value={newCustomer.state}
                    onChange={(e) =>
                      setNewCustomer({ ...newCustomer, state: e.target.value })
                    }
                    className={cn(
                      'w-full appearance-none rounded-md border bg-background px-3 py-2 text-sm',
                      'focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2',
                    )}
                  >
                    <option value="">Select...</option>
                    {INDIAN_STATES.map((s) => (
                      <option key={s} value={s}>{s}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">
                    Pincode
                  </label>
                  <input
                    type="text"
                    value={newCustomer.pincode}
                    onChange={(e) =>
                      setNewCustomer({ ...newCustomer, pincode: e.target.value })
                    }
                    placeholder="6-digit pincode"
                    className={cn(
                      'w-full rounded-md border bg-background px-3 py-2 text-sm',
                      'placeholder:text-muted-foreground',
                      'focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2',
                    )}
                  />
                </div>
              </div>
              <button
                type="button"
                onClick={handleCreateNewCustomer}
                disabled={
                  !newCustomer.name.trim() ||
                  !newCustomer.phone.trim() ||
                  createCustomerMutation.isPending
                }
                className={cn(
                  'flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground',
                  'hover:bg-primary/90 transition-colors',
                  'disabled:opacity-50 disabled:cursor-not-allowed',
                )}
              >
                {createCustomerMutation.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Check className="h-4 w-4" />
                )}
                Save Customer
              </button>
              {createCustomerMutation.error && (
                <p className="text-xs text-destructive">
                  {(createCustomerMutation.error as any)?.response?.data?.error ??
                    'Failed to create customer'}
                </p>
              )}
            </div>
          ) : (
            <div>
              {/* Search existing */}
              <div className="relative max-w-md">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <input
                  type="text"
                  value={customerSearchText}
                  onChange={(e) => {
                    setCustomerSearchText(e.target.value);
                    setShowCustomerDropdown(true);
                  }}
                  onFocus={() => setShowCustomerDropdown(true)}
                  placeholder="Search by phone or name (min 2 chars)..."
                  className={cn(
                    'w-full rounded-md border bg-background pl-9 pr-8 py-2.5 text-sm',
                    'placeholder:text-muted-foreground',
                    'focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2',
                  )}
                />
                {customerSearchText && (
                  <button
                    type="button"
                    onClick={() => {
                      setCustomerSearchText('');
                      setShowCustomerDropdown(false);
                    }}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  >
                    <X className="h-4 w-4" />
                  </button>
                )}

                {/* Dropdown */}
                {showCustomerDropdown && debouncedCustomerSearch.length >= 2 && (
                  <div className="absolute z-20 mt-1 w-full rounded-md border bg-card shadow-lg max-h-48 overflow-y-auto">
                    {customerSearchQuery.isLoading ? (
                      <div className="flex items-center gap-2 p-3 text-sm text-muted-foreground">
                        <Loader2 className="h-4 w-4 animate-spin" />
                        Searching...
                      </div>
                    ) : customerResults.length === 0 ? (
                      <p className="p-3 text-sm text-muted-foreground">
                        No customers found.
                      </p>
                    ) : (
                      customerResults.map((cust) => (
                        <button
                          key={cust.id}
                          type="button"
                          onClick={() => {
                            setSelectedCustomer(cust);
                            setCustomerSearchText('');
                            setShowCustomerDropdown(false);
                          }}
                          className="w-full text-left px-3 py-2 hover:bg-muted transition-colors border-b last:border-0"
                        >
                          <p className="text-sm font-medium">{cust.name}</p>
                          <p className="text-xs text-muted-foreground">
                            {cust.phone}
                            {cust.customerCode && ` | ${cust.customerCode}`}
                          </p>
                        </button>
                      ))
                    )}
                  </div>
                )}
              </div>

              {/* Create new customer link */}
              <button
                type="button"
                onClick={() => {
                  setShowNewCustomerForm(true);
                  setShowCustomerDropdown(false);
                }}
                className="mt-3 flex items-center gap-1.5 text-sm text-primary hover:underline"
              >
                <Plus className="h-4 w-4" />
                Create New Customer
              </button>
            </div>
          )}

          {/* Guarantor — shown only for self-finance */}
          {saleType === SaleType.SELF_FINANCE && !isOthersRole && (
            <div className="pt-4 border-t mt-4">
              <h3 className="text-sm font-medium mb-3 flex items-center gap-2">
                <Shield className="h-4 w-4 text-purple-600" />
                Guarantor <span className="text-destructive">*</span>
              </h3>

              {selectedGuarantor ? (
                <div className="rounded-md border p-3 bg-purple-50 dark:bg-purple-950/30 border-purple-200 dark:border-purple-800">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium text-purple-800 dark:text-purple-200">
                        {selectedGuarantor.name}
                      </p>
                      <p className="text-xs text-purple-600 dark:text-purple-400">
                        {selectedGuarantor.phone}
                        {selectedGuarantor.customerCode &&
                          ` | ${selectedGuarantor.customerCode}`}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedGuarantor(null);
                        setGuarantorSearchText('');
                        setShowNewGuarantorForm(false);
                      }}
                      className="text-sm text-primary hover:underline"
                    >
                      Change
                    </button>
                  </div>
                </div>
              ) : showNewGuarantorForm ? (
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <h4 className="text-sm font-medium">Add New Guarantor</h4>
                    <button
                      type="button"
                      onClick={() => setShowNewGuarantorForm(false)}
                      className="text-sm text-muted-foreground hover:text-foreground"
                    >
                      Cancel
                    </button>
                  </div>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    <div>
                      <label className="block text-sm font-medium mb-1">
                        Guarantor Name <span className="text-destructive">*</span>
                      </label>
                      <input
                        type="text"
                        value={newGuarantor.name}
                        onChange={(e) =>
                          setNewGuarantor({ ...newGuarantor, name: e.target.value })
                        }
                        placeholder="Full name"
                        className={cn(
                          'w-full rounded-md border bg-background px-3 py-2 text-sm',
                          'placeholder:text-muted-foreground',
                          'focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2',
                        )}
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium mb-1">
                        Guarantor Phone <span className="text-destructive">*</span>
                      </label>
                      <input
                        type="tel"
                        value={newGuarantor.phone}
                        onChange={(e) =>
                          setNewGuarantor({ ...newGuarantor, phone: e.target.value })
                        }
                        placeholder="10-digit number"
                        className={cn(
                          'w-full rounded-md border bg-background px-3 py-2 text-sm',
                          'placeholder:text-muted-foreground',
                          'focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2',
                        )}
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium mb-1">
                        Alt. Phone
                      </label>
                      <input
                        type="tel"
                        value={newGuarantor.altPhone}
                        onChange={(e) =>
                          setNewGuarantor({ ...newGuarantor, altPhone: e.target.value })
                        }
                        placeholder="Optional"
                        className={cn(
                          'w-full rounded-md border bg-background px-3 py-2 text-sm',
                          'placeholder:text-muted-foreground',
                          'focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2',
                        )}
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium mb-1">
                        Aadhaar
                      </label>
                      <input
                        type="text"
                        value={newGuarantor.aadhaarNumber}
                        onChange={(e) =>
                          setNewGuarantor({
                            ...newGuarantor,
                            aadhaarNumber: e.target.value,
                          })
                        }
                        placeholder="12-digit number"
                        className={cn(
                          'w-full rounded-md border bg-background px-3 py-2 text-sm',
                          'placeholder:text-muted-foreground',
                          'focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2',
                        )}
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium mb-1">
                        Address
                      </label>
                      <input
                        type="text"
                        value={newGuarantor.addressLine1}
                        onChange={(e) =>
                          setNewGuarantor({
                            ...newGuarantor,
                            addressLine1: e.target.value,
                          })
                        }
                        placeholder="Street address"
                        className={cn(
                          'w-full rounded-md border bg-background px-3 py-2 text-sm',
                          'placeholder:text-muted-foreground',
                          'focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2',
                        )}
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium mb-1">
                        City
                      </label>
                      <input
                        type="text"
                        value={newGuarantor.city}
                        onChange={(e) =>
                          setNewGuarantor({ ...newGuarantor, city: e.target.value })
                        }
                        placeholder="City"
                        className={cn(
                          'w-full rounded-md border bg-background px-3 py-2 text-sm',
                          'placeholder:text-muted-foreground',
                          'focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2',
                        )}
                      />
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={handleCreateNewGuarantor}
                    disabled={
                      !newGuarantor.name.trim() ||
                      !newGuarantor.phone.trim() ||
                      createGuarantorMutation.isPending
                    }
                    className={cn(
                      'flex items-center gap-2 rounded-md bg-purple-600 px-4 py-2 text-sm font-medium text-white',
                      'hover:bg-purple-700 transition-colors',
                      'disabled:opacity-50 disabled:cursor-not-allowed',
                    )}
                  >
                    {createGuarantorMutation.isPending ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Check className="h-4 w-4" />
                    )}
                    Save Guarantor
                  </button>
                  {createGuarantorMutation.error && (
                    <p className="text-xs text-destructive">
                      {(createGuarantorMutation.error as any)?.response?.data?.error ??
                        'Failed to create guarantor'}
                    </p>
                  )}
                </div>
              ) : (
                <div>
                  <div className="relative max-w-md">
                    <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <input
                      type="text"
                      value={guarantorSearchText}
                      onChange={(e) => {
                        setGuarantorSearchText(e.target.value);
                        setShowGuarantorDropdown(true);
                      }}
                      onFocus={() => setShowGuarantorDropdown(true)}
                      placeholder="Search guarantor by name or phone..."
                      className={cn(
                        'w-full rounded-md border bg-background pl-9 pr-8 py-2.5 text-sm',
                        'placeholder:text-muted-foreground',
                        'focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2',
                      )}
                    />
                    {guarantorSearchText && (
                      <button
                        type="button"
                        onClick={() => {
                          setGuarantorSearchText('');
                          setShowGuarantorDropdown(false);
                        }}
                        className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    )}

                    {showGuarantorDropdown &&
                      debouncedGuarantorSearch.length >= 2 && (
                        <div className="absolute z-20 mt-1 w-full rounded-md border bg-card shadow-lg max-h-48 overflow-y-auto">
                          {guarantorSearchQuery.isLoading ? (
                            <div className="flex items-center gap-2 p-3 text-sm text-muted-foreground">
                              <Loader2 className="h-4 w-4 animate-spin" />
                              Searching...
                            </div>
                          ) : guarantorResults.length === 0 ? (
                            <p className="p-3 text-sm text-muted-foreground">
                              No customers found.
                            </p>
                          ) : (
                            guarantorResults.map((cust) => (
                              <button
                                key={cust.id}
                                type="button"
                                onClick={() => {
                                  setSelectedGuarantor(cust);
                                  setGuarantorSearchText('');
                                  setShowGuarantorDropdown(false);
                                }}
                                className="w-full text-left px-3 py-2 hover:bg-muted transition-colors border-b last:border-0"
                              >
                                <p className="text-sm font-medium">
                                  {cust.name}
                                </p>
                                <p className="text-xs text-muted-foreground">
                                  {cust.phone}
                                  {cust.customerCode &&
                                    ` | ${cust.customerCode}`}
                                </p>
                              </button>
                            ))
                          )}
                        </div>
                      )}
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setShowNewGuarantorForm(true);
                      setShowGuarantorDropdown(false);
                    }}
                    className="mt-3 flex items-center gap-1.5 text-sm text-purple-600 hover:underline"
                  >
                    <Plus className="h-4 w-4" />
                    Add New Guarantor
                  </button>

                  {/* Validation hint */}
                  {!selectedGuarantor && (
                    <p className="mt-2 text-xs text-destructive">
                      Guarantor is required for self-finance sales.
                    </p>
                  )}
                </div>
              )}
            </div>
          )}
        </section>

        {/* =============================================================== */}
        {/* SECTION 5: NOTES */}
        {/* =============================================================== */}
        <section className="rounded-lg border bg-card p-6">
          <h2 className="text-lg font-medium mb-4">Notes</h2>
          <textarea
            rows={3}
            {...register('notes')}
            placeholder="Any additional notes about this sale..."
            className={cn(
              'w-full rounded-md border bg-background px-3 py-2.5 text-sm',
              'placeholder:text-muted-foreground',
              'focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2',
            )}
          />
        </section>

        {/* =============================================================== */}
        {/* SECTION 6: SUMMARY CARD */}
        {/* =============================================================== */}
        <section className="rounded-lg border-2 border-primary/20 bg-primary/5 p-6">
          <h2 className="text-lg font-medium mb-4">Sale Summary</h2>
          <div className="space-y-2 text-sm max-w-md">
            <SummaryRow label="Selling Price (incl. GST)" value={formatINR(sellingPrice)} />
            {gstRate > 0 && (
              <SummaryRow
                label={
                  saleGstType === 'CGST_SGST'
                    ? `CGST ${gstRate / 2}% + SGST ${gstRate / 2}% (included)`
                    : saleGstType === 'IGST'
                      ? `IGST ${gstRate}% (included)`
                      : `GST ${gstRate}% (included)`
                }
                value={formatINR(gstAmount)}
              />
            )}

            {saleType === SaleType.FULL_PAYMENT && (
              <div className="flex justify-between border-t pt-2 font-semibold text-base">
                <span>Amount Payable</span>
                <span className="text-primary">{formatINR(sellingPrice)}</span>
              </div>
            )}

            {saleType === SaleType.PARTIAL_WITH_PROMISE && (
              <>
                <SummaryRow
                  label="Down Payment"
                  value={formatINR(downPayment)}
                />
                {pendingAmount > 0 && (
                  <div className="flex justify-between border-t pt-2 font-semibold">
                    <span>Pending Amount</span>
                    <span className="text-red-600">
                      {formatINR(pendingAmount)}
                    </span>
                  </div>
                )}
              </>
            )}

            {saleType === SaleType.SELF_FINANCE && emiResult && (
              <>
                <SummaryRow
                  label="Down Payment"
                  value={formatINR(downPayment)}
                />
                <SummaryRow
                  label="Principal (SP - Down)"
                  value={formatINR(emiResult.principal)}
                />
                <SummaryRow
                  label="Total Interest"
                  value={formatINR(emiResult.totalInterest)}
                />
                {emiResult.fileCharge > 0 && (
                  <SummaryRow
                    label="File Charge"
                    value={formatINR(emiResult.fileCharge)}
                  />
                )}
                <SummaryRow
                  label="EMI / month"
                  value={formatINR(emiResult.emiAmount)}
                />
                <div className="flex justify-between border-t pt-2 font-semibold text-base">
                  <span>Total Amount</span>
                  <span className="text-primary">
                    {formatINR(sellingPrice + emiResult.totalInterest + emiResult.fileCharge)}
                  </span>
                </div>
                <p className="text-[11px] text-muted-foreground">
                  SP ({formatINR(sellingPrice)}) + Interest ({formatINR(emiResult.totalInterest)}) + File ({formatINR(emiResult.fileCharge)})
                </p>
              </>
            )}

            {saleType === SaleType.COMPANY_FINANCE && (
              <>
                <SummaryRow
                  label="Down Payment"
                  value={formatINR(downPayment)}
                />
                <SummaryRow
                  label="Financed Amount"
                  value={formatINR(financedAmount)}
                />
                {pendingAmount > 0 && (
                  <div className="flex justify-between border-t pt-2 font-semibold">
                    <span>Remaining (Unpaid)</span>
                    <span className="text-red-600">
                      {formatINR(pendingAmount)}
                    </span>
                  </div>
                )}
              </>
            )}
          </div>
        </section>

        {/* =============================================================== */}
        {/* ERROR */}
        {/* =============================================================== */}
        {errorMessage && (
          <div className="flex items-center gap-2 rounded-md bg-destructive/10 px-4 py-3 text-sm text-destructive">
            <AlertCircle className="h-4 w-4 shrink-0" />
            {errorMessage}
          </div>
        )}

        {/* =============================================================== */}
        {/* FOOTER */}
        {/* =============================================================== */}
        <div className="flex items-center justify-between pt-4 border-t">
          <button
            type="button"
            onClick={() => navigate(-1)}
            className="rounded-md border px-4 py-2.5 text-sm font-medium text-muted-foreground hover:bg-muted transition-colors"
          >
            Cancel
          </button>

          <button
            type="submit"
            disabled={!canSubmit || createSaleMutation.isPending}
            className={cn(
              'flex items-center gap-2 rounded-md bg-green-600 px-8 py-3 text-base font-medium text-white',
              'hover:bg-green-700 transition-colors',
              'disabled:opacity-50 disabled:cursor-not-allowed',
            )}
          >
            {createSaleMutation.isPending ? (
              <>
                <Loader2 className="h-5 w-5 animate-spin" />
                Creating Sale...
              </>
            ) : (
              <>
                <ShoppingCart className="h-5 w-5" />
                Complete Sale
              </>
            )}
          </button>
        </div>
      </form>
    </div>
  );
}

// ===========================================================================
// SUB-COMPONENTS
// ===========================================================================

function SaleTypeButton({
  active,
  onClick,
  label,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'rounded-md border px-4 py-2 text-sm font-medium transition-colors',
        active
          ? 'border-primary bg-primary text-primary-foreground'
          : 'border-border bg-background text-foreground hover:bg-muted',
      )}
    >
      {label}
    </button>
  );
}

function PaymentSplitSection({
  splits,
  onChange,
  totalRequired,
}: {
  splits: Array<{mode: PaymentMode; amount: number | ''}>;
  onChange: (splits: Array<{mode: PaymentMode; amount: number | ''}>) => void;
  totalRequired: number;
}) {
  const prevTotalRef = useRef(totalRequired);
  const userEditedRef = useRef(false);

  // Auto-fill single split amount to match totalRequired
  useEffect(() => {
    if (splits.length === 1) {
      const currentAmt = splits[0].amount;
      const prevTotal = prevTotalRef.current;
      // Auto-fill if: amount is empty, or it matches previous totalRequired (user hasn't manually edited)
      if (!userEditedRef.current || currentAmt === '' || currentAmt === prevTotal) {
        onChange([{ ...splits[0], amount: totalRequired || '' }]);
        userEditedRef.current = false;
      }
    }
    prevTotalRef.current = totalRequired;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [totalRequired]);

  const totalEntered = splits.reduce((sum, s) => sum + (Number(s.amount) || 0), 0);
  const isMatch = Math.abs(totalEntered - totalRequired) < 0.01;

  const updateSplit = (index: number, field: 'mode' | 'amount', value: PaymentMode | number | '') => {
    const next = splits.map((s, i) => {
      if (i !== index) return s;
      if (field === 'mode') return { ...s, mode: value as PaymentMode };
      return { ...s, amount: value as number | '' };
    });
    if (field === 'amount') {
      userEditedRef.current = true;
    }
    onChange(next);
  };

  const addSplit = () => {
    if (splits.length >= 3) return;
    // Pick a mode not already used, or default to CASH
    const usedModes = new Set(splits.map(s => s.mode));
    const available = PAYMENT_MODES.find(m => !usedModes.has(m.value));
    onChange([...splits, { mode: available?.value ?? PaymentMode.CASH, amount: '' }]);
    userEditedRef.current = true;
  };

  const removeSplit = (index: number) => {
    const next = splits.filter((_, i) => i !== index);
    // If back to 1 split, auto-fill
    if (next.length === 1) {
      next[0] = { ...next[0], amount: totalRequired || '' };
      userEditedRef.current = false;
    }
    onChange(next);
  };

  return (
    <div className="space-y-3">
      {splits.map((split, index) => (
        <div key={index} className="flex items-center gap-2">
          {/* Mode dropdown */}
          <div className="relative w-40 shrink-0">
            <select
              value={split.mode}
              onChange={(e) => updateSplit(index, 'mode', e.target.value as PaymentMode)}
              className={cn(
                'w-full appearance-none rounded-md border bg-background px-3 py-2.5 pr-8 text-sm',
                'focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2',
              )}
            >
              {PAYMENT_MODES.map((mode) => (
                <option key={mode.value} value={mode.value}>
                  {mode.label}
                </option>
              ))}
            </select>
            <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          </div>

          {/* Amount input */}
          <div className="relative flex-1">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
              ₹
            </span>
            <input
              type="number"
              step="0.01"
              value={split.amount}
              onChange={(e) => {
                const val = e.target.value === '' ? '' : Number(e.target.value);
                updateSplit(index, 'amount', val);
              }}
              placeholder="0.00"
              className={cn(
                'w-full rounded-md border bg-background pl-7 pr-3 py-2.5 text-sm',
                'placeholder:text-muted-foreground',
                'focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2',
              )}
            />
          </div>

          {/* Remove button — only shown for 2nd+ splits */}
          {splits.length > 1 && (
            <button
              type="button"
              onClick={() => removeSplit(index)}
              className="rounded-md p-2 text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-colors"
              title="Remove payment mode"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
      ))}

      {/* Add button + validation summary */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        {splits.length < 3 && (
          <button
            type="button"
            onClick={addSplit}
            className="flex items-center gap-1.5 text-sm text-primary hover:underline"
          >
            <Plus className="h-4 w-4" />
            Add Payment Mode
          </button>
        )}
        {splits.length >= 3 && <div />}

        {/* Validation summary */}
        {totalRequired > 0 && (
          <div className={cn(
            'text-xs font-medium',
            isMatch ? 'text-green-600' : 'text-amber-600',
          )}>
            Total: {formatINR(totalEntered)} / {formatINR(totalRequired)} required
            {isMatch ? (
              <Check className="inline-block ml-1 h-3.5 w-3.5" />
            ) : (
              <span className="ml-1">
                ({totalEntered > totalRequired ? '+' : '-'}{formatINR(Math.abs(totalEntered - totalRequired))})
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between">
      <span className="text-muted-foreground">{label}</span>
      <span>{value}</span>
    </div>
  );
}

function GstSelector({
  gstType,
  onGstTypeChange,
  gstPercent,
  onGstPercentChange,
  sellingPrice,
}: {
  gstType: GstType;
  onGstTypeChange: (val: GstType) => void;
  gstPercent: number;
  onGstPercentChange: (val: number) => void;
  sellingPrice: number;
}) {
  // SP is GST-inclusive — extract GST via reverse calculation
  const gstAmount = gstPercent > 0 ? Math.round(sellingPrice * gstPercent / (100 + gstPercent)) : 0;

  return (
    <div className="sm:col-span-2 lg:col-span-3 space-y-3">
      {/* GST Type radio */}
      <div>
        <label className="block text-sm font-medium mb-1.5">GST Type <span className="text-xs text-muted-foreground font-normal">(included in Selling Price)</span></label>
        <div className="flex flex-wrap gap-4">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="radio"
              name="saleGstType"
              checked={gstType === 'GST'}
              onChange={() => onGstTypeChange('GST')}
              className="h-4 w-4 text-primary"
            />
            <span className="text-sm">GST</span>
          </label>
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="radio"
              name="saleGstType"
              checked={gstType === 'CGST_SGST'}
              onChange={() => onGstTypeChange('CGST_SGST')}
              className="h-4 w-4 text-primary"
            />
            <span className="text-sm">CGST + SGST</span>
          </label>
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="radio"
              name="saleGstType"
              checked={gstType === 'IGST'}
              onChange={() => onGstTypeChange('IGST')}
              className="h-4 w-4 text-primary"
            />
            <span className="text-sm">IGST</span>
          </label>
        </div>
      </div>

      {/* GST % dropdown + computed amount */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {gstType === 'CGST_SGST' ? (
          <>
            <div>
              <label className="block text-sm font-medium mb-1.5">
                Total GST %
              </label>
              <div className="relative">
                <select
                  value={gstPercent}
                  onChange={(e) => onGstPercentChange(Number(e.target.value))}
                  className={cn(
                    'w-full appearance-none rounded-md border bg-background px-3 py-2.5 pr-8 text-sm',
                    'focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2',
                  )}
                >
                  {GST_SLABS.map((slab) => (
                    <option key={slab} value={slab}>
                      {slab}% total &rarr; {slab / 2}% each
                    </option>
                  ))}
                </select>
                <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium mb-1.5">CGST (included)</label>
              <div className="rounded-md border bg-muted/50 px-3 py-2.5 text-sm font-medium">
                {gstPercent / 2}% = {formatINR(Math.round(gstAmount / 2))}
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium mb-1.5">SGST (included)</label>
              <div className="rounded-md border bg-muted/50 px-3 py-2.5 text-sm font-medium">
                {gstPercent / 2}% = {formatINR(Math.round(gstAmount / 2))}
              </div>
            </div>
          </>
        ) : (
          <>
            <div>
              <label className="block text-sm font-medium mb-1.5">
                {gstType === 'IGST' ? 'IGST %' : 'GST %'}
              </label>
              <div className="relative">
                <select
                  value={gstPercent}
                  onChange={(e) => onGstPercentChange(Number(e.target.value))}
                  className={cn(
                    'w-full appearance-none rounded-md border bg-background px-3 py-2.5 pr-8 text-sm',
                    'focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2',
                  )}
                >
                  {GST_SLABS.map((slab) => (
                    <option key={slab} value={slab}>
                      {slab}%
                    </option>
                  ))}
                </select>
                <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium mb-1.5">
                {gstType === 'IGST' ? 'IGST (included)' : 'GST (included)'}
              </label>
              <div className="rounded-md border bg-muted/50 px-3 py-2.5 text-sm font-medium">
                {formatINR(gstAmount)}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function SellingPriceCalculations({
  sellingPrice,
  mrp,
  dp,
  gstRate,
}: {
  sellingPrice: number;
  mrp: number;
  dp: number;
  gstRate: number;
}) {
  if (sellingPrice <= 0) return null;

  const discount = mrp - sellingPrice;
  const discountPct = mrp > 0 ? ((discount / mrp) * 100).toFixed(1) : '0.0';
  const isAboveMRP = sellingPrice > mrp;

  // GST-aware profit: both SP and DP are GST-inclusive, so strip GST from both
  const outputGst = gstRate > 0 ? Math.round(sellingPrice * gstRate / (100 + gstRate)) : 0;
  const inputGst = gstRate > 0 ? Math.round(dp * gstRate / (100 + gstRate)) : 0;
  const spExclGst = sellingPrice - outputGst;
  const dpExclGst = dp - inputGst;
  const gstPayable = outputGst - inputGst;
  const netProfit = spExclGst - dpExclGst;
  const netProfitPct = dpExclGst > 0 ? ((netProfit / dpExclGst) * 100).toFixed(1) : '0.0';
  const isLoss = netProfit < 0;

  return (
    <div className="sm:col-span-2 lg:col-span-3">
      {/* Warning if selling at loss or above MRP */}
      {(isLoss || isAboveMRP) && (
        <div className={cn(
          'flex items-center gap-2 rounded-md px-3 py-2 text-xs font-medium mb-2',
          isLoss
            ? 'bg-red-50 text-red-700 border border-red-200 dark:bg-red-950/30 dark:text-red-400 dark:border-red-800'
            : 'bg-amber-50 text-amber-700 border border-amber-200 dark:bg-amber-950/30 dark:text-amber-400 dark:border-amber-800',
        )}>
          <AlertCircle className="h-3.5 w-3.5 shrink-0" />
          {isLoss
            ? `Selling at a loss of ${formatINR(Math.abs(netProfit))} (after GST).`
            : `Selling price is above MRP (${formatINR(mrp)}).`}
        </div>
      )}
      {/* Profit & GST breakdown */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 rounded-md bg-muted/50 px-3 py-2.5">
        <div>
          <span className="text-xs text-muted-foreground">Discount (MRP - SP)</span>
          <p className={cn('text-sm font-semibold', discount >= 0 ? 'text-green-600' : 'text-red-600')}>
            {formatINR(discount)} <span className="text-xs font-normal">({discountPct}%)</span>
          </p>
        </div>
        {gstRate > 0 && (
          <>
            <div>
              <span className="text-xs text-muted-foreground">Output GST (on sale)</span>
              <p className="text-sm font-semibold">{formatINR(outputGst)}</p>
            </div>
            <div>
              <span className="text-xs text-muted-foreground">Input Tax Credit (on purchase)</span>
              <p className="text-sm font-semibold text-green-600">{formatINR(inputGst)}</p>
            </div>
            <div>
              <span className="text-xs text-muted-foreground">GST to Govt</span>
              <p className="text-sm font-semibold text-amber-600">{formatINR(gstPayable)}</p>
            </div>
          </>
        )}
        <div>
          <span className="text-xs text-muted-foreground">Net Profit</span>
          <p className={cn('text-sm font-semibold', netProfit >= 0 ? 'text-green-600' : 'text-red-600')}>
            {formatINR(netProfit)} <span className="text-xs font-normal">({netProfitPct}%)</span>
          </p>
        </div>
      </div>
    </div>
  );
}
