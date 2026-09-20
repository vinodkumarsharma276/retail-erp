import { useState, useMemo } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Loader2,
  AlertCircle,
  ShieldCheck,
  Copy,
} from 'lucide-react';
import { cn } from '../../lib/utils';
import {
  useCreateTenantMutation,
  usePlansListQuery,
  type CreateTenantPayload,
  type PlanListItem,
} from '../../hooks/usePlatform';

type Step = 'tenant' | 'plan' | 'owner' | 'shop' | 'review';

const STEPS: { id: Step; label: string }[] = [
  { id: 'tenant', label: 'Tenant' },
  { id: 'plan', label: 'Plan' },
  { id: 'owner', label: 'Owner user' },
  { id: 'shop', label: 'First shop' },
  { id: 'review', label: 'Review' },
];

interface FormState {
  // Tenant
  slug: string;
  name: string;
  contactEmail: string;
  contactPhone: string;
  gstNumber: string;
  trialEndsAt: string;
  // Plan
  planCode: string;
  // Owner
  ownerUsername: string;
  ownerPassword: string;
  ownerFullName: string;
  ownerEmail: string;
  ownerPhone: string;
  // Initial shop (optional)
  createShop: boolean;
  shopCode: string;
  shopName: string;
  shopGst: string;
  shopPan: string;
  shopAddress1: string;
  shopCity: string;
  shopState: string;
  shopPincode: string;
  shopPhone: string;
}

const emptyForm: FormState = {
  slug: '',
  name: '',
  contactEmail: '',
  contactPhone: '',
  gstNumber: '',
  trialEndsAt: '',
  planCode: '',
  ownerUsername: '',
  ownerPassword: '',
  ownerFullName: '',
  ownerEmail: '',
  ownerPhone: '',
  createShop: false,
  shopCode: '',
  shopName: '',
  shopGst: '',
  shopPan: '',
  shopAddress1: '',
  shopCity: '',
  shopState: '',
  shopPincode: '',
  shopPhone: '',
};

const slugRegex = /^[a-z][a-z0-9-]{1,62}$/;
const gstRegex = /^[a-zA-Z0-9]{15}$/;
const pincodeRegex = /^\d{6}$/;
const panRegex = /^[A-Z]{5}\d{4}[A-Z]$/i;

