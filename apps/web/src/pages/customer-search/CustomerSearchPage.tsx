import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Download, Pencil, Plus, Search, Trash2, UploadCloud, UserSearch, X } from 'lucide-react';
import { formatDateIN, formatPhone, REGISTER_ISSUES, type RegisterIssue } from '@retailerp/shared-utils';
import { PageHeader } from '../../components/PageHeader';
import { Button } from '../../components/ui/button';
import { Badge } from '../../components/ui/badge';
import { Select } from '../../components/ui/select';
import { DataTable } from '../../components/DataTable';
import type { Column, PaginationState } from '../../components/DataTable';
import { EmptyState } from '../../components/EmptyState';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { CategoryCascader } from '../../components/CategoryCascader';
import { cn } from '../../lib/utils';
import { useDebounce } from '../../hooks/useDebounce';
import { useCanCheck } from '../../hooks/usePermission';
import { useToast } from '../../stores/toast-store';
import { useShopStore, isAllShops } from '../../stores/shop-store';
import {
  apiErrorMessage,
  downloadCustomerSearchExport,
  useCustomerSearchQuery,
  useDeleteEntryMutation,
  usePrefixesQuery,
  useReviewSummaryQuery,
  type CustomerSearchEntry,
} from '../../hooks/useCustomerSearch';
import { Tabs } from '../../components/ui/tabs';

const PAGE_SIZE = 25;

/**
 * Customer Searching: the account register that used to live on a Google
 * Sheet. Search-first — one box over account number, name, mobile,
 * co-applicant, area and product.
 */
