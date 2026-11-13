import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Check, UserCheck, UserPlus, X } from 'lucide-react';
import { formatAccountNumber, formatPhone, isValidAccountPrefix, isValidMobile } from '@retailerp/shared-utils';
import { DateInput } from '../../components/DateInput';
import { PageHeader } from '../../components/PageHeader';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Select } from '../../components/ui/select';
import { Badge } from '../../components/ui/badge';
import { Card } from '../../components/ui/card';
import { LoadingSpinner } from '../../components/LoadingSpinner';
import { cn } from '../../lib/utils';
import { useDebounce } from '../../hooks/useDebounce';
import { useMeQuery } from '../../hooks/useAuth';
import { useToast } from '../../stores/toast-store';
import { useShopStore } from '../../stores/shop-store';
import {
  apiErrorMessage,
  takenSuggestion,
  isTakenNumber,
  useAreasQuery,
  useCreateEntryMutation,
  useCustomerNamesQuery,
  useCustomerMatchesQuery,
  useCustomerSearchEntryQuery,
  useNextNumberQuery,
  usePrefixesQuery,
  useUpdateEntryMutation,
  type CustomerMatch,
  type EntryPayload,
} from '../../hooks/useCustomerSearch';
import { useRegisterListUrl } from './registerListUrl';
import { SuggestInput } from '../../components/SuggestInput';
import { ItemsTable, MAX_UNITS, newItemRow, rowReady, type ItemRow } from './ItemsTable';

const NEW_PREFIX = '__new__';
const today = () => new Date().toISOString().slice(0, 10);

interface FormState {
  accountNumber: string;
  customerName: string;
  mobile: string;
  address: string;
  moreAddresses: string[];
  coAddress: string;
  coMoreAddresses: string[];
  area: string;
  coName: string;
  coMobile: string;
  altMobile: string;
  coAltMobile: string;
  purchaseDate: string;
  /** The sheet's Product text of the entry being edited (kept as it is). */
  product: string;
  items: ItemRow[];
  customerId: string | null;
  coCustomerId: string | null;
  shopId: string;
}

