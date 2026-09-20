import { useEffect, useState } from 'react';
import { Save } from 'lucide-react';
import {
  DEFAULT_USER_PREFERENCES,
  type UserPreferences,
  type ThemePreference,
  type DateFormatPreference,
  type TimeFormatPreference,
  type NumberFormatPreference,
  type DensityPreference,
} from '@retailerp/shared-types';
import { usePreferencesStore } from '../../stores/preferences-store';
import { useUpdatePreferencesMutation } from '../../hooks/usePreferences';
import { useToastStore } from '../../stores/toast-store';

const FIELD_CLS =
  'w-full rounded-md border border-input bg-field px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring';
const LABEL_CLS = 'block text-sm font-medium mb-1';
const HELP_CLS = 'mt-1 text-xs text-muted-foreground';

export default function PreferencesPage() {
  const stored = usePreferencesStore((s) => s.preferences);
  const addToast = useToastStore((s) => s.addToast);
  const updatePrefs = useUpdatePreferencesMutation();

  // Local form state seeded from current preferences (with defaults for missing keys)
  const [form, setForm] = useState<UserPreferences>({
    ...DEFAULT_USER_PREFERENCES,
    ...stored,
  });

  useEffect(() => {
    setForm({ ...DEFAULT_USER_PREFERENCES, ...stored });
  }, [stored]);

  const update = <K extends keyof UserPreferences>(key: K, value: UserPreferences[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const handleSave = async () => {
    try {
      await updatePrefs.mutateAsync(form);
      addToast({ type: 'success', message: 'Preferences saved' });
    } catch (err) {
      addToast({
        type: 'error',
        message: err instanceof Error ? err.message : 'Failed to save preferences',
      });
    }
  };

  const handleReset = () => {
    setForm({ ...DEFAULT_USER_PREFERENCES });
  };

  return (
    <div className="container mx-auto px-4 py-6 max-w-3xl">
      <div className="mb-6">
        <h1 className="text-display">User Preferences</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Personalize how dates, currency and the interface appear for your account.
        </p>
      </div>

      {/* Appearance */}
      <Section title="Appearance">
        <Field label="Theme" help="Light, dark, or follow your operating system.">
          <select
            className={FIELD_CLS}
            value={form.theme ?? 'system'}
            onChange={(e) => update('theme', e.target.value as ThemePreference)}
          >
            <option value="light">Light</option>
            <option value="dark">Dark</option>
            <option value="system">System default</option>
          </select>
        </Field>

        <Field
          label="Density"
          help="Compact reduces vertical spacing in tables and forms."
        >
          <select
            className={FIELD_CLS}
            value={form.density ?? 'comfortable'}
            onChange={(e) => update('density', e.target.value as DensityPreference)}
          >
            <option value="comfortable">Comfortable</option>
            <option value="compact">Compact</option>
          </select>
        </Field>

        <Field label="Language">
          <select
            className={FIELD_CLS}
            value={form.language ?? 'en'}
            onChange={(e) => update('language', e.target.value as 'en' | 'hi')}
          >
            <option value="en">English</option>
            <option value="hi">हिन्दी (Hindi)</option>
          </select>
          <p className={HELP_CLS}>UI translations roll out gradually.</p>
        </Field>
      </Section>

      {/* Locale & formats */}
      <Section title="Date, Time & Numbers">
        <Field label="Date format">
          <select
            className={FIELD_CLS}
            value={form.dateFormat ?? 'DD/MM/YYYY'}
            onChange={(e) => update('dateFormat', e.target.value as DateFormatPreference)}
          >
            <option value="DD/MM/YYYY">DD/MM/YYYY (31/12/2026)</option>
            <option value="MM/DD/YYYY">MM/DD/YYYY (12/31/2026)</option>
            <option value="YYYY-MM-DD">YYYY-MM-DD (2026-12-31)</option>
            <option value="DD-MMM-YYYY">DD-MMM-YYYY (31-Dec-2026)</option>
            <option value="DD MMM YYYY">DD MMM YYYY (31 Dec 2026)</option>
          </select>
        </Field>

        <Field label="Time format">
          <select
            className={FIELD_CLS}
            value={form.timeFormat ?? '12h'}
            onChange={(e) => update('timeFormat', e.target.value as TimeFormatPreference)}
          >
            <option value="12h">12-hour (1:30 PM)</option>
            <option value="24h">24-hour (13:30)</option>
          </select>
        </Field>

        <Field label="Currency symbol" help="Shown as a prefix on every amount, e.g. ₹12,345.00">
          <input
            type="text"
            maxLength={4}
            className={FIELD_CLS}
            value={form.currencySymbol ?? '₹'}
            onChange={(e) => update('currencySymbol', e.target.value)}
          />
        </Field>

        <Field label="Number grouping">
          <select
            className={FIELD_CLS}
            value={form.numberFormat ?? 'indian'}
            onChange={(e) => update('numberFormat', e.target.value as NumberFormatPreference)}
          >
            <option value="indian">Indian (12,34,567.00)</option>
            <option value="international">International (1,234,567.00)</option>
          </select>
        </Field>
      </Section>

      {/* App behavior */}
      <Section title="Application">
        <Field label="Default rows per page">
          <select
            className={FIELD_CLS}
            value={form.itemsPerPage ?? 20}
            onChange={(e) =>
              update('itemsPerPage', Number(e.target.value) as 10 | 20 | 50 | 100)
            }
          >
            <option value={10}>10</option>
            <option value={20}>20</option>
            <option value={50}>50</option>
            <option value={100}>100</option>
          </select>
        </Field>

        <Field label="Default landing page" help="Page to open after sign-in.">
          <select
            className={FIELD_CLS}
            value={form.defaultLandingPage ?? '/'}
            onChange={(e) => update('defaultLandingPage', e.target.value)}
          >
            <option value="/">Dashboard</option>
            <option value="/sales">Sales</option>
            <option value="/installments">Installments</option>
            <option value="/products">Products</option>
            <option value="/customers">Customers</option>
          </select>
        </Field>

        <Field label="Notifications">
          <div className="space-y-2">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                className="rounded border-input"
                checked={form.notificationSound ?? true}
                onChange={(e) => update('notificationSound', e.target.checked)}
              />
              Play sound for new notifications
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                className="rounded border-input"
                checked={form.desktopNotifications ?? false}
                onChange={(e) => update('desktopNotifications', e.target.checked)}
              />
              Show desktop notifications
            </label>
          </div>
        </Field>
      </Section>

      <div className="mt-6 flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={handleReset}
          className="px-4 py-2 text-sm rounded-md border border-input hover:bg-accent"
        >
          Reset to defaults
        </button>
        <button
          type="button"
          disabled={updatePrefs.isPending}
          onClick={handleSave}
          className="inline-flex items-center gap-2 px-4 py-2 text-sm rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
        >
          <Save className="h-4 w-4" />
          {updatePrefs.isPending ? 'Saving…' : 'Save preferences'}
        </button>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-6 rounded-lg border bg-card p-5">
      <h2 className="text-base font-semibold mb-4">{title}</h2>
      <div className="grid gap-4 sm:grid-cols-2">{children}</div>
    </section>
  );
}

function Field({
  label,
  help,
  children,
}: {
  label: string;
  help?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className={LABEL_CLS}>{label}</label>
      {children}
      {help ? <p className={HELP_CLS}>{help}</p> : null}
    </div>
  );
}
