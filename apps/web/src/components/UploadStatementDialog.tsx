import { useState, useRef, useCallback } from 'react';
import {
  X,
  Upload,
  Loader2,
  AlertCircle,
  ChevronDown,
  FileSpreadsheet,
  CheckCircle2,
} from 'lucide-react';
import { cn } from '../lib/utils';
import { useBulkImportTransactionsMutation } from '../hooks/useBank';
import { useEscapeKey } from '../hooks/useEscapeKey';

// ---------------------------------------------------------------------------
// CSV Parsing Utility
// ---------------------------------------------------------------------------
function parseCSVLine(line: string): string[] {
  const fields: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (inQuotes) {
      if (char === '"') {
        // Check for escaped quote
        if (i + 1 < line.length && line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        current += char;
      }
    } else {
      if (char === '"') {
        inQuotes = true;
      } else if (char === ',') {
        fields.push(current.trim());
        current = '';
      } else {
        current += char;
      }
    }
  }
  fields.push(current.trim());
  return fields;
}

function parseCSV(text: string): string[][] {
  const lines = text.split(/\r?\n/).filter((line) => line.trim() !== '');
  return lines.map((line) => parseCSVLine(line));
}

// ---------------------------------------------------------------------------
// Column mapping
// ---------------------------------------------------------------------------
interface ColumnMapping {
  date: number;
  description: number;
  debit: number;
  credit: number;
  balance: number;
  reference: number;
}

const COLUMN_FIELDS: Array<{
  key: keyof ColumnMapping;
  label: string;
  required: boolean;
}> = [
  { key: 'date', label: 'Date', required: true },
  { key: 'description', label: 'Description', required: true },
  { key: 'debit', label: 'Debit', required: true },
  { key: 'credit', label: 'Credit', required: true },
  { key: 'balance', label: 'Balance', required: true },
  { key: 'reference', label: 'Reference', required: false },
];

// Try to auto-detect column mapping from header row
function autoDetectMapping(headers: string[]): ColumnMapping {
  const mapping: ColumnMapping = {
    date: -1,
    description: -1,
    debit: -1,
    credit: -1,
    balance: -1,
    reference: -1,
  };

  const lower = headers.map((h) => h.toLowerCase().trim());

  lower.forEach((h, i) => {
    if (/date|txn.*date|transaction.*date|value.*date/.test(h) && mapping.date === -1) {
      mapping.date = i;
    }
    if (/desc|narration|particular|detail|remark/.test(h) && mapping.description === -1) {
      mapping.description = i;
    }
    if (/debit|withdrawal|dr/.test(h) && mapping.debit === -1) {
      mapping.debit = i;
    }
    if (/credit|deposit|cr/.test(h) && !/card/.test(h) && mapping.credit === -1) {
      mapping.credit = i;
    }
    if (/balance|closing/.test(h) && mapping.balance === -1) {
      mapping.balance = i;
    }
    if (/ref|reference|cheque|chq|utr/.test(h) && mapping.reference === -1) {
      mapping.reference = i;
    }
  });

  return mapping;
}

// Parse a date string in various formats to YYYY-MM-DD
function parseDate(dateStr: string): string {
  // Try DD/MM/YYYY or DD-MM-YYYY
  const dmyMatch = dateStr.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
  if (dmyMatch) {
    const [, d, m, y] = dmyMatch;
    return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }
  // Try YYYY-MM-DD
  const ymdMatch = dateStr.match(/^(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})$/);
  if (ymdMatch) {
    const [, y, m, d] = ymdMatch;
    return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }
  // Try MM/DD/YYYY
  const mdyMatch = dateStr.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
  if (mdyMatch) {
    // Already handled above as DMY — fallback returns as-is
  }
  // Return as-is, let the backend parse it
  return dateStr;
}

function parseAmount(val: string): number {
  if (!val) return 0;
  // Remove commas, currency symbols, spaces
  const cleaned = val.replace(/[,₹$\s]/g, '');
  const num = parseFloat(cleaned);
  return isNaN(num) ? 0 : Math.abs(num);
}

// ---------------------------------------------------------------------------
// Parsed transaction row
// ---------------------------------------------------------------------------
interface ParsedTransaction {
  transactionDate: string;
  description: string;
  type: 'debit' | 'credit';
  amount: number;
  balance: number;
  referenceNumber?: string;
}