export function CustomerSearchPage() {
  const navigate = useNavigate();
  const can = useCanCheck();
  const toast = useToast();
  const allShopsMode = isAllShops(useShopStore((s) => s.currentShopId));
  const [searchParams, setSearchParams] = useSearchParams();
  const [exporting, setExporting] = useState(false);
  const [deleting, setDeleting] = useState<CustomerSearchEntry | null>(null);
  const deleteMutation = useDeleteEntryMutation();

  const confirmDelete = async () => {
    if (!deleting) return;
    try {
      const done = await deleteMutation.mutateAsync(deleting.id);
      toast.success(`Deleted ${done.accountNumber}`);
      setDeleting(null);
    } catch (error) {
      toast.error(apiErrorMessage(error, "Couldn't delete the entry"));
    }
  };

  const page = Number(searchParams.get('page')) || 1;
  const q = searchParams.get('q') ?? '';
  const prefix = searchParams.get('prefix') ?? '';
  const area = searchParams.get('area') ?? '';
  const dateFrom = searchParams.get('from') ?? '';
  const dateTo = searchParams.get('to') ?? '';
  const typeFilter = searchParams.get('type') ?? '';
  const view = searchParams.get('view') === 'review' ? 'review' : 'all';
  const issue = searchParams.get('issue') ?? '';
  const debouncedQ = useDebounce(q, 300);
  const debouncedArea = useDebounce(area, 300);

  const update = (changes: Record<string, string>) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      for (const [k, v] of Object.entries(changes)) {
        if (v) next.set(k, v);
        else next.delete(k);
      }
      return next;
    }, { replace: true });
  };

  const filters = {
    page,
    pageSize: PAGE_SIZE,
    q: debouncedQ.trim().length >= 2 ? debouncedQ.trim() : undefined,
    prefix: prefix || undefined,
    area: debouncedArea.trim() || undefined,
    dateFrom: dateFrom || undefined,
    dateTo: dateTo || undefined,
    categoryId: typeFilter || undefined,
    issue: view === 'review' ? issue || 'any' : undefined,
  };
  const query = useCustomerSearchQuery(filters);
  const prefixes = usePrefixesQuery();
  const review = useReviewSummaryQuery();
  const entries = query.data?.data ?? [];
  const pagination = query.data?.pagination;
  const hasFilters = !!(q || prefix || area || dateFrom || dateTo || typeFilter);
  const registerEmpty = view === 'all' && !hasFilters && !query.isLoading && pagination?.totalItems === 0;
  const emptyHints = [
    can('customer_search.import') ? 'import the Google Sheet (download it as .xlsx first)' : null,
    can('customer_search.create') ? (allShopsMode ? 'switch to a single shop to add the first entry' : 'add the first entry') : null,
  ].filter(Boolean);
  const emptyHint = emptyHints.length
    ? `${emptyHints.join(', or ').replace(/^./, (c) => c.toUpperCase())}.`
    : 'Nothing has been added to the register yet.';

  const doExport = async () => {
    setExporting(true);
    try {
      await downloadCustomerSearchExport(filters);
    } catch (error) {
      toast.error(apiErrorMessage(error, 'Export failed'));
    } finally {
      setExporting(false);
    }
  };

  const columns: Column<CustomerSearchEntry>[] = [
    {
      key: 'accountNumber',
      header: 'Account Number',
      alwaysVisible: true,
      sortable: true,
      sortAccessor: (r) => r.accountNumber,
      exportValue: (r) => r.accountNumber,
      render: (r) =>
        r.accountNumber ? (
          <span className="whitespace-nowrap font-mono text-xs font-semibold text-primary">{r.accountNumber}</span>
        ) : (
          <span className="text-xs text-muted-foreground">(none)</span>
        ),
    },
    {
      key: 'customer',
      header: 'Customer',
      sortable: true,
      sortAccessor: (r) => r.customerName,
      exportValue: (r) => r.customerName,
      render: (r) => (
        <div className="flex flex-wrap items-center gap-1.5">
          {r.customerId ? (
            <Link
              to={`/customers/${r.customerId}`}
              onClick={(e) => e.stopPropagation()}
              className="font-medium hover:text-primary hover:underline"
            >
              {r.customerName}
            </Link>
          ) : (
            <span className="text-muted-foreground">{r.customerName || '(no name)'}</span>
          )}
          {r.customerId && r.customerItemCount > 1 && (
            <Link to={`/customers/${r.customerId}`} onClick={(e) => e.stopPropagation()}>
              <Badge tone="info">{r.customerItemCount} items</Badge>
            </Link>
          )}
        </div>
      ),
    },
    {
      key: 'mobile',
      header: 'Mobile',
      exportValue: (r) => r.mobile ?? '',
      render: (r) => <span className="whitespace-nowrap tabular-nums">{r.mobile ? formatPhone(r.mobile) : '-'}</span>,
    },
    {
      key: 'co',
      header: 'Co-applicant',
      exportValue: (r) => r.coName ?? '',
      render: (r) =>
        r.coName ? (
          <div>
            {r.coCustomerId ? (
              <Link to={`/customers/${r.coCustomerId}`} onClick={(e) => e.stopPropagation()} className="hover:text-primary hover:underline">
                {r.coName}
              </Link>
            ) : (
              <span>{r.coName}</span>
            )}
            {r.coMobile && <p className="text-xs tabular-nums text-muted-foreground">{formatPhone(r.coMobile)}</p>}
          </div>
        ) : (
          <span className="text-muted-foreground">-</span>
        ),
    },
    {
      key: 'area',
      header: 'Area',
      sortable: true,
      sortAccessor: (r) => r.area ?? '',
      render: (r) => r.area || <span className="text-muted-foreground">-</span>,
    },
    {
      key: 'purchaseDate',
      header: 'Purchase Date',
      sortable: true,
      sortAccessor: (r) => r.purchaseDate ?? '',
      render: (r) => <span className="whitespace-nowrap">{r.purchaseDate ? formatDateIN(r.purchaseDate) : '-'}</span>,
    },
    {
      key: 'product',
      header: 'Product Type',
      exportValue: (r) => (r.productType ? r.productType.join(' › ') : r.product ?? ''),
      render: (r) =>
        r.productType ? (
          <span title={r.productType.join(' › ')}>
            {r.productType.length > 1 && <span className="text-muted-foreground">{r.productType.slice(0, -1).join(' › ')} › </span>}
            {r.productType[r.productType.length - 1]}
          </span>
        ) : r.product ? (
          <span className="text-muted-foreground" title="As written on the sheet; no product type set">{r.product}</span>
        ) : (
          <span className="text-muted-foreground">-</span>
        ),
    },
    {
      key: 'brandModel',
      header: 'Brand / Model',
      exportValue: (r) => [r.brand, r.model].filter(Boolean).join(' '),
      render: (r) =>
        r.brand || r.model ? (
          <div>
            <p>{r.brand || '-'}</p>
            {r.model && <p className="text-xs text-muted-foreground">{r.model}</p>}
          </div>
        ) : (
          <span className="text-muted-foreground">-</span>
        ),
    },
    {
      key: 'shop',
      header: 'Shop',
      sortable: true,
      sortAccessor: (r) => r.shop.code,
      exportValue: (r) => r.shop.name,
      render: (r) => <span className="rounded-md bg-muted px-2 py-0.5 text-xs font-medium" title={r.shop.name}>{r.shop.code}</span>,
    },
    {
      key: 'issues',
      header: 'Needs review',
      exportValue: (r) => r.issues.map((c) => REGISTER_ISSUES[c as RegisterIssue] ?? c).join('; '),
      render: (r) =>
        r.issues.length ? (
          <div className="flex max-w-xs flex-wrap gap-1">
            {r.issues.map((c) => (
              <Badge key={c} tone={c === 'no_product_type' || c === 'odd_account' ? 'neutral' : 'warning'}>
                {REGISTER_ISSUES[c as RegisterIssue] ?? c}
              </Badge>
            ))}
          </div>
        ) : (
          <span className="text-muted-foreground">-</span>
        ),
    },
    ...(can('customer_search.edit') || can('customer_search.delete')
      ? ([
          {
            key: 'actions',
            // The only way to act on a row from the list; hiding it would strand the row.
            alwaysVisible: true,
            exportable: false,
            resizable: false,
            header: 'Actions',
            align: 'center',
            render: (r) => (
              <div className="flex items-center justify-center gap-1" onClick={(e) => e.stopPropagation()}>
                {can('customer_search.edit') && (
                  <Link
                    to={`/customer-search/${r.id}/edit`}
                    className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                    title={`Edit ${r.accountNumber}`}
                    aria-label={`Edit ${r.accountNumber}`}
                  >
                    <Pencil className="h-4 w-4" />
                  </Link>
                )}
                {can('customer_search.delete') && (
                  <button
                    type="button"
                    onClick={() => setDeleting(r)}
                    className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
                    title={`Delete ${r.accountNumber}`}
                    aria-label={`Delete ${r.accountNumber}`}
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                )}
              </div>
            ),
          },
        ] as Column<CustomerSearchEntry>[])
      : []),
  ];

  const paginationState: PaginationState | undefined = pagination
    ? { page: pagination.page, totalPages: pagination.totalPages, totalItems: pagination.totalItems, pageSize: pagination.pageSize }
    : undefined;

  const newEntryButton = can('customer_search.create') ? (
    allShopsMode ? (
      <Button disabled title="Switch to a single shop to add an entry (new customers are filed under it)" icon={<Plus className="h-3.5 w-3.5" />}>
        New entry
      </Button>
    ) : (
      <Link to="/customer-search/new">
        <Button icon={<Plus className="h-3.5 w-3.5" />}>New entry</Button>
      </Link>
    )
  ) : null;

  return (
    <div>
      <PageHeader
        title="Customer Searching"
        description="Every account in the register: who bought what, with their co-applicant. Search by account number, name, mobile, area or product."
        actions={
          <>
            {can('customer_search.import') && (
              <Link to="/customer-search/import">
                <Button variant="secondary" icon={<UploadCloud className="h-3.5 w-3.5" />}>Import</Button>
              </Link>
            )}
            {can('customer_search.export') && (
              <Button variant="secondary" onClick={doExport} loading={exporting} icon={<Download className="h-3.5 w-3.5" />}>
                Export
              </Button>
            )}
            {newEntryButton}
          </>
        }
      />

      {/* "Needs review": entries saved with something wrong (reused number, no mobile…), by problem. */}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Tabs
          aria-label="Register view"
          value={view}
          onChange={(v) => update({ view: v === 'review' ? 'review' : '', issue: '', page: '' })}
          items={[
            { value: 'all', label: 'All entries' },
            { value: 'review', label: 'Needs review', count: review.data?.total },
          ]}
        />
        {view === 'review' && (
          <div className="w-80">
            <Select value={issue} onChange={(e) => update({ issue: e.target.value, page: '' })} aria-label="Problem">
              <option value="">All problems ({review.data?.total ?? 0})</option>
              {(review.data?.issues ?? []).map((i) => (
                <option key={i.code} value={i.code} disabled={i.count === 0}>
                  {i.label} ({i.count})
                </option>
              ))}
            </Select>
          </div>
        )}
      </div>

      <div className="mb-4">
        <div className="relative max-w-3xl">
          <Search className="absolute left-3.5 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground" />
          <input
            autoFocus
            type="search"
            value={q}
            onChange={(e) => update({ q: e.target.value, page: '' })}
            placeholder="Account number, name, mobile, co-applicant, area or product…"
            aria-label="Search the register"
            className={cn(
              'h-12 w-full rounded-lg border bg-field pl-11 pr-10 text-base',
              'placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2',
            )}
          />
          {q && (
            <button
              onClick={() => update({ q: '', page: '' })}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              aria-label="Clear search"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>

      <div className="mb-4 flex flex-wrap items-end gap-3">
        <div className="w-36">
          <label className="mb-1 block text-xs font-medium text-muted-foreground">Prefix</label>
          <Select value={prefix} onChange={(e) => update({ prefix: e.target.value, page: '' })}>
            <option value="">All prefixes</option>
            {(prefixes.data ?? []).map((p) => (
              <option key={p.prefix} value={p.prefix}>
                {p.prefix} ({p.count})
              </option>
            ))}
          </Select>
        </div>
        <div className="w-36">
          <label className="mb-1 block text-xs font-medium text-muted-foreground">Area</label>
          <input
            value={area}
            onChange={(e) => update({ area: e.target.value, page: '' })}
            placeholder="Any area"
            className="h-9 w-full rounded-md border bg-field px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-muted-foreground">Purchased from</label>
          <input
            type="date"
            value={dateFrom}
            onChange={(e) => update({ from: e.target.value, page: '' })}
            className="h-9 rounded-md border bg-field px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-muted-foreground">to</label>
          <input
            type="date"
            value={dateTo}
            onChange={(e) => update({ to: e.target.value, page: '' })}
            className="h-9 rounded-md border bg-field px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </div>
        {typeFilter !== 'none' && (
          <CategoryCascader
            key={typeFilter ? 'set' : 'cleared'}
            compact
            allowNonLeaf
            initialCategoryId={typeFilter || undefined}
            onCategorySelect={(categoryId) => update({ type: categoryId ?? '', page: '' })}
          />
        )}
        <label className="flex h-9 items-center gap-2 whitespace-nowrap text-sm" title="Entries with no product type (imported text only)">
          <input
            type="checkbox"
            checked={typeFilter === 'none'}
            onChange={(e) => update({ type: e.target.checked ? 'none' : '', page: '' })}
          />
          No type
        </label>
        {hasFilters && (
          <Button variant="ghost" onClick={() => setSearchParams({}, { replace: true })}>
            Clear
          </Button>
        )}
      </div>

      {query.isError && (
        <div className="mb-4 rounded-lg border border-destructive/50 bg-destructive/10 p-4 text-sm text-destructive">
          {apiErrorMessage(query.error, "Couldn't search the register. Please try again.")}
        </div>
      )}

      {registerEmpty ? (
        <EmptyState
          icon={UserSearch}
          title="The register is empty"
          description={emptyHint}
          action={
            can('customer_search.create') && !allShopsMode
              ? { label: 'New entry', onClick: () => navigate('/customer-search/new') }
              : undefined
          }
          secondaryAction={
            can('customer_search.import')
              ? { label: 'Import the sheet', onClick: () => navigate('/customer-search/import') }
              : undefined
          }
        />
      ) : (
        <DataTable<CustomerSearchEntry>
          tableId="customer-search"
          columns={columns}
          data={entries}
          isLoading={query.isLoading}
          pagination={paginationState}
          onPageChange={(p) => update({ page: String(p) })}
          emptyMessage={view === 'review' ? 'Nothing to review here.' : 'No entries match your search.'}
          rowKey={(r) => r.id}
          onRowClick={can('customer_search.detail') ? (r) => navigate(`/customer-search/${r.id}`) : undefined}
        />
      )}

      <ConfirmDialog
        isOpen={!!deleting}
        title={`Delete ${deleting?.accountNumber ?? 'entry'}?`}
        message={
          deleting
            ? `The entry for ${deleting.customerName || '(no name)'}${deleting.productType ? ` (${deleting.productType.join(' › ')})` : ''} will be removed from the register.${deleting.customer ? ` The customer ${deleting.customer.customerCode} stays in Customers.` : ''}`
            : ''
        }
        confirmText="Delete"
        variant="danger"
        loading={deleteMutation.isPending}
        onConfirm={confirmDelete}
        onCancel={() => setDeleting(null)}
      />
    </div>
  );
}
