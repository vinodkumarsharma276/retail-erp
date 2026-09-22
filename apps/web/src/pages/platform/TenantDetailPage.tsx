import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  ArrowLeft,
  Loader2,
  AlertCircle,
  KeyRound,
  Save,
  Copy,
  Check,
  Settings as SettingsIcon,
  RotateCcw,
} from 'lucide-react';
import { cn } from '../../lib/utils';
import {
  useTenantDetailQuery,
  useTenantFeaturesQuery,
  useUpdateTenantMutation,
  useUpsertTenantFeatureMutation,
  useDeleteTenantFeatureOverrideMutation,
  useResetTenantOwnerPasswordMutation,
  usePlansListQuery,
} from '../../hooks/usePlatform';

export function TenantDetailPage() {
  const { id } = useParams<{ id: string }>();
  const detailQuery = useTenantDetailQuery(id);
  const featuresQuery = useTenantFeaturesQuery(id);
  const plansQuery = usePlansListQuery();

  if (!id) return null;

  if (detailQuery.isLoading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="h-6 w-6 animate-spin text-amber-600" />
      </div>
    );
  }

  if (detailQuery.isError || !detailQuery.data) {
    return (
      <div className="flex items-center gap-2 rounded-md border border-red-300 bg-red-50 dark:bg-red-950/30 px-4 py-3 text-sm text-red-700 dark:text-red-300">
        <AlertCircle className="h-4 w-4" />
        Tenant not found.
      </div>
    );
  }

  const tenant = detailQuery.data;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Link
          to="/tenants"
          className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <div className="flex-1">
          <h1 className="text-display">{tenant.name}</h1>
          <p className="text-sm text-muted-foreground mt-0.5 flex items-center gap-3">
            <code className="rounded bg-muted px-1.5 py-0.5 text-xs">{tenant.slug}</code>
            <span className="text-xs">Plan: {tenant.plan?.name ?? tenant.plan?.code}</span>
            <span
              className={cn(
                'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium',
                tenant.status === 'active'
                  ? 'bg-green-100 text-green-700 dark:bg-green-950/30 dark:text-green-400'
                  : tenant.status === 'trial'
                    ? 'bg-blue-100 text-blue-700 dark:bg-blue-950/30 dark:text-blue-400'
                    : tenant.status === 'suspended'
                      ? 'bg-amber-100 text-amber-700 dark:bg-amber-950/30 dark:text-amber-400'
                      : 'bg-red-100 text-red-700 dark:bg-red-950/30 dark:text-red-400',
              )}
            >
              {tenant.status}
            </span>
          </p>
        </div>
      </div>

      {/* Counts */}
      <div className="grid grid-cols-4 gap-3">
        {[
          { label: 'Shops', value: tenant._count.shops },
          { label: 'Users', value: tenant._count.users },
          { label: 'Customers', value: tenant._count.customers },
          { label: 'Sales', value: tenant._count.saleRecords },
        ].map((c) => (
          <div key={c.label} className="rounded-md border bg-card px-4 py-3">
            <p className="text-xs text-muted-foreground">{c.label}</p>
            <p className="font-display text-2xl font-semibold tabular mt-1">{c.value.toLocaleString()}</p>
          </div>
        ))}
      </div>

      {/* Editable details */}
      <EditableDetails tenant={tenant} plans={plansQuery.data ?? []} />

      {/* Owner reset */}
      <ResetOwnerCard tenantId={id} />

      {/* Features */}
      <FeaturesEditor
        tenantId={id}
        features={featuresQuery.data ?? []}
        loading={featuresQuery.isLoading}
      />
    </div>
  );
}