// ---------------------------------------------------------------------------
// Component Props
// ---------------------------------------------------------------------------
interface UploadStatementDialogProps {
  accountId: string;
  onClose: () => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
export function UploadStatementDialog({
  accountId,
  onClose,
}: UploadStatementDialogProps) {
  useEscapeKey(true, onClose);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const bulkImportMutation = useBulkImportTransactionsMutation();

  // Steps: select_file -> map_columns -> preview -> result
  const [step, setStep] = useState<
    'select_file' | 'map_columns' | 'preview' | 'result'
  >('select_file');

  const [rawRows, setRawRows] = useState<string[][]>([]);
  const [headers, setHeaders] = useState<string[]>([]);
  const [mapping, setMapping] = useState<ColumnMapping>({
    date: -1,
    description: -1,
    debit: -1,
    credit: -1,
    balance: -1,
    reference: -1,
  });
  const [parsedTransactions, setParsedTransactions] = useState<
    ParsedTransaction[]
  >([]);
  const [importResult, setImportResult] = useState<{
    imported: number;
    skipped: number;
  } | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);

  // Handle file selection
  const handleFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      setFileError(null);
      const file = e.target.files?.[0];
      if (!file) return;

      if (!file.name.endsWith('.csv')) {
        setFileError('Please select a CSV file.');
        return;
      }