export function TenantOnboardPage() {
  const navigate = useNavigate();
  const [step, setStep] = useState<Step>('tenant');
  const [form, setForm] = useState<FormState>(emptyForm);
  const plansQuery = usePlansListQuery();
  const createMutation = useCreateTenantMutation();

  // Success modal payload — shows the temporary password we never store.
  const [created, setCreated] = useState<{
    slug: string;
    name: string;
    ownerUsername: string;
    ownerPassword: string;
  } | null>(null);

  const update = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  const stepIndex = STEPS.findIndex((s) => s.id === step);

  const errors = useMemo(() => validateStep(step, form), [step, form]);
  const canAdvance = Object.keys(errors).length === 0;

  const handleNext = () => {
    if (!canAdvance) return;
    const next = STEPS[stepIndex + 1];
    if (next) setStep(next.id);
  };
  const handleBack = () => {
    const prev = STEPS[stepIndex - 1];
    if (prev) setStep(prev.id);
  };

  const handleSubmit = () => {
    if (!canAdvance) return;
    const payload: CreateTenantPayload = {
      slug: form.slug.trim(),
      name: form.name.trim(),
      contactEmail: form.contactEmail.trim() || null,
      contactPhone: form.contactPhone.trim() || null,
      gstNumber: form.gstNumber.trim() || null,
      planCode: form.planCode,
      trialEndsAt: form.trialEndsAt ? new Date(form.trialEndsAt).toISOString() : null,
      owner: {
        username: form.ownerUsername.trim(),
        password: form.ownerPassword,
        fullName: form.ownerFullName.trim(),
        email: form.ownerEmail.trim() || null,
        phone: form.ownerPhone.trim(),
      },
      initialShop: form.createShop
        ? {
            code: form.shopCode.trim(),
            name: form.shopName.trim(),
            gstNumber: form.shopGst.trim(),
            panNumber: form.shopPan.trim().toUpperCase(),
            addressLine1: form.shopAddress1.trim(),
            city: form.shopCity.trim(),
            state: form.shopState.trim(),
            pincode: form.shopPincode.trim(),
            phone: form.shopPhone.trim(),
          }
        : undefined,
    };

    createMutation.mutate(payload, {
      onSuccess: (data) => {
        setCreated({
          slug: data.tenant.slug,
          name: data.tenant.name,
          ownerUsername: data.owner.username,
          ownerPassword: form.ownerPassword,
        });
      },
    });
  };

  const apiError = createMutation.error
    ? (createMutation.error as any)?.response?.data?.error ??
      (createMutation.error as any)?.response?.data?.message ??
      'Failed to onboard tenant.'
    : null;

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div className="flex items-center gap-3">
        <Link
          to="/tenants"
          className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <div>
          <h1 className="text-2xl font-semibold">Onboard tenant</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Create a new customer organisation.
          </p>
        </div>
      </div>

      {/* Stepper */}
      <ol className="flex items-center gap-1 text-xs">
        {STEPS.map((s, idx) => (
          <li key={s.id} className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => idx <= stepIndex && setStep(s.id)}
              className={cn(
                'flex items-center gap-1.5 rounded-full px-2.5 py-1 transition-colors',
                idx === stepIndex
                  ? 'bg-amber-600 text-white'
                  : idx < stepIndex
                    ? 'bg-amber-100 dark:bg-amber-950/30 text-amber-700 dark:text-amber-400 hover:bg-amber-200 cursor-pointer'
                    : 'bg-muted text-muted-foreground',
              )}
            >
              {idx < stepIndex && <Check className="h-3 w-3" />}
              <span>{idx + 1}.</span>
              {s.label}
            </button>
            {idx < STEPS.length - 1 && <div className="h-px w-3 bg-border" />}
          </li>
        ))}
      </ol>

      {/* Body */}
      <div className="rounded-lg border bg-card p-6 space-y-5">
        {step === 'tenant' && (
          <TenantStep form={form} update={update} errors={errors} />
        )}
        {step === 'plan' && (
          <PlanStep form={form} update={update} plans={plansQuery.data ?? []} loading={plansQuery.isLoading} errors={errors} />
        )}
        {step === 'owner' && (
          <OwnerStep form={form} update={update} errors={errors} />
        )}
        {step === 'shop' && (
          <ShopStep form={form} update={update} errors={errors} />
        )}
        {step === 'review' && (
          <ReviewStep form={form} plans={plansQuery.data ?? []} />
        )}
      </div>

      {apiError && (
        <div className="flex items-center gap-2 rounded-md border border-red-300 bg-red-50 dark:bg-red-950/30 px-4 py-3 text-sm text-red-700 dark:text-red-300">
          <AlertCircle className="h-4 w-4" />
          {apiError}
        </div>
      )}

      {/* Footer nav */}
      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={handleBack}
          disabled={stepIndex === 0}
          className="flex items-center gap-1.5 rounded-md border bg-background px-3 py-2 text-sm font-medium hover:bg-muted transition-colors disabled:opacity-50"
        >
          <ArrowLeft className="h-4 w-4" />
          Back
        </button>
        {step === 'review' ? (
          <button
            type="button"
            onClick={handleSubmit}
            disabled={createMutation.isPending || !canAdvance}
            className={cn(
              'flex items-center gap-2 rounded-md bg-amber-600 px-4 py-2 text-sm font-medium text-white',
              'hover:bg-amber-700 transition-colors',
              'disabled:opacity-50 disabled:cursor-not-allowed',
            )}
          >
            {createMutation.isPending ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Onboarding…
              </>
            ) : (
              <>
                <ShieldCheck className="h-4 w-4" />
                Onboard tenant
              </>
            )}
          </button>
        ) : (
          <button
            type="button"
            onClick={handleNext}
            disabled={!canAdvance}
            className={cn(
              'flex items-center gap-1.5 rounded-md bg-amber-600 px-3 py-2 text-sm font-medium text-white',
              'hover:bg-amber-700 transition-colors',
              'disabled:opacity-50 disabled:cursor-not-allowed',
            )}
          >
            Next
            <ArrowRight className="h-4 w-4" />
          </button>
        )}
      </div>

      {/* Success modal */}
      {created && (
        <SuccessModal
          created={created}
          onClose={() => {
            setCreated(null);
            navigate('/tenants');
          }}
        />
      )}
    </div>
  );
}

