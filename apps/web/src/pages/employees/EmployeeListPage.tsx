import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useCanCheck } from '../../hooks/usePermission';
import { Plus, Search, X, Pencil } from 'lucide-react';
import { PageHeader } from '../../components/PageHeader';
import { Button } from '../../components/ui/button';
import { cn } from '../../lib/utils';
import { useDebounce } from '../../hooks/useDebounce';
import { useEmployeesQuery } from '../../hooks/useEmployees';
import type { Employee } from '../../hooks/useEmployees';
import { DataTable } from '../../components/DataTable';
import type { Column, PaginationState } from '../../components/DataTable';
import { StatusBadge } from '../../components/StatusBadge';

const PAGE_SIZE = 20;

export function EmployeeListPage() {
  const navigate = useNavigate();
  const can = useCanCheck();

  // Filters state
  const [page, setPage] = useState(1);
  const [searchText, setSearchText] = useState('');
  const debouncedSearch = useDebounce(searchText, 300);

  const employeesQuery = useEmployeesQuery({
    page,
    pageSize: PAGE_SIZE,
    search: debouncedSearch.length >= 2 ? debouncedSearch : undefined,
  });

  const employees = employeesQuery.data?.data ?? [];
  const pagination = employeesQuery.data?.pagination;

  // Clear filters
  const hasFilters = !!searchText;
  const clearFilters = () => {
    setSearchText('');
    setPage(1);
  };

  // Table columns
  const columns: Column<Employee>[] = [
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
      key: 'name',
      header: 'Name',
      render: (row) => (
        <div>
          <span className="font-medium">{row.user?.fullName ?? '-'}</span>
        </div>
      ),
    },
    {
      key: 'username',
      header: 'Username',
      render: (row) => (
        <span className="font-mono text-xs">{row.user?.username ?? '-'}</span>
      ),
    },
    {
      key: 'role',
      header: 'Role',
      render: (row) =>
        row.user?.role ? (
          <StatusBadge status={row.user.role} />
        ) : (
          '-'
        ),
    },
    {
      key: 'shop',
      header: 'Shop',
      render: (row) => row.shop?.name ?? '-',
    },
    {
      key: 'designation',
      header: 'Designation',
      render: (row) => row.designation || '-',
    },
    {
      key: 'dateOfJoining',
      header: 'Joined',
      render: (row) =>
        row.dateOfJoining
          ? new Date(row.dateOfJoining).toLocaleDateString('en-IN')
          : '-',
    },
    {
      key: 'status',
      header: 'Status',
      render: (row) => (
        <StatusBadge status={row.isActive ? 'active' : 'cancelled'} />
      ),
    },
    {
      key: 'actions',
      header: 'Actions',
      render: (row) => (
        <div className="flex items-center gap-2">
          {can('employees.edit') && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              navigate(`/employees/${row.id}/edit`);
            }}
            className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
            title="Edit employee"
          >
            <Pencil className="h-4 w-4" />
          </button>
          )}
        </div>
      ),
    },
  ];

  // Pagination state for DataTable
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
      <PageHeader
        title="Employees"
        description="Field staff who collect installments through the mobile app."
        actions={
          can('employees.create') && (
            <Link to="/employees/new">
              <Button icon={<Plus className="h-3.5 w-3.5" />}>Add employee</Button>
            </Link>
          )
        }
      />

      {/* Filters row */}
      <div className="flex flex-wrap items-end gap-4 mb-6">
        {/* Search input */}
        <div className="min-w-[320px] flex-1 max-w-md">
          <label className="block text-xs font-medium text-muted-foreground mb-1">
            Search
          </label>
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <input
              type="text"
              value={searchText}
              onChange={(e) => {
                setSearchText(e.target.value);
                setPage(1);
              }}
              placeholder="Name, username, or phone..."
              className={cn(
                'w-full rounded-md border bg-field pl-9 pr-8 py-2 text-sm',
                'placeholder:text-muted-foreground',
                'focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2',
              )}
            />
            {searchText && (
              <button
                onClick={() => {
                  setSearchText('');
                  setPage(1);
                }}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
        </div>

        {/* Clear filters */}
        {hasFilters && (
          <button
            onClick={clearFilters}
            className="rounded-md border px-3 py-2 text-sm text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
          >
            Clear Filters
          </button>
        )}
      </div>

      {/* Error state */}
      {employeesQuery.isError && (
        <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-4 mb-6 text-sm text-destructive">
          Failed to load employees. Please try again.
        </div>
      )}

      {/* Data table */}
      <DataTable<Employee>
        columns={columns}
        data={employees}
        isLoading={employeesQuery.isLoading}
        pagination={paginationState}
        onPageChange={setPage}
        emptyMessage="No employees found."
        rowKey={(row) => row.id}
      />
    </div>
  );
}
