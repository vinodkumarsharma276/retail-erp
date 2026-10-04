import { useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  FileSpreadsheet,
  Loader2,
  Upload,
} from 'lucide-react';
import type {
  PurchaseImportPreview,
  PurchaseImportPreviewInvoice,
  PurchaseImportRequest,
  PurchaseImportResult,
  PurchaseImportRow,
  ProductCategory,
} from '@retailerp/shared-types';
import { formatINR, formatDateIN } from '@retailerp/shared-utils';
import { cn } from '../../lib/utils';
import {
  IMPORT_FIELDS,
  autoMap,
  detectHeaderRow,
  mapRows,
  parseDateCell,
  readWorkbook,
  sampleValue,
  type ColumnMapping,
  type ImportFieldKey,
  type ParsedWorkbook,
} from '../../lib/purchase-import';
import { usePurchaseImportCommitMutation, usePurchaseImportPreviewMutation } from '../../hooks/usePurchases';
import { useCategoryTreeQuery } from '../../hooks/useProducts';
import { useShopStore, isAllShops } from '../../stores/shop-store';
import { PageHeader } from '../../components/PageHeader';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { Button } from '../../components/ui/button';
import { Badge } from '../../components/ui/badge';
import { Select } from '../../components/ui/select';
import { Input } from '../../components/ui/input';
import { Tabs } from '../../components/ui/tabs';
import { StatCard } from '../../components/ui/card';

type Step = 'upload' | 'map' | 'review' | 'done';
type InvoiceFilter = 'all' | 'ready' | 'problems' | 'duplicates';

const PAGE_SIZE = 50;