// ─── Step components ────────────────────────────────────────────────────────

interface StepProps {
  form: FormState;
  update: <K extends keyof FormState>(key: K, value: FormState[K]) => void;
  errors: Record<string, string>;
}

function TenantStep({ form, update, errors }: StepProps) {
  return (
    <>
      <SectionTitle title="Tenant details" subtitle="Identity + subdomain." />
      <Field label="Subdomain slug" error={errors.slug} required hint="Used as the subdomain (e.g. acme.retailerp.com). Lowercase letters, digits, hyphens.">
        <input
          value={form.slug}
          onChange={(e) => update('slug', e.target.value.toLowerCase())}
          placeholder="acme"
          className="w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500/50"
        />
      </Field>
      <Field label="Display name" error={errors.name} required>
        <input
          value={form.name}
          onChange={(e) => update('name', e.target.value)}
          placeholder="Acme Retail Pvt Ltd"
          className="w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500/50"
        />
      </Field>
      <div className="grid grid-cols-2 gap-4">
        <Field label="Contact email" error={errors.contactEmail}>
          <input
            type="email"
            value={form.contactEmail}
            onChange={(e) => update('contactEmail', e.target.value)}
            placeholder="ops@acme.com"
            className="w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500/50"
          />
        </Field>
        <Field label="Contact phone">
          <input
            value={form.contactPhone}
            onChange={(e) => update('contactPhone', e.target.value)}
            placeholder="+91…"
            className="w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500/50"
          />
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <Field label="GSTIN" error={errors.gstNumber}>
          <input
            value={form.gstNumber}
            onChange={(e) => update('gstNumber', e.target.value.toUpperCase())}
            placeholder="15-char GSTIN (optional)"
            className="w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500/50"
          />
        </Field>
        <Field label="Trial ends at" hint="Leave blank for a non-trial active tenant.">
          <input
            type="date"
            value={form.trialEndsAt}
            onChange={(e) => update('trialEndsAt', e.target.value)}
            className="w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500/50"
          />
        </Field>
      </div>
    </>
  );
}

function PlanStep({
  form,
  update,
  plans,
  loading,
  errors,
}: StepProps & { plans: PlanListItem[]; loading: boolean }) {
  return (
    <>
      <SectionTitle title="Plan" subtitle="Choose the pricing tier. Drives default feature flags; per-tenant overrides can be set after onboarding." />
      {loading && (
        <div className="flex items-center justify-center py-8">
          <Loader2 className="h-5 w-5 animate-spin text-amber-600" />
        </div>
      )}
      {!loading && plans.length === 0 && (
        <div className="rounded-md border border-amber-300 bg-amber-50 dark:bg-amber-950/30 px-4 py-3 text-sm text-amber-800 dark:text-amber-200">
          No plans defined yet. Visit <Link to="/plans" className="underline">Plans</Link> to create one first.
        </div>
      )}
      <div className="grid gap-3">
        {plans.map((p) => {
          const selected = form.planCode === p.code;
          return (
            <button
              key={p.id}
              type="button"
              onClick={() => update('planCode', p.code)}
              className={cn(
                'rounded-lg border px-4 py-3 text-left transition-colors',
                selected
                  ? 'border-amber-500 ring-2 ring-amber-500/30 bg-amber-50 dark:bg-amber-950/20'
                  : 'hover:bg-muted',
              )}
            >
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-medium">{p.name}</p>
                  <p className="text-xs text-muted-foreground">{p.code}</p>
                </div>
                <div className="text-right">
                  <p className="text-sm font-medium">₹{Number(p.priceMonthly).toLocaleString('en-IN')}/mo</p>
                  <p className="text-xs text-muted-foreground">
                    {p.features.filter((f) => f.enabled).length} features enabled
                  </p>
                </div>
              </div>
              {p.description && (
                <p className="mt-1 text-xs text-muted-foreground">{p.description}</p>
              )}
            </button>
          );
        })}
      </div>
      {errors.planCode && (
        <p className="text-xs text-red-600">{errors.planCode}</p>
      )}
    </>
  );
}

