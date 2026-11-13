import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { ChevronDown, Copy, Download, Pencil, Plus, Search, Trash2, UploadCloud, UserSearch, X } from 'lucide-react';
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
import type { FromRegister } from './registerListUrl';
import { Tabs } from '../../components/ui/tabs';

const PAGE_SIZE = 25;

/**
 * Customer Searching: the account register that used to live on a Google
 * Sheet. Search-first — one box over account number, name, mobile,
 * co-applicant, area and product.
 */
/**
 * A person's mobiles in a table cell: the first, and under it "+1 more" that
 * opens the full list. The list floats above the page, so a narrow column or
 * the table's scroll box can't cut it off. Picking a number copies it; clicks
 * stay here and don't open the entry.
 */
function PhoneList({ numbers, className }: { numbers: Array<string | null | undefined>; className?: string }) {
  const toast = useToast();
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const [at, setAt] = useState<{ top: number; left: number } | null>(null);
  const list = numbers.filter((n): n is string => !!n);

  useEffect(() => {
    if (!at) return;
    const close = (e: Event) => {
      if (e.type === 'keydown' && (e as KeyboardEvent).key !== 'Escape') return;
      if (e.type === 'mousedown' && (menu.current?.contains(e.target as Node) || trigger.current?.contains(e.target as Node))) return;
      setAt(null);
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', close);
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', close);
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
    };
  }, [at]);

  if (!list.length) return <span className="text-muted-foreground">-</span>;
  const first = <span className="block truncate tabular-nums" title={formatPhone(list[0])}>{formatPhone(list[0])}</span>;
  if (list.length === 1) return <span className={className}>{first}</span>;
  return (
    <span className={cn('block', className)} onClick={(e) => e.stopPropagation()}>
      {first}
      <button
        ref={trigger}
        type="button"
        aria-haspopup="menu"
        aria-expanded={!!at}
        className="inline-flex items-center gap-0.5 text-xs font-medium text-primary hover:underline"
        onClick={() => {
          const r = trigger.current!.getBoundingClientRect();
          setAt(at ? null : { top: r.bottom + 4, left: r.left });
        }}
      >
        +{list.length - 1} more <ChevronDown className="h-3 w-3" />
      </button>
      {at &&
        createPortal(
          <div
            ref={menu}
            role="menu"
            style={{ position: 'fixed', top: at.top, left: at.left }}
            className="z-dropdown min-w-[13rem] rounded-lg border border-border bg-popover p-1 text-popover-foreground shadow-lg"
            onClick={(e) => e.stopPropagation()}
          >
            <p className="px-2.5 py-1.5 text-overline">Mobile numbers — click to copy</p>
            {list.map((n, i) => (
              <button
                key={n}
                type="button"
                role="menuitem"
                className="flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-left text-sm hover:bg-muted"
                onClick={() => {
                  void navigator.clipboard?.writeText(n);
                  toast.success(`Copied ${formatPhone(n)}`);
                  setAt(null);
                }}
              >
                <Copy className="h-3.5 w-3.5 text-muted-foreground" />
                <span className="tabular-nums">{formatPhone(n)}</span>
                {i === 0 && <span className="ml-auto text-xs text-muted-foreground">main</span>}
              </button>
            ))}
          </div>,
          document.body,
        )}
    </span>
  );
}

/** "Search in": every column (anywhere in it), or one column for its exact value. Same list as the phone. */
const SEARCH_IN = [
  { value: 'all', label: 'All fields', placeholder: 'Account number, name, mobile, co-applicant, area or product…' },
  { value: 'account', label: 'Account number', placeholder: 'Exact account number, e.g. MN 1' },
  { value: 'name', label: 'Customer name', placeholder: 'Exact customer name' },
  { value: 'mobile', label: 'Mobile', placeholder: '10-digit mobile (either number)' },
  { value: 'coApplicant', label: 'Co-applicant', placeholder: 'Exact co-applicant name, or their 10-digit mobile' },
  { value: 'area', label: 'Area', placeholder: 'Exact area, e.g. KHORA' },
  { value: 'product', label: 'Product type', placeholder: 'Exact product type (includes its sub-types), e.g. Cooler' },
  { value: 'brand', label: 'Brand', placeholder: 'Exact brand, e.g. WHIRLPOOL' },
  { value: 'model', label: 'Model', placeholder: 'Exact model number' },
  { value: 'customerCode', label: 'Customer code', placeholder: 'Exact customer code, e.g. CUST-0042' },
] as const;

