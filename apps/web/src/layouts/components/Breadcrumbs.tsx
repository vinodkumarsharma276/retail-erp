import { Link, useLocation } from 'react-router-dom';
import { ChevronRight, Home } from 'lucide-react';
import { cn } from '../../lib/utils';

/** Map route path segments to human-readable labels. */
const labelMap: Record<string, string> = {
  dashboard: 'Dashboard',
  products: 'Products',
  distributors: 'Distributors',
  purchases: 'Purchases',
  customers: 'Customers',
  sales: 'Sales',
  new: 'New',
  edit: 'Edit',
  installments: 'Installments',
  transfers: 'Transfers',
  expenses: 'Expenses',
  bank: 'Bank Statements',
  upload: 'Upload',
  review: 'Review queue',
  transactions: 'Transactions',
  statements: 'Statements',
  rules: 'Rules & settings',
  employees: 'Employees',
  settings: 'Settings',
};

/** Singular display names for parent segments (used for detail labels). */
const singularLabelMap: Record<string, string> = {
  products: 'Product',
  distributors: 'Distributor',
  purchases: 'Purchase',
  customers: 'Customer',
  sales: 'Sale',
  installments: 'Schedule',
  transfers: 'Transfer',
  expenses: 'Expense',
  employees: 'Employee',
};

/** Check whether a path segment looks like a UUID. */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-/i;

interface Crumb {
  label: string;
  path: string;
}

export function Breadcrumbs({ className }: { className?: string } = {}) {
  const { pathname } = useLocation();

  const segments = pathname.split('/').filter(Boolean);

  if (segments.length === 0) return null;

  // A single crumb just repeats the page title that sits directly below it.
  if (segments.length === 1) return null;

  const crumbs: Crumb[] = segments.map((seg, idx) => {
    // If this segment is a UUID, replace it with a meaningful label
    if (UUID_RE.test(seg)) {
      const parentSeg = idx > 0 ? segments[idx - 1] : '';
      const nextSeg = idx < segments.length - 1 ? segments[idx + 1] : '';
      const singularName = singularLabelMap[parentSeg] ?? 'Details';

      // If the next segment is "edit", this UUID segment should show "Edit"
      if (nextSeg === 'edit') {
        return {
          label: `Edit ${singularName}`,
          path: '/' + segments.slice(0, idx + 1).join('/'),
        };
      }

      return {
        label: `${singularName} Details`,
        path: '/' + segments.slice(0, idx + 1).join('/'),
      };
    }

    // If this segment is "edit" and previous segment was a UUID, skip it
    // (the UUID crumb already shows "Edit ...")
    if (seg === 'edit' && idx > 0 && UUID_RE.test(segments[idx - 1])) {
      return null as unknown as Crumb; // will be filtered out below
    }

    return {
      label: labelMap[seg] ?? seg.charAt(0).toUpperCase() + seg.slice(1),
      path: '/' + segments.slice(0, idx + 1).join('/'),
    };
  }).filter(Boolean);

  return (
    <nav
      aria-label="Breadcrumb"
      className={cn('flex items-center gap-1 text-xs text-muted-foreground', className)}
    >
      <Link
        to="/"
        className="flex items-center hover:text-foreground transition-colors"
      >
        <Home className="h-3.5 w-3.5" />
      </Link>
      {crumbs.map((crumb, idx) => {
        const isLast = idx === crumbs.length - 1;
        return (
          <span key={crumb.path} className="flex items-center gap-1">
            <ChevronRight className="h-3 w-3" />
            {isLast ? (
              <span className={cn('font-medium text-foreground')}>
                {crumb.label}
              </span>
            ) : (
              <Link
                to={crumb.path}
                className="hover:text-foreground transition-colors"
              >
                {crumb.label}
              </Link>
            )}
          </span>
        );
      })}
    </nav>
  );
}
