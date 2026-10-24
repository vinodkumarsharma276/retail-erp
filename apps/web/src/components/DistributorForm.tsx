import { useState, useEffect } from 'react';
import { useForm } from 'react-hook-form';
import {
  Loader2,
  Save,
  AlertCircle,
  Building2,
  FileText,
  MapPin,
  Landmark,
  FileSignature,
  Tag,
} from 'lucide-react';
import { cn } from '../lib/utils';
import { useCategoryTreeQuery } from '../hooks/useProducts';
import { CityInput } from './CityInput';
import {
  useDistributorDetailQuery,
  useCreateDistributorMutation,
  useUpdateDistributorMutation,
  useCheckDistributorDuplicates,
} from '../hooks/useDistributors';
import type { Distributor, ProductCategory } from '@retailerp/shared-types';
import {
  useValidationDialog,
  issuesFromFormErrors,
  type ValidationIssue,
} from './ValidationDialog';

/** What each field is called when it is the thing being complained about. */
const FIELD_LABELS: Record<string, string> = {
  companyName: 'Company name',
  contactPerson: 'Contact person',
  phone: 'Phone',
  altPhone: 'Alternate phone',
  email: 'Email',
  gstNumber: 'GST number',
  panNumber: 'PAN number',
  addressLine1: 'Address line 1',
  addressLine2: 'Address line 2',
  city: 'City',
  state: 'State',
  pincode: 'PIN code',
  bankName: 'Bank name',
  bankAccountNumber: 'Bank account number',
  bankIfsc: 'IFSC code',
  bankBranch: 'Branch',
  paymentTerms: 'Payment terms',
  creditLimit: 'Credit limit',
};
import { duplicateFieldLabel } from '@retailerp/shared-utils';
import { Link } from 'react-router-dom';

// ---------------------------------------------------------------------------
// Form values
// ---------------------------------------------------------------------------
interface DistributorFormValues {
  companyName: string;
  contactPerson: string;
  phone: string;
  altPhone: string;
  email: string;
  gstNumber: string;
  panNumber: string;
  addressLine1: string;
  addressLine2: string;
  city: string;
  state: string;
  pincode: string;
  bankName: string;
  bankAccountNumber: string;
  bankIfsc: string;
  bankBranch: string;
  paymentTerms: string;
  creditLimit: number | '';
}

const defaultValues: DistributorFormValues = {
  companyName: '',
  contactPerson: '',
  phone: '',
  altPhone: '',
  email: '',
  gstNumber: '',
  panNumber: '',
  addressLine1: '',
  addressLine2: '',
  city: '',
  state: '',
  pincode: '',
  bankName: '',
  bankAccountNumber: '',
  bankIfsc: '',
  bankBranch: '',
  paymentTerms: '',
  creditLimit: '',
};

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

const SECTION_NAV = [
  { id: 'section-company', label: 'Company Information', Icon: Building2 },
  { id: 'section-tax', label: 'Tax & Legal', Icon: FileText },
  { id: 'section-address', label: 'Address', Icon: MapPin },
  { id: 'section-bank', label: 'Bank Details', Icon: Landmark },
  { id: 'section-terms', label: 'Terms', Icon: FileSignature },
  { id: 'section-categories', label: 'Categories Supplied', Icon: Tag },
];

interface DistributorFormProps {
  /** Present = edit mode; omitted = create mode. */
  distributorId?: string;
  /** Pre-fills company name — used when creating from a failed search. */
  initialCompanyName?: string;
  /** `page` renders the section nav + sticky bars; `dialog` renders a compact scrollable body. */
  layout?: 'page' | 'dialog';
  onSuccess: (distributor: Distributor) => void;
  onCancel: () => void;
}

