import { useEffect, useState } from 'react';
import { Loader2, X, Download, AlertCircle } from 'lucide-react';
import { cn } from '../lib/utils';
import {
  buildInvoiceData,
  downloadInvoiceFromData,
} from '../lib/invoice-utils';
import type { InvoiceData } from './InvoicePDF';
import { useEscapeKey } from '../hooks/useEscapeKey';

/**
 * Modal that previews the soon-to-be-generated invoice details so the
 * user can confirm or fix them before downloading the PDF. Mostly used
 * to (a) verify the shop's address/GSTIN/phone, and (b) edit B2B
 * customer details (business name, GSTIN) for the bill in case the
 * stored values were wrong or incomplete.
 *
 * The data shown is loaded fresh every time via `buildInvoiceData()`.
 * Edits are NOT persisted back to the customer record — they apply
 * only to this one PDF generation.
 */
export function InvoiceConfirmDialog({
  saleId,
  onClose,
}: {
  saleId: string;
  onClose: () => void;
}) {
  useEscapeKey(true, onClose);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<InvoiceData | null>(null);
  const [downloading, setDownloading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    buildInvoiceData(saleId)
      .then((d) => {
        if (!cancelled) {
          setData(d);
          setLoading(false);
        }
      })
      .catch((e: any) => {
        if (!cancelled) {
          setError(
            e?.response?.data?.error ??
              e?.message ??
              'Failed to load invoice details',
          );
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [saleId]);

  const update = <K extends keyof InvoiceData>(key: K, value: InvoiceData[K]) => {
    setData((prev) => (prev ? { ...prev, [key]: value } : prev));
  };

  const handleDownload = async () => {
    if (!data) return;
    setDownloading(true);
    try {
      await downloadInvoiceFromData(data);
      onClose();
    } catch (e: any) {
      setError(e?.message ?? 'Download failed');
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="flex max-h-[90vh] w-full max-w-2xl flex-col rounded-lg border bg-card shadow-xl">
        <header className="flex items-start justify-between border-b p-4">
          <div>
            <h3 className="text-lg font-semibold">Confirm Invoice Details</h3>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Review the shop & customer details that will appear on the
              printed invoice. Changes here apply only to this PDF.
            </p>
          </div>
          <button onClick={onClose} className="rounded p-1 hover:bg-accent">
            <X className="h-4 w-4" />
          </button>
        </header>

        {loading && (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
          </div>
        )}

        {error && !loading && (
          <div className="flex flex-col items-center justify-center gap-3 py-12 text-center">
            <AlertCircle className="h-8 w-8 text-destructive" />
            <p className="text-sm text-destructive">{error}</p>
          </div>
        )}

        {data && !loading && (
          <div className="flex-1 space-y-6 overflow-y-auto p-4">
            {/* Shop block */}
            <section>
              <h4 className="mb-2 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
                Shop
              </h4>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Field
                  label="Shop Name"
                  value={data.shopName}
                  onChange={(v) => update('shopName', v)}
                />
                <Field
                  label="Shop Phone"
                  value={data.shopPhone}
                  onChange={(v) => update('shopPhone', v)}
                />
                <div className="sm:col-span-2">
                  <Field
                    label="Shop Address"
                    value={data.shopAddress}
                    onChange={(v) => update('shopAddress', v)}
                  />
                </div>
                <Field
                  label="GSTIN"
                  value={data.shopGstin}
                  onChange={(v) => update('shopGstin', v.toUpperCase())}
                />
                <Field
                  label="State"
                  value={data.shopState}
                  onChange={(v) => update('shopState', v)}
                />
              </div>
              {(!data.shopGstin || !data.shopAddress || !data.shopPhone) && (
                <p className="mt-2 text-xs text-amber-700">
                  Some shop fields are missing. Ask an admin to update the
                  shop record under Settings → Shops to make this permanent.
                </p>
              )}
            </section>

            {/* Customer block */}
            <section>
              <h4 className="mb-2 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
                Bill To
              </h4>
              <div className="mb-3 flex items-center gap-3 rounded-md border bg-field px-3 py-2 text-sm">
                <label className="flex items-center gap-1.5 cursor-pointer">
                  <input
                    type="radio"
                    name="invoice-cust-type"
                    checked={!data.customerIsBusiness}
                    onChange={() => update('customerIsBusiness', false)}
                  />
                  Individual
                </label>
                <label className="flex items-center gap-1.5 cursor-pointer">
                  <input
                    type="radio"
                    name="invoice-cust-type"
                    checked={!!data.customerIsBusiness}
                    onChange={() => update('customerIsBusiness', true)}
                  />
                  Business (B2B)
                </label>
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {data.customerIsBusiness && (
                  <div className="sm:col-span-2">
                    <Field
                      label="Business Name"
                      value={data.customerBusinessName ?? ''}
                      onChange={(v) => update('customerBusinessName', v)}
                      placeholder="e.g. Acme Distributors Pvt Ltd"
                    />
                  </div>
                )}
                <Field
                  label={data.customerIsBusiness ? 'Contact Person' : 'Customer Name'}
                  value={data.customerName}
                  onChange={(v) => update('customerName', v)}
                />
                <Field
                  label="Phone"
                  value={data.customerPhone}
                  onChange={(v) => update('customerPhone', v)}
                />
                <div className="sm:col-span-2">
                  <Field
                    label="Address"
                    value={data.customerAddress ?? ''}
                    onChange={(v) => update('customerAddress', v)}
                  />
                </div>
                {data.customerIsBusiness && (
                  <div className="sm:col-span-2">
                    <Field
                      label="Customer GSTIN"
                      value={data.customerGstin ?? ''}
                      onChange={(v) => update('customerGstin', v.toUpperCase())}
                      placeholder="15-character GSTIN"
                    />
                  </div>
                )}
              </div>
            </section>

            {/* Product (read-only) — surfaces IMEI / serial so the user can
                spot mistakes before printing. Not editable here because the
                product is the source of truth and a separate page handles
                product corrections. */}
            <section>
              <h4 className="mb-2 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
                Product
              </h4>
              <div className="rounded-md border bg-muted/30 px-3 py-2 text-sm">
                <p className="font-medium">
                  {data.productBrand} {data.productModel}
                </p>
                {data.productSerial && (
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    Serial: <span className="font-mono">{data.productSerial}</span>
                  </p>
                )}
                {data.productImeis && data.productImeis.length > 0 && (
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    IMEI:{' '}
                    <span className="font-mono">
                      {data.productImeis.join(' / ')}
                    </span>
                  </p>
                )}
                {data.productCategory && (
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    Category: {data.productCategory}
                    {data.hsnCode && ` (HSN ${data.hsnCode})`}
                  </p>
                )}
              </div>
            </section>
          </div>
        )}

        <footer className="flex items-center justify-end gap-2 border-t bg-muted/20 p-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border px-3 py-1.5 text-sm font-medium hover:bg-accent"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleDownload}
            disabled={!data || downloading || loading}
            className={cn(
              'flex items-center gap-2 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90',
              'disabled:opacity-50 disabled:cursor-not-allowed',
            )}
          >
            {downloading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Download className="h-4 w-4" />
            )}
            {downloading ? 'Generating…' : 'Download Invoice'}
          </button>
        </footer>
      </div>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <div>
      <label className="mb-1 block text-xs font-medium text-muted-foreground">
        {label}
      </label>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className={cn(
          'w-full rounded-md border bg-field px-3 py-2 text-sm',
          'placeholder:text-muted-foreground',
          'focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2',
        )}
      />
    </div>
  );
}
