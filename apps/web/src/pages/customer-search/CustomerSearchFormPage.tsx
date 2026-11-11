import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Check, UserCheck, UserPlus } from 'lucide-react';
import { formatPhone } from '@retailerp/shared-utils';
import { PageHeader } from '../../components/PageHeader';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Select } from '../../components/ui/select';
import { Badge } from '../../components/ui/badge';
import { Card } from '../../components/ui/card';
import { LoadingSpinner } from '../../components/LoadingSpinner';
import { CategoryCascader } from '../../components/CategoryCascader';
import { BrandInput } from '../../components/BrandInput';
import { ModelAutocomplete } from '../../components/ModelAutocomplete';
import { cn } from '../../lib/utils';
import { useDebounce } from '../../hooks/useDebounce';
import { useMeQuery } from '../../hooks/useAuth';
import { useToast } from '../../stores/toast-store';
import { useShopStore } from '../../stores/shop-store';
import {
  apiErrorMessage,
  takenSuggestion,
  isTakenNumber,
  useCreateEntryMutation,
  useCustomerMatchesQuery,
  useCustomerSearchEntryQuery,
  useNextNumberQuery,
  usePrefixesQuery,
  useUpdateEntryMutation,
  type CustomerMatch,
  type EntryPayload,
} from '../../hooks/useCustomerSearch';
import { useRegisterListUrl } from './registerListUrl';

const NEW_PREFIX = '__new__';
const today = () => new Date().toISOString().slice(0, 10);

interface FormState {
  accountNumber: string;
  customerName: string;
  mobile: string;
  address: string;
  area: string;
  coName: string;
  coMobile: string;
  purchaseDate: string;
  categoryId: string;
  product: string;
  brand: string;
  model: string;
  customerId: string | null;
  coCustomerId: string | null;
  shopId: string;
}

const EMPTY: FormState = {
  accountNumber: '', customerName: '', mobile: '', address: '', area: '', coName: '', coMobile: '',
  purchaseDate: today(), categoryId: '', product: '', brand: '', model: '', customerId: null, coCustomerId: null, shopId: '',
};

function Field({ label, hint, required, children, className }: { label: string; hint?: ReactNode; required?: boolean; children: ReactNode; className?: string }) {
  return (
    <div className={className}>
      <label className="mb-1.5 block text-sm font-medium">
        {label}
        {required && <span className="text-destructive"> *</span>}
      </label>
      {children}
      {hint && <div className="mt-1 text-xs text-muted-foreground">{hint}</div>}
    </div>
  );
}

/**
 * Customers already on the typed mobile. Picking one files the entry under
 * them; a close spelling that wasn't picked gets a "did you mean" nudge.
 */
