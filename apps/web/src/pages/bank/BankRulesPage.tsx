import { Plus, Trash2, Wand2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CategoryLabel } from './components/domain';
import { PageHeader } from './components/BankLayout';
import { useCanCheck } from '../../hooks/usePermission';
import { CategorySelect } from './components/TransactionDrawer';
import { Badge, Button, Card, CardHeader, EmptyState, Field, Input, Select, useToast } from './components/ui';
import { api, type Settings as SettingsT } from './lib/api';
import { relativeTime } from './lib/format';
import { useInvalidateData, useMeta } from './lib/queries';

export default function BankRulesPage() {
  const { data: meta } = useMeta();
  const canEdit = useCanCheck()('bank.reconcile');
  const qc = useQueryClient();
  const toast = useToast();
  const invalidate = useInvalidateData();
  const rules = useQuery({ queryKey: ['bank-rules'], queryFn: api.rules });

  // ---------------------------------------------------------------- rules
  const [pattern, setPattern] = useState('');
  const [matchType, setMatchType] = useState<'contains' | 'regex'>('contains');
  const [category, setCategory] = useState('Vendor & Supplier Payments');
  const [ruleShop, setRuleShop] = useState('');
  const addRule = useMutation({
    mutationFn: () => api.createRule({ pattern, match_type: matchType, category, shop_id: ruleShop || null, applyToExisting: true }),
    onSuccess: (r) => {
      toast(`Rule added · updated ${r.applied} existing transaction${r.applied === 1 ? '' : 's'}`, 'good');
      setPattern('');
      qc.invalidateQueries({ queryKey: ['bank-rules'] });
      invalidate();
    },
    onError: (e: Error) => toast(e.message, 'critical'),
  });
  const delRule = useMutation({
    mutationFn: api.deleteRule,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['bank-rules'] }),
    onError: (e: Error) => toast(e.message, 'critical'),
  });

  // ---------------------------------------------------------------- thresholds
  const [s, setS] = useState<SettingsT | null>(null);
  useEffect(() => {
    if (meta && !s) setS(meta.settings);
  }, [meta, s]);
  const saveSettings = useMutation({
    mutationFn: () => api.saveSettings(s!),
    onSuccess: () => {
      toast('Review policy saved · flags recalculated', 'good');
      qc.invalidateQueries({ queryKey: ['bank-meta'] });
      invalidate();
    },
    onError: (e: Error) => toast(e.message, 'critical'),
  });

  const groupOf = (c: string) => meta?.categories.find((x) => x.name === c)?.group ?? 'other';

  return (
    <div className="pb-10">
      <PageHeader title="Rules & settings" subtitle="Teach the categorizer your vendors, and tune what gets flagged for review." filters={false} />
      <div className="grid gap-4 lg:grid-cols-5">
        {/* ---------------------------------------------------------------- rules */}
        <Card className="lg:col-span-3">
          <CardHeader title="Categorization rules" subtitle="Your rules run before the built-in rules and AI. New rules also update existing transactions (except ones you set by hand)." />
          {canEdit && <div className="grid gap-3 border-b border-border px-5 pb-4 sm:grid-cols-2">
            <Field label="When the description contains">
              <Input value={pattern} onChange={(e) => setPattern(e.target.value)} placeholder="e.g. SHREE BALAJI TRADERS" />
            </Field>
            <Field label="Set category to">
              <CategorySelect value={category} onChange={setCategory} />
            </Field>
            <Field label="Applies to">
              <Select value={ruleShop} onChange={(e) => setRuleShop(e.target.value)} className="w-full">
                <option value="">All shops</option>
                {meta?.shops.map((sh) => (
                  <option key={sh.id} value={sh.id}>
                    {sh.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Match type">
              <Select value={matchType} onChange={(e) => setMatchType(e.target.value as 'contains' | 'regex')} className="w-full">
                <option value="contains">Contains text (case-insensitive)</option>
                <option value="regex">Regular expression</option>
              </Select>
            </Field>
            <div className="sm:col-span-2">
              <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => addRule.mutate()} loading={addRule.isPending} disabled={pattern.trim().length < 2}>
                Add rule
              </Button>
            </div>
          </div>}
          {rules.data?.length ? (
            <ul className="divide-y divide-border">
              {rules.data.map((r) => (
                <li key={r.id} className="flex items-center gap-3 px-5 py-3">
                  <Wand2 className="size-4 shrink-0 text-muted-foreground" />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[13.5px]">
                      <code className="rounded bg-muted px-1.5 py-0.5 text-[12.5px]">{r.pattern}</code>
                      <span className="mx-2 text-muted-foreground">→</span>
                      <CategoryLabel category={r.category} group={groupOf(r.category)} />
                    </div>
                    <div className="mt-0.5 text-xs text-muted-foreground">
                      {r.shop_name ?? 'All shops'} · {r.match_type} · added {relativeTime(r.created_at)}
                    </div>
                  </div>
                  {canEdit && (
                    <Button variant="ghost" size="sm" onClick={() => delRule.mutate(r.id)} aria-label="Delete rule" loading={delRule.isPending && delRule.variables === r.id}>
                      <Trash2 className="size-4" />
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState icon={<Wand2 className="size-6" />} title="No custom rules yet" body="Tip: open any transaction and use “Always categorize like this” to create one in a click." />
          )}
        </Card>

        <div className="space-y-4 lg:col-span-2">
          {/* ---------------------------------------------------------------- policy */}
          <Card>
            <CardHeader title="Review policy" subtitle="What gets sent to the review queue" />
            {s && (
              <div className="space-y-3 px-5 pb-5">
                <Field label="Large amount to a new or occasional payee (₹)" hint="Regular suppliers are only flagged when a payment is far above their usual amount.">
                  <Input type="number" min={1} value={s.largeAmount} onChange={(e) => setS({ ...s, largeAmount: Number(e.target.value) })} />
                </Field>
                <Field label="Cash withdrawal alert (₹)">
                  <Input type="number" min={1} value={s.cashAlertAmount} onChange={(e) => setS({ ...s, cashAlertAmount: Number(e.target.value) })} />
                </Field>
                <Field label="First-time personal transfer alert (₹)">
                  <Input type="number" min={1} value={s.unknownPayeeAmount} onChange={(e) => setS({ ...s, unknownPayeeAmount: Number(e.target.value) })} />
                </Field>
                <Field label={`Minimum category confidence · ${Math.round(s.minAiConfidence * 100)}%`} hint="Guesses below this are sent for review.">
                  <input
                    type="range"
                    min={0.3}
                    max={0.95}
                    step={0.05}
                    value={s.minAiConfidence}
                    onChange={(e) => setS({ ...s, minAiConfidence: Number(e.target.value) })}
                    className="w-full accent-primary"
                  />
                </Field>
                {canEdit && (
                  <Button variant="primary" onClick={() => saveSettings.mutate()} loading={saveSettings.isPending}>
                    Save & recalculate flags
                  </Button>
                )}
              </div>
            )}
          </Card>

          <Card className="p-5 text-[13px] text-foreground/80">
            <div className="mb-1 font-semibold text-foreground">AI assist</div>
            {meta?.ai.enabled ? (
              <p>
                On, using <Badge tone="accent">{meta.ai.model}</Badge>. AI reads images and scanned PDFs, and categorizes narrations that rules can't place. Change the model with <code>STATEMENTS_AI_MODEL</code> in the API's <code>.env</code>.
              </p>
            ) : (
              <p>
                Off. Add <code>OPENAI_API_KEY</code> to the API's <code>.env</code> and restart it to read images/scanned PDFs and categorize unknown narrations.
              </p>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}
