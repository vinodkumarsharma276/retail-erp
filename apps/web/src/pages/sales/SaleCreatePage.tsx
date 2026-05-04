import { useState, useMemo, useEffect, useRef } from 'react';
import { useNavigate, useSearchParams, useParams } from 'react-router-dom';
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
import { CityInput } from '../../components/CityInput';
import { useProductDetailQuery } from '../../hooks/useProducts';
import {
  useCustomerSearchQuery,
  useCreateCustomerMutation,
} from '../../hooks/useCustomers';
import { useCreateSaleMutation, useUpdateSaleMutation, useSaleDetailQuery } from '../../hooks/useSales';
import { useFinanceCompaniesQuery } from '../../hooks/useFinanceCompanies';
import { useAuthStore } from '../../stores/auth-store';
import { StatusBadge } from '../../components/StatusBadge';
import { CustomerReliabilityCard } from '../../components/CustomerReliabilityCard';
import { useAnyPermission, useCanCheck, usePermission } from '../../hooks/usePermission';
import { AccessDenied } from '../../routes/RoleGuard';
import {
  formatINR,
  calculateEMI,
  INTEREST_RATES,
  INSTALLMENT_MONTHS,
  getFinancialYearForDate,
  formatFinancialYearLabel,
} from '@retailerp/shared-utils';
import {
  UserRole,
  SaleType,
  PaymentMode,
} from '@retailerp/shared-types';
import { ConfirmDialog } from '../../components/ConfirmDialog';
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
  saleDate: string;
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
  saleDate: new Date().toISOString().split('T')[0],
  saleType: SaleType.FULL_PAYMENT,
  sellingPrice: '',
  gstRate: 18,
  downPayment: '',
  promiseDate: getDateDaysFromNow(7),
  interestRate: 0,
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
  zone: string;
  customerType: 'individual' | 'business';
  businessName: string;
  gstNumber: string;
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
  zone: '',
  customerType: 'individual',
  businessName: '',
  gstNumber: '',
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
  const { id } = useParams<{ id?: string }>();
  const isEditMode = Boolean(id);
  const canCreate = useAnyPermission(
    'sales.create_full_payment',
    'sales.create_partial_with_promise',
    'sales.create_self_finance',
    'sales.create_company_finance',
  );
  const canEdit = usePermission('sales.edit');
  const allowed = isEditMode ? canEdit : canCreate;
  if (!allowed) return <AccessDenied />;
  return <SaleCreatePageInner editingSaleId={id} />;
}