function OwnerStep({ form, update, errors }: StepProps) {
  return (
    <>
      <SectionTitle title="Initial owner user" subtitle="This account can log in to the tenant subdomain immediately. Share the temporary password through a secure channel." />
      <div className="grid grid-cols-2 gap-4">
        <Field label="Username" error={errors.ownerUsername} required>
          <input
            value={form.ownerUsername}
            onChange={(e) => update('ownerUsername', e.target.value)}
            placeholder="acme_admin"
            className="w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500/50"
          />
        </Field>
        <Field label="Temporary password" error={errors.ownerPassword} required hint="Min 8 characters. The user must change it on first login.">
          <input
            type="text"
            value={form.ownerPassword}
            onChange={(e) => update('ownerPassword', e.target.value)}
            placeholder="At least 8 characters"
            className="w-full rounded-md border bg-background px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-amber-500/50"
          />
        </Field>
      </div>
      <Field label="Full name" error={errors.ownerFullName} required>
        <input
          value={form.ownerFullName}
          onChange={(e) => update('ownerFullName', e.target.value)}
          placeholder="Jane Doe"
          className="w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500/50"
        />
      </Field>
      <div className="grid grid-cols-2 gap-4">
        <Field label="Email" error={errors.ownerEmail}>
          <input
            type="email"
            value={form.ownerEmail}
            onChange={(e) => update('ownerEmail', e.target.value)}
            placeholder="jane@acme.com"
            className="w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500/50"
          />
        </Field>
        <Field label="Phone" error={errors.ownerPhone} required>
          <input
            value={form.ownerPhone}
            onChange={(e) => update('ownerPhone', e.target.value)}
            placeholder="+91…"
            className="w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500/50"
          />
        </Field>
      </div>
    </>
  );
}

function ShopStep({ form, update, errors }: StepProps) {
  return (
    <>
      <SectionTitle
        title="First shop (optional)"
        subtitle="Pre-create one shop so the owner can start operating immediately. They can add more shops later from inside the tenant app."
      />
      <label className="flex items-center gap-2 text-sm cursor-pointer">
        <input
          type="checkbox"
          checked={form.createShop}
          onChange={(e) => update('createShop', e.target.checked)}
          className="rounded border accent-amber-600"
        />
        Create an initial shop now
      </label>
      {form.createShop && (
        <div className="space-y-4 pt-2">
          <div className="grid grid-cols-3 gap-4">
            <Field label="Shop code" error={errors.shopCode} required>
              <input
                value={form.shopCode}
                onChange={(e) => update('shopCode', e.target.value.toUpperCase())}
                placeholder="HQ"
                className="w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500/50"
              />
            </Field>
            <Field label="Shop name" error={errors.shopName} required>
              <input
                value={form.shopName}
                onChange={(e) => update('shopName', e.target.value)}
                placeholder="Acme HQ"
                className="w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500/50"
              />
            </Field>
            <Field label="Phone" error={errors.shopPhone} required>
              <input
                value={form.shopPhone}
                onChange={(e) => update('shopPhone', e.target.value)}
                placeholder="+91…"
                className="w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500/50"
              />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <Field label="GSTIN (15 chars)" error={errors.shopGst} required>
              <input
                value={form.shopGst}
                onChange={(e) => update('shopGst', e.target.value.toUpperCase())}
                className="w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500/50"
              />
            </Field>
            <Field label="PAN (10 chars)" error={errors.shopPan} required>
              <input
                value={form.shopPan}
                onChange={(e) => update('shopPan', e.target.value.toUpperCase())}
                className="w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500/50"
              />
            </Field>
          </div>
          <Field label="Address line 1" error={errors.shopAddress1} required>
            <input
              value={form.shopAddress1}
              onChange={(e) => update('shopAddress1', e.target.value)}
              className="w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500/50"
            />
          </Field>
          <div className="grid grid-cols-3 gap-4">
            <Field label="City" error={errors.shopCity} required>
              <input
                value={form.shopCity}
                onChange={(e) => update('shopCity', e.target.value)}
                className="w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500/50"
              />
            </Field>
            <Field label="State" error={errors.shopState} required>
              <input
                value={form.shopState}
                onChange={(e) => update('shopState', e.target.value)}
                className="w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500/50"
              />
            </Field>
            <Field label="Pincode (6 digits)" error={errors.shopPincode} required>
              <input
                value={form.shopPincode}
                onChange={(e) => update('shopPincode', e.target.value)}
                className="w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500/50"
              />
            </Field>
          </div>
        </div>
      )}
    </>
  );
}

