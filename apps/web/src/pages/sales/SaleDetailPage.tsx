import { useState, useEffect } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import {
  ArrowLeft,
  Loader2,
  AlertCircle,
  Shield,
  CreditCard,
  CheckCircle,
  Download,
  Banknote,
  Eye,
  Pencil,
} from 'lucide-react';
import { handleInvoiceDownload } from '../../lib/invoice-utils';
import { cn } from '../../lib/utils';
import {
  useSaleDetailQuery,
  useSaleInstallmentsQuery,
  useRecordFinancePaymentMutation,
  useRecordPendingPaymentMutation,
  useSaleActivityQuery,
} from '../../hooks/useSales';
import { usePermission, useCanCheck } from '../../hooks/usePermission';
import { StatusBadge } from '../../components/StatusBadge';
import { CompletionBadge } from '../../components/CompletionBadge';
import { RecordPaymentDialog } from '../../components/RecordPaymentDialog';
import { AccessDenied } from '../../routes/RoleGuard';
import { formatINR, formatDateIN } from '@retailerp/shared-utils';
import { SaleType, FinancePaymentStatus, InstallmentStatus } from '@retailerp/shared-types';

export function SaleDetailPage() {
  const canViewDetail = usePermission('sales.detail');
  if (!canViewDetail) return <AccessDenied />;
  return <SaleDetailPageInner />;
}

