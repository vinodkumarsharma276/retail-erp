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
  ProductEnrichBatchModel,
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
import {
  applyClassifications,
  checkAgainstGrandTotal,
  describeTallyRead,
  looksLikeTallyRegister,
  readTallyRegister,
  type TallyRead,
} from '../../lib/tally-import';
import {
  describePurchaseSheet,
  readPurchaseSheet,
  type PurchaseSheetRead,
} from '../../lib/purchase-sheet-import';
import { ItemIdentifyStep, type IdentifyInvoice } from './ItemIdentifyStep';
import { usePurchaseImportCommitMutation, usePurchaseImportPreviewMutation } from '../../hooks/usePurchases';
import {
  useCategoryTreeQuery,
  useEnrichBatchMutation,
  useEnrichBatchStatusQuery,
} from '../../hooks/useProducts';
import { useShopStore, isAllShops } from '../../stores/shop-store';
import { PageHeader } from '../../components/PageHeader';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { Button } from '../../components/ui/button';
import { Badge } from '../../components/ui/badge';
import { Select } from '../../components/ui/select';
import { Input } from '../../components/ui/input';
import { Tabs } from '../../components/ui/tabs';
import { StatCard } from '../../components/ui/card';

type Step = 'upload' | 'map' | 'identify' | 'review' | 'done';
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
  // Set when the file is a Tally purchase register, which is read outright
  // rather than column-mapped.
  const [tally, setTally] = useState<TallyRead | null>(null);
  // The shop's own purchase sheet: flat columns, with IMEI numbers.
  const [purchaseSheet, setPurchaseSheet] = useState<PurchaseSheetRead | null>(null);
  const [fileName, setFileName] = useState<string>("");
  const [updateDistributors, setUpdateDistributors] = useState(true);

  const previewMutation = usePurchaseImportPreviewMutation();
  const commitMutation = usePurchaseImportCommitMutation();
  const { data: categoryTree } = useCategoryTreeQuery();
  const categoryOptions = useMemo(() => flattenCategories(categoryTree), [categoryTree]);
  const topLevelCategories = useMemo(
    () => (categoryTree ?? []).map((category) => ({ id: category.id, name: category.name })),
    [categoryTree],
  );

  /**
   * The sheet grouped the way the paper is: a bill from a supplier, with
   * the things on it underneath.
   *
   * A product arriving on two bills appears under both. That is not two
   * decisions — what it is, is held against the item name — so setting it
   * in either place sets it in both.
   */
  const identifyInvoices = useMemo<IdentifyInvoice[]>(() => {
    const byKey = new Map<string, IdentifyInvoice>();
    for (const row of tally?.rows ?? purchaseSheet?.rows ?? []) {
      const key = `${row.distributorName}|${row.invoiceNumber}`;
      let invoice = byKey.get(key);
      if (!invoice) {
        invoice = {
          key,
          invoiceNumber: row.invoiceNumber,
          voucherNumber: row.voucherNumber ?? null,
          supplier: row.distributorName,
          date: row.invoiceDate,
          units: 0,
          amount: 0,
          lines: [],
        };
        byKey.set(key, invoice);
      }
      invoice.units += row.quantity;
      invoice.amount += row.amount ?? (row.rate ?? 0) * row.quantity;
      invoice.lines.push({
        rowNumber: row.rowNumber,
        itemName: row.modelNumber,
        quantity: row.quantity,
        rate: row.rate ?? null,
      });
    }
    return [...byKey.values()];  }, [tally, purchaseSheet]);


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
      setFileName(file.name);

      // The shop's own sheet is tried first: it is the format they export
      // deliberately, and its columns are declared rather than guessed at.
      const own = readPurchaseSheet(wb);
      if (own && own.rows.length > 0 && own.columns.missingRequired.length === 0) {
        setPurchaseSheet(own);
        setTally(null);
        setRows(own.rows);
        setSkippedRows(own.parse.skipped.map((entry) => entry.rowNumber));
        setStep('identify');
        return;
      }
      if (own && own.columns.missingRequired.length > 0) {
        setReadError(
          `That sheet is missing ${own.columns.missingRequired.map((c) => c.label).join(", ")}. ` +
            own.columns.missingRequired.map((c) => c.purpose).join(" "),
        );
        return;
      }
      setPurchaseSheet(null);

      // A Tally purchase register has a fixed layout, so it is read as one
      // rather than put through column mapping: its "Particulars" column
      // means the supplier on a voucher row and the item on the rows under
      // it, which no single column mapping can express.
      const read = looksLikeTallyRegister(wb.sheets[biggest]) ? readTallyRegister(wb.sheets[biggest]) : null;
      if (read && read.rows.length > 0) {
        setTally(read);
        setRows(read.rows);
        setSkippedRows(read.parse.skipped.map((entry) => entry.rowNumber));
        setStep('identify');
        return;
      }
      setTally(null);
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

  /** Everything the server needs besides the rows themselves. */
  const importMeta = (): Partial<PurchaseImportRequest> => ({
    fileName,
    sourceFormat: tally ? 'tally_purchase_register' : 'mapped_columns',
    period: tally?.parse.period || undefined,
    sheetOwnerName: tally?.parse.ownerName || undefined,
    updateDistributors,
  });

  const runPreview = (
    nextRows: PurchaseImportRow[],
    nextMap: Record<string, string>,
    topUpSuppliers = updateDistributors,
  ) => {
    const body: PurchaseImportRequest = {
      rows: nextRows,
      categoryMap: nextMap,
      ...importMeta(),
      updateDistributors: topUpSuppliers,
    };
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
      { rows, categoryMap, markPaid: markPaid ? { paymentMode } : null, ...importMeta() },
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
    setTally(null);
    setPurchaseSheet(null);
    setFileName('');
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

      <Stepper step={step} tally={Boolean(tally || purchaseSheet)} />

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
      {step === 'identify' && purchaseSheet && (
        <div className="space-y-5">
          <SheetSummary read={purchaseSheet} fileName={fileName} />
          <ItemIdentifyStep
            itemNames={purchaseSheet.itemNames}
            invoices={identifyInvoices}
            categoryOptions={categoryOptions}
            topLevelCategories={topLevelCategories}
            onBack={() => setStep('upload')}
            continuing={previewMutation.isPending}
            onContinue={({ classifications }) => {
              const next = applyClassifications(purchaseSheet.rows, classifications);
              setRows(next);
              runPreview(next, categoryMap);
            }}
          />
          {previewMutation.isError && (
            <p className="text-sm text-destructive">{apiError(previewMutation.error)}</p>
          )}
        </div>
      )}

      {step === 'identify' && tally && (
        <div className="space-y-5">
          <TallySummary read={tally} fileName={fileName} />
          <ItemIdentifyStep
            itemNames={tally.itemNames}
            invoices={identifyInvoices}
            categoryOptions={categoryOptions}
            topLevelCategories={topLevelCategories}
            onBack={() => setStep('upload')}
            continuing={previewMutation.isPending}
            onContinue={({ classifications }) => {
              const next = applyClassifications(tally.rows, classifications);
              setRows(next);
              runPreview(next, categoryMap);
            }}
          />
          {previewMutation.isError && (
            <p className="text-sm text-destructive">{apiError(previewMutation.error)}</p>
          )}
        </div>
      )}

      {step === 'review' && preview && (
        <Review
          preview={preview}
          skippedRows={skippedRows}
          updateDistributors={updateDistributors}
          setUpdateDistributors={(value: boolean) => {
            setUpdateDistributors(value);
            // The preview reports which blanks would be filled, so recheck.
            runPreview(rows, categoryMap, value);
          }}
          categoryOptions={categoryOptions}
          categoryMap={categoryMap}
          onCategory={setCategoryFor}
          rechecking={previewMutation.isPending}
          markPaid={markPaid}
          setMarkPaid={setMarkPaid}
          paymentMode={paymentMode}
          setPaymentMode={setPaymentMode}
          onBack={() => setStep(tally || purchaseSheet ? 'identify' : 'map')}
          backLabel={tally || purchaseSheet ? 'Back to items' : 'Back to columns'}
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

function Stepper({ step, tally }: { step: Step; tally: boolean }) {
  const steps: Array<{ key: Step; label: string }> = [
    { key: 'upload', label: 'Upload' },
    // A Tally register needs no column matching; its items need identifying.
    tally ? { key: 'identify', label: 'Identify items' } : { key: 'map', label: 'Match columns' },
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
  /** Where Back goes: a Tally register has no column-matching step. */
  backLabel: string;
  updateDistributors: boolean;
  setUpdateDistributors: (value: boolean) => void;
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
  // Invoices show their items by default: what is about to be saved is the
  // whole point of this screen, and a click per invoice to see it meant
  // most were never looked at. The set now holds the ones collapsed.
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

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
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  return (
    <div className="space-y-5">
      {/* The sheet belongs to one shop. Importing it into another is the
          easiest mistake here, and the slowest to undo. */}
      {preview.shopCheck && !preview.shopCheck.matches && (
        <div className="flex items-start gap-3 rounded-lg border border-destructive/40 bg-destructive/5 p-4">
          <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-destructive" />
          <div className="text-sm">
            <p className="font-medium">This sheet may be for a different shop</p>
            <p className="mt-1 text-muted-foreground">
              It was exported for{" "}
              <span className="font-medium text-foreground">
                {preview.shopCheck.consigneeNames.join(", ") || preview.shopCheck.sheetOwnerName}
              </span>
              , but you are importing into{" "}
              <span className="font-medium text-foreground">{preview.shop.name}</span>. Switch shops in the header
              if that is wrong — these purchases and their stock go to the shop you are in.
            </p>
          </div>
        </div>
      )}

      {preview.summary.demoUnits > 0 && (
        <div className="flex items-start gap-3 rounded-lg border border-border bg-muted/30 p-4 text-sm">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
          <p>
            <span className="font-medium">{preview.summary.demoUnits} display piece
            {preview.summary.demoUnits === 1 ? "" : "s"}</span> in this sheet. They will be brought in as stock and
            marked as display units, so they are not sold as new.
          </p>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <StatCard label="Invoices found" value={preview.summary.invoices} />
        <StatCard label="Ready to import" value={preview.summary.ready} tone="success" />
        <StatCard label="Units (products)" value={preview.summary.units} />
        <StatCard label="New suppliers" value={preview.summary.newDistributors} tone="info" />
        <StatCard label="Already recorded" value={preview.summary.duplicates} />
        <StatCard label="With problems" value={preview.summary.withErrors} tone={preview.summary.withErrors ? 'destructive' : 'default'} />
      </div>

      {/* Suppliers already on file whose blanks this sheet can fill. */}
      <div className="rounded-lg border border-border bg-card px-5 py-4">
        <label className="flex items-start gap-3 text-sm">
          <input
            type="checkbox"
            checked={props.updateDistributors}
            onChange={(event) => props.setUpdateDistributors(event.target.checked)}
            className="mt-0.5 h-4 w-4 rounded border-border"
          />
          <span>
            <span className="font-medium">Fill in missing supplier details from this sheet</span>
            <span className="mt-0.5 block text-xs text-muted-foreground">
              Suppliers are matched on GSTIN first, then name. Only blank fields are filled — anything already
              entered is left exactly as it is.
            </span>
          </span>
        </label>
        {props.updateDistributors && preview.distributorUpdates.length > 0 && (
          <ul className="mt-3 space-y-1.5 border-t border-border pt-3 text-sm">
            {preview.distributorUpdates.map((update) => (
              <li key={update.distributorId}>
                <span className="font-medium">{update.name}</span>
                <span className="text-muted-foreground"> — {update.fields.map((f) => f.label).join(", ")}</span>
              </li>
            ))}
          </ul>
        )}
        {props.updateDistributors && preview.distributorUpdates.length === 0 && (
          <p className="mt-2 border-t border-border pt-3 text-xs text-muted-foreground">
            No supplier on file has a blank this sheet can fill.
          </p>
        )}
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
                <InvoiceRow key={inv.key} inv={inv} open={!collapsed.has(inv.key)} onToggle={() => toggle(inv.key)} />
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
          <Button variant="outline" onClick={props.onBack}>{props.backLabel}</Button>
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
        <td className="px-3 py-2 font-mono text-xs">
          {inv.invoiceNumber || '—'}
          {inv.voucherNumber && (
            <span className="mt-0.5 block font-sans text-[11px] text-muted-foreground">
              bill {inv.voucherNumber}
            </span>
          )}
        </td>
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
      {result.batchId && result.created > 0 && <FetchWebDetails batchId={result.batchId} />}
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

/** Models per pass. Small enough that progress moves, large enough to be quick. */
const DETAILS_PASS_SIZE = 5;

/**
 * Filling in what the register could not say, for a whole import run.
 *
 * A purchase register has no specification column of any kind, so every unit
 * it brings in starts with empty details and sits at cost. The lookup is one
 * web search per model — not per unit — but a month's register still names
 * around 200 models, which is far too long for one request. So it runs in
 * passes: each call takes the next few models and reports how many are left.
 * Stopping is safe, and starting again only fills what is still blank.
 */
function FetchWebDetails({ batchId }: { batchId: string }) {
  const { data: status } = useEnrichBatchStatusQuery(batchId);
  const pass = useEnrichBatchMutation();

  const [isRunning, setIsRunning] = useState(false);
  const [models, setModels] = useState<ProductEnrichBatchModel[]>([]);
  const [remaining, setRemaining] = useState<number | null>(null);
  const [unitsUpdated, setUnitsUpdated] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const stopRequested = useRef(false);
  // Frozen when a run starts: the status query refreshes as models get filled
  // in, so reading the denominator off it would make the bar shrink as it fills.
  const [plannedTotal, setPlannedTotal] = useState<number | null>(null);

  const processed = models.length;
  const total = plannedTotal ?? status?.pendingModels ?? 0;
  const filledModels = models.filter((model) => model.filled.length > 0 || model.mrpSuggestion !== null);

  const run = async () => {
    stopRequested.current = false;
    setPlannedTotal(processed + (remaining ?? status?.pendingModels ?? 0));
    setIsRunning(true);
    setError(null);
    setNotice(null);
    try {
      for (;;) {
        const result = await pass.mutateAsync({ batchId, limit: DETAILS_PASS_SIZE });
        if (!result.aiEnabled) {
          setNotice(result.message ?? 'Fetching product details is switched off.');
          break;
        }
        setModels((prev) => [...prev, ...result.models]);
        setUnitsUpdated((prev) => prev + result.unitsUpdated);
        setRemaining(result.remainingModels);
        if (result.remainingModels === 0 || stopRequested.current) break;
      }
    } catch (e) {
      setError(apiError(e));
    } finally {
      setIsRunning(false);
    }
  };

  if (status && status.aiEnabled && status.pendingModels === 0 && processed === 0) {
    return null;
  }

  return (
    <div className="rounded-lg border bg-card">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b px-5 py-3">
        <div>
          <h2 className="text-title">Fetch product details from the web</h2>
          <p className="text-caption">
            The register carried only costs, so these units have no specifications and no real
            MRP. Each model is looked up once and the answer applied to every unit of it.
          </p>
        </div>
        {status?.aiEnabled !== false && (
          <div className="flex shrink-0 gap-2">
            {isRunning ? (
              <Button variant="outline" onClick={() => { stopRequested.current = true; }}>
                Stop after this batch
              </Button>
            ) : (
              <Button onClick={run} disabled={remaining === 0}>
                {processed > 0 ? 'Carry on' : `Fetch details for ${total} model${total === 1 ? '' : 's'}`}
              </Button>
            )}
          </div>
        )}
      </div>

      <div className="space-y-3 px-5 py-4 text-sm">
        {status?.aiEnabled === false && (
          <p className="text-warning">
            Fetching details needs an AI key. Set OPENAI_API_KEY to look specifications up on the
            web — the units are imported either way and can be filled in by hand.
          </p>
        )}

        {notice && <p className="text-warning">{notice}</p>}

        {status?.aiEnabled && processed === 0 && !isRunning && !notice && (
          <p className="text-muted-foreground">
            {status.pendingModels} model{status.pendingModels === 1 ? '' : 's'} across{' '}
            {status.pendingUnits} unit{status.pendingUnits === 1 ? '' : 's'} have no details yet.
            This takes a few seconds per model, and you can stop and carry on later.
          </p>
        )}

        {(isRunning || processed > 0) && (
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              {isRunning && <Loader2 className="h-4 w-4 animate-spin text-primary" />}
              <span className="font-medium">
                {processed} of {total} model{total === 1 ? '' : 's'} looked up
              </span>
              <span className="text-muted-foreground">
                · details filled for {filledModels.length} · {unitsUpdated} unit
                {unitsUpdated === 1 ? '' : 's'} updated
              </span>
            </div>
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-primary transition-all"
                style={{ width: `${total > 0 ? Math.min(100, Math.round((processed / total) * 100)) : 0}%` }}
              />
            </div>
            {remaining === 0 && !isRunning && (
              <p className="text-success">
                Every model in this import has been looked up. Any MRP found is saved as a
                suggestion on the unit — nothing has been priced.
              </p>
            )}
          </div>
        )}

        {error && (
          <p className="flex items-start gap-2 text-destructive">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            {error}
          </p>
        )}

        {models.length > 0 && (
          <ul className="max-h-64 divide-y overflow-y-auto rounded-md border">
            {[...models].reverse().map((model) => (
              <li key={`${model.brand}-${model.modelNumber}`} className="px-3 py-2">
                <span className="font-medium">
                  {model.brand} {model.modelNumber}
                </span>
                <span className="text-muted-foreground"> · {model.units} unit{model.units === 1 ? '' : 's'}</span>
                {model.filled.length > 0 ? (
                  <span className="text-muted-foreground"> · {model.filled.join(', ')}</span>
                ) : (
                  <span className="text-muted-foreground"> · {model.note ?? 'nothing found'}</span>
                )}
                {model.mrpSuggestion !== null && (
                  <span className="text-muted-foreground"> · MRP suggestion {formatINR(model.mrpSuggestion)}</span>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

/**
 * What was read out of a Tally register, and whether it reconciles.
 *
 * The register prints its own Grand Total, which is the best proof that the
 * file was read correctly — so it is checked and shown before anything else.
 */
function TallySummary({ read, fileName }: { read: TallyRead; fileName: string }) {
  const checks = checkAgainstGrandTotal(read);
  const allOk = checks.length > 0 && checks.every((check) => check.ok);
  const issues = read.parse.vouchers.filter((voucher) => voucher.issues.length > 0);

  return (
    <div className="space-y-3 rounded-lg border border-border bg-card p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-title flex items-center gap-2">
            <FileSpreadsheet className="h-4 w-4 text-primary" />
            Tally purchase register
          </h2>
          <p className="text-caption">
            {fileName}
            {read.parse.period && <> · {read.parse.period}</>}
            {read.parse.ownerName && <> · {read.parse.ownerName}</>}
          </p>
        </div>
        <Badge tone="neutral">{describeTallyRead(read)}</Badge>
      </div>

      {checks.length > 0 && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-border pt-3 text-xs">
          <span className={cn("font-medium", allOk ? "text-success" : "text-destructive")}>
            {allOk ? 'Matches the sheet Grand Total' : 'Does not match the sheet Grand Total'}
          </span>
          {checks.map((check) => (
            <span key={check.label} className="inline-flex items-center gap-1 text-muted-foreground">
              {check.ok ? (
                <CheckCircle2 className="h-3.5 w-3.5 text-success" />
              ) : (
                <AlertCircle className="h-3.5 w-3.5 text-destructive" />
              )}
              {check.label}
            </span>
          ))}
        </div>
      )}

      {issues.length > 0 && (
        <div className="border-t border-border pt-3">
          <p className="text-sm font-medium text-warning">
            {issues.length} voucher{issues.length === 1 ? "" : "s"} do not add up in the sheet itself
          </p>
          <ul className="mt-1 space-y-0.5 text-xs text-muted-foreground">
            {issues.slice(0, 5).map((voucher) => (
              <li key={voucher.rowNumber}>
                Row {voucher.rowNumber}, {voucher.supplierName}: {voucher.issues[0]}
              </li>
            ))}
            {issues.length > 5 && <li>…and {issues.length - 5} more.</li>}
          </ul>
        </div>
      )}
    </div>
  );
}

/**
 * What was read out of the shop's own purchase sheet, and how its columns
 * lined up.
 *
 * The shops change their export over time, so the columns are reported
 * rather than silently coerced: anything unrecognised is shown with example
 * values, so a column added upstream is noticed here instead of going
 * quietly missing from the stock it should have described.
 */
function SheetSummary({ read, fileName }: { read: PurchaseSheetRead; fileName: string }) {
  const { columns } = read;
  const imeiCount = read.rows.reduce((sum, row) => sum + (row.unitImeis?.flat().length ?? 0), 0);

  return (
    <div className="space-y-3 rounded-lg border border-border bg-card p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-title flex items-center gap-2">
            <FileSpreadsheet className="h-4 w-4 text-primary" />
            Purchase sheet
          </h2>
          <p className="text-caption">
            {fileName}
            {read.parse.sheetName && <> · {read.parse.sheetName}</>}
            {read.imeiSheet && <> · IMEI numbers from “{read.imeiSheet.sheetName}”</>}
          </p>
        </div>
        <Badge tone="neutral">{describePurchaseSheet(read)}</Badge>
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-border pt-3 text-xs">
        <span className="inline-flex items-center gap-1 text-success">
          <CheckCircle2 className="h-3.5 w-3.5" />
          {columns.recognised.length} columns recognised
        </span>
        {imeiCount > 0 && (
          <span className="text-muted-foreground">{imeiCount} IMEI numbers matched to units</span>
        )}
        {columns.missingOptional.length > 0 && (
          <span className="text-muted-foreground">
            not in this sheet: {columns.missingOptional.join(", ")}
          </span>
        )}
      </div>

      {columns.unknown.length > 0 && (
        <div className="rounded-md border border-warning/40 bg-warning/10 p-3">
          <p className="flex items-center gap-2 text-sm font-medium">
            <AlertTriangle className="h-4 w-4 text-warning" />
            {columns.unknown.length} column{columns.unknown.length === 1 ? "" : "s"} this import does not know
          </p>
          <ul className="mt-2 space-y-1 text-xs">
            {columns.unknown.map((column) => (
              <li key={column.heading}>
                <span className="font-medium">{column.heading}</span>
                {column.samples.length > 0 && (
                  <span className="text-muted-foreground"> — for example {column.samples.join(", ")}</span>
                )}
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-muted-foreground">
            Their values are read but not stored anywhere yet. Tell me what they mean and I will add them as
            product fields; until then the rest of the sheet imports as normal.
          </p>
        </div>
      )}

      {read.imeiProblems.length > 0 && (
        <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3">
          <p className="flex items-center gap-2 text-sm font-medium">
            <AlertCircle className="h-4 w-4 text-destructive" />
            {read.imeiProblems.length} line{read.imeiProblems.length === 1 ? "" : "s"} whose IMEI numbers do not add up
          </p>
          <ul className="mt-1 space-y-0.5 text-xs text-muted-foreground">
            {read.imeiProblems.slice(0, 5).map((problem) => (
              <li key={problem.rowNumber}>
                Row {problem.rowNumber}, {problem.item}: {problem.issue}
              </li>
            ))}
          </ul>
        </div>
      )}

      {read.parse.invoices.some((invoice) => invoice.issues.length > 0) && (
        <div className="border-t border-border pt-3">
          <p className="text-sm font-medium text-warning">Some invoices do not hang together</p>
          <ul className="mt-1 space-y-0.5 text-xs text-muted-foreground">
            {read.parse.invoices.flatMap((invoice) =>
              invoice.issues.map((issue) => (
                <li key={`${invoice.key}-${issue}`}>
                  {invoice.invoiceNumber}: {issue}
                </li>
              )),
            ).slice(0, 5)}
          </ul>
        </div>
      )}
    </div>
  );
}
