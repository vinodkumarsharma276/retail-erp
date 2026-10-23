import { useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  FileSpreadsheet,
  Info,
  Loader2,
  Upload,
} from 'lucide-react';
import { cn } from '../../lib/utils';
import { Button } from '../../components/ui/button';
import { PageHeader } from '../../components/PageHeader';
import { useToast } from '../../stores/toast-store';
import {
  readCreditorWorkbook,
  REQUIRED_CREDITOR_COLUMNS,
  type CreditorWorkbook,
} from '../../lib/creditor-import';
import {
  useDistributorImportPreview,
  useDistributorImportMutation,
  type DistributorImportPreview,
  type DistributorImportResult,
} from '../../hooks/useDistributors';
import { creditorSheetCoverage } from '@retailerp/shared-utils';

/**
 * Bringing a Tally "Sundry Creditors" export in as suppliers.
 *
 * Three states on one screen: pick a file, look at what it says, press the
 * button. The sheet is read in the browser, so the wrong file is caught
 * before anything is sent anywhere, and the preview is answered by the
 * server — only it knows which of these suppliers it already has.
 */
export function DistributorImportPage() {
  const navigate = useNavigate();
  const toast = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [workbook, setWorkbook] = useState<CreditorWorkbook | null>(null);
  const [reading, setReading] = useState(false);
  const [readError, setReadError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [result, setResult] = useState<DistributorImportResult | null>(null);

  const previewMut = useDistributorImportPreview();
  const importMut = useDistributorImportMutation();
  const preview: DistributorImportPreview | undefined = previewMut.data;

  const handleFile = async (file: File) => {
    setReadError(null);
    setResult(null);
    previewMut.reset();
    importMut.reset();
    setReading(true);
    try {
      const wb = await readCreditorWorkbook(file);
      setWorkbook(wb);
      if (wb.missingColumns.length === 0 && wb.rows.length > 0) {
        previewMut.mutate(wb.rows, {
          onError: () => toast.error('Could not check the sheet against your suppliers.'),
        });
      }
    } catch (error) {
      setWorkbook(null);
      setReadError(
        error instanceof Error ? error.message : 'That file could not be read as a spreadsheet.',
      );
    } finally {
      setReading(false);
    }
  };

  const onDrop = (event: React.DragEvent) => {
    event.preventDefault();
    setDragging(false);
    const file = event.dataTransfer.files?.[0];
    if (file) void handleFile(file);
  };

  const startOver = () => {
    setWorkbook(null);
    setResult(null);
    setReadError(null);
    previewMut.reset();
    importMut.reset();
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  // ---------------------------------------------------------------- Done
  if (result) {
    return (
      <div className="mx-auto max-w-[900px]">
        <PageHeader title="Suppliers imported" description={workbook?.fileName} />
        <div className="rounded-lg border bg-card p-6">
          <div className="flex items-start gap-3">
            <CheckCircle2 className="mt-0.5 h-6 w-6 shrink-0 text-primary" />
            <div>
              <p className="text-lg font-medium">
                {result.created} supplier{result.created === 1 ? '' : 's'} added.
              </p>
              <p className="mt-1 text-sm text-muted-foreground">
                {result.filled > 0 && (
                  <>
                    {result.filled} existing supplier{result.filled === 1 ? '' : 's'} had missing
                    details filled in.{' '}
                  </>
                )}
                {result.unchanged > 0 && (
                  <>
                    {result.unchanged} {result.unchanged === 1 ? 'was' : 'were'} already complete
                    and left alone.
                  </>
                )}
              </p>
            </div>
          </div>
          <div className="mt-6 flex flex-wrap gap-3">
            <Link to="/distributors">
              <Button>Go to distributors</Button>
            </Link>
            <Button variant="outline" onClick={startOver}>
              Import another sheet
            </Button>
          </div>
        </div>
      </div>
    );
  }

  const coverage = workbook ? creditorSheetCoverage(workbook.rows) : [];
  const rowsWithRejects = workbook?.rows.filter((r) => r.rejected.length > 0) ?? [];
  const withBalance = workbook?.rows.filter((r) => r.balances.net !== 0).length ?? 0;
  const ready = Boolean(preview && workbook && workbook.missingColumns.length === 0);
  /** Every supplier in the sheet is already here, complete. */
  const nothingToDo = preview != null && preview.counts.create === 0 && preview.counts.fill === 0;

  return (
    <div className="mx-auto max-w-[1100px]">
      <div className="mb-6 flex items-center gap-4">
        <button
          onClick={() => navigate('/distributors')}
          className="rounded-md p-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          aria-label="Back to distributors"
        >
          <ArrowLeft className="h-5 w-5" />
        </button>
        <div>
          <h1 className="text-display">Import suppliers</h1>
          <p className="text-caption mt-0.5">
            A Tally &ldquo;Sundry Creditors&rdquo; export, as Excel or CSV.
          </p>
        </div>
      </div>

      {/* ------------------------------------------------------- Pick a file */}
      {!workbook && (
        <>
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={onDrop}
            className={cn(
              'flex flex-col items-center justify-center rounded-lg border-2 border-dashed p-12 text-center transition-colors',
              dragging ? 'border-primary bg-primary/5' : 'border-border bg-card',
            )}
          >
            {reading ? (
              <>
                <Loader2 className="h-10 w-10 animate-spin text-primary" />
                <p className="mt-4 text-sm text-muted-foreground">Reading the sheet...</p>
              </>
            ) : (
              <>
                <FileSpreadsheet className="h-10 w-10 text-muted-foreground" />
                <p className="mt-4 font-medium">Drop the creditors export here</p>
                <p className="text-caption mt-1">.xlsx, .xls or .csv</p>
                <Button
                  className="mt-4"
                  onClick={() => fileInputRef.current?.click()}
                  icon={<Upload className="h-3.5 w-3.5" />}
                >
                  Choose file
                </Button>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".xlsx,.xls,.csv"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) void handleFile(file);
                  }}
                />
              </>
            )}
          </div>

          {readError && (
            <div className="mt-4 flex items-start gap-2 rounded-lg border border-destructive/50 bg-destructive/10 p-4 text-sm text-destructive">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{readError}</span>
            </div>
          )}

          <div className="mt-6 rounded-lg border bg-muted/30 p-4 text-sm text-muted-foreground">
            <p className="font-medium text-foreground">What the sheet needs</p>
            <p className="mt-1">
              A header row with at least{' '}
              {REQUIRED_CREDITOR_COLUMNS.map((c, i) => (
                <span key={c}>
                  {i > 0 && ', '}
                  <code className="rounded bg-muted px-1 py-0.5 text-xs">{c}</code>
                </span>
              ))}
              . Phone, PIN code and the rest are taken when they are there and left blank when
              they are not — the supplier still comes in, and the list shows what is missing.
            </p>
            <p className="mt-2">
              Balances are not imported. What the shop owes is worked out from the purchases it
              actually has, so a closing balance is kept on the record but never acted on.
            </p>
          </div>
        </>
      )}

      {/* -------------------------------------------------------- Look at it */}
      {workbook && (
        <div className="space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-card px-4 py-3">
            <div className="flex items-center gap-2 text-sm">
              <FileSpreadsheet className="h-4 w-4 text-muted-foreground" />
              <span className="font-medium">{workbook.fileName}</span>
              <span className="text-muted-foreground">
                · sheet &ldquo;{workbook.sheetName}&rdquo; · {workbook.rows.length} supplier
                {workbook.rows.length === 1 ? '' : 's'}
              </span>
            </div>
            <Button variant="outline" size="sm" onClick={startOver}>
              Choose a different file
            </Button>
          </div>

          {workbook.missingColumns.length > 0 ? (
            <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-4 text-sm">
              <p className="flex items-center gap-2 font-medium text-destructive">
                <AlertTriangle className="h-4 w-4" />
                This does not look like a creditors export.
              </p>
              <p className="mt-2 text-muted-foreground">
                Missing column{workbook.missingColumns.length === 1 ? '' : 's'}:{' '}
                {workbook.missingColumns.map((c) => `"${c}"`).join(', ')}.
              </p>
              <p className="mt-1 text-muted-foreground">
                The sheet has: {workbook.headers.slice(0, 12).join(', ')}
                {workbook.headers.length > 12 ? '…' : ''}
              </p>
            </div>
          ) : (
            <>
              {/* What would happen */}
              <div className="rounded-lg border bg-card p-5">
                <h2 className="text-sm font-medium">What this will do</h2>
                {previewMut.isPending ? (
                  <p className="mt-3 flex items-center gap-2 text-sm text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Checking against the suppliers you already have...
                  </p>
                ) : preview ? (
                  <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
                    <Stat label="New suppliers" value={preview.counts.create} tone="primary" />
                    <Stat label="Details filled in" value={preview.counts.fill} />
                    <Stat label="Already there, untouched" value={preview.counts.unchanged} />
                  </div>
                ) : (
                  <p className="mt-3 text-sm text-destructive">
                    Could not check the sheet. Try choosing the file again.
                  </p>
                )}
              </div>

              {/* What the sheet could supply */}
              <div className="rounded-lg border bg-card p-5">
                <h2 className="text-sm font-medium">What the sheet could supply</h2>
                <p className="text-caption mt-0.5">
                  Blanks are not a problem — each supplier shows what it still needs.
                </p>
                <div className="mt-3 grid grid-cols-2 gap-x-6 gap-y-2 sm:grid-cols-4">
                  {coverage.map((c) => (
                    <div key={c.label} className="text-sm">
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="text-muted-foreground">{c.label}</span>
                        <span className="font-medium tabular-nums">
                          {c.filled}/{c.total}
                        </span>
                      </div>
                      <div className="mt-1 h-1 overflow-hidden rounded-full bg-muted">
                        <div
                          className="h-full rounded-full bg-primary"
                          style={{ width: `${c.total ? (c.filled / c.total) * 100 : 0}%` }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
                <p className="text-caption mt-3">
                  City is read out of the address where a known place name is in there; PAN comes
                  from the GSTIN when the PAN column is empty. Bank details are never in a
                  creditors export.
                </p>
              </div>

              {/* Things worth seeing before pressing the button */}
              {workbook.gstCollisions.length > 0 && (
                <Notice
                  tone="warning"
                  title={`${workbook.gstCollisions.length} GSTIN${workbook.gstCollisions.length === 1 ? '' : 's'} on more than one row`}
                >
                  <p>
                    One business, two ledgers. Both come in — merge them on the Distributors
                    screen once you have decided which name is the real one.
                  </p>
                  <ul className="mt-2 space-y-1">
                    {workbook.gstCollisions.map((c) => (
                      <li key={c.gstin}>
                        <code className="text-xs">{c.gstin}</code> — {c.names.join('  |  ')}
                      </li>
                    ))}
                  </ul>
                </Notice>
              )}

              {rowsWithRejects.length > 0 && (
                <Notice
                  tone="warning"
                  title={`${rowsWithRejects.length} row${rowsWithRejects.length === 1 ? '' : 's'} with a value that cannot be stored`}
                >
                  <p>
                    The supplier still comes in; only that one field is left blank. These are
                    typos, and Tally is where they can be fixed.
                  </p>
                  <ul className="mt-2 space-y-1">
                    {rowsWithRejects.slice(0, 10).map((r) =>
                      r.rejected.map((bad) => (
                        <li key={`${r.rowNumber}-${bad.field}`}>
                          Row {r.rowNumber} · {r.companyName} — {bad.field}:{' '}
                          <code className="text-xs">&ldquo;{bad.value}&rdquo;</code>
                        </li>
                      )),
                    )}
                  </ul>
                  {rowsWithRejects.length > 10 && (
                    <p className="mt-1">…and {rowsWithRejects.length - 10} more.</p>
                  )}
                </Notice>
              )}

              {workbook.skipped.length > 0 && (
                <Notice tone="info" title={`${workbook.skipped.length} row(s) skipped`}>
                  <p>
                    {workbook.skipped
                      .slice(0, 8)
                      .map((s) => `row ${s.rowNumber} (${s.reason})`)
                      .join(', ')}
                    {workbook.skipped.length > 8 ? '…' : ''}
                  </p>
                </Notice>
              )}

              {withBalance > 0 && (
                <Notice tone="info" title={`${withBalance} supplier(s) carry a balance in Tally`}>
                  <p>
                    No money is imported. Those figures are kept on the record, but what the shop
                    owes is worked out from the purchases it actually has — inventing purchases to
                    carry a balance would put stock in the system that never arrived.
                  </p>
                </Notice>
              )}

              {/* The rows themselves */}
              {preview && (
                <div className="overflow-hidden rounded-lg border bg-card">
                  <div className="border-b px-4 py-3">
                    <h2 className="text-sm font-medium">
                      Every row ({preview.rows.length})
                    </h2>
                  </div>
                  <div className="max-h-[420px] overflow-y-auto">
                    <table className="w-full text-sm">
                      <thead className="sticky top-0 bg-muted/60 backdrop-blur">
                        <tr className="text-overline">
                          <th className="px-3 py-2 text-left">Row</th>
                          <th className="px-3 py-2 text-left">Supplier</th>
                          <th className="px-3 py-2 text-left">GSTIN</th>
                          <th className="px-3 py-2 text-left">City</th>
                          <th className="px-3 py-2 text-left">Phone</th>
                          <th className="px-3 py-2 text-left">What happens</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y">
                        {preview.rows.map((row) => (
                          <tr key={row.rowNumber}>
                            <td className="px-3 py-2 tabular-nums text-muted-foreground">
                              {row.rowNumber}
                            </td>
                            <td className="px-3 py-2 font-medium">{row.companyName}</td>
                            <td className="px-3 py-2 font-mono text-xs">
                              {row.gstNumber ?? <span className="text-muted-foreground">—</span>}
                            </td>
                            <td className="px-3 py-2">
                              {row.city || <span className="text-muted-foreground">—</span>}
                            </td>
                            <td className="px-3 py-2">
                              {row.phone || <span className="text-muted-foreground">—</span>}
                            </td>
                            <td className="px-3 py-2">
                              <ActionLabel row={row} />
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* Do it */}
              <div className="flex flex-wrap items-center justify-end gap-3">
                <Button variant="outline" onClick={startOver} disabled={importMut.isPending}>
                  Cancel
                </Button>
                <Button
                  disabled={!ready || importMut.isPending || nothingToDo}
                  loading={importMut.isPending}
                  onClick={() => {
                    if (!workbook) return;
                    importMut.mutate(workbook.rows, {
                      onSuccess: (res) => setResult(res),
                      onError: (error) => {
                        const e = error as {
                          response?: { data?: { error?: string; message?: string } };
                          message?: string;
                        };
                        toast.error(
                          e?.response?.data?.error ??
                            e?.response?.data?.message ??
                            e?.message ??
                            'Could not import the suppliers.',
                        );
                      },
                    });
                  }}
                >
                  {!preview
                    ? 'Import'
                    : nothingToDo
                      ? 'Nothing to import'
                      : `Import ${preview.counts.create} supplier${preview.counts.create === 1 ? '' : 's'}`}
                </Button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone?: 'primary';
}) {
  return (
    <div
      className={cn(
        'rounded-lg border px-4 py-3',
        tone === 'primary' ? 'border-primary/40 bg-primary/5' : 'bg-muted/30',
      )}
    >
      <div className="text-2xl font-semibold tabular-nums">{value}</div>
      <div className="text-caption mt-0.5">{label}</div>
    </div>
  );
}

function ActionLabel({ row }: { row: { action: string; matchedName?: string; matchedBy?: string; fills?: string[] } }) {
  if (row.action === 'create') {
    return <span className="font-medium text-primary">New supplier</span>;
  }
  if (row.action === 'fill') {
    return (
      <span className="text-muted-foreground">
        Fills {row.fills?.join(', ')} on{' '}
        <span className="font-medium text-foreground">{row.matchedName}</span>{' '}
        <span className="text-xs">(matched on {row.matchedBy})</span>
      </span>
    );
  }
  return (
    <span className="text-muted-foreground">
      Already have <span className="font-medium text-foreground">{row.matchedName}</span> — nothing
      to change
    </span>
  );
}

function Notice({
  tone,
  title,
  children,
}: {
  tone: 'warning' | 'info';
  title: string;
  children: React.ReactNode;
}) {
  const Icon = tone === 'warning' ? AlertTriangle : Info;
  return (
    <div
      className={cn(
        'rounded-lg border p-4 text-sm',
        tone === 'warning' ? 'border-warning/40 bg-warning/10' : 'bg-muted/30',
      )}
    >
      <p className="flex items-center gap-2 font-medium">
        <Icon className={cn('h-4 w-4', tone === 'warning' && 'text-warning')} />
        {title}
      </p>
      <div className="mt-1 text-muted-foreground">{children}</div>
    </div>
  );
}
