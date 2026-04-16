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
  employees: 'Employees',
  settings: 'Settings',
};

interface Crumb {
  label: string;
  path: string;
}

export function Breadcrumbs() {
  const { pathname } = useLocation();

  const segments = pathname.split('/').filter(Boolean);

  if (segments.length === 0) return null;

  const crumbs: Crumb[] = segments.map((seg, idx) => ({
    label: labelMap[seg] ?? seg.charAt(0).toUpperCase() + seg.slice(1),
    path: '/' + segments.slice(0, idx + 1).join('/'),
  }));

  return (
    <nav aria-label="Breadcrumb" className="flex items-center gap-1 text-sm text-muted-foreground mb-4">
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
            <ChevronRight className="h-3.5 w-3.5" />
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
