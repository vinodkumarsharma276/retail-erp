import { useState } from 'react';
import { Loader2, Plus, Save, AlertCircle, CreditCard } from 'lucide-react';
import { cn } from '../../lib/utils';
import {
  usePlansListQuery,
  useCreatePlanMutation,
  useUpdatePlanMutation,
  useSetPlanFeatureMutation,
  type PlanListItem,
} from '../../hooks/usePlatform';
import { ALL_FEATURE_KEYS, FEATURE_METADATA } from '@retailerp/shared-types';
import { useEscapeKey } from '../../hooks/useEscapeKey';

export function PlanManagerPage() {
  const plansQuery = usePlansListQuery();
  const [showCreate, setShowCreate] = useState(false);
  const [selectedCode, setSelectedCode] = useState<string | null>(null);

  const plans = plansQuery.data ?? [];
  const selected = plans.find((p) => p.code === selectedCode) ?? plans[0] ?? null;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-display">Plans</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Pricing tiers and the default feature flags each plan enables.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setShowCreate(true)}
          className={cn(
            'flex items-center gap-2 rounded-md bg-amber-600 px-4 py-2 text-sm font-medium text-white',
            'hover:bg-amber-700 transition-colors',
          )}
        >
          <Plus className="h-4 w-4" />
          New plan
        </button>
      </div>

      {plansQuery.isLoading && (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-amber-600" />
        </div>
      )}

      {plansQuery.isError && (
        <div className="flex items-center gap-2 rounded-md border border-red-300 bg-red-50 dark:bg-red-950/30 px-4 py-3 text-sm text-red-700 dark:text-red-300">
          <AlertCircle className="h-4 w-4" />
          Failed to load plans.
        </div>
      )}

      {!plansQuery.isLoading && plans.length === 0 && (
        <div className="flex flex-col items-center justify-center rounded-md border bg-card py-16">
          <CreditCard className="h-10 w-10 text-muted-foreground mb-3" />
          <p className="text-sm font-medium">No plans yet</p>
          <p className="text-xs text-muted-foreground mt-1 mb-4">Create the first plan.</p>
          <button
            type="button"
            onClick={() => setShowCreate(true)}
            className="flex items-center gap-1.5 rounded-md bg-amber-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-amber-700 transition-colors"
          >
            <Plus className="h-3.5 w-3.5" />
            New plan
          </button>
        </div>
      )}

      {plans.length > 0 && (
        <div className="grid grid-cols-[16rem_1fr] gap-4">
          {/* Plan list */}
          <aside className="rounded-md border bg-card p-2 space-y-0.5">
            {plans.map((p) => {
              const active = (selected?.code ?? plans[0].code) === p.code;
              const enabledCount = p.features.filter((f) => f.enabled).length;
              return (
                <button
                  key={p.id}
                  onClick={() => setSelectedCode(p.code)}
                  className={cn(
                    'w-full rounded-md px-3 py-2 text-left transition-colors',
                    active
                      ? 'bg-amber-100 dark:bg-amber-950/30 text-amber-900 dark:text-amber-100'
                      : 'hover:bg-muted',
                  )}
                >
                  <p className="text-sm font-medium">{p.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {p.code} · {enabledCount} features
                  </p>
                </button>
              );
            })}
          </aside>

          {/* Detail */}
          {selected && <PlanDetail key={selected.code} plan={selected} />}
        </div>
      )}

      {showCreate && <CreatePlanModal onClose={() => setShowCreate(false)} />}
    </div>
  );
}

