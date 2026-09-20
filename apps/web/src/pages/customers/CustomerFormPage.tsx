import { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { Loader2, Save, ArrowLeft, AlertCircle, Search, X } from 'lucide-react';
import { cn } from '../../lib/utils';
import { useDebounce } from '../../hooks/useDebounce';
import { CityInput } from '../../components/CityInput';
import { usePermission } from '../../hooks/usePermission';
import {
  useCustomerDetailQuery,
  useCustomerSearchQuery,
  useCreateCustomerMutation,
  useUpdateCustomerMutation,
} from '../../hooks/useCustomers';
import type { Customer } from '@retailerp/shared-types';

// ---------------------------------------------------------------------------
// Form values
// ---------------------------------------------------------------------------
interface CustomerFormValues {
  name: string;
  phone: string;
  altPhone: string;
  aadhaarNumber: string;
  addressLine1: string;
  addressLine2: string;
  city: string;
  state: string;
  pincode: string;
  zone: string;
  isGuarantor: boolean;
  customerType: 'individual' | 'business';
  businessName: string;
  gstNumber: string;
}

const defaultValues: CustomerFormValues = {
  name: '',
  phone: '',
  altPhone: '',
  aadhaarNumber: '',
  addressLine1: '',
  addressLine2: '',
  city: '',
  state: '',
  pincode: '',
  zone: '',
  isGuarantor: false,
  customerType: 'individual',
  businessName: '',
  gstNumber: '',
};

// Per-shop zones — today identical across shops; the field is also
// surfaced via the DB-driven form_definitions so this list could be
// pulled from there in the future.
const ZONE_OPTIONS = ['East', 'West', 'North', 'South', 'Delhi', 'Ghaziabad', 'Noida'] as const;

// ---------------------------------------------------------------------------
// INDIAN STATES list for dropdown
// ---------------------------------------------------------------------------
const INDIAN_STATES = [
  'Andhra Pradesh',
  'Arunachal Pradesh',
  'Assam',
  'Bihar',
  'Chhattisgarh',
  'Delhi',
  'Goa',
  'Gujarat',
  'Haryana',
  'Himachal Pradesh',
  'Jharkhand',
  'Karnataka',
  'Kerala',
  'Madhya Pradesh',
  'Maharashtra',
  'Manipur',
  'Meghalaya',
  'Mizoram',
  'Nagaland',
  'Odisha',
  'Punjab',
  'Rajasthan',
  'Sikkim',
  'Tamil Nadu',
  'Telangana',
  'Tripura',
  'Uttar Pradesh',
  'Uttarakhand',
  'West Bengal',
];

export function CustomerFormPage() {
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const isEditMode = !!id;

  // Zone field is gated by the `view.customer.address.zone` permission.
  // Owner & Admin always have it; Owner can grant to any other role.
  const canSeeZone = usePermission('view.customer.address.zone');

  // Guarantor search
  const [guarantorSearchText, setGuarantorSearchText] = useState('');
  const debouncedGuarantorSearch = useDebounce(guarantorSearchText, 300);
  const guarantorSearchQuery = useCustomerSearchQuery(debouncedGuarantorSearch);
  const guarantorResults = guarantorSearchQuery.data ?? [];
  const [selectedGuarantor, setSelectedGuarantor] = useState<Customer | null>(null);
  const [showGuarantorDropdown, setShowGuarantorDropdown] = useState(false);

  // Load existing customer in edit mode
  const { data: existingCustomer, isLoading: isLoadingCustomer } =
    useCustomerDetailQuery(id);

  // Mutations
  const createMutation = useCreateCustomerMutation();
  const updateMutation = useUpdateCustomerMutation();
  const isSaving = createMutation.isPending || updateMutation.isPending;

  // Form
  const {
    register,
    handleSubmit,
    reset,
    watch,
    setValue,
    formState: { errors },
  } = useForm<CustomerFormValues>({ defaultValues });

  const isGuarantor = watch('isGuarantor');
  const customerType = watch('customerType');

  // Pre-fill form when editing
  useEffect(() => {
    if (existingCustomer && isEditMode) {
      reset({
        name: existingCustomer.name,
        phone: existingCustomer.phone,
        altPhone: existingCustomer.altPhone ?? '',
        aadhaarNumber: existingCustomer.aadhaarNumber ?? '',
        addressLine1: existingCustomer.addressLine1 ?? '',
        addressLine2: existingCustomer.addressLine2 ?? '',
        city: existingCustomer.city ?? '',
        state: existingCustomer.state ?? '',
        pincode: existingCustomer.pincode ?? '',
        zone: existingCustomer.zone ?? '',
        isGuarantor: existingCustomer.isGuarantor,
        customerType: existingCustomer.customerType ?? 'individual',
        businessName: existingCustomer.businessName ?? '',
        gstNumber: existingCustomer.gstNumber ?? '',
      });
      // Set guarantor if present
      if ((existingCustomer as any).guarantor) {
        setSelectedGuarantor((existingCustomer as any).guarantor);
      }
    }
  }, [existingCustomer, isEditMode, reset]);

  const onSubmit = (formData: CustomerFormValues) => {
    const payload: Record<string, unknown> = {
      name: formData.name.trim(),
      phone: formData.phone.trim(),
      altPhone: formData.altPhone.trim() || undefined,
      aadhaarNumber: formData.aadhaarNumber.trim() || undefined,
      addressLine1: formData.addressLine1.trim() || undefined,
      addressLine2: formData.addressLine2.trim() || undefined,
      city: formData.city.trim() || undefined,
      state: formData.state || undefined,
      pincode: formData.pincode.trim() || undefined,
      isGuarantor: formData.isGuarantor,
      guarantorId: !formData.isGuarantor && selectedGuarantor ? selectedGuarantor.id : undefined,
      customerType: formData.customerType,
      businessName:
        formData.customerType === 'business' && formData.businessName.trim()
          ? formData.businessName.trim()
          : null,
      gstNumber:
        formData.customerType === 'business' && formData.gstNumber.trim()
          ? formData.gstNumber.trim().toUpperCase()
          : null,
    };

    // Only send zone when the user has permission to edit it; otherwise we
    // leave the existing value untouched on update or null on create.
    if (canSeeZone) {
      payload.zone = formData.zone || null;
    }

    if (isEditMode && id) {
      updateMutation.mutate(
        { id, payload },
        {
          onSuccess: () => {
            navigate(`/customers/${id}`, { replace: true });
          },
        },
      );
    } else {
      createMutation.mutate(payload, {
        onSuccess: (data) => {
          navigate(`/customers/${data.id}`, { replace: true });
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
  if (isEditMode && isLoadingCustomer) {
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
        <button
          onClick={() => navigate(-1)}
          className="rounded-md p-2 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
        >
          <ArrowLeft className="h-5 w-5" />
        </button>
        <h1 className="text-display">
          {isEditMode ? 'Edit Customer' : 'Add Customer'}
        </h1>
      </div>

      <form onSubmit={handleSubmit(onSubmit)} className="space-y-8">
        {/* Section 1: Basic Info */}
        <section className="rounded-lg border bg-card p-6">
          <h2 className="text-lg font-medium mb-4">Basic Information</h2>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {/* Name */}
            <div className="sm:col-span-2 lg:col-span-1">
              <label htmlFor="name" className="block text-sm font-medium mb-1.5">
                Name <span className="text-destructive">*</span>
              </label>
              <input
                id="name"
                type="text"
                {...register('name', { required: 'Name is required' })}
                placeholder="e.g. Rajesh Kumar"
                className={cn(
                  'w-full rounded-md border bg-field px-3 py-2.5 text-sm',
                  'placeholder:text-muted-foreground',
                  'focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2',
                  errors.name && 'border-destructive',
                )}
              />
              {errors.name && (
                <p className="mt-1 text-xs text-destructive">
                  {errors.name.message}
                </p>
              )}
            </div>

            {/* Phone */}
            <div>
              <label htmlFor="phone" className="block text-sm font-medium mb-1.5">
                Phone <span className="text-destructive">*</span>
              </label>
              <input
                id="phone"
                type="tel"
                {...register('phone', {
                  required: 'Phone number is required',
                  pattern: {
                    value: /^[6-9]\d{9}$/,
                    message: 'Enter a valid 10-digit Indian mobile number',
                  },
                })}
                placeholder="e.g. 9876543210"
                className={cn(
                  'w-full rounded-md border bg-field px-3 py-2.5 text-sm',
                  'placeholder:text-muted-foreground',
                  'focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2',
                  errors.phone && 'border-destructive',
                )}
              />
              {errors.phone && (
                <p className="mt-1 text-xs text-destructive">
                  {errors.phone.message}
                </p>
              )}
            </div>

            {/* Alt Phone */}
            <div>
              <label htmlFor="altPhone" className="block text-sm font-medium mb-1.5">
                Alt. Phone
              </label>
              <input
                id="altPhone"
                type="tel"
                {...register('altPhone')}
                placeholder="Optional alternate number"
                className={cn(
                  'w-full rounded-md border bg-field px-3 py-2.5 text-sm',
                  'placeholder:text-muted-foreground',
                  'focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2',
                )}
              />
            </div>

            {/* Aadhaar Number */}
            <div>
              <label htmlFor="aadhaarNumber" className="block text-sm font-medium mb-1.5">
                Aadhaar Number
              </label>
              <input
                id="aadhaarNumber"
                type="text"
                {...register('aadhaarNumber', {
                  pattern: {
                    value: /^\d{12}$/,
                    message: 'Enter a valid 12-digit Aadhaar number',
                  },
                })}
                placeholder="e.g. 123456789012"
                className={cn(
                  'w-full rounded-md border bg-field px-3 py-2.5 text-sm',
                  'placeholder:text-muted-foreground',
                  'focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2',
                  errors.aadhaarNumber && 'border-destructive',
                )}
              />
              {errors.aadhaarNumber && (
                <p className="mt-1 text-xs text-destructive">
                  {errors.aadhaarNumber.message}
                </p>
              )}
            </div>
          </div>
        </section>

        {/* Section 2: Address */}
        <section className="rounded-lg border bg-card p-6">
          <h2 className="text-lg font-medium mb-4">Address</h2>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {/* Address Line 1 */}
            <div className="sm:col-span-2 lg:col-span-3">
              <label htmlFor="addressLine1" className="block text-sm font-medium mb-1.5">
                Address Line 1
              </label>
              <input
                id="addressLine1"
                type="text"
                {...register('addressLine1')}
                placeholder="Street address, building, floor"
                className={cn(
                  'w-full rounded-md border bg-field px-3 py-2.5 text-sm',
                  'placeholder:text-muted-foreground',
                  'focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2',
                )}
              />
            </div>

            {/* Address Line 2 */}
            <div className="sm:col-span-2 lg:col-span-3">
              <label htmlFor="addressLine2" className="block text-sm font-medium mb-1.5">
                Address Line 2
              </label>
              <input
                id="addressLine2"
                type="text"
                {...register('addressLine2')}
                placeholder="Area, landmark (optional)"
                className={cn(
                  'w-full rounded-md border bg-field px-3 py-2.5 text-sm',
                  'placeholder:text-muted-foreground',
                  'focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2',
                )}
              />
            </div>

            {/* City */}
            <div>
              <label htmlFor="city" className="block text-sm font-medium mb-1.5">
                City
              </label>
              <CityInput
                id="city"
                {...register('city')}
                placeholder="e.g. Delhi"
                className={cn(
                  'w-full rounded-md border bg-field px-3 py-2.5 text-sm',
                  'placeholder:text-muted-foreground',
                  'focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2',
                )}
              />
            </div>

            {/* State */}
            <div>
              <label htmlFor="state" className="block text-sm font-medium mb-1.5">
                State
              </label>
              <select
                id="state"
                {...register('state')}
                className={cn(
                  'w-full appearance-none rounded-md border bg-field px-3 py-2.5 text-sm',
                  'focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2',
                )}
              >
                <option value="">Select State...</option>
                {INDIAN_STATES.map((state) => (
                  <option key={state} value={state}>
                    {state}
                  </option>
                ))}
              </select>
            </div>

            {/* Pincode */}
            <div>
              <label htmlFor="pincode" className="block text-sm font-medium mb-1.5">
                Pincode
              </label>
              <input
                id="pincode"
                type="text"
                {...register('pincode', {
                  pattern: {
                    value: /^[1-9][0-9]{5}$/,
                    message: 'Enter a valid 6-digit pincode',
                  },
                })}
                placeholder="e.g. 110001"
                className={cn(
                  'w-full rounded-md border bg-field px-3 py-2.5 text-sm',
                  'placeholder:text-muted-foreground',
                  'focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2',
                  errors.pincode && 'border-destructive',
                )}
              />
              {errors.pincode && (
                <p className="mt-1 text-xs text-destructive">
                  {errors.pincode.message}
                </p>
              )}
            </div>

            {/* Zone — gated by `view.customer.address.zone` permission.
                Owner & Admin always have it; others see only when granted. */}
            {canSeeZone && (
              <div>
                <label htmlFor="zone" className="block text-sm font-medium mb-1.5">
                  Zone
                </label>
                <select
                  id="zone"
                  {...register('zone')}
                  className={cn(
                    'w-full appearance-none rounded-md border bg-field px-3 py-2.5 text-sm',
                    'focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2',
                  )}
                >
                  <option value="">Select Zone...</option>
                  {ZONE_OPTIONS.map((z) => (
                    <option key={z} value={z}>{z}</option>
                  ))}
                </select>
              </div>
            )}
          </div>
        </section>

        {/* Section 3: Business / B2B */}
        <section className="rounded-lg border bg-card p-6">
          <h2 className="text-lg font-medium mb-4">Customer Type</h2>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            <div>
              <label htmlFor="customerType" className="block text-sm font-medium mb-1.5">
                Type
              </label>
              <select
                id="customerType"
                {...register('customerType')}
                className={cn(
                  'w-full appearance-none rounded-md border bg-field px-3 py-2.5 text-sm',
                  'focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2',
                )}
              >
                <option value="individual">Individual</option>
                <option value="business">Business (B2B)</option>
              </select>
            </div>

            {customerType === 'business' && (
              <>
                <div className="sm:col-span-2 lg:col-span-2">
                  <label htmlFor="businessName" className="block text-sm font-medium mb-1.5">
                    Business Name <span className="text-destructive">*</span>
                  </label>
                  <input
                    id="businessName"
                    type="text"
                    {...register('businessName', {
                      required: customerType === 'business' ? 'Business name is required for B2B' : false,
                    })}
                    placeholder="e.g. Acme Distributors Pvt Ltd"
                    className={cn(
                      'w-full rounded-md border bg-field px-3 py-2.5 text-sm',
                      'placeholder:text-muted-foreground',
                      'focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2',
                      errors.businessName && 'border-destructive',
                    )}
                  />
                  {errors.businessName && (
                    <p className="mt-1 text-xs text-destructive">
                      {errors.businessName.message}
                    </p>
                  )}
                </div>
                <div>
                  <label htmlFor="gstNumber" className="block text-sm font-medium mb-1.5">
                    GSTIN <span className="text-destructive">*</span>
                  </label>
                  <input
                    id="gstNumber"
                    type="text"
                    maxLength={15}
                    {...register('gstNumber', {
                      required: customerType === 'business' ? 'GSTIN is required for B2B' : false,
                      pattern: {
                        value: /^\d{2}[A-Z]{5}\d{4}[A-Z]{1}[A-Z\d]{1}[Z]{1}[A-Z\d]{1}$/,
                        message: 'Enter a valid 15-character GSTIN',
                      },
                    })}
                    placeholder="e.g. 07AAAAA0000A1Z5"
                    className={cn(
                      'w-full rounded-md border bg-field px-3 py-2.5 text-sm uppercase',
                      'placeholder:text-muted-foreground',
                      'focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2',
                      errors.gstNumber && 'border-destructive',
                    )}
                  />
                  {errors.gstNumber && (
                    <p className="mt-1 text-xs text-destructive">
                      {errors.gstNumber.message}
                    </p>
                  )}
                </div>
              </>
            )}
          </div>
        </section>

        {/* Section 4: Guarantor */}
        <section className="rounded-lg border bg-card p-6">
          <h2 className="text-lg font-medium mb-4">Guarantor Link</h2>

          {/* Is Guarantor toggle */}
          <label className="flex items-center gap-3 mb-4 cursor-pointer">
            <input
              type="checkbox"
              {...register('isGuarantor')}
              className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary"
            />
            <span className="text-sm font-medium">
              This is a guarantor record (this person guarantees for others)
            </span>
          </label>

          {/* Guarantor search — only show when NOT a guarantor record */}
          {!isGuarantor && (
            <div>
              <label className="block text-sm font-medium mb-1.5">
                Select Guarantor (optional)
              </label>

              {selectedGuarantor ? (
                <div className="flex items-center justify-between rounded-md border p-3 bg-green-50 dark:bg-green-950/30 border-green-200 dark:border-green-800">
                  <div>
                    <p className="text-sm font-medium text-green-800 dark:text-green-200">
                      {selectedGuarantor.name}
                    </p>
                    <p className="text-xs text-green-600 dark:text-green-400">
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
                    }}
                    className="text-sm text-primary hover:underline"
                  >
                    Change
                  </button>
                </div>
              ) : (
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
                    placeholder="Search guarantor by name or phone (min 2 chars)..."
                    className={cn(
                      'w-full rounded-md border bg-field pl-9 pr-8 py-2.5 text-sm',
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

                  {/* Dropdown results */}
                  {showGuarantorDropdown && debouncedGuarantorSearch.length >= 2 && (
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
              )}
            </div>
          )}
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
                {isEditMode ? 'Update Customer' : 'Save Customer'}
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