function SaleDetailPageInner() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const can = useCanCheck();

  // Permission-based section visibility
  const canViewProfit = can('sales.section.profit');
  const canViewPurchasePrice = can('sales.section.purchase_price');
  const canViewSelfFinance = can('sales.section.self_finance');
  const canViewCompanyFinance = can('sales.section.company_finance');
  const canViewGuarantor = can('sales.section.guarantor');
  const canViewPaymentBreakdown = can('sales.section.payment_breakdown');
  const canViewFinancials = can('sales.section.financials');
  const canRecordCompanyPayment = can('sales.record_company_finance_payment');
  const canMarkPartialSettled = can('sales.mark_partial_settled');
  const canDownloadInvoice = can('sales.invoice.download_pdf');
  const canViewInvoice = can('sales.invoice.view');
  const canEditSale = can('sales.edit');
  const canViewSaleHistory = can('sales.view_history');

  const { data: sale, isLoading, isError } = useSaleDetailQuery(id);

  // Only fetch installments when user has self-finance perm on self-finance sales
  const shouldFetchInstallments =
    canViewSelfFinance && sale?.saleType === SaleType.SELF_FINANCE;
  const { data: installmentData, isLoading: isInstallmentsLoading } =
    useSaleInstallmentsQuery(id, shouldFetchInstallments);

  // Activity / audit log — Owner-only by default (Owner can grant
  // `sales.view_history` to other roles via Roles & Users).
  const { data: activityLog } = useSaleActivityQuery(id, canViewSaleHistory);

  // Invoice download state
  const [isDownloading, setIsDownloading] = useState(false);

  const onDownloadInvoice = async () => {
    if (!id) return;
    setIsDownloading(true);
    try {
      await handleInvoiceDownload(id);
    } catch (err) {
      console.error('Invoice download failed:', err);
    } finally {
      setIsDownloading(false);
    }
  };

  // Record pending payment dialog state
  const [showPaymentDialog, setShowPaymentDialog] = useState(false);
  const [paymentAmount, setPaymentAmount] = useState<number | ''>('');
  const [paymentMode, setPaymentMode] = useState('cash');
  const [paymentNotes, setPaymentNotes] = useState('');
  const recordPaymentMutation = useRecordPendingPaymentMutation();

  // Per-installment "Pay" dialog state (for advance payments + overpayments)
  const [installmentPaymentTarget, setInstallmentPaymentTarget] = useState<
    { id: string; amount: number; number: number } | null
  >(null);

  const handleRecordPayment = () => {
    if (!id || !paymentAmount || paymentAmount <= 0) return;

    recordPaymentMutation.mutate(
      { saleId: id, data: { amount: Number(paymentAmount), paymentMode, notes: paymentNotes.trim() || undefined } },
      {
        onSuccess: () => {
          setShowPaymentDialog(false);
          setPaymentAmount('');
          setPaymentMode('cash');
          setPaymentNotes('');
        },
      },
    );
  };

  useEffect(() => {
    if (showPaymentDialog && sale) {
      setPaymentAmount(Number(sale.pendingAmount));
    }
  }, [showPaymentDialog, sale]);

  // Finance payment dialog state
  const [showFinanceDialog, setShowFinanceDialog] = useState(false);
  const [financeRefNumber, setFinanceRefNumber] = useState('');
  const financePaymentMutation = useRecordFinancePaymentMutation();

  const handleRecordFinancePayment = () => {
    if (!id) return;
    financePaymentMutation.mutate(
      {
        saleId: id,
        payload: {
          status: FinancePaymentStatus.RECEIVED,
          referenceNumber: financeRefNumber.trim() || undefined,
          receivedDate: new Date().toISOString().split('T')[0],
        },
      },
      {
        onSuccess: () => {
          setShowFinanceDialog(false);
          setFinanceRefNumber('');
        },
      },
    );
  };

  // Loading
  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  // Error
  if (isError || !sale) {
    return (
      <div className="flex flex-col items-center justify-center py-20">
        <AlertCircle className="h-12 w-12 text-destructive mb-4" />
        <h2 className="text-lg font-medium mb-2">Sale Not Found</h2>
        <p className="text-sm text-muted-foreground mb-4">
          The sale record you are looking for does not exist.
        </p>
        <button
          onClick={() => navigate(-1)}
          className="flex items-center gap-2 text-sm text-primary hover:underline"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Sales
        </button>
      </div>
    );
  }

  return (
    <div>
      {/* Header */}
      <div className="flex items-center gap-4 mb-6">
        <button
          onClick={() => navigate(-1)}
          className="rounded-md p-2 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
        >
          <ArrowLeft className="h-5 w-5" />
        </button>
        <div className="flex-1">
          <h1 className="text-2xl font-semibold">
            Sale {sale.saleNumber}
          </h1>
          <div className="flex flex-wrap items-center gap-2 mt-1">
            <StatusBadge status={sale.saleType} />
            {sale.pendingAmount > 0 && (
              <StatusBadge status="pending" />
            )}
            <CompletionBadge completedAt={(sale as any).completedAt} variant="hero" />
          </div>
        </div>
        {canEditSale && (
          <Link
            to={`/sales/${sale.id}/edit`}
            className={cn(
              'flex items-center gap-2 rounded-md border px-4 py-2 text-sm font-medium',
              'hover:bg-muted transition-colors',
            )}
          >
            <Pencil className="h-4 w-4" />
            Edit Sale
          </Link>
        )}
        {(canDownloadInvoice || canViewInvoice) && (
        <button
          onClick={onDownloadInvoice}
          disabled={isDownloading}
          className={cn(
            'flex items-center gap-2 rounded-md border px-4 py-2 text-sm font-medium',
            'hover:bg-muted transition-colors',
            'disabled:opacity-50 disabled:cursor-not-allowed',
          )}
        >
          {isDownloading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Download className="h-4 w-4" />
          )}
          Download Invoice
        </button>
        )}
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Left column (67%) */}
        <div className="lg:col-span-2 space-y-6">
          {/* Sale Info Card */}
          <div className="rounded-lg border bg-card p-6">
            <h2 className="text-lg font-medium mb-4">Sale Information</h2>
            <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <InfoRow label="Sale Number" value={sale.saleNumber} />
              <InfoRow label="Ledger Number" value={sale.ledgerNumber} />
              <InfoRow label="Sale Date" value={formatDateIN(sale.saleDate)} />
              <InfoRow
                label="Sale Type"
                value={sale.saleType.replace(/_/g, ' ')}
              />
              <InfoRow label="MRP" value={formatINR(sale.mrp)} />
              <InfoRow label="Selling Price (incl. GST)" value={formatINR(sale.sellingPrice)} />
              {canViewFinancials && sale.gstAmount > 0 && (
                <InfoRow label={`GST ${sale.gstRate}% (included)`} value={formatINR(sale.gstAmount)} />
              )}
              <InfoRow label="Total Amount" value={formatINR(sale.totalAmount)} />
              <InfoRow
                label="Down Payment"
                value={formatINR(sale.downPayment)}
              />
              <InfoRow
                label="Payment Mode"
                value={
                  canViewPaymentBreakdown && sale.paymentBreakdown && sale.paymentBreakdown.length > 0
                    ? sale.paymentBreakdown
                        .map((p: {mode: string; amount: number}) =>
                          `${p.mode.replace(/_/g, ' ')}: ${formatINR(p.amount)}`
                        )
                        .join(' + ')
                    : sale.paymentMode.replace(/_/g, ' ')
                }
              />
              {sale.pendingAmount > 0 && (
                <InfoRow
                  label="Pending Amount"
                  value={formatINR(sale.pendingAmount)}
                />
              )}
              {sale.pendingAmount > 0 && canMarkPartialSettled && (
                <div className="sm:col-span-2">
                  <button
                    type="button"
                    onClick={() => setShowPaymentDialog(true)}
                    className={cn(
                      'flex items-center gap-2 rounded-md bg-green-600 px-4 py-2 text-sm font-medium text-white',
                      'hover:bg-green-700 transition-colors',
                    )}
                  >
                    <CreditCard className="h-4 w-4" />
                    Record Payment
                  </button>
                </div>
              )}
              {sale.promiseDate && (
                <InfoRow
                  label="Promise Date"
                  value={formatDateIN(sale.promiseDate)}
                />
              )}
              {sale.notes && (
                <div className="sm:col-span-2">
                  <dt className="text-sm font-medium text-muted-foreground">
                    Notes
                  </dt>
                  <dd className="mt-0.5 text-sm whitespace-pre-wrap">
                    {sale.notes}
                  </dd>
                </div>
              )}
              <InfoRow
                label="Created By"
                value={
                  (sale as any).creator?.fullName ||
                  (sale as any).creator?.username ||
                  sale.createdBy
                }
              />
              <InfoRow
                label="Created"
                value={formatDateIN(sale.createdAt)}
              />
            </dl>
          </div>

          {/* Profit & GST Breakdown Card (permission-gated) */}
          {(canViewProfit || canViewPurchasePrice) && sale.product && (
            <ProfitBreakdownCard
              sellingPrice={sale.sellingPrice}
              purchasePrice={sale.product.purchasePrice}
              mrp={sale.mrp}
              gstRate={sale.gstRate}
              gstAmount={sale.gstAmount}
              purchaseGstAmount={sale.purchaseGstAmount ?? 0}
            />
          )}

          {/* Self Finance details (permission-gated) */}
          {canViewSelfFinance &&
            sale.saleType === SaleType.SELF_FINANCE && (
              <div className="rounded-lg border bg-card p-6">
                <h2 className="text-lg font-medium mb-4">
                  Self Finance Details
                </h2>
                <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <InfoRow
                    label="Interest Rate"
                    value={`${sale.interestRate ?? 0}% per month`}
                  />
                  <InfoRow
                    label="File Charge"
                    value={formatINR(sale.fileCharge)}
                  />
                  <InfoRow
                    label="Total Financed"
                    value={formatINR(sale.totalFinancedAmount ?? 0)}
                  />
                  <InfoRow
                    label="EMI Amount"
                    value={formatINR(sale.emiAmount ?? 0)}
                  />
                  <InfoRow
                    label="Installments"
                    value={String(sale.numInstallments ?? 0)}
                  />
                </dl>

                {/* Total Earnings — product profit + financing income */}
                {sale.product && (() => {
                  const sp = Number(sale.sellingPrice);
                  const dp = Number(sale.product.purchasePrice);
                  const outGst = Number(sale.gstAmount);
                  const inGst = Number(sale.purchaseGstAmount ?? 0);
                  const netProductProfit = (sp - outGst) - (dp - inGst);
                  const principal = sp - Number(sale.downPayment);
                  const rate = Number(sale.interestRate ?? 0);
                  const months = Number(sale.numInstallments ?? 0);
                  const totalInterest = principal * (rate / 100) * months;
                  const fc = Number(sale.fileCharge ?? 0);
                  const totalEarnings = netProductProfit + totalInterest + fc;
                  // Margin % is earnings over cost basis (DP ex-ITC).
                  const costBasis = dp - inGst;
                  const earningsPct = costBasis > 0 ? (totalEarnings / costBasis) * 100 : 0;

                  return (
                    <div className="mt-4 pt-4 border-t">
                      <h3 className="text-sm font-medium mb-3">Total Earnings from this Sale</h3>
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                        <div>
                          <p className="text-xs text-muted-foreground">Net Product Profit</p>
                          <p className={cn('text-sm font-semibold', netProductProfit >= 0 ? 'text-green-600' : 'text-red-600')}>
                            {formatINR(netProductProfit)}
                          </p>
                        </div>
                        <div>
                          <p className="text-xs text-muted-foreground">Interest Earned</p>
                          <p className="text-sm font-semibold text-green-600">
                            {formatINR(totalInterest)}
                          </p>
                        </div>
                        {fc > 0 && (
                          <div>
                            <p className="text-xs text-muted-foreground">File Charge</p>
                            <p className="text-sm font-semibold text-green-600">
                              {formatINR(fc)}
                            </p>
                          </div>
                        )}
                        <div>
                          <p className="text-xs text-muted-foreground">Total Earnings</p>
                          <div className="flex items-baseline gap-2">
                            <p className={cn('text-lg font-bold', totalEarnings >= 0 ? 'text-green-600' : 'text-red-600')}>
                              {formatINR(totalEarnings)}
                            </p>
                            {costBasis > 0 && (
                              <span
                                className={cn(
                                  'text-xs font-semibold px-1.5 py-0.5 rounded-md',
                                  earningsPct >= 0
                                    ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
                                    : 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
                                )}
                                title="Total earnings as a % of cost basis (DP excluding input GST)"
                              >
                                {earningsPct >= 0 ? '+' : ''}
                                {earningsPct.toFixed(1)}%
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })()}

                {/* Guarantor */}
                {canViewGuarantor && sale.guarantor && (
                  <div className="mt-4 pt-4 border-t">
                    <h3 className="text-sm font-medium mb-3 flex items-center gap-2">
                      <Shield className="h-4 w-4 text-purple-600" />
                      Guarantor
                    </h3>
                    <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                      <InfoRow label="Name" value={sale.guarantor.name} />
                      <InfoRow label="Phone" value={sale.guarantor.phone} />
                      <InfoRow label="Code" value={sale.guarantor.customerCode} />
                    </dl>
                    <Link
                      to={`/customers/${sale.guarantor.id}`}
                      className="mt-2 inline-block text-sm text-primary hover:underline"
                    >
                      View Profile
                    </Link>
                  </div>
                )}

                {/* Installment schedule */}
                {isInstallmentsLoading ? (
                  <div className="mt-4 pt-4 border-t">
                    <div className="flex items-center gap-2 text-sm text-muted-foreground py-4">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Loading installments...
                    </div>
                  </div>
                ) : installmentData ? (
                  <div className="mt-4 pt-4 border-t">
                    <div className="flex items-center justify-between mb-3">
                      <h3 className="text-sm font-medium">
                        Installment Schedule
                      </h3>
                      {installmentData.schedule?.id && (
                        <Link
                          to={`/installments/${installmentData.schedule.id}`}
                          className={cn(
                            'flex items-center gap-1 rounded-md border px-2.5 py-1 text-xs font-medium',
                            'hover:bg-muted transition-colors',
                          )}
                        >
                          <Eye className="h-3.5 w-3.5" />
                          View Timeline
                        </Link>
                      )}
                    </div>
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b bg-muted/50">
                            <th className="px-3 py-2 text-left font-medium text-muted-foreground">
                              EMI #
                            </th>
                            <th className="px-3 py-2 text-left font-medium text-muted-foreground">
                              Due Date
                            </th>
                            <th className="px-3 py-2 text-right font-medium text-muted-foreground">
                              Amount
                            </th>
                            <th className="px-3 py-2 text-right font-medium text-muted-foreground">
                              Paid
                            </th>
                            <th className="px-3 py-2 text-left font-medium text-muted-foreground">
                              Status
                            </th>
                            <th className="px-3 py-2 text-right font-medium text-muted-foreground">
                              Action
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {[...installmentData.installments]
                            .sort((a, b) => {
                              const ap = a.parentInstallmentNumber ?? a.installmentNumber;
                              const bp = b.parentInstallmentNumber ?? b.installmentNumber;
                              if (ap !== bp) return ap - bp;
                              // primary first, then subs by subSequence
                              const aSub = a.subSequence ?? 0;
                              const bSub = b.subSequence ?? 0;
                              return aSub - bSub;
                            })
                            .map((inst) => {
                              const isSub =
                                inst.parentInstallmentNumber != null &&
                                inst.subSequence != null;
                              const canPay =
                                !inst.isRescheduled &&
                                (inst.status === InstallmentStatus.UPCOMING ||
                                  inst.status === InstallmentStatus.DUE_TODAY ||
                                  inst.status === InstallmentStatus.OVERDUE ||
                                  inst.status === InstallmentStatus.PARTIALLY_PAID);
                              return (
                                <tr
                                  key={inst.id}
                                  className={cn(
                                    'border-b last:border-0',
                                    isSub && 'bg-muted/30',
                                  )}
                                >
                                  <td className="px-3 py-2">
                                    <span
                                      className={cn(
                                        isSub &&
                                          'ml-5 text-muted-foreground',
                                      )}
                                    >
                                      {isSub
                                        ? `↳ ${inst.parentInstallmentNumber}.${inst.subSequence}`
                                        : inst.installmentNumber}
                                    </span>
                                  </td>
                                  <td className="px-3 py-2">
                                    {formatDateIN(inst.dueDate)}
                                  </td>
                                  <td className="px-3 py-2 text-right font-medium">
                                    {formatINR(inst.amountDue)}
                                  </td>
                                  <td className="px-3 py-2 text-right">
                                    {formatINR(inst.amountPaid)}
                                  </td>
                                  <td className="px-3 py-2">
                                    <StatusBadge status={inst.status} />
                                  </td>
                                  <td className="px-3 py-2 text-right">
                                    {canPay && can('installments.record_payment') ? (
                                      <button
                                        onClick={() =>
                                          setInstallmentPaymentTarget({
                                            id: inst.id,
                                            amount: Number(inst.remainingAmount),
                                            number: inst.installmentNumber,
                                          })
                                        }
                                        className={cn(
                                          'inline-flex items-center gap-1 rounded-md bg-green-600 px-2 py-1 text-xs font-medium text-white',
                                          'hover:bg-green-700 transition-colors',
                                        )}
                                      >
                                        <Banknote className="h-3 w-3" />
                                        Pay
                                      </button>
                                    ) : null}
                                  </td>
                                </tr>
                              );
                            })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                ) : null}
              </div>
            )}

          {/* Company Finance details (permission-gated) */}
          {canViewCompanyFinance &&
            sale.saleType === SaleType.COMPANY_FINANCE && (
              <div className="rounded-lg border bg-card p-6">
                <h2 className="text-lg font-medium mb-4 flex items-center gap-2">
                  <CreditCard className="h-5 w-5 text-blue-600" />
                  Company Finance
                </h2>
                <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  {sale.financeCompany && (
                    <InfoRow
                      label="Finance Company"
                      value={sale.financeCompany.name}
                    />
                  )}
                  <InfoRow
                    label="Financed Amount"
                    value={formatINR(sale.financedAmount ?? 0)}
                  />
                  {sale.expectedPaymentDate && (
                    <InfoRow
                      label="Expected Payment"
                      value={formatDateIN(sale.expectedPaymentDate)}
                    />
                  )}
                  <InfoRow
                    label="Payment Status"
                    value={sale.financePaymentStatus ?? 'pending'}
                  />
                  {sale.financePaymentReceivedDate && (
                    <InfoRow
                      label="Payment Received"
                      value={formatDateIN(sale.financePaymentReceivedDate)}
                    />
                  )}
                  {sale.financeReferenceNumber && (
                    <InfoRow
                      label="Reference #"
                      value={sale.financeReferenceNumber}
                    />
                  )}
                </dl>

                {/* Record payment button */}
                {canRecordCompanyPayment && sale.financePaymentStatus !== FinancePaymentStatus.RECEIVED && (
                  <div className="mt-4 pt-4 border-t">
                    {showFinanceDialog ? (
                      <div className="space-y-3">
                        <div>
                          <label className="block text-sm font-medium mb-1.5">
                            Reference Number (optional)
                          </label>
                          <input
                            type="text"
                            value={financeRefNumber}
                            onChange={(e) => setFinanceRefNumber(e.target.value)}
                            placeholder="Transaction reference"
                            className={cn(
                              'w-full max-w-sm rounded-md border bg-background px-3 py-2 text-sm',
                              'placeholder:text-muted-foreground',
                              'focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2',
                            )}
                          />
                        </div>
                        <div className="flex items-center gap-2">
                          <button
                            onClick={handleRecordFinancePayment}
                            disabled={financePaymentMutation.isPending}
                            className={cn(
                              'flex items-center gap-2 rounded-md bg-green-600 px-4 py-2 text-sm font-medium text-white',
                              'hover:bg-green-700 transition-colors',
                              'disabled:opacity-50 disabled:cursor-not-allowed',
                            )}
                          >
                            {financePaymentMutation.isPending ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              <CheckCircle className="h-4 w-4" />
                            )}
                            Confirm Payment
                          </button>
                          <button
                            onClick={() => setShowFinanceDialog(false)}
                            className="rounded-md border px-4 py-2 text-sm text-muted-foreground hover:bg-muted transition-colors"
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    ) : (
                      <button
                        onClick={() => setShowFinanceDialog(true)}
                        className={cn(
                          'flex items-center gap-2 rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white',
                          'hover:bg-blue-700 transition-colors',
                        )}
                      >
                        <CreditCard className="h-4 w-4" />
                        Record Payment Received
                      </button>
                    )}
                  </div>
                )}
              </div>
            )}
        </div>

        {/* Right column (33%) */}
        <div className="lg:col-span-1 space-y-6">
          {/* Product Card */}
          {sale.product && (
            <div className="rounded-lg border bg-card p-6">
              <h2 className="text-lg font-medium mb-4">Product</h2>
              <dl className="space-y-3">
                <InfoRow label="Brand" value={sale.product.brand} />
                <InfoRow label="Model" value={sale.product.modelNumber} />
                {sale.product.serialNumber && (
                  <InfoRow
                    label="Serial Number"
                    value={sale.product.serialNumber}
                  />
                )}
                <InfoRow label="MRP" value={formatINR(sale.product.mrp)} />
                {canViewPurchasePrice && (
                  <InfoRow label="DP (Dealer Price)" value={formatINR(sale.product.purchasePrice)} />
                )}
              </dl>
              <Link
                to={`/products/${sale.product.id}`}
                className="mt-3 inline-block text-sm text-primary hover:underline"
              >
                View Product
              </Link>
            </div>
          )}

          {/* Customer Card */}
          {sale.customer && (
            <div className="rounded-lg border bg-card p-6">
              <h2 className="text-lg font-medium mb-4">Customer</h2>
              <dl className="space-y-3">
                <InfoRow label="Name" value={sale.customer.name} />
                <InfoRow label="Phone" value={sale.customer.phone} />
                <InfoRow label="Code" value={sale.customer.customerCode} />
                {sale.customer.city && (
                  <InfoRow label="City" value={sale.customer.city} />
                )}
              </dl>
              <Link
                to={`/customers/${sale.customer.id}`}
                className="mt-3 inline-block text-sm text-primary hover:underline"
              >
                View Customer
              </Link>
            </div>
          )}
        </div>
      </div>

      {/* Activity Log — Owner-only audit trail of every modification */}
      {canViewSaleHistory && activityLog && activityLog.length > 0 && (
        <div className="rounded-lg border bg-card p-4 sm:p-6">
          <h2 className="text-sm font-semibold mb-4 flex items-center gap-2 text-muted-foreground uppercase tracking-wide">
            Activity Log
          </h2>
          <ol className="relative border-l border-border ml-2">
            {activityLog.map((entry) => (
              <li key={entry.id} className="ml-4 pb-4">
                <div className="absolute -left-1.5 mt-1.5 h-3 w-3 rounded-full bg-primary" />
                <div className="flex flex-wrap items-baseline gap-2">
                  <span className="text-sm font-medium">
                    {entry.action === 'update_sale_type'
                      ? 'Sale type changed'
                      : entry.action === 'update'
                      ? 'Sale edited'
                      : entry.action}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    by {entry.user?.fullName ?? entry.user?.username ?? 'system'}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {formatDateIN(new Date(entry.createdAt))}{' '}
                    {new Date(entry.createdAt).toLocaleTimeString('en-IN', {
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </span>
                </div>
                <SaleActivityDiff
                  before={entry.oldValues}
                  after={entry.newValues}
                />
              </li>
            ))}
          </ol>
        </div>
      )}

      {/* Record Payment Dialog */}
      {showPaymentDialog && sale.pendingAmount > 0 && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="rounded-lg border bg-card p-6 shadow-xl w-full max-w-md mx-4">
            <h3 className="text-lg font-medium mb-4">Record Payment</h3>

            <div className="space-y-4">
              <div>
                <p className="text-sm text-muted-foreground mb-2">
                  Pending Amount: <span className="font-semibold text-red-600">{formatINR(sale.pendingAmount)}</span>
                </p>
              </div>

              <div>
                <label className="block text-sm font-medium mb-1.5">Amount</label>
                <input
                  type="number"
                  step="0.01"
                  max={Number(sale.pendingAmount)}
                  value={paymentAmount}
                  onChange={(e) => setPaymentAmount(Number(e.target.value) || '')}
                  placeholder="Enter amount"
                  className="w-full rounded-md border bg-background px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
                />
              </div>

              <div>
                <label className="block text-sm font-medium mb-1.5">Payment Mode</label>
                <select
                  value={paymentMode}
                  onChange={(e) => setPaymentMode(e.target.value)}
                  className="w-full appearance-none rounded-md border bg-background px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
                >
                  <option value="cash">Cash</option>
                  <option value="upi">UPI</option>
                  <option value="credit_card">Credit Card</option>
                  <option value="debit_card">Debit Card</option>
                  <option value="bank_transfer">Bank Transfer</option>
                  <option value="cheque">Cheque</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium mb-1.5">Notes (optional)</label>
                <input
                  type="text"
                  value={paymentNotes}
                  onChange={(e) => setPaymentNotes(e.target.value)}
                  placeholder="e.g., Remaining amount collected"
                  className="w-full rounded-md border bg-background px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
                />
              </div>

              {recordPaymentMutation.error && (
                <p className="text-xs text-destructive">
                  {(recordPaymentMutation.error as any)?.response?.data?.error ?? 'Failed to record payment'}
                </p>
              )}
            </div>

            <div className="flex items-center justify-end gap-3 mt-6">
              <button
                type="button"
                onClick={() => { setShowPaymentDialog(false); recordPaymentMutation.reset(); }}
                className="rounded-md border px-4 py-2 text-sm font-medium text-muted-foreground hover:bg-muted transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleRecordPayment}
                disabled={!paymentAmount || paymentAmount <= 0 || paymentAmount > Number(sale.pendingAmount) || recordPaymentMutation.isPending}
                className="flex items-center gap-2 rounded-md bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {recordPaymentMutation.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <CheckCircle className="h-4 w-4" />
                )}
                Confirm Payment
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Per-installment Pay dialog (advance + overpayment) */}
      {installmentPaymentTarget && (
        <RecordPaymentDialog
          installmentId={installmentPaymentTarget.id}
          amountDue={installmentPaymentTarget.amount}
          installmentNumber={installmentPaymentTarget.number}
          onSuccess={() => setInstallmentPaymentTarget(null)}
          onClose={() => setInstallmentPaymentTarget(null)}
        />
      )}
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
      <dd className="mt-0.5 text-sm capitalize">{value}</dd>
    </div>
  );
}

// Renders a compact list of changed fields between two snapshots.
function SaleActivityDiff({
  before,
  after,
}: {
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
}) {
  if (!before && !after) return null;
  const keys = new Set<string>([
    ...Object.keys(before ?? {}),
    ...Object.keys(after ?? {}),
  ]);
  const fmt = (v: unknown) => {
    if (v === null || v === undefined || v === '') return '—';
    if (typeof v === 'number') return String(v);
    if (typeof v === 'string') {
      // Try to detect ISO date strings
      const d = new Date(v);
      if (!Number.isNaN(d.getTime()) && /\d{4}-\d{2}-\d{2}/.test(v)) {
        return formatDateIN(d);
      }
      return v;
    }
    if (typeof v === 'boolean') return v ? 'true' : 'false';
    try {
      return JSON.stringify(v);
    } catch {
      return String(v);
    }
  };
  const changed: Array<{ key: string; before: unknown; after: unknown }> = [];
  keys.forEach((k) => {
    const b = before?.[k];
    const a = after?.[k];
    if (JSON.stringify(b) !== JSON.stringify(a)) {
      changed.push({ key: k, before: b, after: a });
    }
  });
  if (changed.length === 0) {
    return (
      <p className="mt-1 text-xs text-muted-foreground">No field changes recorded.</p>
    );
  }
  return (
    <ul className="mt-2 space-y-1 text-xs">
      {changed.map(({ key, before: b, after: a }) => (
        <li key={key} className="flex flex-wrap items-baseline gap-1">
          <span className="font-medium text-muted-foreground">{key}:</span>
          <span className="line-through text-muted-foreground">{fmt(b)}</span>
          <span className="text-muted-foreground">→</span>
          <span className="text-foreground">{fmt(a)}</span>
        </li>
      ))}
    </ul>
  );
}

function ProfitBreakdownCard({
  sellingPrice,
  purchasePrice,
  mrp,
  gstRate,
  gstAmount,
  purchaseGstAmount,
}: {
  sellingPrice: number;
  purchasePrice: number;
  mrp: number;
  gstRate: number;
  gstAmount: number;
  purchaseGstAmount: number;
}) {
  const spExclGst = sellingPrice - gstAmount;
  const dpExclGst = purchasePrice - purchaseGstAmount;
  const discount = mrp - sellingPrice;
  const discountPct = mrp > 0 ? ((discount / mrp) * 100).toFixed(1) : '0.0';
  const gstPayable = gstAmount - purchaseGstAmount;
  const netProfit = spExclGst - dpExclGst;
  const netProfitPct = dpExclGst > 0 ? ((netProfit / dpExclGst) * 100).toFixed(1) : '0.0';

  return (
    <div className="rounded-lg border bg-card p-6">
      <h2 className="text-lg font-medium mb-4">Profit & GST Breakdown</h2>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left">
              <th className="pb-2 font-medium text-muted-foreground"></th>
              <th className="pb-2 font-medium text-muted-foreground text-right">Sale (to Customer)</th>
              <th className="pb-2 font-medium text-muted-foreground text-right">Purchase (from Distributor)</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            <tr>
              <td className="py-2 text-muted-foreground">Price (incl. GST)</td>
              <td className="py-2 text-right font-medium">{formatINR(sellingPrice)}</td>
              <td className="py-2 text-right font-medium">{formatINR(purchasePrice)}</td>
            </tr>
            {gstRate > 0 && (
              <tr>
                <td className="py-2 text-muted-foreground">GST @ {gstRate}% (extracted)</td>
                <td className="py-2 text-right">{formatINR(gstAmount)}</td>
                <td className="py-2 text-right">{formatINR(purchaseGstAmount)}</td>
              </tr>
            )}
            <tr>
              <td className="py-2 text-muted-foreground">Base Price (excl. GST)</td>
              <td className="py-2 text-right font-medium">{formatINR(spExclGst)}</td>
              <td className="py-2 text-right font-medium">{formatINR(dpExclGst)}</td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* Summary metrics */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mt-4 pt-4 border-t">
        <div>
          <p className="text-xs text-muted-foreground">Discount (MRP - SP)</p>
          <p className={cn('text-sm font-semibold', discount >= 0 ? 'text-green-600' : 'text-red-600')}>
            {formatINR(discount)} <span className="text-xs font-normal">({discountPct}%)</span>
          </p>
        </div>
        {gstRate > 0 && (
          <div>
            <p className="text-xs text-muted-foreground">GST Payable to Govt</p>
            <p className="text-sm font-semibold text-amber-600">{formatINR(gstPayable)}</p>
          </div>
        )}
        <div>
          <p className="text-xs text-muted-foreground">Net Profit</p>
          <p className={cn('text-sm font-semibold', netProfit >= 0 ? 'text-green-600' : 'text-red-600')}>
            {formatINR(netProfit)}
          </p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">Net Profit %</p>
          <p className={cn('text-sm font-semibold', netProfit >= 0 ? 'text-green-600' : 'text-red-600')}>
            {netProfitPct}%
          </p>
        </div>
      </div>
    </div>
  );
}
