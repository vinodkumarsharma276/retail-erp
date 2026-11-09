import { Link } from 'react-router-dom';
import { Loader2, PackageCheck, Shield } from 'lucide-react';
import { formatDateIN } from '@retailerp/shared-utils';
import { useCustomerRegisterQuery, type CustomerSearchEntry } from '../../hooks/useCustomerSearch';

function EntryRows({ entries, showBuyer }: { entries: CustomerSearchEntry[]; showBuyer?: boolean }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b bg-muted/50 text-left text-muted-foreground">
            <th className="px-3 py-2 font-medium">Account Number</th>
            <th className="px-3 py-2 font-medium">Date</th>
            <th className="px-3 py-2 font-medium">Item</th>
            <th className="px-3 py-2 font-medium">{showBuyer ? 'Bought by' : 'Co-applicant'}</th>
            <th className="px-3 py-2 font-medium">Area</th>
          </tr>
        </thead>
        <tbody>
          {entries.map((e) => (
            <tr key={e.id} className="border-b last:border-0 hover:bg-muted/30">
              <td className="px-3 py-2">
                <Link to={`/customer-search/${e.id}`} className="font-mono text-xs font-semibold text-primary hover:underline">
                  {e.accountNumber}
                </Link>
              </td>
              <td className="whitespace-nowrap px-3 py-2 text-muted-foreground">{e.purchaseDate ? formatDateIN(e.purchaseDate) : '-'}</td>
              <td className="px-3 py-2">{[e.productType?.join(' › ') ?? e.product, e.brand, e.model].filter(Boolean).join(' · ') || '-'}</td>
              <td className="px-3 py-2">
                {showBuyer ? (
                  e.customerId ? (
                    <Link to={`/customers/${e.customerId}`} className="hover:text-primary hover:underline">{e.customerName}</Link>
                  ) : (
                    e.customerName || '-'
                  )
                ) : e.coCustomerId ? (
                  <Link to={`/customers/${e.coCustomerId}`} className="hover:text-primary hover:underline">{e.coName}</Link>
                ) : (
                  e.coName || '-'
                )}
              </td>
              <td className="px-3 py-2 text-muted-foreground">{e.area || '-'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** A customer's entries in the account register (Customer Searching), on their detail page. */
export function CustomerRegisterSection({ customerId }: { customerId: string }) {
  const { data, isLoading } = useCustomerRegisterQuery(customerId);

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 rounded-lg border bg-card p-6 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading items bought…
      </div>
    );
  }
  if (!data || (data.items.length === 0 && data.coApplicantOn.length === 0)) return null;

  return (
    <>
      {data.items.length > 0 && (
        <div className="rounded-lg border bg-card p-6">
          <h2 className="mb-4 flex items-center gap-2 text-lg font-medium">
            <PackageCheck className="h-5 w-5 text-primary" />
            Items bought ({data.items.length})
          </h2>
          <EntryRows entries={data.items} />
        </div>
      )}
      {data.coApplicantOn.length > 0 && (
        <div className="rounded-lg border bg-card p-6">
          <h2 className="mb-4 flex items-center gap-2 text-lg font-medium">
            <Shield className="h-5 w-5 text-purple-600" />
            Co-applicant on ({data.coApplicantOn.length})
          </h2>
          <EntryRows entries={data.coApplicantOn} showBuyer />
        </div>
      )}
    </>
  );
}