function PlanDetail({ plan }: { plan: PlanListItem }) {
  const update = useUpdatePlanMutation(plan.id);
  const setFeature = useSetPlanFeatureMutation(plan.id);
  const [draft, setDraft] = useState({
    name: plan.name,
    description: plan.description ?? '',
    priceMonthly: String(plan.priceMonthly),
    priceYearly: String(plan.priceYearly),
    isPublic: plan.isPublic,
    isActive: plan.isActive,
  });

  const dirty =
    draft.name !== plan.name ||
    (draft.description || '') !== (plan.description ?? '') ||
    Number(draft.priceMonthly) !== Number(plan.priceMonthly) ||
    Number(draft.priceYearly) !== Number(plan.priceYearly) ||
    draft.isPublic !== plan.isPublic ||
    draft.isActive !== plan.isActive;

  const handleSave = () =>
    update.mutate({
      name: draft.name,
      description: draft.description || null,
      priceMonthly: Number(draft.priceMonthly) || 0,
      priceYearly: Number(draft.priceYearly) || 0,
      isPublic: draft.isPublic,
      isActive: draft.isActive,
    });

  const featureMap = new Map(plan.features.map((f) => [f.featureKey, f]));

  return (
    <div className="space-y-4">
      <div className="rounded-md border bg-card p-5 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
            Plan details
          </h2>
          <code className="text-xs rounded bg-muted px-1.5 py-0.5">{plan.code}</code>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <Labeled label="Display name">
            <input
              value={draft.name}
              onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
              className="w-full rounded-md border bg-field px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500/50"
            />
          </Labeled>
          <Labeled label="Monthly price (₹)">
            <input
              type="number"
              min={0}
              value={draft.priceMonthly}
              onChange={(e) => setDraft((d) => ({ ...d, priceMonthly: e.target.value }))}
              className="w-full rounded-md border bg-field px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500/50"
            />
          </Labeled>
          <Labeled label="Yearly price (₹)">
            <input
              type="number"
              min={0}
              value={draft.priceYearly}
              onChange={(e) => setDraft((d) => ({ ...d, priceYearly: e.target.value }))}
              className="w-full rounded-md border bg-field px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500/50"
            />
          </Labeled>
          <div className="flex items-center gap-4 pt-5 text-sm">
            <label className="inline-flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={draft.isPublic}
                onChange={(e) => setDraft((d) => ({ ...d, isPublic: e.target.checked }))}
                className="rounded border accent-amber-600"
              />
              Public
            </label>
            <label className="inline-flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={draft.isActive}
                onChange={(e) => setDraft((d) => ({ ...d, isActive: e.target.checked }))}
                className="rounded border accent-amber-600"
              />
              Active
            </label>
          </div>
        </div>
        <Labeled label="Description">
          <textarea
            value={draft.description}
            onChange={(e) => setDraft((d) => ({ ...d, description: e.target.value }))}
            rows={3}
            className="w-full rounded-md border bg-field px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500/50"
          />
        </Labeled>
        <div className="flex justify-end">
          <button
            type="button"
            onClick={handleSave}
            disabled={!dirty || update.isPending}
            className={cn(
              'flex items-center gap-1.5 rounded-md bg-amber-600 px-3 py-2 text-sm font-medium text-white',
              'hover:bg-amber-700 transition-colors disabled:opacity-50',
            )}
          >
            {update.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Save className="h-4 w-4" />
            )}
            Save plan
          </button>
        </div>
      </div>

      {/* Features */}
      <div className="rounded-md border bg-card p-5 space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          Default features
        </h2>
        <p className="text-xs text-muted-foreground">
          Tenants on this plan inherit these flags. Per-tenant overrides are managed on the
          tenant page.
        </p>
        <div className="overflow-hidden rounded-md border">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-xs uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="px-3 py-2 text-left font-medium">Feature</th>
                <th className="px-3 py-2 text-left font-medium">Category</th>
                <th className="px-3 py-2 text-center font-medium">Enabled</th>
              </tr>
            </thead>
            <tbody>
              {ALL_FEATURE_KEYS.map((key) => {
                const f = featureMap.get(key);
                const meta = FEATURE_METADATA[key];
                return (
                  <tr key={key} className="border-t last:border-0">
                    <td className="px-3 py-2">
                      <p className="text-sm">{meta.label}</p>
                      <code className="text-xs text-muted-foreground">{key}</code>
                    </td>
                    <td className="px-3 py-2 text-xs text-muted-foreground">{meta.category}</td>
                    <td className="px-3 py-2 text-center">
                      <input
                        type="checkbox"
                        checked={!!f?.enabled}
                        onChange={(e) =>
                          setFeature.mutate({ featureKey: key, enabled: e.target.checked })
                        }
                        className="rounded border accent-amber-600"
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function CreatePlanModal({ onClose }: { onClose: () => void }) {
  useEscapeKey(true, onClose);

  const create = useCreatePlanMutation();
  const [form, setForm] = useState({
    code: '',
    name: '',
    description: '',
    priceMonthly: '0',
    priceYearly: '0',
    isPublic: true,
    isActive: true,
  });

  const codeOk = /^[a-z][a-z0-9-]{1,49}$/.test(form.code);
  const nameOk = form.name.trim().length > 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-md rounded-lg border bg-card p-6 shadow-xl space-y-4">
        <h2 className="text-lg font-semibold">New plan</h2>
        <Labeled label="Code">
          <input
            value={form.code}
            onChange={(e) => setForm((f) => ({ ...f, code: e.target.value.toLowerCase() }))}
            placeholder="starter"
            className="w-full rounded-md border bg-field px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500/50"
          />
        </Labeled>
        <Labeled label="Display name">
          <input
            value={form.name}
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            placeholder="Starter"
            className="w-full rounded-md border bg-field px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500/50"
          />
        </Labeled>
        <div className="grid grid-cols-2 gap-3">
          <Labeled label="Monthly (₹)">
            <input
              type="number"
              min={0}
              value={form.priceMonthly}
              onChange={(e) => setForm((f) => ({ ...f, priceMonthly: e.target.value }))}
              className="w-full rounded-md border bg-field px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500/50"
            />
          </Labeled>
          <Labeled label="Yearly (₹)">
            <input
              type="number"
              min={0}
              value={form.priceYearly}
              onChange={(e) => setForm((f) => ({ ...f, priceYearly: e.target.value }))}
              className="w-full rounded-md border bg-field px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500/50"
            />
          </Labeled>
        </div>
        <Labeled label="Description">
          <textarea
            rows={3}
            value={form.description}
            onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
            className="w-full rounded-md border bg-field px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500/50"
          />
        </Labeled>
        <div className="flex items-center gap-4 text-sm">
          <label className="inline-flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={form.isPublic}
              onChange={(e) => setForm((f) => ({ ...f, isPublic: e.target.checked }))}
              className="rounded border accent-amber-600"
            />
            Public
          </label>
          <label className="inline-flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={form.isActive}
              onChange={(e) => setForm((f) => ({ ...f, isActive: e.target.checked }))}
              className="rounded border accent-amber-600"
            />
            Active
          </label>
        </div>
        {create.error && (
          <p className="text-xs text-red-600">
            {(create.error as any)?.response?.data?.error ?? 'Failed to create plan'}
          </p>
        )}
        <div className="flex justify-end gap-2 pt-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border bg-field px-3 py-2 text-sm font-medium hover:bg-muted transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() =>
              create.mutate(
                {
                  code: form.code,
                  name: form.name,
                  description: form.description || null,
                  priceMonthly: Number(form.priceMonthly) || 0,
                  priceYearly: Number(form.priceYearly) || 0,
                  isPublic: form.isPublic,
                  isActive: form.isActive,
                },
                { onSuccess: onClose },
              )
            }
            disabled={!codeOk || !nameOk || create.isPending}
            className={cn(
              'flex items-center gap-1.5 rounded-md bg-amber-600 px-3 py-2 text-sm font-medium text-white',
              'hover:bg-amber-700 transition-colors disabled:opacity-50',
            )}
          >
            {create.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Plus className="h-4 w-4" />
            )}
            Create plan
          </button>
        </div>
      </div>
    </div>
  );
}

function Labeled({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs font-medium text-muted-foreground mb-1">{label}</label>
      {children}
    </div>
  );
}