function ReviewStep({ form, plans }: { form: FormState; plans: PlanListItem[] }) {
  const plan = plans.find((p) => p.code === form.planCode);
  return (
    <>
      <SectionTitle title="Review & onboard" subtitle="Verify the details before creating the tenant." />
      <DescGrid>
        <Desc label="Slug" value={<code className="rounded bg-muted px-1.5 py-0.5 text-xs">{form.slug}</code>} />
        <Desc label="Name" value={form.name} />
        <Desc label="Plan" value={plan ? `${plan.name} (${plan.code})` : form.planCode} />
        <Desc label="Trial" value={form.trialEndsAt ? `ends ${form.trialEndsAt}` : 'None — Active immediately'} />
        <Desc label="Contact email" value={form.contactEmail || '—'} />
        <Desc label="Contact phone" value={form.contactPhone || '—'} />
        <Desc label="GSTIN" value={form.gstNumber || '—'} />
      </DescGrid>
      <h3 className="text-sm font-semibold pt-4">Initial owner user</h3>
      <DescGrid>
        <Desc label="Username" value={<code className="rounded bg-muted px-1.5 py-0.5 text-xs">{form.ownerUsername}</code>} />
        <Desc label="Full name" value={form.ownerFullName} />
        <Desc label="Email" value={form.ownerEmail || '—'} />
        <Desc label="Phone" value={form.ownerPhone} />
      </DescGrid>
      <h3 className="text-sm font-semibold pt-4">Initial shop</h3>
      {form.createShop ? (
        <DescGrid>
          <Desc label="Code" value={form.shopCode} />
          <Desc label="Name" value={form.shopName} />
          <Desc label="GSTIN" value={form.shopGst} />
          <Desc label="PAN" value={form.shopPan} />
          <Desc label="Address" value={`${form.shopAddress1}, ${form.shopCity}, ${form.shopState} ${form.shopPincode}`} />
        </DescGrid>
      ) : (
        <p className="text-sm text-muted-foreground">No initial shop — the owner will create one inside the tenant app.</p>
      )}
    </>
  );
}

// ─── Validation ─────────────────────────────────────────────────────────────