const EMPTY: FormState = {
  accountNumber: '', customerName: '', mobile: '', address: '', area: '', coName: '', coMobile: '', altMobile: '', coAltMobile: '', moreAddresses: [], coAddress: '', coMoreAddresses: [],
  purchaseDate: today(), product: '', items: [newItemRow()], customerId: null, coCustomerId: null, shopId: '',
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

const MOBILE_RULE = 'Enter a 10-digit mobile number starting with 6, 7, 8 or 9';

function secondMobileProblem(second: string, first: string): string | null {
  if (!second.trim()) return null;
  if (!isValidMobile(second)) return MOBILE_RULE;
  if (!first.trim()) return 'Fill in the first mobile before a second one';
  return null;
}

/** "+ Add another number", then a second mobile box that can be removed. */
function SecondMobile({ value, problem, onChange }: { value: string; problem: string | null; onChange: (value: string) => void }) {
  const [open, setOpen] = useState(false);
  if (!open && !value) {
    return (
      <button type="button" className="mt-1 text-xs text-primary hover:underline" onClick={() => setOpen(true)}>
        + Add another number
      </button>
    );
  }
  return (
    <div className="mt-2">
      <div className="flex items-center gap-1">
        <Input
          autoFocus={open && !value}
          inputMode="numeric"
          aria-label="Second mobile"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="Second mobile"
          aria-invalid={!!problem || undefined}
        />
        <Button
          type="button"
          size="xs"
          variant="ghost"
          aria-label="Remove second mobile"
          onClick={() => {
            onChange('');
            setOpen(false);
          }}
        >
          <X className="h-3.5 w-3.5" />
        </Button>
      </div>
      {problem && <p className="mt-1 text-xs text-destructive">{problem}</p>}
    </div>
  );
}

const MAX_ADDRESSES = 3;

/** The main address, then "+ Add another address" (up to 3 in all), each extra removable. */
function AddressList({
  main,
  more,
  onMain,
  onMore,
  label = 'Address',
}: {
  main: string;
  more: string[];
  onMain: (value: string) => void;
  onMore: (value: string[]) => void;
  label?: string;
}) {
  return (
    <div className="space-y-2">
      <Input aria-label={label} value={main} onChange={(e) => onMain(e.target.value)} />
      {more.map((a, i) => (
        <div key={i} className="flex items-center gap-1">
          <Input
            autoFocus={!a}
            aria-label={`${label} ${i + 2}`}
            placeholder={`${label} ${i + 2}`}
            value={a}
            onChange={(e) => onMore(more.map((x, j) => (j === i ? e.target.value : x)))}
          />
          <Button
            type="button"
            size="xs"
            variant="ghost"
            aria-label={`Remove ${label.toLowerCase()} ${i + 2}`}
            onClick={() => onMore(more.filter((_, j) => j !== i))}
          >
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>
      ))}
      {more.length < MAX_ADDRESSES - 1 && (
        <button
          type="button"
          className="text-xs text-primary hover:underline disabled:cursor-not-allowed disabled:text-muted-foreground disabled:no-underline"
          disabled={!main.trim()}
          title={!main.trim() ? 'Fill in the first address first' : undefined}
          onClick={() => onMore([...more, ''])}
        >
          + Add another address
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
  const [error, setError] = useState<{ message: string; suggestion: string | null; taken: boolean } | null>(null);
  const me = useMeQuery();
  const shops = me.data?.shops ?? [];
  const currentShopId = useShopStore((s) => s.currentShopId);

  const entry = useCustomerSearchEntryQuery(id);
  const prefixes = usePrefixesQuery(!isEdit);
  const areas = useAreasQuery();
  const activePrefix = prefixChoice === NEW_PREFIX ? (isValidAccountPrefix(newPrefix) ? newPrefix.toUpperCase() : '') : prefixChoice;
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
      moreAddresses: e.moreAddresses ?? [],
      coAddress: e.coAddress ?? '',
      coMoreAddresses: e.coMoreAddresses ?? [],
      area: e.area ?? '',
      coName: e.coName ?? '',
      coMobile: e.coMobile ?? '',
      altMobile: e.altMobile ?? '',
      coAltMobile: e.coAltMobile ?? '',
      purchaseDate: e.purchaseDate ?? '',
      product: e.product ?? '',
      items: [{ ...newItemRow({ categoryId: e.categoryId ?? '', brand: e.brand ?? '', model: e.model ?? '' }), existing: true, originalCategoryId: e.categoryId ?? '' }],
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
  const nameQuery = useDebounce(form.customerName, 300);
  const names = useCustomerNamesQuery(nameQuery);

  const mobileDigits = form.mobile.replace(/\D/g, '');
  const units = form.items.reduce((n, r) => n + (r.existing ? 1 : r.quantity), 0);
  const typeOk = form.items.every(rowReady) && units <= MAX_UNITS;
  // Mobile may be left empty (the entry is then listed under "Needs review").
  const mobileProblem = form.mobile.trim() && !isValidMobile(form.mobile) ? 'Enter a 10-digit mobile number starting with 6, 7, 8 or 9' : null;
  const coMobileProblem = form.coMobile.trim() && !isValidMobile(form.coMobile) ? 'Enter a 10-digit mobile number starting with 6, 7, 8 or 9' : null;
  const altMobileProblem = secondMobileProblem(form.altMobile, form.mobile);
  const coAltMobileProblem = secondMobileProblem(form.coAltMobile, form.coMobile);
  const mobileOk = !mobileProblem && !coMobileProblem && !altMobileProblem && !coAltMobileProblem;
  const canSave = useMemo(
    () => form.accountNumber.trim() && form.customerName.trim() && mobileOk && form.purchaseDate && typeOk && form.shopId,
    [form.accountNumber, form.customerName, mobileOk, form.purchaseDate, typeOk, form.shopId],
  );

  const submit = async (event: FormEvent | null, allowDuplicate = false) => {
    event?.preventDefault();
    setError(null);
    const blank = (v: string) => (v.trim() ? v.trim() : null);
    const [first, ...rest] = form.items;
    const moreItems = rest.map((r) => ({ categoryId: r.categoryId, brand: blank(r.brand), model: blank(r.model), quantity: r.quantity }));
    const payload: EntryPayload = {
      accountNumber: formatAccountNumber(form.accountNumber),
      customerName: form.customerName.trim(),
      mobile: blank(form.mobile),
      address: blank(form.address),
      moreAddresses: form.moreAddresses.map((a) => a.trim()).filter(Boolean),
      coAddress: blank(form.coAddress),
      coMoreAddresses: form.coMoreAddresses.map((a) => a.trim()).filter(Boolean),
      area: blank(form.area),
      coName: blank(form.coName),
      coMobile: blank(form.coMobile),
      altMobile: blank(form.altMobile),
      coAltMobile: blank(form.coAltMobile),
      purchaseDate: form.purchaseDate,
      categoryId: first.categoryId,
      product: blank(form.product),
      brand: blank(first.brand),
      model: blank(first.model),
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
              categoryId: first.categoryId && first.categoryId !== first.originalCategoryId ? first.categoryId : undefined,
              moreItems,
              customerId: form.customerId ?? undefined,
              coCustomerId: form.coCustomerId ?? undefined,
            },
          })
        : await createMutation.mutateAsync({ ...payload, quantity: first.quantity, moreItems });
      const what = (saved.itemsSaved ?? 1) > 1 ? `${saved.itemsSaved} items under ${saved.accountNumber}` : saved.accountNumber;
      toast.success(saved.issues?.length ? `Saved ${what} — listed under Needs review` : `Saved ${what}`);
      navigate(`/customer-search/${saved.id}`, { state: { listUrl } });
    } catch (err) {
      setError({ message: apiErrorMessage(err, "Couldn't save the entry"), suggestion: takenSuggestion(err), taken: isTakenNumber(err) });
    }
  };

  // Shown above the form and above the bottom buttons, so whichever Save was used shows it.
  const errorBox = error ? (
    <div
      className={cn(
        'mb-4 flex flex-wrap items-center gap-3 rounded-lg border p-3 text-sm',
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
  ) : null;

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
        actions={
          <>
            <Button variant="ghost" type="button" onClick={goBack}>
              Cancel
            </Button>
            <Button type="submit" form="customer-search-form" loading={saving} disabled={!canSave}>
              {isEdit ? 'Save changes' : 'Save entry'}
            </Button>
          </>
        }
      />

      {errorBox}

      <form id="customer-search-form" onSubmit={submit} className="space-y-4">
        <Card className="p-4">
          <h2 className="mb-3 text-sm font-semibold">Account Number</h2>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {!isEdit && (
              <Field label="Series (prefix)" hint={prefixChoice === NEW_PREFIX && newPrefix && !activePrefix ? '2 or 3 letters, optionally one digit: BD, CK2, ABC' : next.data?.lastAccountNumber ? `Last in series: ${next.data.lastAccountNumber}` : activePrefix ? 'First of this series' : undefined}>
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
                      placeholder="CK2"
                      title="2 or 3 letters, optionally one digit: BD, CK2, ABC"
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
                placeholder="e.g. BD 13"
                onBlur={() => set('accountNumber', formatAccountNumber(form.accountNumber))}
                className="font-mono"
                required
              />
            </Field>
            <Field label="Purchase date" required>
              <DateInput value={form.purchaseDate} max={today()} onChange={(v) => set('purchaseDate', v)} required ariaLabel="Purchase date" />
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
                aria-invalid={!!mobileProblem || undefined}
              />
              {mobileProblem && <p className="mt-1 text-xs text-destructive">{mobileProblem}</p>}
              <SecondMobile value={form.altMobile} problem={altMobileProblem} onChange={(v) => set('altMobile', v)} />
              <MatchList mobile={form.mobile} name={form.customerName} selectedId={form.customerId} onPick={pickCustomer} />
            </Field>
            <Field label="Customer name" required hint="Pick a name already used or type a new one">
              <SuggestInput
                aria-label="Customer name"
                serverFiltered
                maxShown={20}
                options={(names.data ?? []).map((n) => n.name)}
                optionHint={(i) => (names.data![i].count > 1 ? `${names.data![i].count} customers` : undefined)}
                loading={names.isFetching && !names.data?.length}
                emptyText={nameQuery.replace(/[^A-Za-z]/g, '').length < 2 ? 'Type 2 letters to see names' : undefined}
                value={form.customerName}
                onChange={(e) => setForm((f) => ({ ...f, customerName: e.target.value, customerId: null }))}
                required
              />
            </Field>
            <Field label="Address">
              <AddressList
                main={form.address}
                more={form.moreAddresses}
                onMain={(v) => set('address', v)}
                onMore={(v) => set('moreAddresses', v)}
              />
            </Field>
            <Field label="Area" hint="Pick from the list or type a new area">
              <SuggestInput
                aria-label="Area"
                options={(areas.data ?? []).map((a) => a.area)}
                newHint={(typed) => `“${typed.toUpperCase()}” is a new area`}
                value={form.area}
                onChange={(e) => set('area', e.target.value)}
                onBlur={() => set('area', form.area.trim().replace(/\s+/g, ' ').toUpperCase())}
              />
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
                aria-invalid={!!coMobileProblem || undefined}
              />
              {coMobileProblem && <p className="mt-1 text-xs text-destructive">{coMobileProblem}</p>}
              <SecondMobile value={form.coAltMobile} problem={coAltMobileProblem} onChange={(v) => set('coAltMobile', v)} />
              <MatchList mobile={form.coMobile} name={form.coName} selectedId={form.coCustomerId} onPick={pickCo} />
            </Field>
            <Field label="Co-applicant name">
              <Input value={form.coName} onChange={(e) => setForm((f) => ({ ...f, coName: e.target.value, coCustomerId: null }))} />
            </Field>
            <div className="sm:col-span-2">
              <Field label="Co-applicant address">
                <AddressList
                  label="Co-applicant address"
                  main={form.coAddress}
                  more={form.coMoreAddresses}
                  onMain={(v) => set('coAddress', v)}
                  onMore={(v) => set('coMoreAddresses', v)}
                />
              </Field>
            </div>
          </div>
        </Card>
        </div>

        <Card className="p-4">
          <h2 className="mb-1 text-sm font-semibold">
            Items <span className="text-destructive">*</span>
          </h2>
          <p className="mb-3 text-xs text-muted-foreground">
            {isEdit
              ? 'Row 1 is this entry. Add rows for more products bought under this account; each becomes its own entry.'
              : 'One row per product. Use Qty for several of the same, or duplicate a row and change it.'}
          </p>
          <ItemsTable rows={form.items} onChange={(items) => set('items', items)} sheetText={isEdit ? entry.data?.product : null} />
        </Card>
        {errorBox}

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
