import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { AlertTriangle, Pencil, ReceiptText, Shield, Trash2, User } from 'lucide-react';
import { formatDateIN, formatPhone, REGISTER_ISSUES, type RegisterIssue } from '@retailerp/shared-utils';
import { PageHeader } from '../../components/PageHeader';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { Button } from '../../components/ui/button';
import { Badge } from '../../components/ui/badge';
import { LoadingSpinner } from '../../components/LoadingSpinner';
import { useCanCheck } from '../../hooks/usePermission';
import { useToast } from '../../stores/toast-store';
import { apiErrorMessage, useCustomerSearchEntryQuery, useDeleteEntryMutation } from '../../hooks/useCustomerSearch';
import { useRegisterListUrl } from './registerListUrl';

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-sm font-medium text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 text-sm">{children || '-'}</dd>
    </div>
  );
}

/** One account register entry: the minimum of the sale for now; more of the sale will be added here later. */
export function CustomerSearchDetailPage() {
  const { id } = useParams<{ id: string }>();
  const can = useCanCheck();
  const navigate = useNavigate();
  const toast = useToast();
  const [confirming, setConfirming] = useState(false);
  const deleteMutation = useDeleteEntryMutation();
  const listUrl = useRegisterListUrl();
  const { data: entry, isLoading, isError, error } = useCustomerSearchEntryQuery(id);

  if (isLoading) return <LoadingSpinner />;
  if (isError || !entry) {
    return (
      <div>
        <PageHeader title="Entry not found" backTo={listUrl} />
        <p className="text-sm text-muted-foreground">{apiErrorMessage(error, 'This entry does not exist.')}</p>
      </div>
    );
  }

  return (
    <div className="max-w-5xl">
      <PageHeader
        title={entry.accountNumber || '(no account number)'}
        description={[entry.productType?.join(' › ') ?? entry.product, entry.brand, entry.model].filter(Boolean).join(' · ') || undefined}
        backTo={listUrl}
        badge={<Badge tone={entry.source === 'import' ? 'neutral' : 'primary'}>{entry.source === 'import' ? 'From the sheet' : 'Entered in app'}</Badge>}
        actions={
          can('customer_search.edit') || can('customer_search.delete') ? (
            <>
              {can('customer_search.delete') && (
                <Button variant="destructive-soft" onClick={() => setConfirming(true)} icon={<Trash2 className="h-3.5 w-3.5" />}>
                  Delete
                </Button>
              )}
              {can('customer_search.edit') && (
                <Link to={`/customer-search/${entry.id}/edit`} state={{ listUrl }}>
                  <Button variant="secondary" icon={<Pencil className="h-3.5 w-3.5" />}>Edit</Button>
                </Link>
              )}
            </>
          ) : null
        }
      />

      {entry.issues.length > 0 && (
        <section className="mb-4 rounded-lg border border-warning/40 bg-warning-muted p-4 text-sm">
          <h2 className="mb-2 flex items-center gap-2 font-semibold text-warning">
            <AlertTriangle className="h-4 w-4" /> Needs review
          </h2>
          <ul className="list-disc space-y-0.5 pl-5 text-foreground">
            {entry.issues.map((code) => (
              <li key={code}>
                {REGISTER_ISSUES[code as RegisterIssue] ?? code}
                {code === 'invalid_mobile' && entry.rawValues?.mobile ? ` — the sheet had “${entry.rawValues.mobile}”` : ''}
                {code === 'invalid_date' && entry.rawValues?.purchaseDate ? ` — the sheet had “${entry.rawValues.purchaseDate}”` : ''}
                {code === 'co_incomplete' && entry.rawValues?.coMobile ? ` — the sheet had co-applicant mobile “${entry.rawValues.coMobile}”` : ''}
                {code === 'duplicate_account' && (
                  <>
                    {' — '}
                    <Link to={`/customer-search?q=${encodeURIComponent(entry.accountNumber)}`} className="text-primary hover:underline">
                      see every entry with {entry.accountNumber}
                    </Link>
                  </>
                )}
              </li>
            ))}
          </ul>
          {can('customer_search.edit') && <p className="mt-2 text-xs text-muted-foreground">Edit the entry to fix these; it leaves the list once nothing is left to review.</p>}
        </section>
      )}

      <ConfirmDialog
        isOpen={confirming}
        title={`Delete ${entry.accountNumber || 'this entry'}?`}
        message={`The entry for ${entry.customerName || '(no name)'} will be removed from the register.${entry.customer ? ` The customer ${entry.customer.customerCode} stays in Customers.` : ''}`}
        confirmText="Delete"
        variant="danger"
        loading={deleteMutation.isPending}
        onCancel={() => setConfirming(false)}
        onConfirm={async () => {
          try {
            await deleteMutation.mutateAsync(entry.id);
            toast.success(`Deleted ${entry.accountNumber}`);
            navigate(listUrl);
          } catch (err) {
            toast.error(apiErrorMessage(err, "Couldn't delete the entry"));
          }
        }}
      />

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="rounded-lg border bg-card p-6">
          <h2 className="mb-4 text-lg font-medium">Purchase</h2>
          <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Row label="Account Number"><span className="font-mono font-semibold">{entry.accountNumber}</span></Row>
            <Row label="Purchase date">{entry.purchaseDate ? formatDateIN(entry.purchaseDate) : null}</Row>
            <Row label="Product type">
              {entry.productType ? (
                entry.productType.join(' › ')
              ) : entry.product ? (
                <span className="text-muted-foreground">{entry.product} (as written; no type set)</span>
              ) : null}
            </Row>
            <Row label="Brand">{entry.brand}</Row>
            <Row label="Model">{entry.model}</Row>
            <Row label="Shop">{entry.shop.name}</Row>
          </dl>
          {entry.matchingSale && (
            <Link
              to={`/sales/${entry.matchingSale.id}`}
              className="mt-4 flex items-center gap-2 rounded-md border p-3 text-sm hover:bg-muted"
            >
              <ReceiptText className="h-4 w-4 text-primary" />
              Sale with the same ledger number: <span className="font-mono">{entry.matchingSale.saleNumber}</span>
              {entry.matchingSale.saleDate && <span className="text-muted-foreground">({formatDateIN(entry.matchingSale.saleDate)})</span>}
            </Link>
          )}
        </section>

        <section className="rounded-lg border bg-card p-6">
          <h2 className="mb-4 flex items-center gap-2 text-lg font-medium">
            <User className="h-5 w-5 text-primary" /> Customer
            {entry.customerItemCount > 1 && <Badge tone="info">{entry.customerItemCount} items bought</Badge>}
          </h2>
          <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Row label="Name">
              {entry.customer ? (
                <>
                  <Link to={`/customers/${entry.customer.id}`} className="font-medium text-primary hover:underline">{entry.customerName}</Link>
                  <span className="ml-1.5 font-mono text-xs text-muted-foreground">{entry.customer.customerCode}</span>
                </>
              ) : (
                entry.customerName || null
              )}
            </Row>
            <Row label="Mobile">{entry.mobile ? formatPhone(entry.mobile) : null}</Row>
            <Row label="Address">{entry.address}</Row>
            <Row label="Area">{entry.area}</Row>
          </dl>
          {entry.customer && entry.customer.name !== entry.customerName && (
            <p className="mt-3 text-xs text-muted-foreground">Filed under customer “{entry.customer.name}”.</p>
          )}
        </section>

        <section className="rounded-lg border bg-card p-6">
          <h2 className="mb-4 flex items-center gap-2 text-lg font-medium">
            <Shield className="h-5 w-5 text-purple-600" /> Co-applicant
          </h2>
          {entry.coName ? (
            <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Row label="Name">
                {entry.coCustomer ? (
                  <>
                    <Link to={`/customers/${entry.coCustomer.id}`} className="font-medium text-primary hover:underline">{entry.coName}</Link>
                    <span className="ml-1.5 font-mono text-xs text-muted-foreground">{entry.coCustomer.customerCode}</span>
                  </>
                ) : (
                  entry.coName
                )}
              </Row>
              <Row label="Mobile">{entry.coMobile ? formatPhone(entry.coMobile) : null}</Row>
            </dl>
          ) : (
            <p className="text-sm text-muted-foreground">No co-applicant on this entry.</p>
          )}
        </section>

        <section className="rounded-lg border bg-card p-6">
          <h2 className="mb-4 text-lg font-medium">Record</h2>
          <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Row label="Added">{formatDateIN(entry.createdAt)}{entry.creator ? ` by ${entry.creator.fullName}` : ''}</Row>
            <Row label="Last changed">{formatDateIN(entry.updatedAt)}</Row>
            {entry.importBatch && (
              <Row label="Imported from">
                {entry.importBatch.fileName}, records {entry.importBatch.rowFrom}–{entry.importBatch.rowTo}
              </Row>
            )}
          </dl>
        </section>
      </div>
    </div>
  );
}
