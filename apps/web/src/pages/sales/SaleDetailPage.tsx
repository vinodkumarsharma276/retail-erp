import { useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import {
  ArrowLeft,
  Loader2,
  AlertCircle,
  Shield,
  CreditCard,
  CheckCircle,
  Download,
} from 'lucide-react';
import { handleInvoiceDownload } from '../../lib/invoice-utils';
import { cn } from '../../lib/utils';
import {
  useSaleDetailQuery,
  useSaleInstallmentsQuery,
  useRecordFinancePaymentMutation,
} from '../../hooks/useSales';
import { useAuthStore } from '../../stores/auth-store';
import { StatusBadge } from '../../components/StatusBadge';
import { formatINR, formatDateIN } from '@retailerp/shared-utils';
import { UserRole, SaleType, FinancePaymentStatus } from '@retailerp/shared-types';

export function SaleDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const userRole = user?.role;

  const isAdminOrAccountant =
    userRole === UserRole.ADMIN || userRole === UserRole.ACCOUNTANT;

  const { data: sale, isLoading, isError } = useSaleDetailQuery(id);

  // Only fetch installments for admin/accountant on self-finance sales
  const shouldFetchInstallments =
    isAdminOrAccountant && sale?.saleType === SaleType.SELF_FINANCE;
  const { data: installmentData, isLoading: isInstallmentsLoading } =
    useSaleInstallmentsQuery(id, shouldFetchInstallments);

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
          <div className="flex items-center gap-2 mt-1">
            <StatusBadge status={sale.saleType} />
            {sale.pendingAmount > 0 && (
              <StatusBadge status="pending" />
            )}
          </div>
        </div>
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
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-5">
        {/* Left column (60%) */}
        <div className="lg:col-span-3 space-y-6">
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
              <InfoRow label="Selling Price" value={formatINR(sale.sellingPrice)} />
              {sale.product && (
                <>
                  <InfoRow
                    label="DP (Dealer Price)"
                    value={formatINR(sale.product.purchasePrice)}
                  />
                  <InfoRow
                    label="Discount (MRP - SP)"
                    value={formatINR(sale.mrp - sale.sellingPrice)}
                  />
                  <InfoRow
                    label="Gross Profit (SP - DP)"
                    value={formatINR(sale.sellingPrice - sale.product.purchasePrice)}
                  />
                  {sale.gstAmount > 0 ? (
                    <>
                      <InfoRow
                        label="Output GST (on sale)"
                        value={formatINR(sale.gstAmount)}
                      />
                      <InfoRow
                        label="Input Tax Credit (from purchase)"
                        value={formatINR(sale.purchaseGstAmount ?? 0)}
                      />
                      <InfoRow
                        label="GST Payable to Govt"
                        value={formatINR(sale.gstAmount - (sale.purchaseGstAmount ?? 0))}
                      />
                      <InfoRow
                        label="Net Profit (after GST)"
                        value={formatINR(
                          (sale.sellingPrice - sale.gstAmount) -
                          (sale.product.purchasePrice - (sale.purchaseGstAmount ?? 0))
                        )}
                      />
                    </>
                  ) : (
                    <InfoRow
                      label="Profit %"
                      value={
                        sale.product.purchasePrice > 0
                          ? `${(((sale.sellingPrice - sale.product.purchasePrice) / sale.product.purchasePrice) * 100).toFixed(1)}%`
                          : '0.0%'
                      }
                    />
                  )}
                </>
              )}
              {sale.discountAmount > 0 && (
                <InfoRow
                  label="Discount"
                  value={formatINR(sale.discountAmount)}
                />
              )}
              <InfoRow label="Net Amount" value={formatINR(sale.netAmount)} />
              {sale.gstAmount > 0 && (
                <>
                  <InfoRow label="GST Rate" value={`${sale.gstRate}%`} />
                  <InfoRow label="GST (included in SP)" value={formatINR(sale.gstAmount)} />
                </>
              )}
              <InfoRow
                label="Total Amount"
                value={formatINR(sale.totalAmount)}
              />
              <InfoRow
                label="Down Payment"
                value={formatINR(sale.downPayment)}
              />
              <InfoRow
                label="Payment Mode"
                value={sale.paymentMode.replace(/_/g, ' ')}
              />
              {sale.pendingAmount > 0 && (
                <InfoRow
                  label="Pending Amount"
                  value={formatINR(sale.pendingAmount)}
                />
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
                value={sale.createdBy}
              />
              <InfoRow
                label="Created"
                value={formatDateIN(sale.createdAt)}
              />
            </dl>
          </div>

          {/* Self Finance details (admin/accountant only) */}
          {isAdminOrAccountant &&
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

                {/* Guarantor */}
                {sale.guarantor && (
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
                    <h3 className="text-sm font-medium mb-3">
                      Installment Schedule
                    </h3>
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
                          </tr>
                        </thead>
                        <tbody>
                          {installmentData.installments.map((inst) => (
                            <tr
                              key={inst.id}
                              className="border-b last:border-0"
                            >
                              <td className="px-3 py-2">
                                {inst.installmentNumber}
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
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                ) : null}
              </div>
            )}

          {/* Company Finance details (admin/accountant only) */}
          {isAdminOrAccountant &&
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
                {sale.financePaymentStatus !== FinancePaymentStatus.RECEIVED && (
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

        {/* Right column (40%) */}
        <div className="lg:col-span-2 space-y-6">
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
                <InfoRow label="DP (Dealer Price)" value={formatINR(sale.product.purchasePrice)} />
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
