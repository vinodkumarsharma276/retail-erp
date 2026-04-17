import { useState, useMemo, useEffect } from 'react';
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
// Form values
// ---------------------------------------------------------------------------
interface SaleFormValues {
  ledgerNumber: string;
  saleType: SaleType;
  // Pricing
  sellingPrice: number | '';
  discountAmount: number | '';
  gstRate: number | '';
  // Payment
  paymentMode: PaymentMode;
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
  discountAmount: '',
  gstRate: '',
  paymentMode: PaymentMode.CASH,
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
  const discountAmount = Number(watch('discountAmount')) || 0;
  const gstRate = Number(watch('gstRate')) || 0;
  const downPayment = Number(watch('downPayment')) || 0;
  const paymentMode = watch('paymentMode');
  const interestRate = watch('interestRate');
  const fileCharge = Number(watch('fileCharge')) || 0;
  const numInstallments = watch('numInstallments');
  const financedAmount = Number(watch('financedAmount')) || 0;

  // Pre-fill selling price with MRP as default (max they can charge)
  useEffect(() => {
    if (selectedProduct && !watch('sellingPrice')) {
      setValue('sellingPrice', selectedProduct.mrp);
    }
  }, [selectedProduct, setValue, watch]);

  // -----------------------------------------------------------------------
  // Computed amounts
  // -----------------------------------------------------------------------
  const netAmount = sellingPrice - discountAmount;
  const gstAmount = netAmount * (gstRate / 100);
  const totalAmount = netAmount + gstAmount;

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