function EditableDetails({
  tenant,
  plans,
}: {
  tenant: NonNullable<ReturnType<typeof useTenantDetailQuery>['data']>;
  plans: NonNullable<ReturnType<typeof usePlansListQuery>['data']>;
}) {
  const update = useUpdateTenantMutation(tenant.id);
  const [draft, setDraft] = useState({
    name: tenant.name,
    contactEmail: tenant.contactEmail ?? '',
    contactPhone: tenant.contactPhone ?? '',
    gstNumber: tenant.gstNumber ?? '',
    status: tenant.status,
    planCode: tenant.plan?.code ?? '',
    customDomain: tenant.customDomain ?? '',
  });

  const dirty =
    draft.name !== tenant.name ||
    (draft.contactEmail || '') !== (tenant.contactEmail ?? '') ||
    (draft.contactPhone || '') !== (tenant.contactPhone ?? '') ||
    (draft.gstNumber || '') !== (tenant.gstNumber ?? '') ||
    draft.status !== tenant.status ||
    draft.planCode !== (tenant.plan?.code ?? '') ||
    (draft.customDomain || '') !== (tenant.customDomain ?? '');

  const handleSave = () => {
    update.mutate(
      {
        name: draft.name,
        contactEmail: draft.contactEmail || null,
        contactPhone: draft.contactPhone || null,
        gstNumber: draft.gstNumber || null,
        status: draft.status,
        planCode: draft.planCode,
        customDomain: draft.customDomain || null,
      },
      { onSuccess: () => undefined },
    );
  };

  return (
    <div className="rounded-md border bg-card p-5 space-y-4">
      <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
        <SettingsIcon className="h-3.5 w-3.5" />
        Tenant details
      </h2>
      <div className="grid grid-cols-2 gap-4">
        <Labeled label="Display name">
          <input
            value={draft.name}
            onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
            className="w-full rounded-md border bg-field px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500/50"
          />
        </Labeled>
        <Labeled label="Status">
          <select
            value={draft.status}
            onChange={(e) => setDraft((d) => ({ ...d, status: e.target.value as any }))}
            className="w-full rounded-md border bg-field px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500/50"
          >
            <option value="active">Active</option>
            <option value="trial">Trial</option>
            <option value="suspended">Suspended</option>
            <option value="cancelled">Cancelled</option>
          </select>
        </Labeled>
        <Labeled label="Plan">
          <select
            value={draft.planCode}
            onChange={(e) => setDraft((d) => ({ ...d, planCode: e.target.value }))}
            className="w-full rounded-md border bg-field px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500/50"
          >
            {plans.map((p) => (
              <option key={p.id} value={p.code}>
                {p.name} ({p.code})
              </option>
            ))}
          </select>
        </Labeled>
        <Labeled label="Custom domain">
          <input
            value={draft.customDomain}
            onChange={(e) => setDraft((d) => ({ ...d, customDomain: e.target.value }))}
            placeholder="erp.customerdomain.com (optional)"
            className="w-full rounded-md border bg-field px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500/50"
          />
        </Labeled>
        <Labeled label="Contact email">
          <input
            type="email"
            value={draft.contactEmail}
            onChange={(e) => setDraft((d) => ({ ...d, contactEmail: e.target.value }))}
            className="w-full rounded-md border bg-field px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500/50"
          />
        </Labeled>
        <Labeled label="Contact phone">
          <input
            value={draft.contactPhone}
            onChange={(e) => setDraft((d) => ({ ...d, contactPhone: e.target.value }))}
            className="w-full rounded-md border bg-field px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500/50"
          />
        </Labeled>
        <Labeled label="GSTIN">
          <input
            value={draft.gstNumber}
            onChange={(e) =>
              setDraft((d) => ({ ...d, gstNumber: e.target.value.toUpperCase() }))
            }
            className="w-full rounded-md border bg-field px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500/50"
          />
        </Labeled>
      </div>
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
          Save changes
        </button>
      </div>
    </div>
  );
}

