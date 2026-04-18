import { useParams, Link, useNavigate } from 'react-router-dom';
import { ArrowLeft, Loader2, Pencil, AlertCircle, Shield, User } from 'lucide-react';
import { cn } from '../../lib/utils';
import { useCustomerDetailQuery, useCustomerSalesQuery } from '../../hooks/useCustomers';
import { StatusBadge } from '../../components/StatusBadge';
import { CustomerReliabilityCard } from '../../components/CustomerReliabilityCard';
import { formatINR, formatDateIN, formatPhone, formatAadhaar } from '@retailerp/shared-utils';

export function CustomerDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const { data: customer, isLoading, isError } = useCustomerDetailQuery(id);
  const { data: sales, isLoading: isSalesLoading } = useCustomerSalesQuery(id);

  // Loading
  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  // Error
  if (isError || !customer) {
    return (
      <div className="flex flex-col items-center justify-center py-20">
        <AlertCircle className="h-12 w-12 text-destructive mb-4" />
        <h2 className="text-lg font-medium mb-2">Customer Not Found</h2>
        <p className="text-sm text-muted-foreground mb-4">
          The customer you are looking for does not exist or has been removed.
        </p>
        <button
          onClick={() => navigate(-1)}
          className="flex items-center gap-2 text-sm text-primary hover:underline"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Customers
        </button>
      </div>
    );
  }

  // Mask aadhaar: show last 4 digits only
  const maskedAadhaar = customer.aadhaarNumber
    ? `XXXX-XXXX-${customer.aadhaarNumber.slice(-4)}`
    : null;

  const addressParts = [
    customer.addressLine1,
    customer.addressLine2,
    customer.city,
    customer.state,
    customer.pincode,
  ].filter(Boolean);
  const fullAddress = addressParts.length > 0 ? addressParts.join(', ') : null;

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
            <h1 className="text-2xl font-semibold">{customer.name}</h1>
            <div className="flex items-center gap-2 mt-1">
              <span className="text-sm text-muted-foreground font-mono">
                {customer.customerCode}
              </span>
              {customer.isGuarantor && (
                <span className="inline-flex items-center gap-1 rounded-full bg-purple-100 px-2.5 py-0.5 text-xs font-medium text-purple-700">
                  <Shield className="h-3 w-3" />
                  Guarantor
                </span>
              )}
            </div>
          </div>
        </div>

        <button
          onClick={() => navigate(`/customers/${customer.id}/edit`)}
          className={cn(
            'flex items-center gap-2 rounded-md border px-4 py-2 text-sm font-medium',
            'hover:bg-muted transition-colors',
          )}
        >
          <Pencil className="h-4 w-4" />
          Edit
        </button>
      </div>

      {/* Main layout */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-5">
        {/* Left: Customer Info (60%) */}
        <div className="lg:col-span-3 space-y-6">
          {/* Customer Info Card */}
          <div className="rounded-lg border bg-card p-6">
            <h2 className="text-lg font-medium mb-4">Customer Information</h2>
            <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <InfoRow label="Customer Code" value={customer.customerCode} />
              <InfoRow label="Name" value={customer.name} />
              <InfoRow label="Phone" value={formatPhone(customer.phone)} />
              {customer.altPhone && (
                <InfoRow label="Alt. Phone" value={formatPhone(customer.altPhone)} />
              )}
              {maskedAadhaar && (
                <InfoRow label="Aadhaar" value={maskedAadhaar} />
              )}
              {fullAddress && (
                <div className="sm:col-span-2">
                  <dt className="text-sm font-medium text-muted-foreground">Address</dt>
                  <dd className="mt-0.5 text-sm">{fullAddress}</dd>
                </div>
              )}
              <InfoRow label="Created" value={formatDateIN(customer.createdAt)} />
            </dl>
          </div>

          {/* Guarantor Info */}
          {customer.guarantor && (
            <div className="rounded-lg border bg-card p-6">
              <h2 className="text-lg font-medium mb-4 flex items-center gap-2">
                <Shield className="h-5 w-5 text-purple-600" />
                Guarantor
              </h2>
              <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <InfoRow label="Name" value={customer.guarantor.name} />
                <InfoRow label="Phone" value={formatPhone(customer.guarantor.phone)} />
                <InfoRow label="Code" value={customer.guarantor.customerCode} />
              </dl>
              <Link
                to={`/customers/${customer.guarantor.id}`}
                className="mt-3 inline-block text-sm text-primary hover:underline"
              >
                View Guarantor Profile
              </Link>
            </div>
          )}

          {/* Guaranteed Customers (if this is a guarantor) */}
          {customer.guaranteedCustomers && customer.guaranteedCustomers.length > 0 && (
            <div className="rounded-lg border bg-card p-6">
              <h2 className="text-lg font-medium mb-4 flex items-center gap-2">
                <User className="h-5 w-5 text-blue-600" />
                Guaranteed Customers ({customer.guaranteedCustomers.length})
              </h2>
              <div className="space-y-3">
                {customer.guaranteedCustomers.map((gc) => (
                  <Link
                    key={gc.id}
                    to={`/customers/${gc.id}`}
                    className="flex items-center justify-between rounded-md border p-3 hover:bg-muted transition-colors"
                  >
                    <div>
                      <p className="text-sm font-medium">{gc.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {gc.phone} | {gc.customerCode}
                      </p>
                    </div>
                    <span className="text-xs text-primary">View</span>
                  </Link>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Right: Sales History (40%) */}
        <div className="lg:col-span-2 space-y-4">
          <CustomerReliabilityCard customerId={id!} />
          <div className="rounded-lg border bg-card p-6">
            <h2 className="text-lg font-medium mb-4">Sales History</h2>

            {isSalesLoading ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground py-4">
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading sales...
              </div>
            ) : !sales || sales.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4">
                No sales recorded yet.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b bg-muted/50">
                      <th className="px-3 py-2 text-left font-medium text-muted-foreground">
                        Date
                      </th>
                      <th className="px-3 py-2 text-left font-medium text-muted-foreground">
                        Product
                      </th>
                      <th className="px-3 py-2 text-left font-medium text-muted-foreground">
                        Type
                      </th>
                      <th className="px-3 py-2 text-right font-medium text-muted-foreground">
                        Amount
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {sales.map((sale) => (
                      <tr
                        key={sale.id}
                        className="border-b last:border-0 hover:bg-muted/30 cursor-pointer transition-colors"
                        onClick={() => navigate(`/sales/${sale.id}`)}
                      >
                        <td className="px-3 py-2 text-muted-foreground">
                          {formatDateIN(sale.saleDate)}
                        </td>
                        <td className="px-3 py-2">
                          {sale.productBrand} {sale.productModel}
                        </td>
                        <td className="px-3 py-2">
                          <StatusBadge status={sale.saleType} />
                        </td>
                        <td className="px-3 py-2 text-right font-medium">
                          {formatINR(sale.totalAmount)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
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
      <dd className="mt-0.5 text-sm">{value}</dd>
    </div>
  );
}
