import { CheckCircle2, RotateCcw, ShieldAlert, Wand2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { api, type Transaction } from '../lib/api';
import { date } from '../lib/format';
import { useInvalidateData, useMeta, useUpdateTx } from '../lib/queries';
import { useCanCheck } from '../../../hooks/usePermission';
import { Amount, CategoryLabel, FlagChips, ReviewBadge, SourceBadge } from './domain';
import { Button, Drawer, Field, Input, Select, useToast } from './ui';

/** Suggest a reusable rule pattern from a narration: the counterparty, else the longest alphabetic chunk. */
function suggestPattern(tx: Transaction) {
  if (tx.counterparty && tx.counterparty.length >= 3) return tx.counterparty.toUpperCase();
  const words = tx.description.replace(/[^A-Za-z ]/g, ' ').split(/\s+/).filter((w) => w.length > 3);
  return words.slice(0, 3).join(' ').toUpperCase();
}

export function CategorySelect({ value, onChange, disabled, placeholder }: { value: string; onChange: (v: string) => void; disabled?: boolean; placeholder?: string }) {
  const { data: meta } = useMeta();
  const groups = useMemo(() => meta?.groups ?? [], [meta]);
  return (
    <Select value={value} onChange={(e) => onChange(e.target.value)} disabled={disabled} className="w-full" aria-label="Category">
      {placeholder && (
        <option value="" disabled>
          {placeholder}
        </option>
      )}
      {groups.map((g) => (
        <optgroup key={g.id} label={g.label}>
          {meta?.categories
            .filter((c) => c.group === g.id)
            .map((c) => (
              <option key={c.name} value={c.name}>
                {c.name}
              </option>
            ))}
        </optgroup>
      ))}
    </Select>
  );
}

export function TransactionDrawer({ tx, onClose }: { tx: Transaction | null; onClose: () => void }) {
  const canEdit = useCanCheck()('bank.reconcile');
  const toast = useToast();
  const update = useUpdateTx();
  const invalidate = useInvalidateData();
  const [current, setCurrent] = useState<Transaction | null>(tx);
  const [note, setNote] = useState('');
  const [rulePattern, setRulePattern] = useState('');
  const [ruleScope, setRuleScope] = useState<'shop' | 'all'>('shop');

  useEffect(() => {
    setCurrent(tx);
    setNote(tx?.reviewer_note ?? '');
    if (tx) setRulePattern(suggestPattern(tx));
  }, [tx]);

  const createRule = useMutation({
    mutationFn: () =>
      api.createRule({
        pattern: rulePattern,
        match_type: 'contains',
        category: current!.category,
        shop_id: ruleScope === 'shop' ? current!.shop_id : null,
        applyToExisting: true,
      }),
    onSuccess: (r) => {
      toast(`Rule saved · applied to ${r.applied} transaction${r.applied === 1 ? '' : 's'}`, 'good');
      invalidate();
    },
    onError: (e: Error) => toast(e.message, 'critical'),
  });

  if (!current) return null;
  const t = current;

  const patch = (p: Parameters<typeof api.updateTx>[1], msg: string) =>
    update.mutate(
      { id: t.id, patch: p },
      {
        onSuccess: (next) => {
          setCurrent(next);
          toast(msg, 'good');
        },
        onError: (e: Error) => toast(e.message, 'critical'),
      },
    );

  return (
    <Drawer open={!!tx} onClose={onClose} title="Transaction details">
      <div className="space-y-5 p-5">
        <div>
          <div className="flex items-start justify-between gap-3">
            <div className="text-muted-foreground text-[13px]">
              {date(t.date)} · {t.shop_name} · {t.bank}
            </div>
            <ReviewBadge status={t.review_status} />
          </div>
          <Amount value={t.amount} className="mt-1 block text-3xl font-semibold tracking-tight" />
          {t.counterparty && <div className="mt-1 text-[15px] font-medium">{t.counterparty}</div>}
          <p className="mt-2 rounded-lg bg-subtle p-3 font-mono text-[12.5px] leading-relaxed break-all text-foreground/80">{t.description}</p>
        </div>

        {t.flag_reasons.length > 0 && (
          <div>
            <div className="mb-1.5 text-[13px] font-medium text-foreground/80">Why it was flagged</div>
            <FlagChips reasons={t.flag_reasons} max={10} />
          </div>
        )}

        <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-[13px]">
          <div>
            <dt className="text-muted-foreground">Channel</dt>
            <dd>{t.channel}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Balance after</dt>
            <dd className="num">{t.balance != null ? <Amount value={t.balance} signed={false} className="!text-foreground font-normal" /> : '—'}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Reference</dt>
            <dd className="truncate">{t.reference || '—'}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Source file</dt>
            <dd className="truncate" title={t.file_name}>
              {t.file_name}
            </dd>
          </div>
          <div className="col-span-2">
            <dt className="text-muted-foreground">Categorized by</dt>
            <dd className="mt-0.5 flex items-center gap-2">
              <SourceBadge source={t.category_source} confidence={t.confidence} />
              {t.ai_note && <span className="text-foreground/80">{t.ai_note.replace(/^⚠\s*/, '')}</span>}
            </dd>
          </div>
        </dl>

        <div className="space-y-3 rounded-xl border border-border p-4">
          <Field label="Category">
            <CategorySelect value={t.category} onChange={(category) => patch({ category }, `Category set to ${category}`)} disabled={!canEdit || update.isPending} />
          </Field>
          <div className="text-xs text-muted-foreground">
            Currently <CategoryLabel category={t.category} group={t.group} className="!text-xs" />
          </div>
        </div>

        <div className="space-y-3 rounded-xl border border-border p-4">
          <div className="text-[13px] font-medium text-foreground/80">Review</div>
          <Field label="Note for the team">
            <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Confirmed with Ramesh — stock advance" disabled={!canEdit} />
          </Field>
          {canEdit && <div className="flex flex-wrap gap-2">
            <Button
              variant="good"
              icon={<CheckCircle2 className="size-4" />}
              onClick={() => patch({ review_status: 'verified', reviewer_note: note || null }, 'Marked verified')}
              loading={update.isPending}
            >
              Verify
            </Button>
            <Button
              variant="danger"
              icon={<ShieldAlert className="size-4" />}
              onClick={() => patch({ review_status: 'suspicious', reviewer_note: note || null }, 'Marked suspicious')}
            >
              Suspicious
            </Button>
            {t.review_status && t.review_status !== 'pending' && t.flagged && (
              <Button variant="ghost" icon={<RotateCcw className="size-4" />} onClick={() => patch({ review_status: 'pending' }, 'Moved back to review')}>
                Reopen
              </Button>
            )}
          </div>}
          {t.reviewed_at && (
            <p className="text-xs text-muted-foreground">
              Last reviewed {new Date(t.reviewed_at).toLocaleString()}
              {t.reviewed_by ? ` by ${t.reviewed_by}` : ''}
            </p>
          )}
        </div>

        {canEdit && <div className="space-y-3 rounded-xl border border-dashed border-border-strong p-4">
          <div className="flex items-center gap-1.5 text-[13px] font-medium text-foreground/80">
            <Wand2 className="size-4" /> Always categorize like this
          </div>
          <p className="text-xs text-muted-foreground">
            Future and existing transactions whose description contains this text will be set to <b className="text-foreground/80">{t.category}</b>.
          </p>
          <Input value={rulePattern} onChange={(e) => setRulePattern(e.target.value)} aria-label="Rule pattern" />
          <div className="flex items-center justify-between gap-2">
            <Select value={ruleScope} onChange={(e) => setRuleScope(e.target.value as 'shop' | 'all')} aria-label="Rule scope">
              <option value="shop">Only {t.shop_name}</option>
              <option value="all">All shops</option>
            </Select>
            <Button onClick={() => createRule.mutate()} loading={createRule.isPending} disabled={rulePattern.trim().length < 2}>
              Create rule
            </Button>
          </div>
        </div>}
      </div>
    </Drawer>
  );
}