export function DistributorForm({
  distributorId,
  initialCompanyName,
  layout = 'page',
  onSuccess,
  onCancel,
}: DistributorFormProps) {
  const isEditMode = !!distributorId;
  const isDialog = layout === 'dialog';

  const { data: categoryTree } = useCategoryTreeQuery();
  const rootCategories: ProductCategory[] = categoryTree ?? [];
  const [selectedCategoryIds, setSelectedCategoryIds] = useState<string[]>([]);

  const { data: existingDistributor, isLoading: isLoadingDistributor } =
    useDistributorDetailQuery(distributorId);

  const createMutation = useCreateDistributorMutation();
  const updateMutation = useUpdateDistributorMutation();
  const isSaving = createMutation.isPending || updateMutation.isPending;

  const {
    register,
    handleSubmit,
    reset,
    setError,
    watch,
    formState: { errors },
  } = useForm<DistributorFormValues>({
    defaultValues: { ...defaultValues, companyName: initialCompanyName ?? '' },
  });

  // Pre-fill form when editing
  useEffect(() => {
    if (existingDistributor && isEditMode) {
      reset({
        companyName: existingDistributor.companyName,
        contactPerson: existingDistributor.contactPerson,
        phone: existingDistributor.phone,
        altPhone: existingDistributor.altPhone ?? '',
        email: existingDistributor.email ?? '',
        gstNumber: existingDistributor.gstNumber ?? '',
        panNumber: existingDistributor.panNumber ?? '',
        addressLine1: existingDistributor.addressLine1,
        addressLine2: existingDistributor.addressLine2 ?? '',
        city: existingDistributor.city,
        state: existingDistributor.state,
        pincode: existingDistributor.pincode,
        bankName: existingDistributor.bankName ?? '',
        bankAccountNumber: existingDistributor.bankAccountNumber ?? '',
        bankIfsc: existingDistributor.bankIfsc ?? '',
        bankBranch: existingDistributor.bankBranch ?? '',
        paymentTerms: existingDistributor.paymentTerms ?? '',
        creditLimit: existingDistributor.creditLimit ?? '',
      });
      // Category checkboxes show root categories, so map any leaf back to its root.
      const cats =
        (existingDistributor as any).categories ??
        (existingDistributor as any).distributorCategories ??
        [];
      if (cats.length > 0 && rootCategories.length > 0) {
        const rootIds = new Set<string>();
        for (const dc of cats) {
          const cat = dc.category ?? dc;
          const catId = cat.id ?? dc.categoryId;
          const isRoot = rootCategories.some((rc: any) => rc.id === catId);
          if (isRoot) {
            rootIds.add(catId);
          } else {
            const parentRoot = rootCategories.find((rc: any) =>
              rc.children?.some((child: any) => child.id === catId),
            );
            if (parentRoot) rootIds.add(parentRoot.id);
          }
        }
        setSelectedCategoryIds(Array.from(rootIds));
      }
    }
  }, [existingDistributor, isEditMode, reset, rootCategories]);

  // ------ Already on the books? ------
  const checkDuplicates = useCheckDistributorDuplicates();
  const validation = useValidationDialog();
  /** Set when the person has read the similar-name warning and meant it. */
  const [dismissedSimilar, setDismissedSimilar] = useState(false);

  const watchedIdentity = watch(['companyName', 'phone', 'gstNumber', 'panNumber']);
  const identityKey = watchedIdentity.join('|');
  // Change any of the four and the last answer no longer applies.
  useEffect(() => {
    setDismissedSimilar(false);
  }, [identityKey]);

  /**
   * A field this form refuses is said in front of the person too. On a form
   * this long the message beside the field can be a screen away from the
   * button they pressed.
   */
  const showFieldErrors = (formErrors: Record<string, unknown>) => {
    validation.show(issuesFromFormErrors(formErrors, FIELD_LABELS));
  };

  const toggleCategory = (catId: string) => {
    setSelectedCategoryIds((prev) =>
      prev.includes(catId) ? prev.filter((c) => c !== catId) : [...prev, catId],
    );
  };

  const onSubmit = async (formData: DistributorFormValues) => {
    // Look before writing. A GSTIN, PAN or phone belongs to one business,
    // so one already on file means this is that business again and the
    // record to change is the one that exists. A merely similar name might
    // be, so it is said once and then the person decides.
    if (!dismissedSimilar) {
      try {
        const [report] = await checkDuplicates.mutateAsync([
          {
            companyName: formData.companyName.trim(),
            phone: formData.phone.trim() || null,
            gstNumber: formData.gstNumber.trim() || null,
            panNumber: formData.panNumber.trim() || null,
            excludeId: distributorId,
          },
        ]);

        const issues: ValidationIssue[] = [
          ...(report?.clashes ?? []).map((c) => ({
            severity: 'block' as const,
            title: `The ${duplicateFieldLabel(c.field)} ${c.value} already belongs to ${c.existingName}`,
            field: c.field,
            detail: (
              <>
                A GSTIN, PAN or phone number belongs to one business, so this is that business
                again. Open{' '}
                <Link
                  to={`/distributors/${c.existingId}`}
                  className="font-medium text-foreground underline underline-offset-4"
                >
                  {c.existingName}
                </Link>{' '}
                and bring it up to date instead — or correct the number here if it was typed
                wrong.
              </>
            ),
          })),
          ...((report?.similar.length ?? 0) > 0
            ? [
                {
                  severity: 'warn' as const,
                  title: 'A supplier with a very similar name already exists',
                  field: 'companyName',
                  detail: (
                    <>
                      {report!.similar.map((s) => (
                        <span key={s.existingId} className="mr-2 inline-block">
                          <Link
                            to={`/distributors/${s.existingId}`}
                            className="font-medium text-foreground underline underline-offset-4"
                          >
                            {s.existingName}
                          </Link>
                          <span className="ml-1 text-xs">({Math.round(s.score * 100)}% alike)</span>
                        </span>
                      ))}
                      <span className="mt-1 block">
                        If that is the same business, open it instead of adding a second record.
                      </span>
                    </>
                  ),
                },
              ]
            : []),
        ];

        const stopped = validation.show(issues, {
          proceedLabel: 'It is a different supplier — save anyway',
          // Only reachable when nothing is blocking, so this cannot wave a
          // real clash through.
          onProceed: () => {
            setDismissedSimilar(true);
            void handleSubmit(onSubmit, showFieldErrors)();
          },
        });
        if (stopped) return;
      } catch {
        // The check is a help, not a gate: if it cannot run, saving still
        // can, and the API's own unique constraints are still there.
      }
    }

    const payload: Record<string, unknown> = {
      companyName: formData.companyName.trim(),
      contactPerson: formData.contactPerson.trim(),
      phone: formData.phone.trim(),
      altPhone: formData.altPhone.trim() || undefined,
      email: formData.email.trim() || undefined,
      gstNumber: formData.gstNumber.trim() || undefined,
      panNumber: formData.panNumber.trim() || undefined,
      addressLine1: formData.addressLine1.trim(),
      addressLine2: formData.addressLine2.trim() || undefined,
      city: formData.city.trim(),
      state: formData.state,
      pincode: formData.pincode.trim(),
      bankName: formData.bankName.trim() || undefined,
      bankAccountNumber: formData.bankAccountNumber.trim() || undefined,
      bankIfsc: formData.bankIfsc.trim() || undefined,
      bankBranch: formData.bankBranch.trim() || undefined,
      paymentTerms: formData.paymentTerms.trim() || undefined,
      creditLimit: formData.creditLimit ? Number(formData.creditLimit) : 0,
      categoryIds: selectedCategoryIds,
    };

    const onError = (error: unknown) => {
      const msg = (error as any)?.response?.data?.error ?? '';
      if (msg.includes('GST number')) {
        setError('gstNumber', { type: 'server', message: msg });
      } else if (msg.includes('PAN number')) {
        setError('panNumber', { type: 'server', message: msg });
      } else if (msg.includes('bank account')) {
        setError('bankAccountNumber', { type: 'server', message: msg });
      }
    };

    if (isEditMode && distributorId) {
      updateMutation.mutate(
        { id: distributorId, payload },
        { onSuccess: (updated) => onSuccess(updated as Distributor), onError },
      );
    } else {
      createMutation.mutate(payload, {
        onSuccess: (created) => onSuccess(created as Distributor),
        onError,
      });
    }
  };

  const mutationError = createMutation.error || updateMutation.error;
  const errorMessage = mutationError
    ? (mutationError as any)?.response?.data?.error ??
      (mutationError as any)?.response?.data?.message ??
      'Something went wrong. Please try again.'
    : null;

  // Ctrl+S / Cmd+S to submit
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        if (!isSaving) {
          handleSubmit(onSubmit, showFieldErrors)();
        }
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [isSaving, handleSubmit, onSubmit]);

  if (isEditMode && isLoadingDistributor) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  const inputClass = (hasError?: unknown) =>
    cn(
      'w-full rounded-md border bg-field px-3 py-2.5 text-sm',
      'placeholder:text-muted-foreground',
      'focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2',
      hasError && 'border-destructive',
    );

  const upperInputClass = (hasError?: unknown) =>
    cn(
      'w-full rounded-md border bg-field px-3 py-2.5 text-sm uppercase',
      'placeholder:text-muted-foreground placeholder:normal-case',
      'focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2',
      hasError && 'border-destructive',
    );

  const sectionClass = cn(
    'rounded-lg border bg-card p-4',
    !isDialog && 'scroll-mt-24',
  );

  const formSections = (
    <>
      {/* Section 1: Company Info */}
      <section id="section-company" className={sectionClass}>
        <h2 className="text-sm font-semibold mb-3 flex items-center gap-2 text-muted-foreground uppercase tracking-wide">
          <Building2 className="h-4 w-4 text-primary" />
          Company Information
        </h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          <div className="sm:col-span-2 lg:col-span-1">
            <label htmlFor="companyName" className="block text-sm font-medium mb-1.5">
              Company Name <span className="text-destructive">*</span>
            </label>
            <input
              id="companyName"
              type="text"
              {...register('companyName', { required: 'Company name is required' })}
              placeholder="e.g. Samsung Distributors Pvt. Ltd."
              className={inputClass(errors.companyName)}
            />
            {errors.companyName && (
              <p className="mt-1 text-xs text-destructive">{errors.companyName.message}</p>
            )}
          </div>

          <div>
            <label htmlFor="contactPerson" className="block text-sm font-medium mb-1.5">
              Contact Person <span className="text-destructive">*</span>
            </label>
            <input
              id="contactPerson"
              type="text"
              {...register('contactPerson', { required: 'Contact person is required' })}
              placeholder="e.g. Rajesh Kumar"
              className={inputClass(errors.contactPerson)}
            />
            {errors.contactPerson && (
              <p className="mt-1 text-xs text-destructive">{errors.contactPerson.message}</p>
            )}
          </div>

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
              className={inputClass(errors.phone)}
            />
            {errors.phone && (
              <p className="mt-1 text-xs text-destructive">{errors.phone.message}</p>
            )}
          </div>

          <div>
            <label htmlFor="altPhone" className="block text-sm font-medium mb-1.5">
              Alt. Phone
            </label>
            <input
              id="altPhone"
              type="tel"
              {...register('altPhone')}
              placeholder="Optional alternate number"
              className={inputClass()}
            />
          </div>

          <div>
            <label htmlFor="email" className="block text-sm font-medium mb-1.5">
              Email
            </label>
            <input
              id="email"
              type="email"
              {...register('email', {
                pattern: {
                  value: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
                  message: 'Enter a valid email address',
                },
              })}
              placeholder="e.g. contact@company.com"
              className={inputClass(errors.email)}
            />
            {errors.email && (
              <p className="mt-1 text-xs text-destructive">{errors.email.message}</p>
            )}
          </div>
        </div>
      </section>

      {/* Section 2: Tax & Legal */}
      <section id="section-tax" className={sectionClass}>
        <h2 className="text-sm font-semibold mb-3 flex items-center gap-2 text-muted-foreground uppercase tracking-wide">
          <FileText className="h-4 w-4 text-primary" />
          Tax &amp; Legal
        </h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="gstNumber" className="block text-sm font-medium mb-1.5">
              GST Number
            </label>
            <input
              id="gstNumber"
              type="text"
              {...register('gstNumber', {
                pattern: {
                  value: /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/,
                  message: 'Enter a valid 15-character GST number',
                },
              })}
              placeholder="e.g. 22AAAAA0000A1Z5"
              className={upperInputClass(errors.gstNumber)}
            />
            {errors.gstNumber && (
              <p className="mt-1 text-xs text-destructive">{errors.gstNumber.message}</p>
            )}
          </div>

          <div>
            <label htmlFor="panNumber" className="block text-sm font-medium mb-1.5">
              PAN Number
            </label>
            <input
              id="panNumber"
              type="text"
              {...register('panNumber', {
                pattern: {
                  value: /^[A-Z]{5}[0-9]{4}[A-Z]{1}$/,
                  message: 'Enter a valid 10-character PAN number',
                },
              })}
              placeholder="e.g. AAAAA1234A"
              className={upperInputClass(errors.panNumber)}
            />
            {errors.panNumber && (
              <p className="mt-1 text-xs text-destructive">{errors.panNumber.message}</p>
            )}
          </div>
        </div>
      </section>

      {/* Section 3: Address */}
      <section id="section-address" className={sectionClass}>
        <h2 className="text-sm font-semibold mb-3 flex items-center gap-2 text-muted-foreground uppercase tracking-wide">
          <MapPin className="h-4 w-4 text-primary" />
          Address
        </h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          <div className="sm:col-span-2 lg:col-span-3">
            <label htmlFor="addressLine1" className="block text-sm font-medium mb-1.5">
              Address Line 1 <span className="text-destructive">*</span>
            </label>
            <input
              id="addressLine1"
              type="text"
              {...register('addressLine1', { required: 'Address is required' })}
              placeholder="Street address, building, floor"
              className={inputClass(errors.addressLine1)}
            />
            {errors.addressLine1 && (
              <p className="mt-1 text-xs text-destructive">{errors.addressLine1.message}</p>
            )}
          </div>

          <div className="sm:col-span-2 lg:col-span-3">
            <label htmlFor="addressLine2" className="block text-sm font-medium mb-1.5">
              Address Line 2
            </label>
            <input
              id="addressLine2"
              type="text"
              {...register('addressLine2')}
              placeholder="Area, landmark (optional)"
              className={inputClass()}
            />
          </div>

          <div>
            <label htmlFor="city" className="block text-sm font-medium mb-1.5">
              City <span className="text-destructive">*</span>
            </label>
            <CityInput
              id="city"
              {...register('city', { required: 'City is required' })}
              placeholder="e.g. Delhi"
              className={inputClass(errors.city)}
            />
            {errors.city && (
              <p className="mt-1 text-xs text-destructive">{errors.city.message}</p>
            )}
          </div>

          <div>
            <label htmlFor="state" className="block text-sm font-medium mb-1.5">
              State <span className="text-destructive">*</span>
            </label>
            <select
              id="state"
              {...register('state', { required: 'State is required' })}
              className={cn(
                'w-full appearance-none rounded-md border bg-field px-3 py-2.5 text-sm',
                'focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2',
                errors.state && 'border-destructive',
              )}
            >
              <option value="">Select State...</option>
              {INDIAN_STATES.map((state) => (
                <option key={state} value={state}>
                  {state}
                </option>
              ))}
            </select>
            {errors.state && (
              <p className="mt-1 text-xs text-destructive">{errors.state.message}</p>
            )}
          </div>

          <div>
            <label htmlFor="pincode" className="block text-sm font-medium mb-1.5">
              Pincode <span className="text-destructive">*</span>
            </label>
            <input
              id="pincode"
              type="text"
              {...register('pincode', {
                required: 'Pincode is required',
                pattern: {
                  value: /^[1-9][0-9]{5}$/,
                  message: 'Enter a valid 6-digit pincode',
                },
              })}
              placeholder="e.g. 110001"
              className={inputClass(errors.pincode)}
            />
            {errors.pincode && (
              <p className="mt-1 text-xs text-destructive">{errors.pincode.message}</p>
            )}
          </div>
        </div>
      </section>

      {/* Section 4: Bank Details */}
      <section id="section-bank" className={sectionClass}>
        <h2 className="text-sm font-semibold mb-3 flex items-center gap-2 text-muted-foreground uppercase tracking-wide">
          <Landmark className="h-4 w-4 text-primary" />
          Bank Details
        </h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="bankName" className="block text-sm font-medium mb-1.5">
              Bank Name
            </label>
            <input
              id="bankName"
              type="text"
              {...register('bankName')}
              placeholder="e.g. State Bank of India"
              className={inputClass()}
            />
          </div>

          <div>
            <label htmlFor="bankAccountNumber" className="block text-sm font-medium mb-1.5">
              Account Number
            </label>
            <input
              id="bankAccountNumber"
              type="text"
              {...register('bankAccountNumber')}
              placeholder="Account number"
              className={inputClass(errors.bankAccountNumber)}
            />
            {errors.bankAccountNumber && (
              <p className="text-xs text-destructive mt-1">
                {errors.bankAccountNumber.message}
              </p>
            )}
          </div>

          <div>
            <label htmlFor="bankIfsc" className="block text-sm font-medium mb-1.5">
              IFSC Code
            </label>
            <input
              id="bankIfsc"
              type="text"
              {...register('bankIfsc', {
                pattern: {
                  value: /^[A-Z]{4}0[A-Z0-9]{6}$/,
                  message: 'Enter a valid IFSC code',
                },
              })}
              placeholder="e.g. SBIN0001234"
              className={upperInputClass(errors.bankIfsc)}
            />
            {errors.bankIfsc && (
              <p className="mt-1 text-xs text-destructive">{errors.bankIfsc.message}</p>
            )}
          </div>

          <div>
            <label htmlFor="bankBranch" className="block text-sm font-medium mb-1.5">
              Branch
            </label>
            <input
              id="bankBranch"
              type="text"
              {...register('bankBranch')}
              placeholder="e.g. Connaught Place, Delhi"
              className={inputClass()}
            />
          </div>
        </div>
      </section>

      {/* Section 5: Terms */}
      <section id="section-terms" className={sectionClass}>
        <h2 className="text-sm font-semibold mb-3 flex items-center gap-2 text-muted-foreground uppercase tracking-wide">
          <FileSignature className="h-4 w-4 text-primary" />
          Terms
        </h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="paymentTerms" className="block text-sm font-medium mb-1.5">
              Payment Terms
            </label>
            <input
              id="paymentTerms"
              type="text"
              {...register('paymentTerms')}
              placeholder="e.g. Net 30, COD, etc."
              className={inputClass()}
            />
          </div>

          <div>
            <label htmlFor="creditLimit" className="block text-sm font-medium mb-1.5">
              Credit Limit
            </label>
            <input
              id="creditLimit"
              type="number"
              step="1"
              {...register('creditLimit', {
                min: { value: 0, message: 'Credit limit must be positive' },
              })}
              placeholder="0"
              className={inputClass(errors.creditLimit)}
            />
            {errors.creditLimit && (
              <p className="mt-1 text-xs text-destructive">{errors.creditLimit.message}</p>
            )}
          </div>
        </div>
      </section>

      {/* Section 6: Categories Supplied */}
      <section id="section-categories" className={sectionClass}>
        <h2 className="text-sm font-semibold mb-3 flex items-center gap-2 text-muted-foreground uppercase tracking-wide">
          <Tag className="h-4 w-4 text-primary" />
          Categories Supplied
        </h2>
        {rootCategories.length === 0 ? (
          <p className="text-sm text-muted-foreground">No categories available.</p>
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {rootCategories.map((cat) => (
              <label
                key={cat.id}
                className={cn(
                  'flex items-center gap-2.5 rounded-md border p-3 cursor-pointer transition-colors',
                  selectedCategoryIds.includes(cat.id)
                    ? 'border-primary bg-primary/5'
                    : 'hover:bg-muted',
                )}
              >
                <input
                  type="checkbox"
                  checked={selectedCategoryIds.includes(cat.id)}
                  onChange={() => toggleCategory(cat.id)}
                  className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary"
                />
                <span className="text-sm font-medium">{cat.name}</span>
              </label>
            ))}
          </div>
        )}
      </section>

      {errorMessage && (
        <div className="flex items-center gap-2 rounded-md bg-destructive/10 px-4 py-3 text-sm text-destructive">
          <AlertCircle className="h-4 w-4 shrink-0" />
          {errorMessage}
        </div>
      )}
    </>
  );

  const submitLabel = isEditMode ? 'Update' : 'Save Distributor';

  if (isDialog) {
    return (
      <form onSubmit={handleSubmit(onSubmit, showFieldErrors)} className="flex min-h-0 flex-1 flex-col">
        {validation.dialog}
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">{formSections}</div>
        <div className="flex items-center justify-end gap-2 border-t bg-card p-4">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-md border px-4 py-2 text-sm font-medium text-muted-foreground hover:bg-muted transition-colors"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={isSaving}
            className={cn(
              'flex items-center justify-center gap-2 rounded-md bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground',
              'hover:bg-primary/90 transition-colors',
              'disabled:opacity-50 disabled:cursor-not-allowed',
            )}
          >
            {isSaving ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Saving…
              </>
            ) : (
              <>
                <Save className="h-4 w-4" />
                {submitLabel}
              </>
            )}
          </button>
        </div>
      </form>
    );
  }

  return (
    <form
      onSubmit={handleSubmit(onSubmit, showFieldErrors)}
      className="grid grid-cols-1 gap-4 lg:grid-cols-12 lg:gap-6"
    >
      {validation.dialog}
      <div className="space-y-4 lg:col-span-9">{formSections}</div>

      <aside className="lg:col-span-3">
        <div className="space-y-3 lg:sticky lg:top-4">
          <nav className="hidden lg:block rounded-lg border bg-card p-3">
            <p className="px-2 pb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              On this page
            </p>
            <ul className="space-y-0.5 text-sm">
              {SECTION_NAV.map(({ id, label, Icon }) => (
                <li key={id}>
                  <a
                    href={`#${id}`}
                    className="flex items-center gap-2 rounded-md px-2 py-1.5 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
                  >
                    <Icon className="h-3.5 w-3.5" />
                    <span>{label}</span>
                  </a>
                </li>
              ))}
            </ul>
          </nav>

          <div className="hidden lg:flex lg:flex-col lg:gap-2">
            <button
              type="submit"
              disabled={isSaving}
              title="Save (Ctrl+S)"
              className={cn(
                'flex w-full items-center justify-center gap-2 rounded-md bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground',
                'hover:bg-primary/90 transition-colors',
                'disabled:opacity-50 disabled:cursor-not-allowed',
              )}
            >
              {isSaving ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Saving…
                </>
              ) : (
                <>
                  <Save className="h-4 w-4" />
                  {submitLabel}
                </>
              )}
            </button>
            <button
              type="button"
              onClick={onCancel}
              className="w-full rounded-md border px-4 py-2 text-sm font-medium text-muted-foreground hover:bg-muted transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      </aside>

      <div className="fixed inset-x-0 bottom-0 z-30 border-t bg-card p-3 shadow-lg lg:hidden">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-md border px-3 py-2 text-sm font-medium text-muted-foreground hover:bg-muted transition-colors"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={isSaving}
            className={cn(
              'flex flex-1 items-center justify-center gap-2 rounded-md bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground',
              'hover:bg-primary/90 transition-colors',
              'disabled:opacity-50 disabled:cursor-not-allowed',
            )}
          >
            {isSaving ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Saving…
              </>
            ) : (
              <>
                <Save className="h-4 w-4" />
                {submitLabel}
              </>
            )}
          </button>
        </div>
      </div>
    </form>
  );
}