    const payload: Record<string, unknown> = {
      productId: selectedProduct.id,
      customerId: selectedCustomer.id,
      ledgerNumber: formData.ledgerNumber.trim(),
      saleType: formData.saleType,
      sellingPrice: Number(formData.sellingPrice),
      discountAmount: Number(formData.discountAmount) || 0,
      gstRate: Number(formData.gstRate) || 0,
      paymentMode: formData.paymentMode,
      notes: formData.notes.trim() || undefined,
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
        payload.financeCompanyId = formData.financeCompanyId || undefined;
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
        {/* SECTION 3: CUSTOMER */}
        {/* =============================================================== */}
        <section className="rounded-lg border bg-card p-6">
          <h2 className="text-lg font-medium mb-4 flex items-center gap-2">
            <User className="h-5 w-5 text-primary" />
            Customer
          </h2>

          {selectedCustomer ? (
            <div className="rounded-md border p-4 bg-green-50 border-green-200">
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-medium text-green-800">
                    {selectedCustomer.name}
                  </p>
                  <p className="text-sm text-green-600 mt-0.5">
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
        </section>

        {/* =============================================================== */}
        {/* SECTION 4: SALE TYPE */}
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

                {/* Payment Mode */}
                <div>
                  <label className="block text-sm font-medium mb-1.5">
                    Payment Mode
                  </label>
                  <PaymentModePills
                    value={paymentMode}
                    onChange={(val) => setValue('paymentMode', val)}
                  />
                </div>

                {/* Discount */}
                <div>
                  <label className="block text-sm font-medium mb-1.5">
                    Discount Amount
                  </label>
                  <input
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

                {/* GST Rate */}
                <div>
                  <label className="block text-sm font-medium mb-1.5">
                    GST Rate (%)
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    {...register('gstRate', {
                      min: { value: 0, message: 'Must be positive' },
                    })}
                    placeholder="0"
                    className={cn(
                      'w-full rounded-md border bg-background px-3 py-2.5 text-sm',
                      'placeholder:text-muted-foreground',
                      'focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2',
                    )}
                  />
                </div>

                {/* Pricing calculations */}
                {selectedProduct && sellingPrice > 0 && (
                  <SellingPriceCalculations
                    sellingPrice={sellingPrice}
                    mrp={selectedProduct.mrp}
                    dp={selectedProduct.purchasePrice}
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

                {/* Payment Mode */}
                <div>
                  <label className="block text-sm font-medium mb-1.5">
                    Payment Mode
                  </label>
                  <PaymentModePills
                    value={paymentMode}
                    onChange={(val) => setValue('paymentMode', val)}
                  />
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

                {/* Discount */}
                <div>
                  <label className="block text-sm font-medium mb-1.5">
                    Discount Amount
                  </label>
                  <input
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

                {/* GST Rate */}
                <div>
                  <label className="block text-sm font-medium mb-1.5">
                    GST Rate (%)
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    {...register('gstRate', {
                      min: { value: 0, message: 'Must be positive' },
                    })}
                    placeholder="0"
                    className={cn(
                      'w-full rounded-md border bg-background px-3 py-2.5 text-sm',
                      'placeholder:text-muted-foreground',
                      'focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2',
                    )}
                  />
                </div>

                {/* Pricing calculations */}
                {selectedProduct && sellingPrice > 0 && (
                  <SellingPriceCalculations
                    sellingPrice={sellingPrice}
                    mrp={selectedProduct.mrp}
                    dp={selectedProduct.purchasePrice}
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

                {/* Payment Mode (for down payment) */}
                <div>
                  <label className="block text-sm font-medium mb-1.5">
                    Payment Mode (Down Payment)
                  </label>
                  <PaymentModePills
                    value={paymentMode}
                    onChange={(val) => setValue('paymentMode', val)}
                  />
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

                {/* Discount */}
                <div>
                  <label className="block text-sm font-medium mb-1.5">
                    Discount Amount
                  </label>
                  <input
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

                {/* GST Rate */}
                <div>
                  <label className="block text-sm font-medium mb-1.5">
                    GST Rate (%)
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    {...register('gstRate', {
                      min: { value: 0, message: 'Must be positive' },
                    })}
                    placeholder="0"
                    className={cn(
                      'w-full rounded-md border bg-background px-3 py-2.5 text-sm',
                      'placeholder:text-muted-foreground',
                      'focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2',
                    )}
                  />
                </div>

                {/* Pricing calculations */}
                {selectedProduct && sellingPrice > 0 && (
                  <SellingPriceCalculations
                    sellingPrice={sellingPrice}
                    mrp={selectedProduct.mrp}
                    dp={selectedProduct.purchasePrice}
                  />
                )}
              </div>

              {/* EMI Preview Panel */}
              {emiResult && (
                <div className="rounded-lg border-2 border-blue-200 bg-blue-50 p-5">
                  <h3 className="text-base font-medium text-blue-900 mb-4">
                    EMI Preview
                  </h3>
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5 mb-4">
                    <div>
                      <p className="text-xs font-medium text-blue-700">Principal</p>
                      <p className="text-lg font-semibold text-blue-900">
                        {formatINR(emiResult.principal)}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs font-medium text-blue-700">Total Interest</p>
                      <p className="text-lg font-semibold text-blue-900">
                        {formatINR(emiResult.totalInterest)}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs font-medium text-blue-700">File Charge</p>
                      <p className="text-lg font-semibold text-blue-900">
                        {formatINR(emiResult.fileCharge)}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs font-medium text-blue-700">Total Payable</p>
                      <p className="text-lg font-bold text-blue-900">
                        {formatINR(emiResult.totalPayable)}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs font-medium text-blue-700">EMI / Month</p>
                      <p className="text-lg font-bold text-primary">
                        {formatINR(emiResult.emiAmount)}
                      </p>
                    </div>
                  </div>

                  {/* Schedule table */}
                  <div className="max-h-64 overflow-y-auto rounded-md border border-blue-200 bg-white">
                    <table className="w-full text-sm">
                      <thead className="sticky top-0 bg-blue-100">
                        <tr>
                          <th className="px-3 py-2 text-left font-medium text-blue-800">
                            Month #
                          </th>
                          <th className="px-3 py-2 text-left font-medium text-blue-800">
                            Due Date
                          </th>
                          <th className="px-3 py-2 text-right font-medium text-blue-800">
                            Amount
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {emiResult.schedule.map((item) => (
                          <tr
                            key={item.installmentNumber}
                            className="border-t border-blue-100"
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

              {/* Guarantor Section */}
              <div className="pt-4 border-t">
                <h3 className="text-sm font-medium mb-3 flex items-center gap-2">
                  <Shield className="h-4 w-4 text-purple-600" />
                  Guarantor <span className="text-destructive">*</span>
                </h3>

                {selectedGuarantor ? (
                  <div className="rounded-md border p-3 bg-purple-50 border-purple-200">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm font-medium text-purple-800">
                          {selectedGuarantor.name}
                        </p>
                        <p className="text-xs text-purple-600">
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
                    placeholder="0.00"
                    className={cn(
                      'w-full rounded-md border bg-background px-3 py-2.5 text-sm',
                      'placeholder:text-muted-foreground',
                      'focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2',
                    )}
                  />
                </div>

                {/* Payment Mode (for down payment) */}
                <div>
                  <label className="block text-sm font-medium mb-1.5">
                    Payment Mode (Down Payment)
                  </label>
                  <PaymentModePills
                    value={paymentMode}
                    onChange={(val) => setValue('paymentMode', val)}
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

                {/* Discount */}
                <div>
                  <label className="block text-sm font-medium mb-1.5">
                    Discount Amount
                  </label>
                  <input
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

                {/* GST Rate */}
                <div>
                  <label className="block text-sm font-medium mb-1.5">
                    GST Rate (%)
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    {...register('gstRate', {
                      min: { value: 0, message: 'Must be positive' },
                    })}
                    placeholder="0"
                    className={cn(
                      'w-full rounded-md border bg-background px-3 py-2.5 text-sm',
                      'placeholder:text-muted-foreground',
                      'focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2',
                    )}
                  />
                </div>

                {/* Pricing calculations */}
                {selectedProduct && sellingPrice > 0 && (
                  <SellingPriceCalculations
                    sellingPrice={sellingPrice}
                    mrp={selectedProduct.mrp}
                    dp={selectedProduct.purchasePrice}
                  />
                )}
              </div>
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
            <SummaryRow label="Selling Price" value={formatINR(sellingPrice)} />
            {discountAmount > 0 && (
              <SummaryRow
                label="Discount"
                value={`- ${formatINR(discountAmount)}`}
              />
            )}
            <SummaryRow label="Net Amount" value={formatINR(netAmount)} />
            {gstRate > 0 && (
              <SummaryRow
                label={`GST (${gstRate}%)`}
                value={formatINR(gstAmount)}
              />
            )}
            <div className="flex justify-between border-t pt-2 font-semibold text-base">
              <span>Total Amount</span>
              <span className="text-primary">{formatINR(totalAmount)}</span>
            </div>

            {saleType !== SaleType.FULL_PAYMENT && (
              <>
                <SummaryRow
                  label="Down Payment"
                  value={formatINR(downPayment)}
                />
                {saleType === SaleType.COMPANY_FINANCE && (
                  <SummaryRow
                    label="Financed Amount"
                    value={formatINR(financedAmount)}
                  />
                )}
                {saleType === SaleType.SELF_FINANCE && emiResult && (
                  <SummaryRow
                    label="EMI / month"
                    value={formatINR(emiResult.emiAmount)}
                  />
                )}
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

function PaymentModePills({
  value,
  onChange,
}: {
  value: PaymentMode;
  onChange: (val: PaymentMode) => void;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {PAYMENT_MODES.map((mode) => (
        <button
          key={mode.value}
          type="button"
          onClick={() => onChange(mode.value)}
          className={cn(
            'rounded-full border px-3 py-1.5 text-xs font-medium transition-colors',
            value === mode.value
              ? 'border-primary bg-primary text-primary-foreground'
              : 'hover:bg-muted',
          )}
        >
          {mode.label}
        </button>
      ))}
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

function SellingPriceCalculations({
  sellingPrice,
  mrp,
  dp,
}: {
  sellingPrice: number;
  mrp: number;
  dp: number;
}) {
  if (sellingPrice <= 0) return null;

  const discount = mrp - sellingPrice;
  const profit = sellingPrice - dp;
  const profitPct = dp > 0 ? ((profit / dp) * 100).toFixed(1) : '0.0';
  const isBelowDP = sellingPrice < dp;
  const isAboveMRP = sellingPrice > mrp;

  return (
    <div className="sm:col-span-2 lg:col-span-3">
      {/* Warning if outside range */}
      {(isBelowDP || isAboveMRP) && (
        <div className={cn(
          'flex items-center gap-2 rounded-md px-3 py-2 text-xs font-medium mb-2',
          isBelowDP
            ? 'bg-red-50 text-red-700 border border-red-200'
            : 'bg-amber-50 text-amber-700 border border-amber-200',
        )}>
          <AlertCircle className="h-3.5 w-3.5 shrink-0" />
          {isBelowDP
            ? `Selling price is below DP (${formatINR(dp)}). You will make a loss of ${formatINR(Math.abs(profit))}.`
            : `Selling price is above MRP (${formatINR(mrp)}).`}
        </div>
      )}
      {/* Calculations */}
      <div className="grid grid-cols-3 gap-3 rounded-md bg-muted/50 px-3 py-2.5">
        <div>
          <span className="text-xs text-muted-foreground">Discount (MRP - SP)</span>
          <p className={cn('text-sm font-semibold', discount >= 0 ? 'text-green-600' : 'text-red-600')}>
            {formatINR(discount)}
          </p>
        </div>
        <div>
          <span className="text-xs text-muted-foreground">Profit (SP - DP)</span>
          <p className={cn('text-sm font-semibold', profit >= 0 ? 'text-green-600' : 'text-red-600')}>
            {formatINR(profit)}
          </p>
        </div>
        <div>
          <span className="text-xs text-muted-foreground">Profit %</span>
          <p className={cn('text-sm font-semibold', profit >= 0 ? 'text-green-600' : 'text-red-600')}>
            {profitPct}%
          </p>
        </div>
      </div>
    </div>
  );
}
