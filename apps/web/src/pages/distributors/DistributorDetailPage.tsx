import { useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { useCanCheck } from '../../hooks/usePermission';
import { useEscapeKey } from '../../hooks/useEscapeKey';
import { isAllShops, useShopStore } from '../../stores/shop-store';
import {
  ArrowLeft,
  Loader2,
  Pencil,
  AlertCircle,
  Calendar,
  Banknote,
  Plus,
  X,
  CheckCircle,
} from 'lucide-react';
import { cn } from '../../lib/utils';
import {
  useDistributorDetailQuery,
  useDistributorProductsQuery,
  useDistributorPaymentsQuery,
  useRecordDistributorPaymentMutation,
} from '../../hooks/useDistributors';
import { usePurchasesQuery } from '../../hooks/usePurchases';
import { DataTable } from '../../components/DataTable';
import type { Column, PaginationState } from '../../components/DataTable';
import { StatusBadge } from '../../components/StatusBadge';
import { Button } from '../../components/ui/button';
import { useToast } from '../../stores/toast-store';
import {
  distributorCompleteness,
  type Completeness,
} from '../../lib/distributor-completeness';
import { formatINR, formatDateIN } from '@retailerp/shared-utils';
import type {
  DistributorProduct,
  DistributorPayment,
  Purchase,
  Distributor,
} from '@retailerp/shared-types';

type TabType = 'products' | 'payments' | 'invoices' | 'missing';

const PAGE_SIZE = 20;

export function DistributorDetailPage() {
  const can = useCanCheck();
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  // Active tab
  const [activeTab, setActiveTab] = useState<TabType>('products');

  // Payment dialog state
  const [showPaymentDialog, setShowPaymentDialog] = useState(false);

  // A purchase belongs to one shop's books, so it cannot be started while the
  // header is showing every shop at once.
  const allShopsMode = isAllShops(useShopStore((s) => s.currentShopId));

  // Distributor detail
  const { data: distributor, isLoading, isError } = useDistributorDetailQuery(id);

  // Fetch all purchases to compute pending total (large page to get all)
  const allPurchasesQuery = usePurchasesQuery({
    page: 1,
    pageSize: 1000,
    distributorId: id,
    paymentStatus: '',
    allShops: true,
  });
  const allPurchases = allPurchasesQuery.data?.data ?? [];
  const pendingPurchases = allPurchases.filter((p) => p.paymentStatus !== 'paid');
  const totalPending = pendingPurchases.reduce(
    (sum, p) => sum + (Number(p.netAmount) - Number(p.amountPaid)),
    0,
  );

  // What the supplier record is still missing. A supplier created by the
  // sheet importer has no bank details, because a register never has them.
  const completeness = distributorCompleteness(
    (distributor ?? ({} as Distributor)) as Distributor,
  );

  // Loading
  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  // Error
  if (isError || !distributor) {
    return (
      <div className="flex flex-col items-center justify-center py-20">
        <AlertCircle className="h-12 w-12 text-destructive mb-4" />
        <h2 className="text-lg font-medium mb-2">Distributor Not Found</h2>
        <p className="text-sm text-muted-foreground mb-4">
          The distributor you are looking for does not exist or has been removed.
        </p>
        <button
          onClick={() => navigate(-1)}
          className="flex items-center gap-2 text-sm text-primary hover:underline"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Distributors
        </button>
      </div>
    );
  }

  // categories is the DistributorCategory join table: [{ id, categoryId, category: { id, name, slug } }]
  const rawCategories = (distributor as any).categories as
    | Array<{ id: string; categoryId: string; category?: { id: string; name: string } }>
    | undefined;
  const categories = rawCategories?.map((dc) => ({
    id: dc.category?.id ?? dc.categoryId ?? dc.id,
    name: dc.category?.name ?? (dc as any).name ?? 'Unknown',
  }));

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-4">
          <button
            onClick={() => navigate(-1)}
            className="rounded-md p-2 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
          <div>
            <h1 className="text-display">
              {distributor.companyName}
            </h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              {distributor.contactPerson} &middot; {distributor.phone}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          {can('purchases.create') && (
            allShopsMode ? (
              <button
                disabled
                title="Switch to a single shop to record a purchase"
                className={cn(
                  'flex items-center gap-2 rounded-md border px-4 py-2 text-sm font-medium',
                  'cursor-not-allowed opacity-50',
                )}
              >
                <Plus className="h-4 w-4" />
                New purchase
              </button>
            ) : (
              <button
                onClick={() =>
                  navigate(`/purchases/new?distributorId=${distributor.id}`)
                }
                className={cn(
                  'flex items-center gap-2 rounded-md border px-4 py-2 text-sm font-medium',
                  'hover:bg-muted transition-colors',
                )}
              >
                <Plus className="h-4 w-4" />
                New purchase
              </button>
            )
          )}
          {totalPending > 0 && can('purchases.record_payment') && (
            <button
              onClick={() => setShowPaymentDialog(true)}
              className={cn(
                'flex items-center gap-2 rounded-md px-4 py-2 text-sm font-medium',
                'bg-primary text-primary-foreground hover:bg-primary/90 transition-colors',
              )}
            >
              <Banknote className="h-4 w-4" />
              Make Payment
              <span className="ml-1 text-xs opacity-90">
                ({formatINR(totalPending)})
              </span>
            </button>
          )}
          {can('distributors.edit') && (
          <button
            onClick={() => navigate(`/distributors/${distributor.id}/edit`)}
            className={cn(
              'flex items-center gap-2 rounded-md border px-4 py-2 text-sm font-medium',
              'hover:bg-muted transition-colors',
            )}
          >
            <Pencil className="h-4 w-4" />
            Edit
          </button>
          )}
        </div>
      </div>

      {/* Info card */}
      <div className="rounded-lg border bg-card p-6 mb-6">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <InfoRow label="Contact Person" value={distributor.contactPerson} />
          <InfoRow label="Phone" value={distributor.phone} />
          <InfoRow label="Alt. Phone" value={distributor.altPhone ?? '-'} />
          <InfoRow label="Email" value={distributor.email ?? '-'} />
          <InfoRow label="GST Number" value={distributor.gstNumber ?? '-'} />
          <InfoRow label="PAN Number" value={distributor.panNumber ?? '-'} />
          <InfoRow
            label="Address"
            value={[
              distributor.addressLine1,
              distributor.addressLine2,
              distributor.city,
              distributor.state,
              distributor.pincode,
            ]
              .filter(Boolean)
              .join(', ')}
          />
          <InfoRow label="Bank" value={distributor.bankName ?? '-'} />
          <InfoRow label="Account No." value={distributor.bankAccountNumber ?? '-'} />
          <InfoRow label="IFSC" value={distributor.bankIfsc ?? '-'} />
          <InfoRow label="Branch" value={distributor.bankBranch ?? '-'} />
          <InfoRow label="Payment Terms" value={distributor.paymentTerms ?? '-'} />
          <InfoRow label="Credit Limit" value={formatINR(distributor.creditLimit)} />
        </div>

        {/* Categories supplied */}
        {categories && categories.length > 0 && (
          <div className="mt-4 pt-4 border-t">
            <p className="text-sm font-medium text-muted-foreground mb-2">
              Categories Supplied
            </p>
            <div className="flex flex-wrap gap-2">
              {categories.map((cat) => (
                <span
                  key={cat.id}
                  className="inline-flex items-center rounded-full bg-blue-100 px-3 py-1 text-xs font-medium text-blue-700"
                >
                  {cat.name}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Tabs */}
      <div className="border-b mb-6">
        <nav className="flex gap-6">
          {([
            { key: 'products', label: 'Products Purchased' },
            { key: 'payments', label: 'Payment History' },
            { key: 'invoices', label: 'Pending Invoices' },
            {
              key: 'missing',
              label: completeness.isComplete
                ? 'Missing details'
                : `Missing details (${completeness.missing.length})`,
            },
          ] as const).map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={cn(
                'pb-3 text-sm font-medium border-b-2 transition-colors',
                activeTab === tab.key
                  ? 'border-primary text-primary'
                  : 'border-transparent text-muted-foreground hover:text-foreground',
              )}
            >
              <span className={cn('inline-flex items-center gap-1.5')}>
                {tab.label}
                {tab.key === 'missing' && completeness.importantMissing.length > 0 && (
                  <AlertCircle className="h-3.5 w-3.5 text-destructive" />
                )}
              </span>
            </button>
          ))}
        </nav>
      </div>

      {/* Tab content */}
      {activeTab === 'products' && <ProductsTab distributorId={id!} />}
      {activeTab === 'payments' && <PaymentsTab distributorId={id!} />}
      {activeTab === 'invoices' && <PendingInvoicesTab distributorId={id!} />}
      {activeTab === 'missing' && (
        <MissingDetailsTab
          distributor={distributor}
          completeness={completeness}
          canEdit={can('distributors.edit')}
          onEdit={() => navigate(`/distributors/${id}/edit`)}
        />
      )}

      {/* Lumpsum Payment Dialog */}
      {showPaymentDialog && (
        <LumpsumPaymentDialog
          distributorId={id!}
          totalPending={totalPending}
          pendingInvoiceCount={pendingPurchases.length}
          onClose={() => setShowPaymentDialog(false)}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Products Tab
// ---------------------------------------------------------------------------
function getDateDaysAgo(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().split('T')[0];
}

function getToday(): string {
  return new Date().toISOString().split('T')[0];
}

function ProductsTab({ distributorId }: { distributorId: string }) {
  const [page, setPage] = useState(1);
  const [dateFrom, setDateFrom] = useState(getDateDaysAgo(90));
  const [dateTo, setDateTo] = useState(getToday());

  const productsQuery = useDistributorProductsQuery(distributorId, {
    page,
    pageSize: PAGE_SIZE,
    dateFrom: dateFrom || undefined,
    dateTo: dateTo || undefined,
  });

  const products = productsQuery.data?.data ?? [];
  const pagination = productsQuery.data?.pagination;

  const columns: Column<DistributorProduct>[] = [
    {
      key: 'sno',
      header: 'S.No',
      render: (_row, idx) =>
        pagination
          ? (pagination.page - 1) * pagination.pageSize + idx + 1
          : idx + 1,
      className: 'w-16',
    },
    {
      key: 'product',
      header: 'Product',
      render: (row) => (
        <span className="font-medium">
          {row.brand} {row.modelNumber}
        </span>
      ),
    },
    {
      key: 'category',
      header: 'Category',
      render: (row) => row.category?.name ?? row.categoryName ?? '-',
    },
    {
      key: 'purchaseDate',
      header: 'Purchase Date',
      render: (row) => {
        const date = row.purchase?.invoiceDate ?? row.purchaseDate;
        return date ? formatDateIN(date) : '-';
      },
    },
    {
      key: 'invoiceNumber',
      header: 'Invoice #',
      render: (row) => (
        <span className="font-mono text-xs">
          {row.purchase?.invoiceNumber ?? row.invoiceNumber ?? '-'}
        </span>
      ),
    },
    {
      key: 'purchasePrice',
      header: 'Purchase Price',
      align: 'right',
      render: (row) => formatINR(row.purchasePrice),
    },
  ];

  const paginationState: PaginationState | undefined = pagination
    ? {
        page: pagination.page,
        totalPages: pagination.totalPages,
        totalItems: pagination.totalItems,
        pageSize: pagination.pageSize,
      }
    : undefined;

  return (
    <div>
      {/* Date range filters */}
      <div className="flex flex-wrap items-end gap-4 mb-4">
        <div>
          <label className="block text-xs font-medium text-muted-foreground mb-1">
            From
          </label>
          <div className="relative">
            <Calendar className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <input
              type="date"
              value={dateFrom}
              onChange={(e) => {
                setDateFrom(e.target.value);
                setPage(1);
              }}
              className={cn(
                'rounded-md border bg-field pl-9 pr-3 py-2 text-sm',
                'focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2',
              )}
            />
          </div>
        </div>
        <div>
          <label className="block text-xs font-medium text-muted-foreground mb-1">
            To
          </label>
          <div className="relative">
            <Calendar className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <input
              type="date"
              value={dateTo}
              onChange={(e) => {
                setDateTo(e.target.value);
                setPage(1);
              }}
              className={cn(
                'rounded-md border bg-field pl-9 pr-3 py-2 text-sm',
                'focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2',
              )}
            />
          </div>
        </div>
        {(dateFrom !== getDateDaysAgo(90) || dateTo !== getToday()) && (
          <button
            onClick={() => {
              setDateFrom(getDateDaysAgo(90));
              setDateTo(getToday());
              setPage(1);
            }}
            className="rounded-md border px-3 py-2 text-sm text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
          >
            Clear Dates
          </button>
        )}
      </div>

      {productsQuery.isError && (
        <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-4 mb-4 text-sm text-destructive">
          Failed to load products.
        </div>
      )}

      <DataTable<DistributorProduct>
        columns={columns}
        data={products}
        isLoading={productsQuery.isLoading}
        pagination={paginationState}
        onPageChange={setPage}
        emptyMessage="No products purchased from this distributor."
        rowKey={(row) => row.id}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Payments Tab
// ---------------------------------------------------------------------------
function PaymentsTab({ distributorId }: { distributorId: string }) {
  const { data: payments, isLoading, isError } =
    useDistributorPaymentsQuery(distributorId);

  const columns: Column<DistributorPayment>[] = [
    {
      key: 'sno',
      header: 'S.No',
      render: (_row, idx) => idx + 1,
      className: 'w-16',
    },
    {
      key: 'date',
      header: 'Date',
      render: (row) => formatDateIN(row.paymentDate),
    },
    {
      key: 'amount',
      header: 'Amount',
      align: 'right',
      render: (row) => formatINR(row.amount),
    },
    {
      key: 'mode',
      header: 'Mode',
      render: (row) => (
        <span className="capitalize">{row.paymentMode.replace(/_/g, ' ')}</span>
      ),
    },
    {
      key: 'reference',
      header: 'Reference',
      render: (row) => row.referenceNumber ?? '-',
    },
    {
      key: 'invoice',
      header: 'Invoice #',
      render: (row) => (
        <span className="font-mono text-xs">
          {row.purchase?.invoiceNumber ?? row.invoiceNumber ?? '-'}
        </span>
      ),
    },
  ];

  if (isError) {
    return (
      <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-4 text-sm text-destructive">
        Failed to load payment history.
      </div>
    );
  }

  return (
    <DataTable<DistributorPayment>
      columns={columns}
      data={payments ?? []}
      isLoading={isLoading}
      emptyMessage="No payments recorded for this distributor."
      rowKey={(row) => row.id}
    />
  );
}

// ---------------------------------------------------------------------------
// Pending Invoices Tab
// ---------------------------------------------------------------------------
function PendingInvoicesTab({ distributorId }: { distributorId: string }) {
  const [page, setPage] = useState(1);

  const purchasesQuery = usePurchasesQuery({
    page,
    pageSize: PAGE_SIZE,
    distributorId,
    paymentStatus: '', // Get all invoices, we filter visually
    allShops: true, // Show invoices across all shops for this distributor
  });

  const purchases = purchasesQuery.data?.data ?? [];
  const pagination = purchasesQuery.data?.pagination;

  // Filter to only show non-fully-paid invoices for the "Pending Invoices" tab
  const pendingPurchases = purchases.filter(
    (p) => p.paymentStatus !== 'paid',
  );

  const columns: Column<Purchase>[] = [
    {
      key: 'sno',
      header: 'S.No',
      render: (_row, idx) => idx + 1,
      className: 'w-16',
    },
    {
      key: 'invoiceNumber',
      header: 'Invoice #',
      render: (row) => (
        <Link
          to={`/purchases/${row.id}`}
          className="font-mono text-xs text-primary hover:underline"
        >
          {row.invoiceNumber}
        </Link>
      ),
    },
    {
      key: 'shop',
      header: 'Shop',
      render: (row) => (row as any).shop?.name ?? '-',
    },
    {
      key: 'date',
      header: 'Date',
      render: (row) => formatDateIN(row.invoiceDate),
    },
    {
      key: 'total',
      header: 'Total',
      align: 'right',
      render: (row) => formatINR(row.netAmount),
    },
    {
      key: 'paid',
      header: 'Paid',
      align: 'right',
      render: (row) => formatINR(row.amountPaid),
    },
    {
      key: 'pending',
      header: 'Pending',
      align: 'right',
      render: (row) => {
        const pending = (Number(row.netAmount) || 0) - (Number(row.amountPaid) || 0);
        return (
          <span className={cn(pending > 0 ? 'text-red-600 font-medium' : '')}>
            {formatINR(pending)}
          </span>
        );
      },
    },
    {
      key: 'status',
      header: 'Status',
      render: (row) => <StatusBadge status={row.paymentStatus} />,
    },
  ];

  const paginationState: PaginationState | undefined = pagination
    ? {
        page: pagination.page,
        totalPages: pagination.totalPages,
        totalItems: pagination.totalItems,
        pageSize: pagination.pageSize,
      }
    : undefined;

  if (purchasesQuery.isError) {
    return (
      <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-4 text-sm text-destructive">
        Failed to load invoices.
      </div>
    );
  }

  return (
    <DataTable<Purchase>
      columns={columns}
      data={pendingPurchases}
      isLoading={purchasesQuery.isLoading}
      pagination={paginationState}
      onPageChange={setPage}
      emptyMessage="No pending invoices for this distributor."
      rowKey={(row) => row.id}
    />
  );
}

// ---------------------------------------------------------------------------
// Lumpsum Payment Dialog
// ---------------------------------------------------------------------------
function LumpsumPaymentDialog({
  distributorId,
  totalPending,
  pendingInvoiceCount,
  onClose,
}: {
  distributorId: string;
  totalPending: number;
  pendingInvoiceCount: number;
  onClose: () => void;
}) {
  useEscapeKey(true, onClose);

  const toast = useToast();
  const mutation = useRecordDistributorPaymentMutation();

  const [amount, setAmount] = useState(String(totalPending));
  const [paymentMode, setPaymentMode] = useState('cash');
  const [paymentDate, setPaymentDate] = useState(
    new Date().toISOString().split('T')[0],
  );
  const [referenceNumber, setReferenceNumber] = useState('');
  const [notes, setNotes] = useState('');
  const [result, setResult] = useState<{
    totalDistributed: number;
    invoicesPaidFull: number;
    invoicesPaidPartial: number;
    remainingAmount: number;
  } | null>(null);

  const parsedAmount = parseFloat(amount) || 0;
  const isValid = parsedAmount > 0 && paymentMode && paymentDate;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isValid) return;

    try {
      const res = await mutation.mutateAsync({
        id: distributorId,
        payload: {
          amount: parsedAmount,
          paymentMode,
          paymentDate,
          referenceNumber: referenceNumber || undefined,
          notes: notes || undefined,
        },
      });
      setResult(res);
      toast.success(
        `Payment of ${formatINR(res.totalDistributed)} distributed across ${res.invoicesPaidFull + res.invoicesPaidPartial} invoice(s)`,
      );
    } catch (error: any) {
      const message =
        error?.response?.data?.error || error?.message || 'Failed to record payment';
      toast.error(message);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/50"
        onClick={onClose}
      />

      {/* Dialog */}
      <div className="relative w-full max-w-md rounded-lg border bg-card p-6 shadow-lg mx-4">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold">Make Payment</h2>
          <button
            onClick={onClose}
            className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {result ? (
          /* Success result view */
          <div className="space-y-4">
            <div className="flex items-center gap-3 p-4 rounded-lg bg-green-50 dark:bg-green-950/30 border border-green-200 dark:border-green-800">
              <CheckCircle className="h-8 w-8 text-green-600 dark:text-green-400 flex-shrink-0" />
              <div>
                <p className="font-medium text-green-800 dark:text-green-200">Payment Recorded</p>
                <p className="text-sm text-green-700 dark:text-green-400 mt-1">
                  {formatINR(result.totalDistributed)} distributed across invoices
                </p>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3 text-sm">
              <div className="rounded-md border p-3">
                <p className="text-muted-foreground">Invoices Paid in Full</p>
                <p className="text-lg font-semibold mt-1">{result.invoicesPaidFull}</p>
              </div>
              <div className="rounded-md border p-3">
                <p className="text-muted-foreground">Invoices Partially Paid</p>
                <p className="text-lg font-semibold mt-1">{result.invoicesPaidPartial}</p>
              </div>
              <div className="rounded-md border p-3">
                <p className="text-muted-foreground">Total Distributed</p>
                <p className="text-lg font-semibold mt-1">{formatINR(result.totalDistributed)}</p>
              </div>
              <div className="rounded-md border p-3">
                <p className="text-muted-foreground">Remaining (Unallocated)</p>
                <p className="text-lg font-semibold mt-1">{formatINR(result.remainingAmount)}</p>
              </div>
            </div>

            <button
              onClick={onClose}
              className={cn(
                'w-full rounded-md px-4 py-2.5 text-sm font-medium',
                'bg-primary text-primary-foreground hover:bg-primary/90 transition-colors',
              )}
            >
              Close
            </button>
          </div>
        ) : (
          /* Payment form */
          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Pending summary */}
            <div className="rounded-md bg-muted/50 border p-3 text-sm">
              <span className="text-muted-foreground">Total Pending: </span>
              <span className="font-semibold text-red-600">{formatINR(totalPending)}</span>
              <span className="text-muted-foreground"> across </span>
              <span className="font-medium">{pendingInvoiceCount} invoice(s)</span>
            </div>

            {/* Amount */}
            <div>
              <label className="block text-sm font-medium mb-1">Amount</label>
              <input
                type="number"
                step="0.01"
                min="0.01"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className={cn(
                  'w-full rounded-md border bg-field px-3 py-2 text-sm',
                  'focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2',
                )}
                placeholder="Enter amount"
                required
              />
              {parsedAmount > totalPending && (
                <p className="text-xs text-amber-600 mt-1">
                  Amount exceeds total pending. Excess ({formatINR(parsedAmount - totalPending)}) will remain unallocated.
                </p>
              )}
            </div>

            {/* Payment Mode */}
            <div>
              <label className="block text-sm font-medium mb-1">Payment Mode</label>
              <select
                value={paymentMode}
                onChange={(e) => setPaymentMode(e.target.value)}
                className={cn(
                  'w-full rounded-md border bg-field px-3 py-2 text-sm',
                  'focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2',
                )}
                required
              >
                <option value="cash">Cash</option>
                <option value="bank_transfer">Bank Transfer</option>
                <option value="cheque">Cheque</option>
                <option value="upi">UPI</option>
              </select>
            </div>

            {/* Payment Date */}
            <div>
              <label className="block text-sm font-medium mb-1">Payment Date</label>
              <input
                type="date"
                value={paymentDate}
                onChange={(e) => setPaymentDate(e.target.value)}
                className={cn(
                  'w-full rounded-md border bg-field px-3 py-2 text-sm',
                  'focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2',
                )}
                required
              />
            </div>

            {/* Reference Number */}
            <div>
              <label className="block text-sm font-medium mb-1">
                Reference Number <span className="text-muted-foreground font-normal">(optional)</span>
              </label>
              <input
                type="text"
                value={referenceNumber}
                onChange={(e) => setReferenceNumber(e.target.value)}
                className={cn(
                  'w-full rounded-md border bg-field px-3 py-2 text-sm',
                  'focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2',
                )}
                placeholder="Cheque no., UTR, etc."
              />
            </div>

            {/* Notes */}
            <div>
              <label className="block text-sm font-medium mb-1">
                Notes <span className="text-muted-foreground font-normal">(optional)</span>
              </label>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={2}
                className={cn(
                  'w-full rounded-md border bg-field px-3 py-2 text-sm resize-none',
                  'focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2',
                )}
                placeholder="Any additional notes..."
              />
            </div>

            {/* Submit */}
            <div className="flex gap-3 pt-2">
              <button
                type="button"
                onClick={onClose}
                className={cn(
                  'flex-1 rounded-md border px-4 py-2.5 text-sm font-medium',
                  'hover:bg-muted transition-colors',
                )}
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={!isValid || mutation.isPending}
                className={cn(
                  'flex-1 rounded-md px-4 py-2.5 text-sm font-medium',
                  'bg-primary text-primary-foreground hover:bg-primary/90 transition-colors',
                  'disabled:opacity-50 disabled:cursor-not-allowed',
                )}
              >
                {mutation.isPending ? (
                  <span className="flex items-center justify-center gap-2">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Processing...
                  </span>
                ) : (
                  'Confirm Payment'
                )}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-sm font-medium text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 text-sm">{value}</dd>
    </div>
  );
}

/**
 * What is still missing on a supplier, and a way in to fill it.
 *
 * The gaps are grouped the way the supplier form is, so the list reads as
 * instructions for the edit screen rather than as a bare list of columns.
 */
function MissingDetailsTab({
  distributor,
  completeness,
  canEdit,
  onEdit,
}: {
  distributor: Distributor | undefined;
  completeness: Completeness;
  canEdit: boolean;
  onEdit: () => void;
}) {
  if (!distributor) return null;

  if (completeness.isComplete) {
    return (
      <div className="flex flex-col items-center gap-2 rounded-lg border border-border bg-card py-16 text-center">
        <CheckCircle className="h-6 w-6 text-success" />
        <p className="font-medium">Nothing is missing</p>
        <p className="max-w-sm text-sm text-muted-foreground">
          Contact, address, tax and bank details are all on file for this supplier.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-border bg-card p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-title flex items-center gap-2">
              <AlertCircle
                className={cn('h-4 w-4', completeness.importantMissing.length > 0 ? 'text-destructive' : 'text-warning')}
              />
              {completeness.missing.length} detail{completeness.missing.length === 1 ? "" : "s"} missing
            </h2>
            <p className="text-caption">
              {completeness.fromImport
                ? "This supplier was created from an imported sheet, which does not carry bank details."
                : "Fill these in so payments and GST claims against this supplier are complete."}
            </p>
          </div>
          {canEdit && (
            <Button onClick={onEdit}>
              <Pencil className="mr-2 h-4 w-4" />
              Fill in the details
            </Button>
          )}
        </div>

        <div className="mt-4">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>Record complete</span>
            <span className="font-medium text-foreground">{completeness.percent}%</span>
          </div>
          <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-muted">
            <div
              className={cn('h-full rounded-full', completeness.percent >= 75 ? 'bg-success' : completeness.percent >= 40 ? 'bg-warning' : 'bg-destructive')}
              style={{ width: `${completeness.percent}%` }}
            />
          </div>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        {completeness.byGroup.map((entry) => (
          <div key={entry.group} className="rounded-lg border border-border bg-card p-5">
            <h3 className="text-sm font-semibold">{entry.group}</h3>
            <ul className="mt-2 space-y-1.5">
              {entry.fields.map((field) => (
                <li key={String(field.field)} className="flex items-center gap-2 text-sm">
                  <span
                    className={cn('h-1.5 w-1.5 shrink-0 rounded-full', field.important ? 'bg-destructive' : 'bg-muted-foreground/50')}
                  />
                  {field.label}
                  {field.important && (
                    <span className="text-xs text-muted-foreground">needed to pay this supplier</span>
                  )}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </div>
  );
}
