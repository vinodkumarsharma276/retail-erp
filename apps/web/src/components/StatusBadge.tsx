import { cn } from '../lib/utils';
import { Badge, type BadgeTone } from './ui/badge';

/**
 * Maps every domain status in the app onto one of six semantic tones.
 *
 * The rule is "what should the reader DO about it?", not "what category is
 * this?". So `overdue` and `unmatched` are both danger even though they come
 * from unrelated modules, while expense categories — which carry no urgency at
 * all — are uniformly neutral instead of each claiming their own colour.
 */
const statusMeta: Record<string, { tone: BadgeTone; label: string }> = {
  // --- Product lifecycle ---
  in_stock: { tone: 'success', label: 'In Stock' },
  sold: { tone: 'neutral', label: 'Sold' },
  transferred: { tone: 'info', label: 'Transferred' },
  returned: { tone: 'warning', label: 'Returned' },
  damaged: { tone: 'danger', label: 'Damaged' },

  // --- Installment lifecycle ---
  upcoming: { tone: 'neutral', label: 'Upcoming' },
  due_today: { tone: 'info', label: 'Due Today' },
  paid: { tone: 'success', label: 'Paid' },
  partially_paid: { tone: 'warning', label: 'Partial' },
  overdue: { tone: 'danger', label: 'Overdue' },
  rescheduled: { tone: 'neutral', label: 'Rescheduled' },

  // --- Schedule / finance payment ---
  active: { tone: 'info', label: 'EMI Active' },
  completed: { tone: 'success', label: 'Completed' },
  defaulted: { tone: 'danger', label: 'Defaulted' },
  pending: { tone: 'warning', label: 'Pending' },
  partial: { tone: 'warning', label: 'Partial' },
  received: { tone: 'success', label: 'Received' },

  // --- Sale types ---
  // Descriptive, not urgent: a single tone keeps the Sales table calm and
  // leaves colour free to mean "needs attention" in the status column.
  full_payment: { tone: 'neutral', label: 'Full Payment' },
  partial_with_promise: { tone: 'neutral', label: 'Partial + Promise' },
  self_finance: { tone: 'neutral', label: 'Self Finance' },
  company_finance: { tone: 'neutral', label: 'Company Finance' },

  // --- Sale approval ---
  approved: { tone: 'success', label: 'Approved' },

  // --- Transfers ---
  initiated: { tone: 'info', label: 'Initiated' },
  in_transit: { tone: 'warning', label: 'In Transit' },
  cancelled: { tone: 'neutral', label: 'Cancelled' },

  // --- Reconciliation ---
  unmatched: { tone: 'danger', label: 'Unmatched' },
  matched: { tone: 'success', label: 'Matched' },
  manual_match: { tone: 'info', label: 'Manual Match' },
  disputed: { tone: 'warning', label: 'Disputed' },

  // --- Promise lifecycle (Pattern B) ---
  kept: { tone: 'success', label: 'Kept' },
  partially_kept: { tone: 'warning', label: 'Partially Kept' },
  broken: { tone: 'danger', label: 'Broken' },

  // --- Expense categories: classification only, never urgency ---
  rent: { tone: 'neutral', label: 'Rent' },
  electricity: { tone: 'neutral', label: 'Electricity' },
  salary: { tone: 'neutral', label: 'Salary' },
  transport: { tone: 'neutral', label: 'Transport' },
  maintenance: { tone: 'neutral', label: 'Maintenance' },
  marketing: { tone: 'neutral', label: 'Marketing' },
  purchase: { tone: 'neutral', label: 'Purchase' },
  misc: { tone: 'neutral', label: 'Misc' },
};

/** Tones that earn a leading dot, so urgency is visible without reading. */
const DOTTED_TONES: BadgeTone[] = ['danger', 'warning', 'success'];

interface StatusBadgeProps {
  status: string;
  className?: string;
  /** Force the dot on or off, overriding the tone-based default. */
  dot?: boolean;
}

export function StatusBadge({ status, className, dot }: StatusBadgeProps) {
  const meta = statusMeta[status] ?? {
    tone: 'neutral' as BadgeTone,
    label: status.replace(/_/g, ' '),
  };

  return (
    <Badge
      tone={meta.tone}
      dot={dot ?? DOTTED_TONES.includes(meta.tone)}
      className={cn('capitalize', className)}
    >
      {meta.label}
    </Badge>
  );
}