export function CustomerSearchPage() {
  const navigate = useNavigate();
  const location = useLocation();
  // Details and edit come back to exactly this view (tab, problem, search, page).
  const fromList: FromRegister = { listUrl: location.pathname + location.search };
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
  const searchInOption = SEARCH_IN.find((f) => f.value === searchParams.get('in')) ?? SEARCH_IN[0];
  const searchIn = searchInOption.value;
  // Newest purchase first unless a column header asks otherwise; sorted by the API over the whole register.
  const sortKey = searchParams.get('sort') || 'purchaseDate';
  const sortDir: 'asc' | 'desc' = searchParams.get('dir') === 'asc' || searchParams.get('dir') === 'desc' ? (searchParams.get('dir') as 'asc' | 'desc') : sortKey === 'purchaseDate' ? 'desc' : 'asc';
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
    // Exact search takes any length ("MN 1"); anywhere-search waits for 2 characters.
    q: debouncedQ.trim().length >= (searchIn === 'all' ? 2 : 1) ? debouncedQ.trim() : undefined,
    field: searchIn === 'all' ? undefined : searchIn,
    prefix: prefix || undefined,
    area: debouncedArea.trim() || undefined,
    dateFrom: dateFrom || undefined,
    dateTo: dateTo || undefined,
    categoryId: typeFilter || undefined,
    issue: view === 'review' ? issue || 'any' : undefined,
    sort: sortKey,
    dir: sortDir,
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
      exportValue: (r) => [r.mobile, r.altMobile].filter(Boolean).join(', '),
      render: (r) => <PhoneList numbers={[r.mobile, r.altMobile]} />,
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
            {r.coMobile && <PhoneList numbers={[r.coMobile, r.coAltMobile]} className="text-xs text-muted-foreground" />}
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
                    state={fromList}
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
      <Link to="/customer-search/new" state={fromList}>
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
        <div className="flex max-w-3xl gap-2">
          <Select
            aria-label="Search in"
            title="Search in one column for an exact value, or in all of them"
            value={searchIn}
            onChange={(e) => update({ in: e.target.value === 'all' ? '' : e.target.value, page: '' })}
            className="h-12 w-44 shrink-0 text-sm"
          >
            {SEARCH_IN.map((f) => (
              <option key={f.value} value={f.value}>
                {f.label}
              </option>
            ))}
          </Select>
          <div className="relative min-w-0 flex-1">
            <Search className="absolute left-3.5 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground" />
            <input
              autoFocus
              type="search"
              value={q}
              onChange={(e) => update({ q: e.target.value, page: '' })}
              placeholder={searchInOption.placeholder}
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
        {searchIn !== 'all' && (
          <p className="mt-1 text-xs text-muted-foreground">
            Exact match on {searchInOption.label.toLowerCase()} — choose “All fields” to find it anywhere.
          </p>
        )}
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
              ? { label: 'New entry', onClick: () => navigate('/customer-search/new', { state: fromList }) }
              : undefined
          }
          secondaryAction={
            can('customer_search.import')
              ? { label: 'Import the sheet', onClick: () => navigate('/customer-search/import') }
              : undefined
          }
        />
      ) : (
        <>
          {pagination && (
            <p className="mb-2 text-sm text-muted-foreground" data-testid="customer-search-total">
              <span className="font-semibold text-foreground">{pagination.totalItems.toLocaleString('en-IN')}</span>{' '}
              {pagination.totalItems === 1 ? 'entry' : 'entries'}
              {hasFilters || view === 'review'
                ? pagination.totalItems === 1 ? ' matches' : ' match'
                : ' in the register'}
            </p>
          )}
          <DataTable<CustomerSearchEntry>
            tableId="customer-search"
            columns={columns}
            data={entries}
            isLoading={query.isLoading}
            pagination={paginationState}
            onPageChange={(p) => update({ page: String(p) })}
            emptyMessage={view === 'review' ? 'Nothing to review here.' : 'No entries match your search.'}
            rowKey={(r) => r.id}
            serverSort={{
              key: sortKey,
              dir: sortDir,
              onChange: (key, dir) =>
                update({ sort: key === 'purchaseDate' ? '' : key, dir: key === 'purchaseDate' && dir === 'desc' ? '' : dir, page: '' }),
            }}
            onRowClick={can('customer_search.detail') ? (r) => navigate(`/customer-search/${r.id}`, { state: fromList }) : undefined}
          />
        </>
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