function ResetOwnerCard({ tenantId }: { tenantId: string }) {
  const reset = useResetTenantOwnerPasswordMutation(tenantId);
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    if (!reset.data?.temporaryPassword) return;
    try {
      await navigator.clipboard.writeText(reset.data.temporaryPassword);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* noop */
    }
  };

  return (
    <div className="rounded-md border bg-card p-5 space-y-3">
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
            <KeyRound className="h-3.5 w-3.5" />
            Reset owner password
          </h2>
          <p className="text-xs text-muted-foreground mt-1">
            Generates a one-time password for the tenant's primary owner user and revokes all
            their active sessions. Share through a secure channel.
          </p>
        </div>
        <button
          type="button"
          onClick={() => reset.mutate()}
          disabled={reset.isPending}
          className="flex items-center gap-1.5 rounded-md border border-amber-300 bg-amber-50 dark:bg-amber-950/30 px-3 py-1.5 text-xs font-medium text-amber-700 dark:text-amber-400 hover:bg-amber-100 transition-colors disabled:opacity-50"
        >
          {reset.isPending ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <RotateCcw className="h-3.5 w-3.5" />
          )}
          Generate temporary password
        </button>
      </div>

      {reset.data && (
        <div className="rounded-md border bg-muted/30 p-3 text-sm space-y-2">
          <div>
            <span className="text-xs text-muted-foreground">Username</span>
            <p className="font-mono">{reset.data.username}</p>
          </div>
          <div>
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground">Temporary password</span>
              <button
                onClick={copy}
                className="flex items-center gap-1 rounded px-1.5 py-0.5 text-xs text-amber-700 hover:bg-amber-100 dark:hover:bg-amber-950/30"
              >
                <Copy className="h-3 w-3" />
                {copied ? 'Copied' : 'Copy'}
              </button>
            </div>
            <p className="font-mono break-all">{reset.data.temporaryPassword}</p>
          </div>
        </div>
      )}
      {reset.error && (
        <p className="text-xs text-red-600">
          {(reset.error as any)?.response?.data?.error ?? 'Failed to reset password'}
        </p>
      )}
    </div>
  );
}

function FeaturesEditor({
  tenantId,
  features,
  loading,
}: {
  tenantId: string;
  features: ReturnType<typeof useTenantFeaturesQuery>['data'] extends infer T
    ? T extends Array<infer U>
      ? U[]
      : never
    : never;
  loading: boolean;
}) {
  const upsert = useUpsertTenantFeatureMutation(tenantId);
  const remove = useDeleteTenantFeatureOverrideMutation(tenantId);

  return (
    <div className="rounded-md border bg-card p-5 space-y-3">
      <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
        <Check className="h-3.5 w-3.5" />
        Feature flags
      </h2>
      <p className="text-xs text-muted-foreground">
        Plan defaults are merged with per-tenant overrides at request time. Toggle to override a
        plan default; click <em>Reset to plan</em> to drop the override.
      </p>

      {loading ? (
        <div className="flex items-center justify-center py-6">
          <Loader2 className="h-5 w-5 animate-spin text-amber-600" />
        </div>
      ) : (
        <div className="overflow-hidden rounded-md border">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-xs uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="px-3 py-2 text-left font-medium">Feature key</th>
                <th className="px-3 py-2 text-left font-medium">Source</th>
                <th className="px-3 py-2 text-left font-medium">Note</th>
                <th className="px-3 py-2 text-center font-medium">Enabled</th>
                <th className="px-3 py-2 text-right font-medium">Action</th>
              </tr>
            </thead>
            <tbody>
              {features.map((f) => (
                <tr key={f.featureKey} className="border-t last:border-0">
                  <td className="px-3 py-2">
                    <code className="text-xs">{f.featureKey}</code>
                  </td>
                  <td className="px-3 py-2 text-xs">
                    {f.source === 'override' ? (
                      <span className="rounded bg-amber-100 dark:bg-amber-950/30 text-amber-700 dark:text-amber-400 px-1.5 py-0.5">
                        Override
                      </span>
                    ) : (
                      <span className="text-muted-foreground">Plan default</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-xs text-muted-foreground truncate max-w-[200px]">
                    {f.note ?? ''}
                  </td>
                  <td className="px-3 py-2 text-center">
                    <label className="inline-flex cursor-pointer items-center">
                      <input
                        type="checkbox"
                        checked={f.enabled}
                        onChange={(e) =>
                          upsert.mutate({
                            featureKey: f.featureKey,
                            enabled: e.target.checked,
                          })
                        }
                        className="rounded border accent-amber-600"
                      />
                    </label>
                  </td>
                  <td className="px-3 py-2 text-right">
                    {f.source === 'override' && (
                      <button
                        type="button"
                        onClick={() => remove.mutate(f.featureKey)}
                        className="text-xs text-muted-foreground hover:text-amber-700"
                      >
                        Reset to plan
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function Labeled({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="block text-xs font-medium text-muted-foreground mb-1">{label}</label>
      {children}
    </div>
  );
}
