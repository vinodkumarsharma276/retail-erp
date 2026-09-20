import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Loader2,
  AlertCircle,
  Plus,
  Search,
  Building2,
  Users,
  Store,
} from 'lucide-react';
import { cn } from '../../lib/utils';
import { useTenantsListQuery, type TenantListItem } from '../../hooks/usePlatform';

const STATUS_BADGES: Record<TenantListItem['status'], { label: string; cls: string }> = {
  active:    { label: 'Active',    cls: 'bg-green-100 text-green-700 dark:bg-green-950/30 dark:text-green-400' },
  trial:     { label: 'Trial',     cls: 'bg-blue-100 text-blue-700 dark:bg-blue-950/30 dark:text-blue-400' },
  suspended: { label: 'Suspended', cls: 'bg-amber-100 text-amber-700 dark:bg-amber-950/30 dark:text-amber-400' },
  cancelled: { label: 'Cancelled', cls: 'bg-red-100 text-red-700 dark:bg-red-950/30 dark:text-red-400' },
};

export function TenantListPage() {
  const [status, setStatus] = useState<string>('');
  const [q, setQ] = useState('');
  const { data, isLoading, isError } = useTenantsListQuery({
    status: status || undefined,
    q: q.trim() || undefined,
  });

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-display">Tenants</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Customer organisations onboarded onto the platform.
          </p>
        </div>
        <Link
          to="/tenants/new"
          className={cn(
            'flex items-center gap-2 rounded-md bg-amber-600 px-4 py-2 text-sm font-medium text-white',
            'hover:bg-amber-700 transition-colors',
          )}
        >
          <Plus className="h-4 w-4" />
          Onboard tenant
        </Link>
      </div>

      {/* Filter bar */}
      <div className="flex flex-wrap items-center gap-3 rounded-md border bg-card px-3 py-2">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <input
            type="text"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search by name, slug, or email…"
            className="w-full rounded-md border bg-background pl-8 pr-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500/50"
          />
        </div>
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          className="rounded-md border bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500/50"
        >
          <option value="">All statuses</option>
          <option value="active">Active</option>
          <option value="trial">Trial</option>
          <option value="suspended">Suspended</option>
          <option value="cancelled">Cancelled</option>
        </select>
      </div>

      {/* Table */}
      {isLoading && (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-amber-600" />
        </div>
      )}

      {isError && (
        <div className="flex items-center gap-2 rounded-md border border-red-300 bg-red-50 dark:bg-red-950/30 px-4 py-3 text-sm text-red-700 dark:text-red-300">
          <AlertCircle className="h-4 w-4" />
          Failed to load tenants.
        </div>
      )}

      {!isLoading && !isError && (data?.length ?? 0) === 0 && (
        <div className="flex flex-col items-center justify-center rounded-md border bg-card py-16 text-center">
          <Building2 className="h-10 w-10 text-muted-foreground mb-3" />
          <p className="text-sm font-medium">No tenants yet</p>
          <p className="text-xs text-muted-foreground mt-1 mb-4">
            Onboard your first customer organisation.
          </p>
          <Link
            to="/tenants/new"
            className="flex items-center gap-2 rounded-md bg-amber-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-amber-700 transition-colors"
          >
            <Plus className="h-3.5 w-3.5" />
            Onboard tenant
          </Link>
        </div>
      )}

      {!isLoading && !isError && (data?.length ?? 0) > 0 && (
        <div className="overflow-hidden rounded-md border bg-card">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-xs uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="px-4 py-2.5 text-left font-medium">Name</th>
                <th className="px-4 py-2.5 text-left font-medium">Slug</th>
                <th className="px-4 py-2.5 text-left font-medium">Plan</th>
                <th className="px-4 py-2.5 text-left font-medium">Status</th>
                <th className="px-4 py-2.5 text-right font-medium">Shops</th>
                <th className="px-4 py-2.5 text-right font-medium">Users</th>
                <th className="px-4 py-2.5 text-left font-medium">Created</th>
              </tr>
            </thead>
            <tbody>
              {data!.map((t) => {
                const badge = STATUS_BADGES[t.status];
                return (
                  <tr key={t.id} className="border-t last:border-0 hover:bg-muted/30 transition-colors">
                    <td className="px-4 py-2.5">
                      <Link to={`/tenants/${t.id}`} className="font-medium hover:text-amber-700">
                        {t.name}
                      </Link>
                      {t.contactEmail && (
                        <p className="text-xs text-muted-foreground mt-0.5 truncate max-w-[260px]">
                          {t.contactEmail}
                        </p>
                      )}
                    </td>
                    <td className="px-4 py-2.5">
                      <code className="rounded bg-muted px-1.5 py-0.5 text-xs">{t.slug}</code>
                    </td>
                    <td className="px-4 py-2.5">
                      <span className="text-xs">{t.plan?.name ?? t.plan?.code ?? '—'}</span>
                    </td>
                    <td className="px-4 py-2.5">
                      <span className={cn('inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium', badge.cls)}>
                        {badge.label}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                        <Store className="h-3 w-3" />
                        {t._count?.shops ?? 0}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                        <Users className="h-3 w-3" />
                        {t._count?.users ?? 0}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-xs text-muted-foreground">
                      {new Date(t.createdAt).toLocaleDateString()}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
