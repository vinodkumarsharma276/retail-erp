import { useMemo, useState } from 'react';
import { Camera, Check, FileImage, Loader2, Plus, X } from 'lucide-react';
import { formatINR } from '@retailerp/shared-utils';
import type { DistributorListItem } from '@retailerp/shared-types';
import { cn } from '../lib/utils';
import { useOcrStatusQuery, useScanInvoiceMutation } from '../hooks/useOcr';
import { useCreateDistributorMutation } from '../hooks/useDistributors';
import { useToastStore } from '../stores/toast-store';
import type { InvoiceParseResult } from '../api/ocr-api';

type Props = {
  open: boolean;
  onClose: () => void;
  onApply: (result: InvoiceParseResult, distributor: DistributorListItem) => void;
};

type DistributorDraft = {
  companyName: string;
  contactPerson: string;
  phone: string;
  altPhone: string;
  gstNumber: string;
  panNumber: string;
  addressLine1: string;
  city: string;
  state: string;
  pincode: string;
  bankName: string;
  bankAccountNumber: string;
  bankIfsc: string;
  bankBranch: string;
};

// Phone numbers from OCR may be comma/slash/semicolon separated, contain spaces,
// dashes, parentheses, country-code prefixes, etc. The API caps each phone field
// at 15 chars (E.164). Normalise to digits + leading + only.
function sanitizePhone(raw: string): string {
  const cleaned = raw.replace(/[^0-9+]/g, '').replace(/(?!^)\+/g, '');
  return cleaned.slice(0, 15);
}

function splitPhones(raw: string): { primary: string; alternate: string } {
  const parts = raw
    .split(/[,;/|\n]+/)
    .map((p) => sanitizePhone(p))
    .filter((p) => p.length >= 10);
  return { primary: parts[0] ?? '', alternate: parts[1] ?? '' };
}

function distributorFromMatch(result: InvoiceParseResult): DistributorListItem | null {
  const match = result.distributor.match;
  if (!match.id || !match.companyName) return null;
  return {
    id: match.id,
    companyName: match.companyName,
    contactPerson: match.contactPerson || match.companyName,
    phone: match.phone || '',
    gstNumber: match.gstNumber || result.distributor.parsed.gstNumber || undefined,
    panNumber: result.distributor.parsed.panNumber || undefined,
    addressLine1: '',
    city: '',
    state: '',
    pincode: '',
    creditLimit: 0,
    dynamicAttributes: {},
    isActive: true,
    createdAt: '',
    updatedAt: '',
    totalProductsPurchased: 0,
    totalPaymentPaid: 0,
    pendingPayment: 0,
  };
}

function initialDraft(result: InvoiceParseResult): DistributorDraft {
  const parsed = result.distributor.parsed;
  const { primary, alternate } = splitPhones(parsed.phone || '');
  return {
    companyName: parsed.companyName || '',
    contactPerson: parsed.companyName || '',
    phone: primary,
    altPhone: alternate,
    gstNumber: parsed.gstNumber || '',
    panNumber: parsed.panNumber || '',
    addressLine1: parsed.address || '',
    city: parsed.city || '',
    state: parsed.state || '',
    pincode: parsed.pincode || '',
    bankName: parsed.bankName || '',
    bankAccountNumber: parsed.bankAccountNumber || '',
    bankIfsc: parsed.bankIfsc || '',
    bankBranch: parsed.bankBranch || '',
  };
}

function toListItem(distributor: any): DistributorListItem {
  return {
    ...distributor,
    totalProductsPurchased: 0,
    totalPaymentPaid: 0,
    pendingPayment: 0,
  };
}

