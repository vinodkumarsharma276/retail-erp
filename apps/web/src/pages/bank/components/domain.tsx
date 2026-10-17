import clsx from 'clsx';
import { AlertTriangle, Bot, CheckCircle2, CircleDot, Hand, ShieldAlert, Sparkles, Wand2 } from 'lucide-react';
import type { FlagReason, GroupId, ReviewStatus, Transaction } from '../lib/api';
import { GROUP_COLOR } from '../lib/colors';
import { money } from '../lib/format';
import { Badge } from './ui';

export function Dot({ color, size = 8 }: { color: string; size?: number }) {
  return <span aria-hidden className="inline-block shrink-0 rounded-full" style={{ width: size, height: size, background: color }} />;
}

export function CategoryLabel({ category, group, className }: { category: string; group: GroupId; className?: string }) {
  return (
    <span className={clsx('inline-flex min-w-0 items-center gap-1.5 text-[13px] text-foreground', className)}>
      <Dot color={GROUP_COLOR[group]} />
      <span className="truncate">{category}</span>
    </span>
  );
}

export function Amount({ value, currency = 'INR', className, signed = true }: { value: number; currency?: string; className?: string; signed?: boolean }) {
  const credit = value > 0;
  return (
    <span className={clsx('num font-medium whitespace-nowrap', credit ? 'text-success' : 'text-foreground', className)}>
      {signed ? (credit ? '+' : '−') : ''}
      {money(Math.abs(value), currency)}
    </span>
  );
}

export function SourceBadge({ source, confidence }: { source: Transaction['category_source']; confidence: number | null }) {
  const conf = confidence != null ? ` · ${Math.round(confidence * 100)}%` : '';
  switch (source) {
    case 'user':
      return <Badge tone="accent" icon={<Hand className="size-3" />}>You</Badge>;
    case 'user-rule':
      return <Badge tone="accent" icon={<Wand2 className="size-3" />}>Your rule</Badge>;
    case 'rule':
      return <Badge icon={<Sparkles className="size-3" />}>Rule{conf}</Badge>;
    case 'ai':
      return <Badge tone={(confidence ?? 1) < 0.65 ? 'warning' : 'neutral'} icon={<Bot className="size-3" />}>AI{conf}</Badge>;
    default:
      return <Badge tone="warning" icon={<CircleDot className="size-3" />}>Guess{conf}</Badge>;
  }
}

export function ReviewBadge({ status }: { status: ReviewStatus | null }) {
  if (status === 'pending') return <Badge tone="warning" icon={<AlertTriangle className="size-3" />}>Needs review</Badge>;
  if (status === 'verified') return <Badge tone="good" icon={<CheckCircle2 className="size-3" />}>Verified</Badge>;
  if (status === 'suspicious') return <Badge tone="critical" icon={<ShieldAlert className="size-3" />}>Suspicious</Badge>;
  return null;
}

const SEVERITY_TONE = { high: 'critical', medium: 'warning', low: 'neutral' } as const;
export function FlagChips({ reasons, max = 3 }: { reasons: FlagReason[]; max?: number }) {
  if (!reasons?.length) return null;
  const sorted = [...reasons].sort((a, b) => ['high', 'medium', 'low'].indexOf(a.severity) - ['high', 'medium', 'low'].indexOf(b.severity));
  return (
    <div className="flex flex-wrap gap-1">
      {sorted.slice(0, max).map((r) => (
        <Badge key={r.code + r.label} tone={SEVERITY_TONE[r.severity]}>
          {r.label}
        </Badge>
      ))}
      {sorted.length > max && <Badge>+{sorted.length - max}</Badge>}
    </div>
  );
}

export const REASON_LABEL: Record<string, string> = {
  duplicate: 'Possible duplicate',
  uncategorized: 'No category',
  low_confidence: 'Low-confidence category',
  ai_suspicious: 'AI marked unusual',
  large_amount: 'Large amount, new payee',
  payee_spike: 'Spike vs. usual for payee',
  outlier: 'Outlier for category',
  cash: 'Large cash withdrawal',
  new_payee: 'First-time transfer',
  round_figure: 'Round-figure transfer',
};

export const METHOD_LABEL: Record<string, { label: string; tone: 'neutral' | 'accent' }> = {
  spreadsheet: { label: 'Spreadsheet', tone: 'neutral' },
  'pdf-text': { label: 'PDF text', tone: 'neutral' },
  'ai-text': { label: 'AI · text', tone: 'accent' },
  'ai-vision': { label: 'AI · vision', tone: 'accent' },
  'bank-api': { label: 'Bank API', tone: 'accent' },
};