function MatchList({
  mobile,
  name,
  selectedId,
  onPick,
}: {
  mobile: string;
  name: string;
  selectedId: string | null;
  onPick: (match: CustomerMatch | null) => void;
}) {
  const debouncedName = useDebounce(name, 300);
  const matches = useCustomerMatchesQuery(mobile, debouncedName);
  const list = matches.data ?? [];
  if (mobile.replace(/\D/g, '').length < 10 || list.length === 0) return null;

  const exact = list.find((m) => m.exact);
  const nearMiss = !selectedId && !exact && debouncedName.trim() ? list.find((m) => (m.score ?? 0) >= 0.5) : undefined;

  return (
    <div className="mt-2 rounded-md border bg-muted/40 p-2">
      {nearMiss && (
        <div className="mb-2 flex flex-wrap items-center gap-2 rounded-md bg-warning-muted px-2 py-1.5 text-sm text-warning">
          Did you mean <strong>{nearMiss.name}</strong> ({nearMiss.customerCode})?
          <Button size="xs" variant="secondary" type="button" onClick={() => onPick(nearMiss)}>
            Yes, same person
          </Button>
        </div>
      )}
      <p className="mb-1 text-xs font-medium text-muted-foreground">Already on this mobile</p>
      <ul className="space-y-1">
        {list.map((m) => {
          const picked = selectedId === m.id || (!selectedId && m.exact);
          return (
            <li key={m.id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
              <span className="min-w-0">
                <span className="font-medium">{m.name}</span>{' '}
                <span className="font-mono text-xs text-muted-foreground">{m.customerCode}</span>
                {m.itemCount > 0 && <Badge tone="info" className="ml-1.5">{m.itemCount} items</Badge>}
                {m.addressLine1 && <span className="block truncate text-xs text-muted-foreground">{[m.addressLine1, m.addressLine2].filter(Boolean).join(', ')}</span>}
              </span>
              {picked ? (
                <span className="inline-flex items-center gap-1 text-xs font-medium text-success">
                  <Check className="h-3.5 w-3.5" /> {selectedId === m.id ? 'Selected' : 'Same name — will link'}
                </span>
              ) : (
                <Button size="xs" variant="ghost" type="button" onClick={() => onPick(m)}>
                  Use
                </Button>
              )}
            </li>
          );
        })}
      </ul>
      {selectedId && (
        <button type="button" className="mt-1 text-xs text-primary hover:underline" onClick={() => onPick(null)}>
          Not them — a new customer
        </button>
      )}
    </div>
  );
}

export function CustomerSearchFormPage() {
  const { id } = useParams<{ id: string }>();
  const isEdit = !!id;
  const navigate = useNavigate();
  const listUrl = useRegisterListUrl();
  /** Back to the entry (when editing) or the list view this started from. */
  const goBack = () => navigate(isEdit ? `/customer-search/${id}` : listUrl, { state: { listUrl } });
  const toast = useToast();
  const [form, setForm] = useState<FormState>(EMPTY);
  const [loaded, setLoaded] = useState(!isEdit);
  const [prefixChoice, setPrefixChoice] = useState('');
  const [newPrefix, setNewPrefix] = useState('');
  const [numberTouched, setNumberTouched] = useState(false);
  // On edit, an entry keeps its type (even an imported top-level one) unless the picker is used.
  const [typeTouched, setTypeTouched] = useState(false);
  const [error, setError] = useState<{ message: string; suggestion: string | null; taken: boolean } | null>(null);
  const me = useMeQuery();
  const shops = me.data?.shops ?? [];
  const currentShopId = useShopStore((s) => s.currentShopId);

  const entry = useCustomerSearchEntryQuery(id);
  const prefixes = usePrefixesQuery(!isEdit);
  const activePrefix = prefixChoice === NEW_PREFIX ? newPrefix.trim().toUpperCase() : prefixChoice;
  const next = useNextNumberQuery(activePrefix, !isEdit);
  const createMutation = useCreateEntryMutation();
  const updateMutation = useUpdateEntryMutation();
  const saving = createMutation.isPending || updateMutation.isPending;

  useEffect(() => {
    if (!isEdit || !entry.data || loaded) return;
    const e = entry.data;
    setForm({
      accountNumber: e.accountNumber,
      customerName: e.customerName,
      mobile: e.mobile ?? '',
      address: e.address ?? '',
      area: e.area ?? '',
      coName: e.coName ?? '',
      coMobile: e.coMobile ?? '',
      purchaseDate: e.purchaseDate ?? '',
      categoryId: e.categoryId ?? '',
      product: e.product ?? '',
      brand: e.brand ?? '',
      model: e.model ?? '',
      customerId: null,
      coCustomerId: null,
      shopId: e.shopId,
    });
    setLoaded(true);
  }, [isEdit, entry.data, loaded]);

  // A new entry belongs to the shop the person is working in, until they pick another.
  useEffect(() => {
    if (isEdit || form.shopId || !shops.length) return;
    const start = shops.find((s) => s.id === currentShopId) ?? shops[0];
    setForm((f) => ({ ...f, shopId: start.id }));
  }, [isEdit, form.shopId, shops, currentShopId]);

  // A new entry takes the series' next number until the person types their own.
  useEffect(() => {
    if (!isEdit && !numberTouched && next.data) setForm((f) => ({ ...f, accountNumber: next.data!.nextAccountNumber }));
  }, [isEdit, numberTouched, next.data]);

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => setForm((f) => ({ ...f, [key]: value }));

  const pickCustomer = (m: CustomerMatch | null) =>
    setForm((f) =>
      m
        ? {
            ...f,
            customerId: m.id,
            customerName: m.name,
            address: f.address || m.addressLine1 || '',
            area: f.area || m.addressLine2 || '',
          }
        : { ...f, customerId: null },
    );
  const pickCo = (m: CustomerMatch | null) =>
    setForm((f) => (m ? { ...f, coCustomerId: m.id, coName: m.name } : { ...f, coCustomerId: null }));

  const mobileDigits = form.mobile.replace(/\D/g, '');
  const typeOk = isEdit ? !typeTouched || !!form.categoryId : !!form.categoryId;
  // Mobile may be left empty (the entry is then listed under "Needs review").
  const mobileOk = mobileDigits.length === 0 || mobileDigits.length >= 10;
  const canSave = useMemo(
    () => form.accountNumber.trim() && form.customerName.trim() && mobileOk && form.purchaseDate && typeOk && form.shopId,
    [form.accountNumber, form.customerName, mobileOk, form.purchaseDate, typeOk, form.shopId],
  );

  const submit = async (event: FormEvent | null, allowDuplicate = false) => {
    event?.preventDefault();
    setError(null);
    const blank = (v: string) => (v.trim() ? v.trim() : null);
    const payload: EntryPayload = {
      accountNumber: form.accountNumber.trim().toUpperCase(),
      customerName: form.customerName.trim(),
      mobile: blank(form.mobile),
      address: blank(form.address),
      area: blank(form.area),
      coName: blank(form.coName),
      coMobile: blank(form.coMobile),
      purchaseDate: form.purchaseDate,
      categoryId: form.categoryId,
      product: blank(form.product),
      brand: blank(form.brand),
      model: blank(form.model),
      customerId: form.customerId,
      coCustomerId: form.coCustomerId,
      shopId: form.shopId || undefined,
      allowDuplicate,
    };
    try {
      const saved = isEdit
        ? await updateMutation.mutateAsync({
            id: id!,
            payload: {
              ...payload,
              categoryId: typeTouched && form.categoryId ? form.categoryId : undefined,
              customerId: form.customerId ?? undefined,
              coCustomerId: form.coCustomerId ?? undefined,
            },
          })
        : await createMutation.mutateAsync(payload);
      toast.success(saved.issues?.length ? `Saved ${saved.accountNumber} — listed under Needs review` : `Saved ${saved.accountNumber}`);
      navigate(`/customer-search/${saved.id}`, { state: { listUrl } });
    } catch (err) {
      setError({ message: apiErrorMessage(err, "Couldn't save the entry"), suggestion: takenSuggestion(err), taken: isTakenNumber(err) });
    }
  };

  if (isEdit && (entry.isLoading || !loaded)) {
    return entry.isError ? (
      <p className="text-sm text-destructive">{apiErrorMessage(entry.error, 'Entry not found')}</p>
    ) : (
      <LoadingSpinner />
    );
  }

  return (
    <div className="max-w-6xl">
      <PageHeader
        title={isEdit ? `Edit ${entry.data?.accountNumber ?? 'entry'}` : 'New entry'}
        description={isEdit ? undefined : 'Pick the series, then the customer by mobile number. New customers are created in the current shop.'}
        backTo={goBack}
      />

      <form onSubmit={submit} className="space-y-4">
        <Card className="p-4">
          <h2 className="mb-3 text-sm font-semibold">Account Number</h2>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {!isEdit && (
              <Field label="Series (prefix)" hint={next.data?.lastAccountNumber ? `Last in series: ${next.data.lastAccountNumber}` : activePrefix ? 'First of this series' : undefined}>
                <div className="flex items-center gap-2">
                  <div className="min-w-0 flex-1">
                    <Select
                      value={prefixChoice}
                      onChange={(e) => {
                        setPrefixChoice(e.target.value);
                        setNumberTouched(false);
                      }}
                    >
                      <option value="">Choose…</option>
                      {(prefixes.data ?? []).map((p) => (
                        <option key={p.prefix} value={p.prefix}>
                          {p.prefix} — last {p.lastAccountNumber ?? '–'} ({p.count})
                        </option>
                      ))}
                      <option value={NEW_PREFIX}>New series…</option>
                    </Select>
                  </div>
                  {prefixChoice === NEW_PREFIX && (
                    <Input
                      autoFocus
                      aria-label="New series letters"
                      value={newPrefix}
                      maxLength={4}
                      onChange={(e) => {
                        setNewPrefix(e.target.value.replace(/[^a-zA-Z0-9]/g, '').toUpperCase());
                        setNumberTouched(false);
                      }}
                      placeholder="BD"
                      title="1-3 letters, optionally one digit (CI2)"
                      className="w-20 shrink-0 text-center font-mono uppercase"
                    />
                  )}
                </div>
              </Field>
            )}
            <Field label="Account Number" required hint={!isEdit && !numberTouched && next.data ? 'Suggested; change it if needed' : undefined}>
              <Input
                value={form.accountNumber}
                onChange={(e) => {
                  setNumberTouched(true);
                  set('accountNumber', e.target.value.toUpperCase());
                }}
                placeholder="e.g. BD-13"
                className="font-mono"
                required
              />
            </Field>
            <Field label="Purchase date" required>
              <Input type="date" value={form.purchaseDate} max={today()} onChange={(e) => set('purchaseDate', e.target.value)} required />
            </Field>
            <Field
              label="Shop"
              required
              hint={isEdit && entry.data && form.shopId !== entry.data.shopId ? 'The entry moves; its customer too, unless they have other entries or sales in the old shop.' : undefined}
            >
              <Select value={form.shopId} onChange={(e) => set('shopId', e.target.value)} required>
                {!form.shopId && <option value="">Choose a shop…</option>}
                {shops.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.code} — {s.name}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
        </Card>

        <div className="grid items-start gap-4 lg:grid-cols-2">
        <Card className="p-4">
          <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold">
            Customer
            {form.customerId ? (
              <Badge tone="success"><UserCheck className="mr-1 h-3 w-3" />Existing customer</Badge>
            ) : null}
          </h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label="Mobile"
              hint={
                !form.mobile.trim()
                  ? isEdit && entry.data?.rawValues?.mobile
                    ? `The sheet had “${entry.data.rawValues.mobile}”. Without a mobile the entry stays under Needs review.`
                    : 'Leave empty if unknown; the entry is then listed under Needs review.'
                  : undefined
              }
            >
              <Input
                inputMode="numeric"
                value={form.mobile}
                onChange={(e) => setForm((f) => ({ ...f, mobile: e.target.value, customerId: null }))}
                placeholder="10-digit mobile"
              />
              <MatchList mobile={form.mobile} name={form.customerName} selectedId={form.customerId} onPick={pickCustomer} />
            </Field>
            <Field label="Customer name" required>
              <Input
                value={form.customerName}
                onChange={(e) => setForm((f) => ({ ...f, customerName: e.target.value, customerId: null }))}
                required
              />
            </Field>
            <Field label="Address">
              <Input value={form.address} onChange={(e) => set('address', e.target.value)} />
            </Field>
            <Field label="Area">
              <Input value={form.area} onChange={(e) => set('area', e.target.value)} />
            </Field>
          </div>
        </Card>

        <Card className="p-4">
          <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold">
            Co-applicant <span className="font-normal text-muted-foreground">(guarantor, optional)</span>
            {form.coCustomerId ? <Badge tone="success"><UserCheck className="mr-1 h-3 w-3" />Existing customer</Badge> : null}
          </h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Co-applicant mobile">
              <Input
                inputMode="numeric"
                value={form.coMobile}
                onChange={(e) => setForm((f) => ({ ...f, coMobile: e.target.value, coCustomerId: null }))}
                placeholder="10-digit mobile"
              />
              <MatchList mobile={form.coMobile} name={form.coName} selectedId={form.coCustomerId} onPick={pickCo} />
            </Field>
            <Field label="Co-applicant name">
              <Input value={form.coName} onChange={(e) => setForm((f) => ({ ...f, coName: e.target.value, coCustomerId: null }))} />
            </Field>
          </div>
        </Card>
        </div>

        <Card className="p-4">
          <h2 className="mb-3 text-sm font-semibold">
            Item <span className="text-destructive">*</span>
          </h2>
          <div className="grid items-start gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div className="sm:col-span-2">
              <CategoryCascader
                required
                allowCreate
                initialCategoryId={form.categoryId || undefined}
                onCategorySelect={(categoryId) => {
                  setTypeTouched(true);
                  set('categoryId', categoryId ?? '');
                }}
              />
              {typeTouched && !form.categoryId && (
                <p className="mt-1 text-xs text-warning">Choose the product type down to its last level.</p>
              )}
              {isEdit && entry.data?.product && !entry.data.productType && (
                <p className="mt-1 text-xs text-muted-foreground">The sheet said “{entry.data.product}”.</p>
              )}
            </div>
            <Field label="Brand" hint="Pick from the list or type a new one">
              <BrandInput categoryId={form.categoryId || undefined} value={form.brand} onChange={(e) => set('brand', e.target.value)} />
            </Field>
            <Field label="Model">
              <ModelAutocomplete
                value={form.model}
                onChange={(value) => set('model', value)}
                onSelect={(p) => setForm((f) => ({ ...f, model: p.modelNumber, brand: f.brand || p.brand }))}
                placeholder="Type a model number…"
              />
            </Field>
          </div>
        </Card>

        {error && (
          <div
            className={cn(
              'flex flex-wrap items-center gap-3 rounded-lg border p-3 text-sm',
              error.taken ? 'border-warning/40 bg-warning-muted text-warning' : 'border-destructive/50 bg-destructive/10 text-destructive',
            )}
          >
            {error.message}
            {error.suggestion && (
              <Button
                size="sm"
                variant="secondary"
                type="button"
                onClick={() => {
                  setNumberTouched(true);
                  set('accountNumber', error.suggestion!);
                  setError(null);
                }}
              >
                Use {error.suggestion}
              </Button>
            )}
            {error.taken && (
              <Button size="sm" variant="secondary" type="button" loading={saving} onClick={() => submit(null, true)}>
                Save anyway (listed under Needs review)
              </Button>
            )}
          </div>
        )}

        <div className="flex items-center justify-end gap-2">
          <Button variant="ghost" type="button" onClick={goBack}>
            Cancel
          </Button>
          <Button type="submit" loading={saving} disabled={!canSave} icon={form.customerId ? <UserCheck className="h-3.5 w-3.5" /> : <UserPlus className="h-3.5 w-3.5" />}>
            {isEdit ? 'Save changes' : 'Save entry'}
          </Button>
        </div>
        {!form.customerId && mobileDigits.length >= 10 && form.customerName.trim() && (
          <p className="text-right text-xs text-muted-foreground">
            Filed under the customer with this exact name on {formatPhone(mobileDigits.slice(-10))}, or a new customer if there is none.
          </p>
        )}
      </form>
    </div>
  );
}