export function ScanInvoiceDialog({ open, onClose, onApply }: Props) {
  const toast = useToastStore((s) => s.addToast);
  const ocrStatus = useOcrStatusQuery();
  const scanMutation = useScanInvoiceMutation();
  const createDistributor = useCreateDistributorMutation();
  const [createdDistributor, setCreatedDistributor] = useState<DistributorListItem | null>(null);
  const [draft, setDraft] = useState<DistributorDraft | null>(null);
  const [overrideMatch, setOverrideMatch] = useState(false);

  const result = scanMutation.data ?? null;
  const matchedDistributor = useMemo(() => result ? distributorFromMatch(result) : null, [result]);
  const effectiveMatch = overrideMatch ? null : matchedDistributor;
  const selectedDistributor = createdDistributor ?? effectiveMatch;

  if (!open) return null;

  const handleFile = (file: File | undefined) => {
    if (!file) return;
    if (ocrStatus.data && !ocrStatus.data.enabled) {
      toast({ type: 'error', message: 'OCR scanning is not configured. Set OPENAI_API_KEY to enable invoice scanning.' });
      return;
    }
    setCreatedDistributor(null);
    setDraft(null);
    setOverrideMatch(false);
    scanMutation.mutate(file, {
      onSuccess: (data) => {
        if (!data.distributor.match.id) setDraft(initialDraft(data));
      },
      onError: (error: any) => {
        toast({ type: 'error', message: error?.response?.data?.error ?? 'Invoice scan failed' });
      },
    });
  };

  const canCreateDistributor = !!draft?.companyName && !!draft.contactPerson && !!draft.phone && !!draft.addressLine1 && !!draft.city && !!draft.state && !!draft.pincode;

  const handleCreateDistributor = () => {
    if (!draft) return;
    // Re-sanitise on submit in case the user pasted a multi-phone string into the field
    const { primary, alternate } = splitPhones(draft.phone);
    const altPhoneFinal = sanitizePhone(draft.altPhone) || alternate || '';
    const phoneFinal = primary || sanitizePhone(draft.phone);
    createDistributor.mutate(
      {
        ...draft,
        phone: phoneFinal,
        altPhone: altPhoneFinal || undefined,
        gstNumber: draft.gstNumber || undefined,
        panNumber: draft.panNumber || undefined,
        bankName: draft.bankName || undefined,
        bankAccountNumber: draft.bankAccountNumber || undefined,
        bankIfsc: draft.bankIfsc || undefined,
        bankBranch: draft.bankBranch || undefined,
      },
      {
        onSuccess: (distributor) => {
          setCreatedDistributor(toListItem(distributor));
          toast({ type: 'success', message: 'Distributor created' });
        },
        onError: (error: any) => {
          toast({ type: 'error', message: error?.response?.data?.error ?? 'Failed to create distributor' });
        },
      },
    );
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-3">
      <div className="flex max-h-[92vh] w-full max-w-5xl flex-col rounded-lg border bg-card shadow-xl">
        <div className="flex items-center justify-between border-b px-5 py-4">
          <div>
            <h2 className="text-lg font-semibold">Scan invoice</h2>
            <p className="text-sm text-muted-foreground">Take a photo or upload an image/PDF, then review before applying.</p>
          </div>
          <button onClick={onClose} className="rounded-md p-1.5 hover:bg-accent"><X className="h-5 w-5" /></button>
        </div>

        <div className="overflow-y-auto p-5">
          {ocrStatus.data && !ocrStatus.data.enabled && (
            <div className="mb-4 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200">
              OCR scanning is not configured yet. Add OPENAI_API_KEY and set OCR_PROVIDER=openai to enable parsing.
            </div>
          )}

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="flex cursor-pointer items-center justify-center gap-2 rounded-md border border-dashed p-4 text-sm font-medium hover:border-primary hover:text-primary">
              <Camera className="h-4 w-4" /> Take photo
              <input type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => handleFile(e.target.files?.[0])} />
            </label>
            <label className="flex cursor-pointer items-center justify-center gap-2 rounded-md border border-dashed p-4 text-sm font-medium hover:border-primary hover:text-primary">
              <FileImage className="h-4 w-4" /> Upload image or PDF
              <input type="file" accept="image/*,application/pdf" className="hidden" onChange={(e) => handleFile(e.target.files?.[0])} />
            </label>
          </div>

          {scanMutation.isPending && (
            <div className="mt-5 flex items-center gap-2 rounded-md border bg-muted/40 p-4 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Reading invoice...
            </div>
          )}

          {result && (
            <div className="mt-5 space-y-4">
              {result.warnings.length > 0 && (
                <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200">
                  {result.warnings.join(' ')}
                </div>
              )}

              <section className="rounded-md border p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h3 className="font-medium">Distributor</h3>
                    {selectedDistributor ? (
                      <p className="mt-1 text-sm text-muted-foreground">
                        <span className="font-medium text-foreground">{selectedDistributor.companyName}</span>{' '}
                        {createdDistributor
                          ? '(newly created)'
                          : effectiveMatch
                            ? `(matched by ${result.distributor.match.matchedBy})`
                            : ''}
                      </p>
                    ) : (
                      <p className="mt-1 text-sm text-muted-foreground">
                        {matchedDistributor && overrideMatch
                          ? `Ignoring matched distributor "${matchedDistributor.companyName}". Edit the details below and create a new one.`
                          : 'No existing distributor matched. Confirm the details below to create it.'}
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    {result.invoice.number && <span className="rounded bg-muted px-2 py-1 font-mono text-xs">{result.invoice.number}</span>}
                    {effectiveMatch && !createdDistributor && (
                      <button
                        type="button"
                        onClick={() => {
                          setOverrideMatch(true);
                          if (!draft) setDraft(initialDraft(result));
                        }}
                        className="rounded-md border px-2 py-1 text-xs font-medium hover:bg-accent"
                        title="OCR may have matched the wrong distributor — create a new one instead"
                      >
                        Not this distributor? Create new
                      </button>
                    )}
                    {overrideMatch && matchedDistributor && !createdDistributor && (
                      <button
                        type="button"
                        onClick={() => { setOverrideMatch(false); setDraft(null); }}
                        className="rounded-md border px-2 py-1 text-xs font-medium hover:bg-accent"
                      >
                        Use matched distributor
                      </button>
                    )}
                  </div>
                </div>

                {!selectedDistributor && draft && (
                  <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    {(['companyName', 'contactPerson', 'phone', 'altPhone', 'gstNumber', 'panNumber', 'addressLine1', 'city', 'state', 'pincode', 'bankName', 'bankAccountNumber', 'bankIfsc', 'bankBranch'] as const).map((key) => (
                      <div key={key} className={key === 'addressLine1' ? 'sm:col-span-2 lg:col-span-3' : ''}>
                        <label className="block text-xs font-medium capitalize text-muted-foreground">
                          {key === 'altPhone' ? 'Alt phone (optional)' : key.replace(/([A-Z])/g, ' $1')}
                        </label>
                        <input
                          value={draft[key]}
                          onChange={(e) => setDraft({ ...draft, [key]: e.target.value })}
                          className="mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm"
                        />
                        {key === 'phone' && draft.phone.includes(',') && (
                          <p className="mt-1 text-[11px] text-amber-600 dark:text-amber-400">
                            Multiple phones detected. The first becomes the primary phone; move the second to “Alt phone”.
                          </p>
                        )}
                      </div>
                    ))}
                    <div className="sm:col-span-2 lg:col-span-3">
                      <button
                        type="button"
                        disabled={!canCreateDistributor || createDistributor.isPending}
                        onClick={handleCreateDistributor}
                        className="inline-flex items-center gap-2 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
                      >
                        {createDistributor.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                        Create distributor
                      </button>
                    </div>
                  </div>
                )}
              </section>

              <section className="rounded-md border p-4">
                <h3 className="font-medium">Invoice summary</h3>
                <div className="mt-3 grid gap-3 text-sm sm:grid-cols-4">
                  <div><p className="text-muted-foreground">Date</p><p className="font-medium">{result.invoice.date || '-'}</p></div>
                  <div><p className="text-muted-foreground">Taxable</p><p className="font-medium">{formatINR(result.invoice.totals.taxableAmount || 0)}</p></div>
                  <div><p className="text-muted-foreground">GST</p><p className="font-medium">{formatINR(result.invoice.totals.gstAmount || 0)}</p></div>
                  <div><p className="text-muted-foreground">Net</p><p className="font-medium">{formatINR(result.invoice.totals.netAmount || 0)}</p></div>
                </div>
              </section>

              <section className="rounded-md border p-4">
                <h3 className="font-medium">Products parsed ({result.items.length})</h3>
                <div className="mt-3 overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/50"><tr><th className="px-2 py-2 text-left">Model</th><th className="px-2 py-2 text-left">Brand</th><th className="px-2 py-2 text-left">Serials</th><th className="px-2 py-2 text-right">DP</th><th className="px-2 py-2 text-right">GST</th></tr></thead>
                    <tbody>
                      {result.items.map((item, index) => (
                        <tr key={`${item.modelNumber}-${index}`} className="border-b last:border-0">
                          <td className="px-2 py-2 font-medium">{item.modelNumber || '-'}</td>
                          <td className="px-2 py-2">{item.brand || '-'}</td>
                          <td className="px-2 py-2 font-mono text-xs">{item.serialNumbers.length ? item.serialNumbers.join(', ') : `${item.quantity} qty`}</td>
                          <td className="px-2 py-2 text-right">{formatINR(item.purchasePrice || 0)}</td>
                          <td className="px-2 py-2 text-right">{item.gstPercent ?? '-'}%</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 border-t px-5 py-4">
          <button onClick={onClose} className="rounded-md border px-3 py-2 text-sm font-medium hover:bg-accent">Cancel</button>
          <button
            disabled={!result || !selectedDistributor}
            onClick={() => result && selectedDistributor && onApply(result, selectedDistributor)}
            className={cn('inline-flex items-center gap-2 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground', 'disabled:opacity-50')}
          >
            <Check className="h-4 w-4" /> Use these details
          </button>
        </div>
      </div>
    </div>
  );
}