      const reader = new FileReader();
      reader.onload = (event) => {
        const text = event.target?.result as string;
        const rows = parseCSV(text);
        if (rows.length < 2) {
          setFileError(
            'CSV file must have at least a header row and one data row.',
          );
          return;
        }

        const headerRow = rows[0];
        const dataRows = rows.slice(1);

        setHeaders(headerRow);
        setRawRows(dataRows);

        // Auto-detect column mapping
        const detected = autoDetectMapping(headerRow);
        setMapping(detected);

        setStep('map_columns');
      };
      reader.onerror = () => {
        setFileError('Failed to read the file. Please try again.');
      };
      reader.readAsText(file);
    },
    [],
  );

  // Apply mapping and create preview
  const handleApplyMapping = () => {
    if (mapping.date === -1 || mapping.description === -1) {
      setFileError('Date and Description columns are required.');
      return;
    }
    if (mapping.debit === -1 && mapping.credit === -1) {
      setFileError('At least Debit or Credit column is required.');
      return;
    }

    const transactions: ParsedTransaction[] = [];

    for (const row of rawRows) {
      const dateVal = row[mapping.date] ?? '';
      const descVal = row[mapping.description] ?? '';
      const debitVal = mapping.debit >= 0 ? row[mapping.debit] ?? '' : '';
      const creditVal = mapping.credit >= 0 ? row[mapping.credit] ?? '' : '';
      const balanceVal = mapping.balance >= 0 ? row[mapping.balance] ?? '' : '';
      const refVal = mapping.reference >= 0 ? row[mapping.reference] ?? '' : '';

      // Skip empty rows
      if (!dateVal && !descVal) continue;

      const debitAmt = parseAmount(debitVal);
      const creditAmt = parseAmount(creditVal);

      // Determine type and amount
      let type: 'debit' | 'credit';
      let amount: number;

      if (debitAmt > 0 && creditAmt === 0) {
        type = 'debit';
        amount = debitAmt;
      } else if (creditAmt > 0 && debitAmt === 0) {
        type = 'credit';
        amount = creditAmt;
      } else if (debitAmt > 0 && creditAmt > 0) {
        // Both have values — take the larger as the transaction
        if (debitAmt >= creditAmt) {
          type = 'debit';
          amount = debitAmt;
        } else {
          type = 'credit';
          amount = creditAmt;
        }
      } else {
        // Zero amount — skip
        continue;
      }

      transactions.push({
        transactionDate: parseDate(dateVal),
        description: descVal,
        type,
        amount,
        balance: parseAmount(balanceVal),
        referenceNumber: refVal || undefined,
      });
    }

    setParsedTransactions(transactions);
    setFileError(null);
    setStep('preview');
  };

  // Import transactions
  const handleImport = () => {
    bulkImportMutation.mutate(
      {
        accountId,
        transactions: parsedTransactions,
      },
      {
        onSuccess: (result) => {
          setImportResult(result);
          setStep('result');
        },
      },
    );
  };

  const mutationError = bulkImportMutation.error
    ? (bulkImportMutation.error as any)?.response?.data?.error ??
      (bulkImportMutation.error as any)?.response?.data?.message ??
      'Import failed. Please try again.'
    : null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />

      {/* Dialog */}
      <div className="relative z-10 w-full max-w-4xl max-h-[90vh] overflow-y-auto rounded-lg border bg-card p-6 shadow-xl mx-4">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-medium">Upload Bank Statement</h3>
          <button
            onClick={onClose}
            className="rounded-md p-1 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Step: Select File */}
        {step === 'select_file' && (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Upload a CSV file exported from your bank. The file should contain
              columns for date, description, debit/credit amounts, and balance.
            </p>

            <div
              onClick={() => fileInputRef.current?.click()}
              className={cn(
                'flex flex-col items-center justify-center rounded-lg border-2 border-dashed p-12 cursor-pointer',
                'hover:border-primary hover:bg-muted/50 transition-colors',
              )}
            >
              <Upload className="h-10 w-10 text-muted-foreground mb-3" />
              <p className="text-sm font-medium">
                Click to select a CSV file
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                Supported format: .csv
              </p>
            </div>

            <input
              ref={fileInputRef}
              type="file"
              accept=".csv"
              onChange={handleFileChange}
              className="hidden"
            />

            {fileError && (
              <div className="flex items-center gap-2 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
                <AlertCircle className="h-4 w-4 shrink-0" />
                {fileError}
              </div>
            )}
          </div>
        )}

        {/* Step: Map Columns */}
        {step === 'map_columns' && (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Map CSV columns to the required fields. Auto-detected mappings are
              pre-selected — adjust if needed.
            </p>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {COLUMN_FIELDS.map((field) => (
                <div key={field.key}>
                  <label className="block text-sm font-medium mb-1">
                    {field.label}{' '}
                    {field.required && (
                      <span className="text-destructive">*</span>
                    )}
                  </label>
                  <div className="relative">
                    <select
                      value={mapping[field.key]}
                      onChange={(e) =>
                        setMapping((prev) => ({
                          ...prev,
                          [field.key]: Number(e.target.value),
                        }))
                      }
                      className={cn(
                        'w-full appearance-none rounded-md border bg-field px-3 py-2 pr-8 text-sm',
                        'focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2',
                      )}
                    >
                      <option value={-1}>-- Not Mapped --</option>
                      {headers.map((h, i) => (
                        <option key={i} value={i}>
                          {h || `Column ${i + 1}`}
                        </option>
                      ))}
                    </select>
                    <ChevronDown className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  </div>
                </div>
              ))}
            </div>

            {/* Preview first 3 raw rows */}
            <div className="mt-4">
              <p className="text-xs font-medium text-muted-foreground mb-2">
                Raw CSV Preview (first 3 rows):
              </p>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b bg-muted/50">
                      {headers.map((h, i) => (
                        <th
                          key={i}
                          className="px-3 py-2 text-left font-medium text-muted-foreground whitespace-nowrap"
                        >
                          {h || `Col ${i + 1}`}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {rawRows.slice(0, 3).map((row, rowIdx) => (
                      <tr key={rowIdx} className="border-b last:border-0">
                        {headers.map((_, colIdx) => (
                          <td
                            key={colIdx}
                            className="px-3 py-2 whitespace-nowrap"
                          >
                            {row[colIdx] ?? ''}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {fileError && (
              <div className="flex items-center gap-2 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
                <AlertCircle className="h-4 w-4 shrink-0" />
                {fileError}
              </div>
            )}

            <div className="flex items-center gap-3 pt-2">
              <button
                onClick={handleApplyMapping}
                className={cn(
                  'flex items-center gap-2 rounded-md bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground',
                  'hover:bg-primary/90 transition-colors',
                )}
              >
                Continue to Preview
              </button>
              <button
                onClick={() => {
                  setStep('select_file');
                  setFileError(null);
                }}
                className="rounded-md border px-5 py-2.5 text-sm font-medium text-muted-foreground hover:bg-muted transition-colors"
              >
                Back
              </button>
            </div>
          </div>
        )}

        {/* Step: Preview */}
        {step === 'preview' && (
          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <FileSpreadsheet className="h-5 w-5 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">
                <span className="font-medium text-foreground">
                  {parsedTransactions.length}
                </span>{' '}
                transactions parsed. Review below and click Import.
              </p>
            </div>

            <div className="overflow-x-auto max-h-[400px] overflow-y-auto">
              <table className="w-full text-sm">
                <thead className="sticky top-0">
                  <tr className="border-b bg-muted/80">
                    <th className="px-3 py-2 text-left font-medium text-muted-foreground">
                      #
                    </th>
                    <th className="px-3 py-2 text-left font-medium text-muted-foreground">
                      Date
                    </th>
                    <th className="px-3 py-2 text-left font-medium text-muted-foreground">
                      Description
                    </th>
                    <th className="px-3 py-2 text-left font-medium text-muted-foreground">
                      Reference
                    </th>
                    <th className="px-3 py-2 text-right font-medium text-muted-foreground">
                      Debit
                    </th>
                    <th className="px-3 py-2 text-right font-medium text-muted-foreground">
                      Credit
                    </th>
                    <th className="px-3 py-2 text-right font-medium text-muted-foreground">
                      Balance
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {parsedTransactions.map((txn, idx) => (
                    <tr
                      key={idx}
                      className="border-b last:border-0 hover:bg-muted/30"
                    >
                      <td className="px-3 py-2">{idx + 1}</td>
                      <td className="px-3 py-2 whitespace-nowrap">
                        {txn.transactionDate}
                      </td>
                      <td className="px-3 py-2 max-w-[200px] truncate">
                        {txn.description}
                      </td>
                      <td className="px-3 py-2 font-mono text-xs">
                        {txn.referenceNumber ?? '-'}
                      </td>
                      <td className="px-3 py-2 text-right text-red-600">
                        {txn.type === 'debit' ? txn.amount.toFixed(2) : '-'}
                      </td>
                      <td className="px-3 py-2 text-right text-green-600">
                        {txn.type === 'credit' ? txn.amount.toFixed(2) : '-'}
                      </td>
                      <td className="px-3 py-2 text-right">
                        {txn.balance.toFixed(2)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {mutationError && (
              <div className="flex items-center gap-2 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
                <AlertCircle className="h-4 w-4 shrink-0" />
                {mutationError}
              </div>
            )}

            <div className="flex items-center gap-3 pt-2">
              <button
                onClick={handleImport}
                disabled={
                  bulkImportMutation.isPending ||
                  parsedTransactions.length === 0
                }
                className={cn(
                  'flex items-center gap-2 rounded-md bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground',
                  'hover:bg-primary/90 transition-colors',
                  'disabled:opacity-50 disabled:cursor-not-allowed',
                )}
              >
                {bulkImportMutation.isPending ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Importing...
                  </>
                ) : (
                  <>
                    <Upload className="h-4 w-4" />
                    Import {parsedTransactions.length} Transactions
                  </>
                )}
              </button>
              <button
                onClick={() => setStep('map_columns')}
                disabled={bulkImportMutation.isPending}
                className="rounded-md border px-5 py-2.5 text-sm font-medium text-muted-foreground hover:bg-muted transition-colors"
              >
                Back
              </button>
            </div>
          </div>
        )}

        {/* Step: Result */}
        {step === 'result' && importResult && (
          <div className="space-y-4 text-center py-6">
            <CheckCircle2 className="h-12 w-12 text-green-600 mx-auto" />
            <h3 className="text-lg font-medium">Import Complete</h3>
            <div className="space-y-1 text-sm text-muted-foreground">
              <p>
                <span className="font-semibold text-green-600">
                  {importResult.imported}
                </span>{' '}
                transactions imported successfully.
              </p>
              {importResult.skipped > 0 && (
                <p>
                  <span className="font-semibold text-amber-600">
                    {importResult.skipped}
                  </span>{' '}
                  transactions skipped (possible duplicates).
                </p>
              )}
            </div>
            <button
              onClick={onClose}
              className={cn(
                'rounded-md bg-primary px-6 py-2.5 text-sm font-medium text-primary-foreground',
                'hover:bg-primary/90 transition-colors',
              )}
            >
              Done
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
