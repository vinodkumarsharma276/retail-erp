import { Download } from 'lucide-react';
import { formatINR } from '@retailerp/shared-utils';
import type { RegisterParseResult } from '../api/ocr-api';

type Props = { result: RegisterParseResult };

function csvEscape(value: unknown) {
  const text = value == null ? '' : String(value);
  return `"${text.replace(/"/g, '""')}"`;
}

export function RegisterParseTable({ result }: Props) {
  const downloadCsv = () => {
    const headers = ['Row', 'Date', 'Ledger', 'Customer', 'Phone', 'Model', 'Amount', 'Payment Mode', 'Remarks', 'Confidence'];
    const rows = result.rows.map((row) => [row.rowIndex, row.date, row.ledgerNumber, row.customerName, row.phone, row.modelNumber, row.amount, row.paymentMode, row.remarks, row.confidence]);
    const csv = [headers, ...rows].map((row) => row.map(csvEscape).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'register-parse.csv';
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="rounded-lg border bg-card p-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-medium">Parsed rows</h2>
          <p className="text-sm text-muted-foreground">Preview only. Review before using these values in sales.</p>
        </div>
        <button onClick={downloadCsv} className="inline-flex items-center gap-2 rounded-md border px-3 py-2 text-sm font-medium hover:bg-muted">
          <Download className="h-4 w-4" /> CSV
        </button>
      </div>

      {result.warnings.length > 0 && (
        <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200">
          {result.warnings.join(' ')}
        </div>
      )}

      <div className="mt-4 overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-muted/50"><tr><th className="px-2 py-2 text-left">#</th><th className="px-2 py-2 text-left">Date</th><th className="px-2 py-2 text-left">Ledger</th><th className="px-2 py-2 text-left">Customer</th><th className="px-2 py-2 text-left">Phone</th><th className="px-2 py-2 text-left">Model</th><th className="px-2 py-2 text-right">Amount</th><th className="px-2 py-2 text-left">Mode</th><th className="px-2 py-2 text-left">Remarks</th></tr></thead>
          <tbody>
            {result.rows.map((row) => (
              <tr key={row.rowIndex} className="border-b last:border-0">
                <td className="px-2 py-2">{row.rowIndex}</td>
                <td className="px-2 py-2">{row.date || '-'}</td>
                <td className="px-2 py-2 font-mono text-xs">{row.ledgerNumber || '-'}</td>
                <td className="px-2 py-2">{row.customerName || '-'}</td>
                <td className="px-2 py-2">{row.phone || '-'}</td>
                <td className="px-2 py-2">{row.modelNumber || '-'}</td>
                <td className="px-2 py-2 text-right">{row.amount ? formatINR(row.amount) : '-'}</td>
                <td className="px-2 py-2">{row.paymentMode || '-'}</td>
                <td className="px-2 py-2">{row.remarks || '-'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}