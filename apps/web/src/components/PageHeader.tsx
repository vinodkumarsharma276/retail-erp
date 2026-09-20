import type { ReactNode } from 'react';
import { ArrowLeft } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { cn } from '../lib/utils';
import { Button } from './ui/button';
import { Breadcrumbs } from '../layouts/components/Breadcrumbs';

/**
 * The single page-title pattern for the whole app.
 *
 * Previously 36 pages each hand-rolled their own `<h1>` block with slightly
 * different margins and type sizes, while the layout rendered a separate
 * breadcrumb strip above them — so every screen spent two rows of chrome
 * saying the same word twice ("Sales" in the crumb, "Sales" in the heading).
 * Breadcrumbs now live inline here, above the title, and only render when
 * they add something the title doesn't.
 */
export interface PageHeaderProps {
  title: string;
  description?: ReactNode;
  /** Primary + secondary actions, right-aligned. One primary button, please. */
  actions?: ReactNode;
  /** Shows a back button before the title. */
  backTo?: string | (() => void);
  /** Status badge or similar, rendered next to the title. */
  badge?: ReactNode;
  /** Set false on detail pages where the crumb trail is noise. */
  showBreadcrumbs?: boolean;
  className?: string;
}

export function PageHeader({
  title,
  description,
  actions,
  backTo,
  badge,
  showBreadcrumbs = true,
  className,
}: PageHeaderProps) {
  const navigate = useNavigate();

  const handleBack = () => {
    if (typeof backTo === 'function') backTo();
    else if (typeof backTo === 'string') navigate(backTo);
  };

  return (
    <header className={cn('mb-4', className)}>
      {showBreadcrumbs && <Breadcrumbs className="mb-1.5" />}

      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
        <div className="flex min-w-0 items-start gap-2">
          {backTo && (
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={handleBack}
              aria-label="Go back"
              className="mt-0.5"
            >
              <ArrowLeft className="h-4 w-4" />
            </Button>
          )}
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-display truncate">{title}</h1>
              {badge}
            </div>
            {description && (
              <p className="mt-0.5 text-caption max-w-2xl">{description}</p>
            )}
          </div>
        </div>

        {actions && (
          <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>
        )}
      </div>
    </header>
  );
}