function SaleCreatePageInner({ editingSaleId }: { editingSaleId?: string }) {
  const isEditMode = Boolean(editingSaleId);
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const productIdFromUrl = searchParams.get('productId');
  const user = useAuthStore((s) => s.user);
  const userRole = user?.role;
  const can = useCanCheck();

  // Section permissions for the create form
  const canViewFinancials = can('sales.section.financials');

  // -----------------------------------------------------------------------
  // Existing sale (edit mode)
  // -----------------------------------------------------------------------
  const { data: existingSale, isLoading: isExistingSaleLoading } = useSaleDetailQuery(editingSaleId);

  // -----------------------------------------------------------------------
  // Product state
  // -----------------------------------------------------------------------
  // In edit mode, drive product fetch from the loaded sale; otherwise from URL.
  const productIdSource = isEditMode
    ? (existingSale?.productId ?? undefined)
    : (productIdFromUrl ?? undefined);
  const { data: preSelectedProduct, isLoading: isProductLoading } =
    useProductDetailQuery(productIdSource);
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [productSearchText, setProductSearchText] = useState('');

  // If product is preselected from URL or sale, use it
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
  const [summaryOpen, setSummaryOpen] = useState(false);
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
    if (isEditMode) return; // edit mode prefills from existing sale instead
    if (selectedProduct && !watch('sellingPrice')) {
      setValue('sellingPrice', selectedProduct.mrp);
      // Set initial down payment to 50% of MRP
      setValue('downPayment', Math.round(selectedProduct.mrp / 2));
      setDownPaymentManuallySet(false);
    }
  }, [selectedProduct, setValue, watch, isEditMode]);

  // Auto-select GST rate from purchase invoice
  useEffect(() => {
    if (isEditMode) return; // GST rate prefilled from existing sale in edit mode
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
    if (isEditMode) return; // edit mode locks saleType; defaults come from prefill
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
  // Edit-mode prefill — runs once when existingSale loads
  // -----------------------------------------------------------------------
  const editPrefilledRef = useRef(false);
  useEffect(() => {
    if (!isEditMode) return;
    if (!existingSale) return;
    if (editPrefilledRef.current) return;

    const s: any = existingSale;

    // Sale type & ledger & date & notes (strip the "GST Type: ..." suffix we append on save)
    setValue('saleType', s.saleType as SaleType);
    setValue('ledgerNumber', s.ledgerNumber ?? '');
    if (s.saleDate) {
      const d = new Date(s.saleDate);
      setValue('saleDate', d.toISOString().split('T')[0]);
    }
    let notesStr = String(s.notes ?? '');
    let parsedGstType: GstType = 'GST';
    const gstTypeMatch = notesStr.match(/GST Type:\s*(GST|CGST_SGST|IGST)/);
    if (gstTypeMatch) {
      parsedGstType = gstTypeMatch[1] as GstType;
      notesStr = notesStr.replace(/\s*\|?\s*GST Type:\s*(GST|CGST_SGST|IGST)/, '').trim();
    }
    setSaleGstType(parsedGstType);
    setValue('notes', notesStr);

    // Pricing
    setValue('sellingPrice', Number(s.sellingPrice));
    setValue('gstRate', Number(s.gstRate ?? 0));
    setValue('downPayment', Number(s.downPayment ?? 0));

    // Type-specific
    if (s.saleType === SaleType.PARTIAL_WITH_PROMISE && s.promiseDate) {
      setValue('promiseDate', new Date(s.promiseDate).toISOString().split('T')[0]);
    }
    if (s.saleType === SaleType.SELF_FINANCE) {
      setValue('interestRate', Number(s.interestRate ?? 0));
      setValue('fileCharge', Number(s.fileCharge ?? 0));
      setValue('numInstallments', Number(s.numInstallments ?? 6));
    }
    if (s.saleType === SaleType.COMPANY_FINANCE) {
      setValue('financeCompanyId', s.financeCompanyId ?? '');
      setValue('financedAmount', Number(s.financedAmount ?? 0));
      if (s.expectedPaymentDate) {
        setValue('expectedPaymentDate', new Date(s.expectedPaymentDate).toISOString().split('T')[0]);
      }
    }

    // Selected customer / guarantor (from sale relations)
    if (s.customer) setSelectedCustomer(s.customer as Customer);
    if (s.guarantor) setSelectedGuarantor(s.guarantor as Customer);

    // Payment splits
    if (Array.isArray(s.paymentBreakdown) && s.paymentBreakdown.length > 0) {
      setPaymentSplits(
        s.paymentBreakdown.map((b: { mode: PaymentMode; amount: number }) => ({
          mode: b.mode,
          amount: Number(b.amount),
        })),
      );
    } else if (s.paymentMode) {
      const totalPaid = s.saleType === 'full_payment'
        ? Number(s.sellingPrice)
        : Number(s.downPayment ?? 0);
      setPaymentSplits([{ mode: s.paymentMode as PaymentMode, amount: totalPaid }]);
    }

    setDownPaymentManuallySet(true);
    editPrefilledRef.current = true;
  }, [isEditMode, existingSale, setValue]);

  // -----------------------------------------------------------------------
  // FY-change warning (edit mode, non-Owner) — pop a confirmation only when
  // the user has actively changed the sale date away from the prefilled
  // baseline AND the new date falls in a different Indian financial year.
  // Owner users skip this gate entirely.
  // -----------------------------------------------------------------------
  const watchedSaleDate = watch('saleDate');
  const baselineSaleDateRef = useRef<string | null>(null);

  // Capture the canonical input value once prefill has set the date.
  useEffect(() => {
    if (!isEditMode) return;
    if (baselineSaleDateRef.current !== null) return;
    if (!editPrefilledRef.current) return;
    if (!watchedSaleDate) return;
    baselineSaleDateRef.current = watchedSaleDate;
  }, [isEditMode, watchedSaleDate]);

  const [fyWarning, setFyWarning] = useState<
    { oldFy: number; newFy: number; date: string } | null
  >(null);
  const fyAcknowledgedRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!isEditMode) return;
    if (userRole === UserRole.OWNER) return;
    const baseline = baselineSaleDateRef.current;
    if (!baseline || !watchedSaleDate) return;
    // Only fire after the user has actually changed the date.
    if (watchedSaleDate === baseline) return;
    const oldFy = getFinancialYearForDate(baseline);
    const newFy = getFinancialYearForDate(watchedSaleDate);
    if (oldFy === null || newFy === null) return;
    if (oldFy === newFy) return;
    if (fyAcknowledgedRef.current.has(watchedSaleDate)) return;
    setFyWarning({ oldFy, newFy, date: watchedSaleDate });
  }, [isEditMode, userRole, watchedSaleDate]);

  const handleFyWarningConfirm = () => {
    if (fyWarning) {
      fyAcknowledgedRef.current.add(fyWarning.date);
    }
    setFyWarning(null);
  };

  const handleFyWarningCancel = () => {
    // Revert the date back to the baseline (original FY).
    const baseline = baselineSaleDateRef.current;
    if (baseline) {
      setValue('saleDate', baseline, { shouldDirty: true });
    }
    setFyWarning(null);
  };

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

  // Effective monthly rate % = interest + (fileCharge / principal / months) × 100.
  // Mirrors server-side calculation so UI and DB agree.
  const effectiveMonthlyRate = useMemo<number | null>(() => {
    if (saleType !== SaleType.SELF_FINANCE) return null;
    const principal = sellingPrice - downPayment;
    if (principal <= 0 || numInstallments <= 0) return null;
    const raw = interestRate + (fileCharge / principal / numInstallments) * 100;
    return Math.round(raw * 1000) / 1000;
  }, [saleType, sellingPrice, downPayment, interestRate, fileCharge, numInstallments]);

  // -----------------------------------------------------------------------
  // Create / Update sale mutation
  // -----------------------------------------------------------------------
  const createSaleMutation = useCreateSaleMutation();
  const updateSaleMutation = useUpdateSaleMutation();
  const activeMutation = isEditMode ? updateSaleMutation : createSaleMutation;

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
      saleDate: formData.saleDate || undefined,
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

    if (isEditMode && editingSaleId) {
      updateSaleMutation.mutate(
        { saleId: editingSaleId, payload },
        {
          onSuccess: (data) => {
            navigate(`/sales/${data.id}`, { replace: true });
          },
        },
      );
    } else {
      createSaleMutation.mutate(payload, {
        onSuccess: (data) => {
          navigate(`/sales/${data.id}`, { replace: true });
        },
      });
    }
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
      customerType: newCustomer.customerType,
      businessName:
        newCustomer.customerType === 'business' && newCustomer.businessName.trim()
          ? newCustomer.businessName.trim()
          : null,
      gstNumber:
        newCustomer.customerType === 'business' && newCustomer.gstNumber.trim()
          ? newCustomer.gstNumber.trim().toUpperCase()
          : null,
    };
    if (can('view.customer.address.zone')) {
      payload.zone = newCustomer.zone || null;
    }

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

  // -----------------------------------------------------------------------
  // Ctrl+S / Cmd+S keyboard shortcut to submit
  // -----------------------------------------------------------------------
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        if (canSubmit && !activeMutation.isPending) {
          handleSubmit(onSubmit)();
        }
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [canSubmit, activeMutation.isPending, handleSubmit, onSubmit]);

  // Error message from mutation
  const errorMessage = activeMutation.error
    ? (activeMutation.error as any)?.response?.data?.error ??
      (activeMutation.error as any)?.response?.data?.message ??
      'Something went wrong. Please try again.'
    : null;

  // Total displayed on mobile bottom bar (covers all sale types)
  const mobileBarTotal =
    saleType === SaleType.SELF_FINANCE && emiResult
      ? sellingPrice + emiResult.totalInterest + emiResult.fileCharge
      : sellingPrice;

  // Shared summary body (used in desktop right rail and mobile drawer)
  const summaryBody = (
    <div className="space-y-2 text-sm">
      <SummaryRow label="Selling Price (incl. GST)" value={formatINR(sellingPrice)} />
      {canViewFinancials && gstRate > 0 && (
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
          <SummaryRow label="Down Payment" value={formatINR(downPayment)} />
          {pendingAmount > 0 && (
            <div className="flex justify-between border-t pt-2 font-semibold">
              <span>Pending Amount</span>
              <span className="text-red-600">{formatINR(pendingAmount)}</span>
            </div>
          )}
        </>
      )}

      {saleType === SaleType.SELF_FINANCE && emiResult && (
        <>
          <SummaryRow label="Down Payment" value={formatINR(downPayment)} />
          <SummaryRow label="Principal (SP - Down)" value={formatINR(emiResult.principal)} />
          <SummaryRow label="Total Interest" value={formatINR(emiResult.totalInterest)} />
          {emiResult.fileCharge > 0 && (
            <SummaryRow label="File Charge" value={formatINR(emiResult.fileCharge)} />
          )}
          <SummaryRow label="EMI / month" value={formatINR(emiResult.emiAmount)} />
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
          <SummaryRow label="Down Payment" value={formatINR(downPayment)} />
          <SummaryRow label="Financed Amount" value={formatINR(financedAmount)} />
          {pendingAmount > 0 && (
            <div className="flex justify-between border-t pt-2 font-semibold">
              <span>Remaining (Unpaid)</span>
              <span className="text-red-600">{formatINR(pendingAmount)}</span>
            </div>
          )}
        </>
      )}
    </div>
  );

  return (
    <div className="mx-auto max-w-[1600px] pb-24 lg:pb-0">
      {/* Page header */}
      <div className="flex items-center gap-4 mb-4">
        <button
          onClick={() => navigate(-1)}
          className="rounded-md p-2 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
        >
          <ArrowLeft className="h-5 w-5" />
        </button>
        <h1 className="text-xl font-semibold sm:text-2xl">
          {isEditMode
            ? `Edit Sale${existingSale?.saleNumber ? ` ${existingSale.saleNumber}` : ''}`
            : 'New Sale'}
        </h1>
      </div>

      {isEditMode && isExistingSaleLoading && (
        <div className="mb-4 flex items-center gap-2 rounded-md border bg-muted/30 px-3 py-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading sale…
        </div>
      )}
      {isEditMode && existingSale && (
        <div className="mb-4 flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-300">
          <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
          <span>
            Editing this sale will reset any installment payments, finance payment status, and partial-promise settlements. Product and sale type cannot be changed.
          </span>
        </div>
      )}

      <form onSubmit={handleSubmit(onSubmit)} className="grid grid-cols-1 gap-4 lg:grid-cols-12 lg:gap-6">
        {/* === MAIN COLUMN ============================================== */}
        <div className="space-y-4 lg:col-span-8">
        {/* =============================================================== */}
        {/* SECTION 1: PRODUCT */}
        {/* =============================================================== */}
        <section className="rounded-lg border bg-card p-4">
          <h2 className="text-sm font-semibold mb-3 flex items-center gap-2 text-muted-foreground uppercase tracking-wide">
            <Package className="h-4 w-4 text-primary" />
            Product
          </h2>

          {isProductLoading && productIdFromUrl ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading product...
            </div>
          ) : selectedProduct ? (
            <div className="flex items-start gap-3 rounded-md border bg-muted/30 p-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-primary/10">
                <Package className="h-5 w-5 text-primary" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="font-semibold">
                    {selectedProduct.brand} {selectedProduct.modelNumber}
                  </p>
                  <StatusBadge status={selectedProduct.status} />
                  {!productIdFromUrl && !isEditMode && (
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedProduct(null);
                        setProductSearchText('');
                      }}
                      className="ml-auto text-xs text-primary hover:underline"
                    >
                      Change
                    </button>
                  )}
                </div>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {[
                    selectedProduct.serialNumber && `SN ${selectedProduct.serialNumber}`,
                    (selectedProduct as any).category?.name,
                    selectedProduct.color,
                    selectedProduct.warrantyMonths && `${selectedProduct.warrantyMonths}mo warranty`,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </p>
                <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
                  <span>
                    <span className="text-muted-foreground">MRP </span>
                    <span className="font-semibold">{formatINR(selectedProduct.mrp)}</span>
                  </span>
                  <span>
                    <span className="text-muted-foreground">DP </span>
                    <span className="font-semibold">{formatINR(selectedProduct.purchasePrice)}</span>
                  </span>
                  {selectedProduct.barcode && (
                    <span className="font-mono text-[11px] text-muted-foreground">
                      {selectedProduct.barcode}
                    </span>
                  )}
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
        <section className="rounded-lg border bg-card p-4">
          <h2 className="text-sm font-semibold mb-3 flex items-center gap-2 text-muted-foreground uppercase tracking-wide">
            <FileText className="h-4 w-4 text-primary" />
            Ledger & Sale Date
          </h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
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

            <div>
              <label htmlFor="saleDate" className="block text-sm font-medium mb-1.5">
                Sold on <span className="text-destructive">*</span>
              </label>
              <input
                id="saleDate"
                type="date"
                min={
                  (selectedProduct as any)?.purchase?.invoiceDate
                    ? String((selectedProduct as any).purchase.invoiceDate).slice(0, 10)
                    : undefined
                }
                max={new Date().toISOString().split('T')[0]}
                {...register('saleDate', {
                  required: 'Sale date is required',
                  validate: (value) => {
                    if (!value) return 'Sale date is required';
                    const invoiceDate = (selectedProduct as any)?.purchase?.invoiceDate;
                    if (invoiceDate && value < String(invoiceDate).slice(0, 10)) {
                      return `Sale date cannot be before purchase invoice date (${String(invoiceDate).slice(0, 10)})`;
                    }
                    const today = new Date().toISOString().split('T')[0];
                    if (value > today) return 'Sale date cannot be in the future';
                    return true;
                  },
                })}
                className={cn(
                  'w-full rounded-md border bg-background px-3 py-2.5 text-sm',
                  'focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2',
                  errors.saleDate && 'border-destructive',
                )}
              />
              <p className="mt-1 text-xs text-muted-foreground">
                {(selectedProduct as any)?.purchase?.invoiceDate
                  ? `Must be on or after purchase invoice date (${String((selectedProduct as any).purchase.invoiceDate).slice(0, 10)}).`
                  : 'Defaults to today. You can backdate if the sale was actually on an earlier day.'}
              </p>
              {errors.saleDate && (
                <p className="mt-1 text-xs text-destructive">
                  {errors.saleDate.message}
                </p>
              )}
            </div>
          </div>
        </section>

        {/* =============================================================== */}
        {/* SECTION 3: SALE TYPE */}
        {/* =============================================================== */}
        <section className="rounded-lg border bg-card p-4">
          <h2 className="text-sm font-semibold mb-3 flex items-center gap-2 text-muted-foreground uppercase tracking-wide">
            <CreditCard className="h-4 w-4 text-primary" />
            Sale Type
          </h2>

          {/* Segmented control */}
          <div className="flex flex-wrap gap-2 mb-6">
            {/* Full Payment */}
            {(can('sales.create_full_payment') || (isEditMode && saleType === SaleType.FULL_PAYMENT)) && (
              <SaleTypeButton
                active={saleType === SaleType.FULL_PAYMENT}
                onClick={() => setValue('saleType', SaleType.FULL_PAYMENT)}
                label="Full Payment"
              />
            )}
            {/* Partial with Promise */}
            {(can('sales.create_partial_with_promise') || (isEditMode && saleType === SaleType.PARTIAL_WITH_PROMISE)) && (
              <SaleTypeButton
                active={saleType === SaleType.PARTIAL_WITH_PROMISE}
                onClick={() => setValue('saleType', SaleType.PARTIAL_WITH_PROMISE)}
                label="Partial with Promise"
              />
            )}
            {/* Self Finance */}
            {(can('sales.create_self_finance') || (isEditMode && saleType === SaleType.SELF_FINANCE)) && (
              <SaleTypeButton
                active={saleType === SaleType.SELF_FINANCE}
                onClick={() => setValue('saleType', SaleType.SELF_FINANCE)}
                label="Self Finance (Installment)"
              />
            )}
            {/* Company Finance */}
            {(can('sales.create_company_finance') || (isEditMode && saleType === SaleType.COMPANY_FINANCE)) && (
              <SaleTypeButton
                active={saleType === SaleType.COMPANY_FINANCE}
                onClick={() => setValue('saleType', SaleType.COMPANY_FINANCE)}
                label="Company Finance"
              />
            )}
          </div>
          {isEditMode && (
            <p className="-mt-3 mb-4 text-xs text-muted-foreground">
              Changing the sale type will reset payment status, finance details
              and any installment schedule for this sale. The change will be
              recorded in the sale's activity log.
            </p>
          )}

          {/* ---- FULL PAYMENT ---- */}
          {saleType === SaleType.FULL_PAYMENT && (
            <div className="space-y-4">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
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
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
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
          {saleType === SaleType.SELF_FINANCE && (can('sales.create_self_finance') || isEditMode) && (
            <div className="space-y-4">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
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
                  <div className="relative">
                    <select
                      value={interestRate}
                      onChange={(e) =>
                        setValue('interestRate', Number(e.target.value))
                      }
                      className={cn(
                        'w-full appearance-none rounded-md border bg-background px-3 py-2.5 pr-8 text-sm',
                        'focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2',
                      )}
                    >
                      {INTEREST_RATES.map((rate) => (
                        <option key={rate} value={rate}>
                          {rate}%
                        </option>
                      ))}
                    </select>
                    <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
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
                    {effectiveMonthlyRate !== null && (
                      <div>
                        <p className="text-xs font-medium text-blue-700 dark:text-blue-400">
                          Effective Rate / Month
                        </p>
                        <p className="text-lg font-semibold text-blue-900 dark:text-blue-100">
                          {effectiveMonthlyRate}%
                        </p>
                        <p className="text-[10px] text-blue-500 dark:text-blue-400">
                          {interestRate}% interest +{' '}
                          {(
                            Math.round(
                              (effectiveMonthlyRate - interestRate) * 1000,
                            ) / 1000
                          ).toFixed(3)}
                          % file
                        </p>
                      </div>
                    )}
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
                    <table className="w-full text-sm border-separate border-spacing-0">
                      <thead className="sticky top-0 z-10 bg-blue-100 dark:bg-blue-950 shadow-sm">
                        <tr>
                          <th className="px-3 py-2 text-left font-medium text-blue-800 dark:text-blue-300 border-b border-blue-200 dark:border-blue-800">
                            Month #
                          </th>
                          <th className="px-3 py-2 text-left font-medium text-blue-800 dark:text-blue-300 border-b border-blue-200 dark:border-blue-800">
                            Due Date
                          </th>
                          <th className="px-3 py-2 text-right font-medium text-blue-800 dark:text-blue-300 border-b border-blue-200 dark:border-blue-800">
                            Amount
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {emiResult.schedule.map((item) => (
                          <tr
                            key={item.installmentNumber}
                            className="bg-card"
                          >
                            <td className="px-3 py-1.5 border-t border-blue-100 dark:border-blue-900">
                              {item.installmentNumber}
                            </td>
                            <td className="px-3 py-1.5 border-t border-blue-100 dark:border-blue-900">{item.dueDate}</td>
                            <td className="px-3 py-1.5 text-right font-medium border-t border-blue-100 dark:border-blue-900">
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
          {saleType === SaleType.COMPANY_FINANCE && (can('sales.create_company_finance') || isEditMode) && (
            <div className="space-y-4">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
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
        <section className="rounded-lg border bg-card p-4">
          <h2 className="text-sm font-semibold mb-3 flex items-center gap-2 text-muted-foreground uppercase tracking-wide">
            <User className="h-4 w-4 text-primary" />
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
                  <CityInput
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

                {/* Zone — gated by view.customer.address.zone */}
                {can('view.customer.address.zone') && (
                  <div>
                    <label className="block text-sm font-medium mb-1">Zone</label>
                    <select
                      value={newCustomer.zone}
                      onChange={(e) =>
                        setNewCustomer({ ...newCustomer, zone: e.target.value })
                      }
                      className={cn(
                        'w-full appearance-none rounded-md border bg-background px-3 py-2 text-sm',
                        'focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2',
                      )}
                    >
                      <option value="">Select Zone...</option>
                      <option value="East">East</option>
                      <option value="West">West</option>
                      <option value="North">North</option>
                      <option value="South">South</option>
                    </select>
                  </div>
                )}

                {/* B2B fields — toggle plus business name + GSTIN. Shown on
                    invoices for business customers (used by GST input
                    credit reporting). */}
                <div>
                  <label className="block text-sm font-medium mb-1">
                    Customer Type
                  </label>
                  <select
                    value={newCustomer.customerType}
                    onChange={(e) =>
                      setNewCustomer({
                        ...newCustomer,
                        customerType: e.target.value as 'individual' | 'business',
                      })
                    }
                    className={cn(
                      'w-full appearance-none rounded-md border bg-background px-3 py-2 text-sm',
                      'focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2',
                    )}
                  >
                    <option value="individual">Individual</option>
                    <option value="business">Business (B2B)</option>
                  </select>
                </div>

                {newCustomer.customerType === 'business' && (
                  <>
                    <div className="sm:col-span-2">
                      <label className="block text-sm font-medium mb-1">
                        Business Name <span className="text-destructive">*</span>
                      </label>
                      <input
                        type="text"
                        value={newCustomer.businessName}
                        onChange={(e) =>
                          setNewCustomer({
                            ...newCustomer,
                            businessName: e.target.value,
                          })
                        }
                        placeholder="e.g. Acme Distributors Pvt Ltd"
                        className={cn(
                          'w-full rounded-md border bg-background px-3 py-2 text-sm',
                          'placeholder:text-muted-foreground',
                          'focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2',
                        )}
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium mb-1">
                        GSTIN <span className="text-destructive">*</span>
                      </label>
                      <input
                        type="text"
                        maxLength={15}
                        value={newCustomer.gstNumber}
                        onChange={(e) =>
                          setNewCustomer({
                            ...newCustomer,
                            gstNumber: e.target.value.toUpperCase(),
                          })
                        }
                        placeholder="15-char GSTIN"
                        className={cn(
                          'w-full rounded-md border bg-background px-3 py-2 text-sm uppercase',
                          'placeholder:text-muted-foreground',
                          'focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2',
                        )}
                      />
                    </div>
                  </>
                )}
              </div>
              <button
                type="button"
                onClick={handleCreateNewCustomer}
                disabled={
                  !newCustomer.name.trim() ||
                  !newCustomer.phone.trim() ||
                  (newCustomer.customerType === 'business' &&
                    (!newCustomer.businessName.trim() || !newCustomer.gstNumber.trim())) ||
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
                  placeholder="Search by phone, name, customer code or ledger # (min 2 chars)..."
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
          {saleType === SaleType.SELF_FINANCE && (can('sales.create_self_finance') || isEditMode) && (
            <div className="pt-4 border-t mt-4">
              <h3 className="text-sm font-medium mb-3 flex items-center gap-2">
                <Shield className="h-4 w-4 text-purple-600" />
                Guarantor <span className="text-destructive">*</span>
              </h3>

              {/* Self-guarantor checkbox — for installments to known customers
                  the customer may stand as their own guarantor. */}
              {selectedCustomer && (
                <label className="mb-3 flex items-center gap-2 cursor-pointer select-none text-sm">
                  <input
                    type="checkbox"
                    className="h-4 w-4 rounded border-input text-primary focus:ring-2 focus:ring-ring"
                    checked={
                      !!selectedGuarantor &&
                      selectedGuarantor.id === selectedCustomer.id
                    }
                    onChange={(e) => {
                      if (e.target.checked) {
                        setSelectedGuarantor(selectedCustomer);
                        setGuarantorSearchText('');
                        setShowNewGuarantorForm(false);
                      } else {
                        setSelectedGuarantor(null);
                      }
                    }}
                  />
                  <span>
                    Customer is their own guarantor{' '}
                    <span className="text-muted-foreground">
                      (use for trusted / known customers)
                    </span>
                  </span>
                </label>
              )}

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
                      <CityInput
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
        <section className="rounded-lg border bg-card">
          <details className="group">
            <summary className="flex cursor-pointer items-center justify-between p-4 list-none">
              <h2 className="text-sm font-semibold flex items-center gap-2 text-muted-foreground uppercase tracking-wide">
                <FileText className="h-4 w-4 text-primary" />
                Notes
                <span className="text-xs font-normal normal-case tracking-normal text-muted-foreground/70">(optional)</span>
              </h2>
              <ChevronDown className="h-4 w-4 text-muted-foreground transition-transform group-open:rotate-180" />
            </summary>
            <div className="px-4 pb-4">
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
            </div>
          </details>
        </section>

        </div>
        {/* === END MAIN COLUMN ========================================== */}

        {/* === RIGHT RAIL =============================================== */}
        <aside className="lg:col-span-4">
          <div className="space-y-4 lg:sticky lg:top-4">
        {/* =============================================================== */}
        {/* SECTION 6: SUMMARY CARD (desktop right rail only) */}
        {/* =============================================================== */}
        {canViewFinancials && (
        <section className="hidden lg:block rounded-lg border-2 border-primary/20 bg-primary/5 p-5">
          <h2 className="text-base font-semibold mb-3">Sale Summary</h2>
          {summaryBody}
        </section>
        )}

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
        {/* DESKTOP ACTIONS (inside right rail) */}
        {/* =============================================================== */}
        <div className="hidden lg:flex lg:flex-col lg:gap-2">
          <button
            type="submit"
            disabled={!canSubmit || activeMutation.isPending}
            title="Save (Ctrl+S)"
            className={cn(
              'flex w-full items-center justify-center gap-2 rounded-md bg-green-600 px-4 py-2.5 text-sm font-semibold text-white',
              'hover:bg-green-700 transition-colors',
              'disabled:opacity-50 disabled:cursor-not-allowed',
            )}
          >
            {activeMutation.isPending ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                {isEditMode ? 'Saving Changes…' : 'Creating Sale…'}
              </>
            ) : (
              <>
                <ShoppingCart className="h-4 w-4" />
                {isEditMode ? 'Save Changes' : 'Complete Sale'}
                <kbd className="ml-1 hidden rounded border border-white/30 bg-white/10 px-1.5 py-0.5 text-[10px] font-medium xl:inline">Ctrl+S</kbd>
              </>
            )}
          </button>
          <button
            type="button"
            onClick={() => navigate(-1)}
            className="w-full rounded-md border px-4 py-2 text-sm font-medium text-muted-foreground hover:bg-muted transition-colors"
          >
            Cancel
          </button>
        </div>
          </div>
        </aside>
        {/* === END RIGHT RAIL =========================================== */}

        {/* === MOBILE STICKY ACTION BAR ================================= */}
        <div className="fixed inset-x-0 bottom-0 z-30 border-t bg-card shadow-lg lg:hidden">
          <div className="flex items-center gap-2 p-3">
            {canViewFinancials ? (
            <button
              type="button"
              onClick={() => setSummaryOpen(true)}
              className="flex flex-1 items-center justify-between rounded-md border bg-muted/30 px-3 py-2 text-left hover:bg-muted transition-colors"
              aria-label="View sale summary"
            >
              <span className="flex flex-col">
                <span className="text-[10px] uppercase tracking-wide text-muted-foreground">Total</span>
                <span className="text-sm font-semibold leading-tight">{formatINR(mobileBarTotal)}</span>
              </span>
              <ChevronDown className="h-4 w-4 rotate-180 text-muted-foreground" />
            </button>
            ) : (
              <div className="flex-1" />
            )}
            <button
              type="submit"
              disabled={!canSubmit || activeMutation.isPending}
              className={cn(
                'flex items-center justify-center gap-2 rounded-md bg-green-600 px-4 py-2.5 text-sm font-semibold text-white',
                'hover:bg-green-700 transition-colors',
                'disabled:opacity-50 disabled:cursor-not-allowed',
              )}
            >
              {activeMutation.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Saving…
                </>
              ) : (
                <>
                  <ShoppingCart className="h-4 w-4" />
                  {isEditMode ? 'Save Changes' : 'Save Sale'}
                </>
              )}
            </button>
          </div>
        </div>

        {/* === MOBILE SUMMARY DRAWER ==================================== */}
        {canViewFinancials && summaryOpen && (
          <div className="fixed inset-0 z-40 lg:hidden" role="dialog" aria-modal="true" aria-label="Sale summary">
            <div
              className="absolute inset-0 bg-black/50"
              onClick={() => setSummaryOpen(false)}
            />
            <div className="absolute inset-x-0 bottom-0 max-h-[85vh] overflow-y-auto rounded-t-2xl border-t bg-card p-5 shadow-2xl">
              <div className="mx-auto mb-3 h-1.5 w-12 rounded-full bg-muted-foreground/30" />
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-base font-semibold">Sale Summary</h2>
                <button
                  type="button"
                  onClick={() => setSummaryOpen(false)}
                  className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
                  aria-label="Close summary"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
              {summaryBody}
              {errorMessage && (
                <div className="mt-4 flex items-center gap-2 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
                  <AlertCircle className="h-4 w-4 shrink-0" />
                  {errorMessage}
                </div>
              )}
              <button
                type="button"
                onClick={() => {
                  setSummaryOpen(false);
                  navigate(-1);
                }}
                className="mt-4 w-full rounded-md border px-4 py-2.5 text-sm font-medium text-muted-foreground hover:bg-muted transition-colors"
              >
                Cancel Sale
              </button>
            </div>
          </div>
        )}
      </form>

      {/* FY-change warning — non-Owner users editing a sale into a different FY */}
      <ConfirmDialog
        isOpen={fyWarning !== null}
        title="Financial year change"
        message={
          fyWarning
            ? `You are moving this sale from ${formatFinancialYearLabel(
                fyWarning.oldFy,
              )} to ${formatFinancialYearLabel(
                fyWarning.newFy,
              )}. This affects financial year reports, GST filings and reconciliation. Are you sure you want to continue?`
            : ''
        }
        confirmText="Yes, change FY"
        cancelText="Keep original date"
        variant="danger"
        onConfirm={handleFyWarningConfirm}
        onCancel={handleFyWarningCancel}
      />
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
  disabled,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'rounded-md border px-4 py-2 text-sm font-medium transition-colors',
        active
          ? 'border-primary bg-primary text-primary-foreground'
          : 'border-border bg-background text-foreground hover:bg-muted',
        disabled && 'opacity-50 cursor-not-allowed',
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

  // Lay GST Type alongside the percent + amount on a single row so the
  // right-hand area beside Selling Price is used productively. CGST+SGST
  // splits the amount cell into two so the user sees each half.
  return (
    <div className="sm:col-span-2 lg:col-span-3 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {/* GST Type radio */}
      <div>
        <label className="block text-sm font-medium mb-1.5">
          GST Type{' '}
          <span className="text-xs text-muted-foreground font-normal">
            (incl. in SP)
          </span>
        </label>
        <div className="flex flex-wrap items-center gap-3 rounded-md border bg-background px-3 py-2.5 text-sm">
          <label className="flex items-center gap-1.5 cursor-pointer">
            <input
              type="radio"
              name="saleGstType"
              checked={gstType === 'GST'}
              onChange={() => onGstTypeChange('GST')}
              className="h-4 w-4 text-primary"
            />
            <span>GST</span>
          </label>
          <label className="flex items-center gap-1.5 cursor-pointer">
            <input
              type="radio"
              name="saleGstType"
              checked={gstType === 'CGST_SGST'}
              onChange={() => onGstTypeChange('CGST_SGST')}
              className="h-4 w-4 text-primary"
            />
            <span>C+S</span>
          </label>
          <label className="flex items-center gap-1.5 cursor-pointer">
            <input
              type="radio"
              name="saleGstType"
              checked={gstType === 'IGST'}
              onChange={() => onGstTypeChange('IGST')}
              className="h-4 w-4 text-primary"
            />
            <span>IGST</span>
          </label>
        </div>
      </div>

      {/* % + computed amount(s) — laid out on the same row as GST Type */}
      {gstType === 'CGST_SGST' ? (
        <>
          <div>
            <label className="block text-sm font-medium mb-1.5">Total GST %</label>
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
  const can = useCanCheck();
  const canViewProfit = can('sales.section.profit');
  const canViewPurchasePrice = can('sales.section.purchase_price');
  const canViewFinancials = can('sales.section.financials');
  const canShow = canViewProfit || canViewPurchasePrice || canViewFinancials;
  if (!canShow) return null;
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
        {canViewFinancials && gstRate > 0 && (
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
        {canViewProfit && (
        <div>
          <span className="text-xs text-muted-foreground">Net Profit</span>
          <p className={cn('text-sm font-semibold', netProfit >= 0 ? 'text-green-600' : 'text-red-600')}>
            {formatINR(netProfit)} <span className="text-xs font-normal">({netProfitPct}%)</span>
          </p>
        </div>
        )}
      </div>
    </div>
  );
}