function validateStep(step: Step, form: FormState): Record<string, string> {
  const e: Record<string, string> = {};
  if (step === 'tenant' || step === 'review') {
    if (!slugRegex.test(form.slug)) e.slug = 'Slug must be lowercase, alphanumeric + hyphens, start with a letter (2–63 chars)';
    if (!form.name.trim()) e.name = 'Required';
    if (form.contactEmail && !/^.+@.+\..+$/.test(form.contactEmail)) e.contactEmail = 'Invalid email';
    if (form.gstNumber && !gstRegex.test(form.gstNumber)) e.gstNumber = 'GSTIN must be 15 alphanumeric characters';
  }
  if (step === 'plan' || step === 'review') {
    if (!form.planCode) e.planCode = 'Select a plan';
  }
  if (step === 'owner' || step === 'review') {
    if (!form.ownerUsername.trim()) e.ownerUsername = 'Required';
    if (form.ownerPassword.length < 8) e.ownerPassword = 'At least 8 characters';
    if (!form.ownerFullName.trim()) e.ownerFullName = 'Required';
    if (form.ownerEmail && !/^.+@.+\..+$/.test(form.ownerEmail)) e.ownerEmail = 'Invalid email';
    if (!form.ownerPhone.trim()) e.ownerPhone = 'Required';
  }
  if ((step === 'shop' || step === 'review') && form.createShop) {
    if (!form.shopCode.trim()) e.shopCode = 'Required';
    if (!form.shopName.trim()) e.shopName = 'Required';
    if (!gstRegex.test(form.shopGst)) e.shopGst = '15 alphanumeric chars';
    if (!panRegex.test(form.shopPan)) e.shopPan = 'Invalid PAN';
    if (!form.shopAddress1.trim()) e.shopAddress1 = 'Required';
    if (!form.shopCity.trim()) e.shopCity = 'Required';
    if (!form.shopState.trim()) e.shopState = 'Required';
    if (!pincodeRegex.test(form.shopPincode)) e.shopPincode = '6 digits';
    if (!form.shopPhone.trim()) e.shopPhone = 'Required';
  }
  return e;
}

// ─── Small UI primitives (kept local to this page) ──────────────────────────

function SectionTitle({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div className="space-y-0.5">
      <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
        {title}
      </h2>
      {subtitle && <p className="text-xs text-muted-foreground">{subtitle}</p>}
    </div>
  );
}

function Field({
  label,
  required,
  hint,
  error,
  children,
}: {
  label: string;
  required?: boolean;
  hint?: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="block text-xs font-medium text-muted-foreground mb-1">
        {label} {required && <span className="text-red-500">*</span>}
      </label>
      {children}
      {hint && !error && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
      {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
    </div>
  );
}

function DescGrid({ children }: { children: React.ReactNode }) {
  return <dl className="grid grid-cols-2 gap-3 text-sm">{children}</dl>;
}

function Desc({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="font-medium mt-0.5 break-all">{value}</dd>
    </div>
  );
}

function SuccessModal({
  created,
  onClose,
}: {
  created: { slug: string; name: string; ownerUsername: string; ownerPassword: string };
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(created.ownerPassword);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* noop */
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-md rounded-lg border bg-card p-6 shadow-xl">
        <div className="flex items-center gap-2 mb-3 text-green-700 dark:text-green-400">
          <Check className="h-5 w-5" />
          <h2 className="text-lg font-semibold">Tenant onboarded</h2>
        </div>
        <p className="text-sm text-muted-foreground mb-4">
          <strong>{created.name}</strong> is now active at{' '}
          <code className="rounded bg-muted px-1 py-0.5 text-xs">{created.slug}</code>. Share these
          credentials with the customer through a secure channel — they are not stored anywhere
          else.
        </p>
        <div className="space-y-2 rounded-md border bg-muted/30 p-3 text-sm">
          <div>
            <span className="text-xs text-muted-foreground">Username</span>
            <p className="font-mono">{created.ownerUsername}</p>
          </div>
          <div>
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground">Temporary password</span>
              <button
                onClick={copy}
                className="flex items-center gap-1 rounded px-1.5 py-0.5 text-xs text-amber-700 hover:bg-amber-100 dark:hover:bg-amber-950/30"
              >
                <Copy className="h-3 w-3" />
                {copied ? 'Copied' : 'Copy'}
              </button>
            </div>
            <p className="font-mono break-all">{created.ownerPassword}</p>
          </div>
        </div>
        <button
          onClick={onClose}
          className="mt-5 w-full rounded-md bg-amber-600 px-4 py-2 text-sm font-medium text-white hover:bg-amber-700 transition-colors"
        >
          Done
        </button>
      </div>
    </div>
  );
}