function columnLetter(index: number): string {
  let n = index + 1;
  let s = '';
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

/** Leaf categories with their full path, for the "map this product type" selects. */
function flattenCategories(tree: ProductCategory[] | undefined): Array<{ id: string; label: string }> {
  const out: Array<{ id: string; label: string }> = [];
  const walk = (nodes: ProductCategory[], trail: string[]) => {
    for (const n of nodes) {
      const path = [...trail, n.name];
      if (!n.children || n.children.length === 0) out.push({ id: n.id, label: path.join(' › ') });
      else walk(n.children, path);
    }
  };
  walk(tree ?? [], []);
  return out.sort((a, b) => a.label.localeCompare(b.label));
}

function apiError(error: unknown): string {
  const e = error as { response?: { data?: { error?: string; message?: string } }; message?: string };
  return e?.response?.data?.error ?? e?.response?.data?.message ?? e?.message ?? 'Something went wrong.';
}

export function PurchaseImportPage() {
  const shopId = useShopStore((s) => s.currentShopId);
  const shopName = useShopStore((s) => s.currentShopName);
  const shopCode = useShopStore((s) => s.currentShopCode);
  const allShops = isAllShops(shopId);

  const [step, setStep] = useState<Step>('upload');
  const [workbook, setWorkbook] = useState<ParsedWorkbook | null>(null);
  const [readError, setReadError] = useState<string | null>(null);
  const [reading, setReading] = useState(false);
  const [sheetIndex, setSheetIndex] = useState(0);
  const [headerRow, setHeaderRow] = useState(0);
  const [mapping, setMapping] = useState<ColumnMapping>({});
  const [fillDown, setFillDown] = useState(true);
  const [rows, setRows] = useState<PurchaseImportRow[]>([]);
  const [skippedRows, setSkippedRows] = useState<number[]>([]);
  const [categoryMap, setCategoryMap] = useState<Record<string, string>>({});
  const [preview, setPreview] = useState<PurchaseImportPreview | null>(null);
  const [markPaid, setMarkPaid] = useState(false);
  const [paymentMode, setPaymentMode] = useState<'cash' | 'upi' | 'bank_transfer' | 'cheque'>('bank_transfer');
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [result, setResult] = useState<PurchaseImportResult | null>(null);

  const previewMutation = usePurchaseImportPreviewMutation();
  const commitMutation = usePurchaseImportCommitMutation();
  const { data: categoryTree } = useCategoryTreeQuery();
  const categoryOptions = useMemo(() => flattenCategories(categoryTree), [categoryTree]);

  const sheet = workbook?.sheets[sheetIndex];
  const headers = sheet?.rows[headerRow] ?? [];

  // --- Step 1: read the file -------------------------------------------------
  const loadFile = async (file: File) => {
    setReadError(null);
    if (!/\.(xlsx|xls|csv)$/i.test(file.name)) {
      setReadError('Choose an Excel (.xlsx or .xls) or CSV file.');
      return;
    }
    if (file.size > 30 * 1024 * 1024) {
      setReadError('That file is over 30 MB. Export a shorter date range from Tally and import it in parts.');
      return;
    }
    setReading(true);
    try {
      const wb = await readWorkbook(file);
      const usable = wb.sheets.findIndex((s) => s.rows.length > 1);
      if (usable === -1) {
        setReadError('The file has no rows.');
        return;
      }
      // Start on the sheet with the most rows.
      const biggest = wb.sheets.reduce((best, s, i) => (s.rows.length > wb.sheets[best].rows.length ? i : best), usable);
      const hdr = detectHeaderRow(wb.sheets[biggest].rows);
      setWorkbook(wb);
      setSheetIndex(biggest);
      setHeaderRow(hdr);
      setMapping(autoMap(wb.sheets[biggest].rows[hdr] ?? []));
      setStep('map');
    } catch {
      setReadError("Couldn't read that file. If it came from Tally, export it again as Excel (.xlsx).");
    } finally {
      setReading(false);
    }
  };

  const changeSheet = (index: number) => {
    if (!workbook) return;
    const hdr = detectHeaderRow(workbook.sheets[index].rows);
    setSheetIndex(index);
    setHeaderRow(hdr);
    setMapping(autoMap(workbook.sheets[index].rows[hdr] ?? []));
  };

  const changeHeaderRow = (oneBased: number) => {
    if (!sheet) return;
    const idx = Math.min(Math.max(oneBased - 1 - sheet.rowOffset, 0), sheet.rows.length - 1);
    setHeaderRow(idx);
    setMapping(autoMap(sheet.rows[idx] ?? []));
  };

  // --- Step 2 → 3: check on the server ------------------------------------------
  const missingRequired = IMPORT_FIELDS.filter(
    (f) => f.required && mapping[f.key] == null && !(f.key === 'quantity'),
  );
  const noPrice = mapping.rate == null && mapping.amount == null;

  const runPreview = (nextRows: PurchaseImportRow[], nextMap: Record<string, string>) => {
    const body: PurchaseImportRequest = { rows: nextRows, categoryMap: nextMap };
    previewMutation.mutate(body, {
      onSuccess: (data) => {
        setPreview(data);
        setStep('review');
      },
    });
  };

  const checkRows = () => {
    if (!sheet) return;
    const mapped = mapRows(sheet, { headerRow, mapping, fillDown });
    setRows(mapped.rows);
    setSkippedRows(mapped.skipped);
    runPreview(mapped.rows, categoryMap);
  };

  const setCategoryFor = (name: string, categoryId: string) => {
    const next = { ...categoryMap };
    if (categoryId) next[name.toLowerCase()] = categoryId;
    else delete next[name.toLowerCase()];
    setCategoryMap(next);
    runPreview(rows, next);
  };

  // --- Step 3 → 4: save -----------------------------------------------------------
  const doImport = () => {
    setConfirmOpen(false);
    commitMutation.mutate(
      { rows, categoryMap, markPaid: markPaid ? { paymentMode } : null },
      {
        onSuccess: (data) => {
          setResult(data);
          setStep('done');
        },
      },
    );
  };

  const reset = () => {
    setStep('upload');
    setWorkbook(null);
    setPreview(null);
    setResult(null);
    setRows([]);
    setCategoryMap({});
    previewMutation.reset();
    commitMutation.reset();
  };

  if (allShops) {
    return (
      <div>
        <PageHeader title="Import purchases" backTo="/purchases" />
        <div className="rounded-lg border bg-card p-6 text-sm">
          Switch to a single shop in the header first — imported purchases are added to the shop you're in.
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="Import purchases"
        description="Bring in purchase invoices from Tally or any Excel sheet."
        backTo="/purchases"
        badge={<Badge tone="primary">Into {shopName ?? 'this shop'}{shopCode ? ` (${shopCode})` : ''}</Badge>}
      />

      <Stepper step={step} />

      {/* ------------------------------ Upload ------------------------------ */}
      {step === 'upload' && (
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_22rem]">
          <DropZone onFile={loadFile} busy={reading} error={readError} />
          <div className="rounded-lg border bg-card p-5 text-sm">
            <h2 className="text-title mb-2">Exporting from Tally</h2>
            <ol className="list-decimal space-y-1.5 pl-5 text-muted-foreground">
              <li>Open <strong className="text-foreground">Purchase Register</strong> (Display More Reports › Account Books).</li>
              <li>Choose the period, and show it <strong className="text-foreground">item-wise</strong> (detailed) so each product is on its own line.</li>
              <li>Export (Alt+E) as <strong className="text-foreground">Excel</strong>.</li>
            </ol>
            <p className="mt-3 text-muted-foreground">
              Nothing is saved until you review it. Invoices already recorded for a supplier are skipped, so
              importing the same file twice is safe.
            </p>
          </div>
        </div>
      )}

      {/* ------------------------------ Map columns ------------------------------ */}
      {step === 'map' && workbook && sheet && (
        <div className="space-y-5">
          <div className="flex flex-wrap items-end gap-4 rounded-lg border bg-card p-4">
            <div className="flex items-center gap-2 text-sm">
              <FileSpreadsheet className="h-4 w-4 text-primary" />
              <span className="font-medium">{workbook.fileName}</span>
              <span className="text-muted-foreground">· {sheet.rows.slice(headerRow + 1).filter((r) => r.some((c) => c !== '' && c != null)).length} rows</span>
            </div>
            {workbook.sheets.length > 1 && (
              <label className="text-sm">
                <span className="mb-1 block text-xs font-medium text-muted-foreground">Sheet</span>
                <Select value={sheetIndex} onChange={(e) => changeSheet(Number(e.target.value))} className="w-48">
                  {workbook.sheets.map((s, i) => (
                    <option key={s.name} value={i}>{s.name} ({s.rows.length} rows)</option>
                  ))}
                </Select>
              </label>
            )}
            <label className="text-sm">
              <span className="mb-1 block text-xs font-medium text-muted-foreground">Headings are on row</span>
              <Input
                type="number"
                min={1}
                value={sheet.rowOffset + headerRow + 1}
                onChange={(e) => changeHeaderRow(Number(e.target.value) || 1)}
                className="w-24"
              />
            </label>
            <label className="flex items-center gap-2 pb-2 text-sm">
              <input
                type="checkbox"
                checked={fillDown}
                onChange={(e) => setFillDown(e.target.checked)}
                className="h-4 w-4 accent-[hsl(var(--primary))]"
              />
              Fill blank invoice cells from the row above
              <span className="text-xs text-muted-foreground">(Tally prints date and supplier once per invoice)</span>
            </label>
            <Button variant="ghost" size="sm" className="ml-auto" onClick={reset}>Choose another file</Button>
          </div>

          <SheetPeek rows={sheet.rows} headerRow={headerRow} rowOffset={sheet.rowOffset} />

          <div className="rounded-lg border bg-card">
            <div className="border-b px-5 py-3">
              <h2 className="text-title">Match the columns</h2>
              <p className="text-caption">
                Columns with familiar headings are matched for you. Check each one; leave a field as
                “Not in sheet” if the file doesn't have it.
              </p>
            </div>
            <div className="divide-y">
              {(['Invoice', 'Supplier', 'Product', 'Amounts'] as const).map((group) => (
                <div key={group} className="px-5 py-3">
                  <p className="text-overline mb-2">{group}</p>
                  <div className="grid gap-x-6 gap-y-2 md:grid-cols-2">
                    {IMPORT_FIELDS.filter((f) => f.group === group).map((field) => {
                      const col = mapping[field.key];
                      const raw = sampleValue(sheet, headerRow, col);
                      const sample = field.key === 'invoiceDate' && raw ? parseDateCell(Number(raw) || raw) : raw;
                      return (
                        <div key={field.key} className="grid grid-cols-[minmax(0,11rem)_minmax(0,1fr)] items-center gap-3">
                          <span className="text-sm" title={field.hint}>
                            {field.label}
                            {field.required && <span className="text-destructive"> *</span>}
                          </span>
                          <div className="min-w-0">
                            <Select
                              value={col ?? ''}
                              onChange={(e) =>
                                setMapping((m) => {
                                  const next = { ...m };
                                  if (e.target.value === '') delete next[field.key as ImportFieldKey];
                                  else next[field.key as ImportFieldKey] = Number(e.target.value);
                                  return next;
                                })
                              }
                              className={cn('h-8 text-sm', field.required && col == null && 'border-destructive')}
                            >
                              <option value="">— Not in sheet —</option>
                              {headers.map((h, i) => (
                                <option key={i} value={i}>
                                  {columnLetter(i + sheet.colOffset)} · {String(h || '(no heading)')}
                                </option>
                              ))}
                            </Select>
                            {sample && <p className="mt-0.5 truncate text-xs text-muted-foreground">e.g. {sample}</p>}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3 border-t bg-subtle px-5 py-3">
              <div className="text-sm">
                {missingRequired.length > 0 ? (
                  <span className="text-destructive">
                    Still to match: {missingRequired.map((f) => f.label).join(', ')}
                  </span>
                ) : noPrice ? (
                  <span className="text-destructive">Match either the rate or the line amount.</span>
                ) : (
                  <span className="text-muted-foreground">
                    {mapping.quantity == null ? 'No quantity column — every line counts as 1 unit. ' : ''}
                    Ready to check.
                  </span>
                )}
              </div>
              <Button
                onClick={checkRows}
                disabled={missingRequired.length > 0 || noPrice}
                loading={previewMutation.isPending}
              >
                Check rows
              </Button>
            </div>
            {previewMutation.isError && (
              <p className="px-5 pb-3 text-sm text-destructive">{apiError(previewMutation.error)}</p>
            )}
          </div>
        </div>
      )}

      {/* ------------------------------ Review ------------------------------ */}
      {step === 'review' && preview && (
        <Review
          preview={preview}
          skippedRows={skippedRows}
          categoryOptions={categoryOptions}
          categoryMap={categoryMap}
          onCategory={setCategoryFor}
          rechecking={previewMutation.isPending}
          markPaid={markPaid}
          setMarkPaid={setMarkPaid}
          paymentMode={paymentMode}
          setPaymentMode={setPaymentMode}
          onBack={() => setStep('map')}
          onImport={() => setConfirmOpen(true)}
          importing={commitMutation.isPending}
          importError={commitMutation.isError ? apiError(commitMutation.error) : null}
        />
      )}

      {/* ------------------------------ Done ------------------------------ */}
      {step === 'done' && result && <Done result={result} onAgain={reset} />}

      <ConfirmDialog
        isOpen={confirmOpen}
        onCancel={() => setConfirmOpen(false)}
        onConfirm={doImport}
        title="Import purchases?"
        message={
          preview
            ? `${preview.summary.ready} invoice(s) with ${preview.invoices
                .filter((i) => !i.errors.length && !i.duplicateOf)
                .reduce((s, i) => s + i.unitCount, 0)} unit(s) will be added to ${shopName ?? 'this shop'}` +
              (markPaid ? ', marked as paid.' : ', with the full amount still owed.') +
              ' Invoices with problems are left out.'
            : ''
        }
        confirmText="Import"
        loading={commitMutation.isPending}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------

function Stepper({ step }: { step: Step }) {
  const steps: Array<{ key: Step; label: string }> = [
    { key: 'upload', label: 'Upload' },
    { key: 'map', label: 'Match columns' },
    { key: 'review', label: 'Review' },
    { key: 'done', label: 'Done' },
  ];
  const at = steps.findIndex((s) => s.key === step);
  return (
    <ol className="flex flex-wrap items-center gap-2 text-sm">
      {steps.map((s, i) => (
        <li key={s.key} className="flex items-center gap-2">
          <span
            className={cn(
              'flex h-6 w-6 items-center justify-center rounded-full text-xs font-semibold',
              i < at && 'bg-primary text-primary-foreground',
              i === at && 'bg-primary-muted text-primary ring-1 ring-primary',
              i > at && 'bg-muted text-muted-foreground',
            )}
          >
            {i + 1}
          </span>
          <span className={cn(i === at ? 'font-semibold' : 'text-muted-foreground')}>{s.label}</span>
          {i < steps.length - 1 && <span className="mx-1 h-px w-6 bg-border" aria-hidden />}
        </li>
      ))}
    </ol>
  );
}

function DropZone({ onFile, busy, error }: { onFile: (f: File) => void; busy: boolean; error: string | null }) {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  return (
    <div>
      <button
        type="button"
        onClick={() => input.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          const f = e.dataTransfer.files?.[0];
          if (f) onFile(f);
        }}
        className={cn(
          'flex w-full flex-col items-center justify-center gap-3 rounded-lg border-2 border-dashed bg-card px-6 py-16 text-center transition-colors',
          over ? 'border-primary bg-primary-muted' : 'border-border-strong hover:border-primary',
        )}
      >
        {busy ? <Loader2 className="h-8 w-8 animate-spin text-primary" /> : <Upload className="h-8 w-8 text-primary" />}
        <span className="text-base font-semibold">{busy ? 'Reading the file…' : 'Drop the Excel file here, or click to choose'}</span>
        <span className="text-sm text-muted-foreground">.xlsx, .xls or .csv — up to 30 MB</span>
      </button>
      <input
        ref={input}
        type="file"
        accept=".xlsx,.xls,.csv"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onFile(f);
          e.target.value = '';
        }}
      />
      {error && (
        <p className="mt-2 flex items-center gap-1.5 text-sm text-destructive">
          <AlertCircle className="h-4 w-4" /> {error}
        </p>
      )}
    </div>
  );
}

/** The first few rows around the heading row, so the person can see what they're mapping. */
function SheetPeek({ rows, headerRow, rowOffset }: { rows: unknown[][]; headerRow: number; rowOffset: number }) {
  const start = Math.max(0, headerRow - 1);
  const slice = rows.slice(start, headerRow + 6);
  const width = Math.min(Math.max(...slice.map((r) => r.length), 0), 30);
  return (
    <div className="overflow-x-auto rounded-lg border bg-card">
      <table className="w-full text-xs">
        <tbody>
          {slice.map((row, i) => {
            const rowIndex = start + i;
            const isHeader = rowIndex === headerRow;
            return (
              <tr key={rowIndex} className={cn('border-b last:border-0', isHeader && 'bg-primary-muted font-semibold')}>
                <td className="w-10 bg-subtle px-2 py-1.5 text-right font-mono text-muted-foreground">{rowOffset + rowIndex + 1}</td>
                {Array.from({ length: width }, (_, c) => (
                  <td key={c} className="max-w-[12rem] truncate whitespace-nowrap px-2 py-1.5">
                    {String(row[c] ?? '')}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function Review(props: {
  preview: PurchaseImportPreview;
  skippedRows: number[];
  categoryOptions: Array<{ id: string; label: string }>;
  categoryMap: Record<string, string>;
  onCategory: (name: string, id: string) => void;
  rechecking: boolean;
  markPaid: boolean;
  setMarkPaid: (v: boolean) => void;
  paymentMode: 'cash' | 'upi' | 'bank_transfer' | 'cheque';
  setPaymentMode: (v: 'cash' | 'upi' | 'bank_transfer' | 'cheque') => void;
  onBack: () => void;
  onImport: () => void;
  importing: boolean;
  importError: string | null;
}) {
  const { preview } = props;
  const [filter, setFilter] = useState<InvoiceFilter>('all');
  const [page, setPage] = useState(0);
  const [open, setOpen] = useState<Set<string>>(new Set());

  const filtered = preview.invoices.filter((inv) =>
    filter === 'ready'
      ? !inv.errors.length && !inv.duplicateOf
      : filter === 'problems'
        ? inv.errors.length > 0
        : filter === 'duplicates'
          ? !!inv.duplicateOf
          : true,
  );
  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const shown = filtered.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE);
  const readyValue = preview.invoices
    .filter((i) => !i.errors.length && !i.duplicateOf)
    .reduce((s, i) => s + i.netAmount, 0);

  const toggle = (key: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <StatCard label="Invoices found" value={preview.summary.invoices} />
        <StatCard label="Ready to import" value={preview.summary.ready} tone="success" />
        <StatCard label="Units (products)" value={preview.summary.units} />
        <StatCard label="New suppliers" value={preview.summary.newDistributors} tone="info" />
        <StatCard label="Already recorded" value={preview.summary.duplicates} />
        <StatCard label="With problems" value={preview.summary.withErrors} tone={preview.summary.withErrors ? 'destructive' : 'default'} />
      </div>

      {preview.unknownCategories.length > 0 && (
        <div className="rounded-lg border border-warning/30 bg-card">
          <div className="border-b px-5 py-3">
            <h2 className="text-title flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-warning" /> Choose a category for these product types
            </h2>
            <p className="text-caption">
              They don't match any of your categories by name. Pick the right one; the rows are re-checked straight away.
            </p>
          </div>
          <div className="divide-y">
            {preview.unknownCategories.map((u) => (
              <div key={u.name || '(blank)'} className="flex flex-wrap items-center gap-3 px-5 py-2.5">
                <span className="min-w-[12rem] text-sm font-medium">
                  {u.name || <em className="text-muted-foreground">No product type given</em>}
                </span>
                <span className="text-xs text-muted-foreground">{u.rows} row{u.rows === 1 ? '' : 's'}</span>
                <Select
                  value={props.categoryMap[u.name.toLowerCase()] ?? ''}
                  onChange={(e) => props.onCategory(u.name, e.target.value)}
                  className="ml-auto h-8 w-full max-w-sm text-sm"
                  disabled={props.rechecking}
                >
                  <option value="">Choose a category…</option>
                  {props.categoryOptions.map((c) => (
                    <option key={c.id} value={c.id}>{c.label}</option>
                  ))}
                </Select>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="rounded-lg border bg-card">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b px-4 py-2.5">
          <Tabs
            aria-label="Filter invoices"
            size="sm"
            value={filter}
            onChange={(v) => {
              setFilter(v);
              setPage(0);
            }}
            items={[
              { value: 'all', label: 'All', count: preview.invoices.length },
              { value: 'ready', label: 'Ready', count: preview.summary.ready },
              { value: 'problems', label: 'Problems', count: preview.summary.withErrors },
              { value: 'duplicates', label: 'Already recorded', count: preview.summary.duplicates },
            ]}
          />
          {props.rechecking && (
            <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Re-checking…
            </span>
          )}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[860px] text-sm">
            <thead>
              <tr className="border-b bg-subtle text-left text-xs text-muted-foreground">
                <th className="w-8 px-3 py-2" />
                <th className="px-3 py-2 font-medium">Date</th>
                <th className="px-3 py-2 font-medium">Invoice</th>
                <th className="px-3 py-2 font-medium">Supplier</th>
                <th className="px-3 py-2 text-right font-medium">Units</th>
                <th className="px-3 py-2 text-right font-medium">Net amount</th>
                <th className="px-3 py-2 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((inv) => (
                <InvoiceRow key={inv.key} inv={inv} open={open.has(inv.key)} onToggle={() => toggle(inv.key)} />
              ))}
              {shown.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-3 py-8 text-center text-muted-foreground">Nothing here.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        {pages > 1 && (
          <div className="flex items-center justify-end gap-2 border-t px-4 py-2 text-sm">
            <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage(page - 1)}>Previous</Button>
            <span className="text-muted-foreground">Page {page + 1} of {pages}</span>
            <Button variant="outline" size="sm" disabled={page >= pages - 1} onClick={() => setPage(page + 1)}>Next</Button>
          </div>
        )}
      </div>

      {props.skippedRows.length > 0 && (
        <p className="text-xs text-muted-foreground">
          Left out {props.skippedRows.length} blank or total line{props.skippedRows.length === 1 ? '' : 's'}
          {props.skippedRows.length <= 12 ? ` (rows ${props.skippedRows.join(', ')})` : ''}.
        </p>
      )}

      <div className="flex flex-wrap items-center justify-between gap-4 rounded-lg border bg-card px-5 py-4">
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={props.markPaid}
              onChange={(e) => props.setMarkPaid(e.target.checked)}
              className="h-4 w-4 accent-[hsl(var(--primary))]"
            />
            These invoices are already paid
          </label>
          {props.markPaid && (
            <Select
              value={props.paymentMode}
              onChange={(e) => props.setPaymentMode(e.target.value as typeof props.paymentMode)}
              className="h-8 w-40 text-sm"
            >
              <option value="bank_transfer">Bank transfer</option>
              <option value="cheque">Cheque</option>
              <option value="upi">UPI</option>
              <option value="cash">Cash</option>
            </Select>
          )}
          {!props.markPaid && <span className="text-xs text-muted-foreground">Otherwise the full amount shows as owed to each supplier.</span>}
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={props.onBack}>Back to columns</Button>
          <Button
            onClick={props.onImport}
            disabled={preview.summary.ready === 0 || props.rechecking}
            loading={props.importing}
          >
            Import {preview.summary.ready} invoice{preview.summary.ready === 1 ? '' : 's'} · {formatINR(readyValue)}
          </Button>
        </div>
        {props.importError && <p className="w-full text-sm text-destructive">{props.importError}</p>}
      </div>
    </div>
  );
}

function InvoiceRow({ inv, open, onToggle }: { inv: PurchaseImportPreviewInvoice; open: boolean; onToggle: () => void }) {
  const status = inv.duplicateOf ? (
    <Badge tone="neutral">Already recorded</Badge>
  ) : inv.errors.length > 0 ? (
    <Badge tone="danger" dot>{inv.errors.length} problem{inv.errors.length === 1 ? '' : 's'}</Badge>
  ) : (
    <Badge tone="success" dot>Ready{inv.warnings.length ? ` · ${inv.warnings.length} note${inv.warnings.length === 1 ? '' : 's'}` : ''}</Badge>
  );
  return (
    <>
      <tr className="cursor-pointer border-b hover:bg-subtle" onClick={onToggle}>
        <td className="px-3 py-2 text-muted-foreground">
          {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        </td>
        <td className="whitespace-nowrap px-3 py-2">{/^\d{4}-\d{2}-\d{2}$/.test(inv.invoiceDate) ? formatDateIN(inv.invoiceDate) : inv.invoiceDate || '—'}</td>
        <td className="px-3 py-2 font-mono text-xs">{inv.invoiceNumber || '—'}</td>
        <td className="px-3 py-2">
          <span className="font-medium">{inv.distributor.name || '—'}</span>{' '}
          {inv.distributor.matchedId ? (
            inv.distributor.matchedName !== inv.distributor.name && (
              <span className="text-xs text-muted-foreground">→ {inv.distributor.matchedName}</span>
            )
          ) : (
            inv.distributor.name && <Badge tone="info" className="ml-1">New</Badge>
          )}
        </td>
        <td className="px-3 py-2 text-right font-mono">{inv.unitCount}</td>
        <td className="px-3 py-2 text-right font-mono">{formatINR(inv.netAmount)}</td>
        <td className="px-3 py-2">{status}</td>
      </tr>
      {open && (
        <tr className="border-b bg-subtle/60">
          <td />
          <td colSpan={6} className="px-3 py-3">
            {inv.errors.length > 0 && (
              <ul className="mb-2 space-y-0.5 text-sm text-destructive">
                {inv.errors.map((e) => <li key={e}>• {e}</li>)}
              </ul>
            )}
            {inv.warnings.length > 0 && (
              <ul className="mb-2 space-y-0.5 text-sm text-warning">
                {inv.warnings.map((w) => <li key={w}>• {w}</li>)}
              </ul>
            )}
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-muted-foreground">
                  <th className="py-1 pr-3 font-medium">Row</th>
                  <th className="py-1 pr-3 font-medium">Category</th>
                  <th className="py-1 pr-3 font-medium">Brand</th>
                  <th className="py-1 pr-3 font-medium">Item</th>
                  <th className="py-1 pr-3 text-right font-medium">Qty</th>
                  <th className="py-1 pr-3 text-right font-medium">Rate</th>
                  <th className="py-1 pr-3 text-right font-medium">GST</th>
                  <th className="py-1 text-right font-medium">MRP</th>
                </tr>
              </thead>
              <tbody>
                {inv.items.map((it) => (
                  <tr key={it.rowNumber} className="border-t border-border/60">
                    <td className="py-1 pr-3 font-mono text-muted-foreground">{it.rowNumber}</td>
                    <td className="py-1 pr-3">
                      {it.categoryLabel ?? <span className="text-destructive">{it.categoryName || 'none'}?</span>}
                    </td>
                    <td className="py-1 pr-3">{it.brand}</td>
                    <td className="py-1 pr-3">{it.modelNumber}{it.serialNumber ? <span className="text-muted-foreground"> · {it.serialNumber}</span> : null}</td>
                    <td className="py-1 pr-3 text-right font-mono">{it.quantity}</td>
                    <td className="py-1 pr-3 text-right font-mono">{formatINR(it.rate)}</td>
                    <td className="py-1 pr-3 text-right font-mono">{formatINR(it.gstAmount)}</td>
                    <td className="py-1 text-right font-mono">{formatINR(it.mrp)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </td>
        </tr>
      )}
    </>
  );
}

function Done({ result, onAgain }: { result: PurchaseImportResult; onAgain: () => void }) {
  const failed = result.results.filter((r) => r.status === 'failed');
  return (
    <div className="space-y-5">
      <div className="flex items-start gap-3 rounded-lg border border-success/30 bg-success-muted px-5 py-4">
        <CheckCircle2 className="mt-0.5 h-5 w-5 text-success" />
        <div className="text-sm">
          <p className="font-semibold">
            {result.created} invoice{result.created === 1 ? '' : 's'} imported
            {result.distributorsCreated > 0 && `, ${result.distributorsCreated} new supplier${result.distributorsCreated === 1 ? '' : 's'} added`}.
          </p>
          <p className="text-muted-foreground">
            {result.skipped > 0 && `${result.skipped} already recorded and skipped. `}
            {result.failed > 0 && `${result.failed} not imported — see below.`}
            {result.distributorsCreated > 0 && ' New suppliers were created with only a name (and GSTIN if given) — fill in their phone and address from the Distributors page.'}
          </p>
        </div>
      </div>
      {failed.length > 0 && (
        <div className="rounded-lg border bg-card">
          <h2 className="text-title border-b px-5 py-3">Not imported</h2>
          <ul className="divide-y text-sm">
            {failed.map((f) => (
              <li key={f.key} className="px-5 py-2">
                <span className="font-medium">{f.distributorName} · {f.invoiceNumber || '(no number)'}</span>
                <span className="text-destructive"> — {f.message}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      <div className="flex gap-2">
        <Link to="/purchases"><Button>Go to purchases</Button></Link>
        <Button variant="outline" onClick={onAgain}>Import another file</Button>
      </div>
    </div>
  );
}
