import { NavLink, Outlet, Navigate, useLocation } from 'react-router-dom';
import { FileText, FolderTree } from 'lucide-react';
import { cn } from '../../lib/utils';

const settingsNavItems = [
  {
    to: '/settings/forms',
    label: 'Form Builder',
    icon: FileText,
    description: 'Configure dynamic form fields',
  },
  {
    to: '/settings/categories',
    label: 'Category Manager',
    icon: FolderTree,
    description: 'Manage product categories & attributes',
  },
];

export function SettingsPage() {
  const location = useLocation();

  // If at /settings exactly, redirect to first child
  if (location.pathname === '/settings') {
    return <Navigate to="/settings/forms" replace />;
  }

  return (
    <div>
      {/* Page header */}
      <div className="mb-6">
        <h1 className="text-2xl font-semibold">Settings</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Configure forms, categories, and system settings.
        </p>
      </div>

      {/* Tab navigation */}
      <div className="flex items-center gap-1 border-b mb-6">
        {settingsNavItems.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            className={({ isActive }) =>
              cn(
                'flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors',
                isActive
                  ? 'border-primary text-primary'
                  : 'border-transparent text-muted-foreground hover:text-foreground hover:border-muted-foreground/30',
              )
            }
          >
            <item.icon className="h-4 w-4" />
            {item.label}
          </NavLink>
        ))}
      </div>

      {/* Sub-page content */}
      <Outlet />
    </div>
  );
}
