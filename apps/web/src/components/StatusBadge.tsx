import { cn } from '../lib/utils';

const statusStyles: Record<string, { bg: string; text: string; label: string }> = {
  in_stock: { bg: 'bg-green-100', text: 'text-green-700', label: 'In Stock' },
  sold: { bg: 'bg-red-100', text: 'text-red-700', label: 'Sold' },
  transferred: { bg: 'bg-blue-100', text: 'text-blue-700', label: 'Transferred' },
  returned: { bg: 'bg-yellow-100', text: 'text-yellow-700', label: 'Returned' },
  damaged: { bg: 'bg-gray-100', text: 'text-gray-700', label: 'Damaged' },
  overdue: { bg: 'bg-red-100', text: 'text-red-700', label: 'Overdue' },
  paid: { bg: 'bg-green-100', text: 'text-green-700', label: 'Paid' },
  upcoming: { bg: 'bg-blue-100', text: 'text-blue-700', label: 'Upcoming' },
  due_today: { bg: 'bg-orange-100', text: 'text-orange-700', label: 'Due Today' },
  partially_paid: { bg: 'bg-yellow-100', text: 'text-yellow-700', label: 'Partial' },
  rescheduled: { bg: 'bg-purple-100', text: 'text-purple-700', label: 'Rescheduled' },
  pending: { bg: 'bg-orange-100', text: 'text-orange-700', label: 'Pending' },
  partial: { bg: 'bg-yellow-100', text: 'text-yellow-700', label: 'Partial' },
};

interface StatusBadgeProps {
  status: string;
  className?: string;
}

export function StatusBadge({ status, className }: StatusBadgeProps) {
  const style = statusStyles[status] ?? {
    bg: 'bg-gray-100',
    text: 'text-gray-700',
    label: status.replace(/_/g, ' '),
  };

  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium capitalize',
        style.bg,
        style.text,
        className,
      )}
    >
      {style.label}
    </span>
  );
}
