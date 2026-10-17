import clsx from 'clsx';
import { History, Lock, Pause, Play, PlugZap, RefreshCw, Unplug } from 'lucide-react';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { UserRole } from '@retailerp/shared-types';
import { useCanCheck } from '../../../hooks/usePermission';
import { useAuthStore } from '../../../stores/auth-store';
import { api, type BankAccount, type BankFeed, type FeedProvider } from '../lib/api';
import { count, date, relativeTime } from '../lib/format';
import { useInvalidateData } from '../lib/queries';
import { Badge, Button, ConfirmDialog, Drawer, Field, Input, Select, useToast } from './ui';

export function useFeeds() {
  return useQuery({ queryKey: ['bank-feeds'], queryFn: api.feeds, refetchInterval: 60_000 });
}

const firstOfMonth = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
};

const fitsBank = (p: FeedProvider, bank: string) => p.banks === 'any' || p.banks.some((b) => b.toLowerCase() === bank.toLowerCase());

/** Connect a registered account to its bank's statement API (or the demo feed). */
function ConnectFeedDialog({ account, providers, onClose }: { account: BankAccount; providers: FeedProvider[]; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const invalidate = useInvalidateData();
  const options = providers.filter((p) => fitsBank(p, account.bank_name));
  const [providerId, setProviderId] = useState(options.find((p) => p.ready)?.id ?? '');
  const [creds, setCreds] = useState<Record<string, string>>({});
  const [startDate, setStart] = useState(firstOfMonth());
  const [autoSync, setAutoSync] = useState(true);
  const provider = options.find((p) => p.id === providerId);
  const valid = !!provider?.ready && provider.credentialFields.every((f) => creds[f.key]?.trim()) && !!startDate;

  const connect = useMutation({
    mutationFn: () => api.connectFeed({ bankAccountId: account.id, provider: providerId, credentials: creds, startDate, autoSync }),
    onSuccess: (r) => {
      const first = r.firstSync;
      if (first && 'error' in first && first.error) toast(`Connected, but the first sync failed: ${first.error}`, 'critical');
      else if (first && 'imported' in first) toast(`Connected · imported ${count(first.imported)} transactions`, 'good');
      else toast('Connected', 'good');
      qc.invalidateQueries({ queryKey: ['bank-feeds'] });
      invalidate();
      onClose();
    },
    onError: (e: Error) => toast(e.message, 'critical'),
  });

  return (
    <ConfirmDialog
      open
      title={`Automatic feed for ${account.bank_name} XXXX${account.account_number.slice(-4)}`}
      confirmLabel="Connect & sync now"
      loading={connect.isPending}
      onCancel={onClose}
      onConfirm={() => valid && connect.mutate()}
      body={
        <div className="space-y-3 pt-1">
          <p className="text-[13px] text-foreground/80">
            New transactions are pulled from the bank every morning and go through the same categorising and review as uploaded statements.
            Anything already imported (from a PDF, Excel or an earlier sync) is skipped.
          </p>
          <Field label="Connection">
            <Select value={providerId} onChange={(e) => setProviderId(e.target.value)} className="w-full">
              <option value="" disabled>
                Choose…
              </option>
              {options.map((p) => (
                <option key={p.id} value={p.id} disabled={!p.ready}>
                  {p.label}
                  {p.ready ? '' : ' (not available yet)'}
                </option>
              ))}
            </Select>
          </Field>
          {options
            .filter((p) => !p.ready)
            .map((p) => (
              <p key={p.id} className="rounded-lg bg-warning-muted px-3 py-2 text-xs text-warning">
                <b>{p.label}:</b> {p.note}
              </p>
            ))}
          {provider?.ready && provider.note && <p className="text-xs text-muted-foreground">{provider.note}</p>}
          {provider?.credentialFields.map((f) => (
            <Field key={f.key} label={f.label}>
              <Input
                type={f.secret ? 'password' : 'text'}
                autoComplete={f.secret ? 'new-password' : 'off'}
                value={creds[f.key] ?? ''}
                placeholder={f.placeholder}
                onChange={(e) => setCreds({ ...creds, [f.key]: e.target.value })}
              />
            </Field>
          ))}
          <Field label="Import transactions from" hint="The first sync fetches from this date (up to a year back).">
            <Input type="date" value={startDate} onChange={(e) => setStart(e.target.value)} />
          </Field>
          <label className="flex items-center gap-2 text-[13px]">
            <input type="checkbox" className="size-4 accent-primary" checked={autoSync} onChange={(e) => setAutoSync(e.target.checked)} />
            Sync automatically every morning
          </label>
        </div>
      }
    />
  );
}

function RunsDrawer({ feed, onClose }: { feed: BankFeed; onClose: () => void }) {
  const runs = useQuery({ queryKey: ['bank-feed-runs', feed.id], queryFn: () => api.feedRuns(feed.id) });
  return (
    <Drawer open onClose={onClose} title={`Sync history · ${feed.bank_name} XXXX${feed.account_number.slice(-4)}`}>
      <ul className="divide-y divide-border">
        {runs.data?.map((r) => (
          <li key={r.id} className="px-5 py-3 text-[13px]">
            <div className="flex items-center justify-between gap-2">
              <span className="font-medium">
                {date(r.from_date)} – {date(r.to_date)}
              </span>
              <Badge tone={r.status === 'success' ? 'good' : r.status === 'failed' ? 'critical' : 'neutral'}>{r.status}</Badge>
            </div>
            <div className="mt-0.5 text-xs text-muted-foreground">
              {r.trigger === 'scheduled' ? 'Nightly' : 'Manual'} · {relativeTime(r.started_at)}
              {r.status === 'success' && ` · ${count(r.imported)} new, ${count(r.skipped)} already imported`}
            </div>
            {r.error && <div className="mt-1 text-xs text-destructive">{r.error}</div>}
          </li>
        ))}
        {runs.data?.length === 0 && <li className="px-5 py-6 text-center text-sm text-muted-foreground">No syncs yet.</li>}
      </ul>
    </Drawer>
  );
}

/** Feed status + actions shown under a registered bank account. */
export function AccountFeedLine({ account }: { account: BankAccount }) {
  const { data } = useFeeds();
  const qc = useQueryClient();
  const toast = useToast();
  const invalidate = useInvalidateData();
  const role = useAuthStore((s) => s.user?.role);
  const canManage = role === UserRole.OWNER || role === UserRole.ADMIN;
  const canSync = useCanCheck()('bank.upload_statement');
  const [connecting, setConnecting] = useState(false);
  const [history, setHistory] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);

  const feed = data?.feeds.find((f) => f.bank_account_id === account.id);
  const refresh = () => qc.invalidateQueries({ queryKey: ['bank-feeds'] });
  const sync = useMutation({
    mutationFn: () => api.syncFeed(feed!.id),
    onSuccess: (r) => {
      toast(r.imported ? `Synced · ${count(r.imported)} new transactions` : 'Synced · nothing new', 'good');
      refresh();
      if (r.imported) invalidate();
    },
    onError: (e: Error) => {
      toast(e.message, 'critical');
      refresh();
    },
  });
  const update = useMutation({
    mutationFn: (patch: { paused?: boolean; autoSync?: boolean }) => api.updateFeed(feed!.id, patch),
    onSuccess: refresh,
    onError: (e: Error) => toast(e.message, 'critical'),
  });
  const disconnect = useMutation({
    mutationFn: () => api.disconnectFeed(feed!.id),
    onSuccess: () => {
      toast('Feed disconnected · imported transactions are kept', 'good');
      setDisconnecting(false);
      refresh();
    },
    onError: (e: Error) => toast(e.message, 'critical'),
  });

  if (!data) return null;
  const provider = data.providers.find((p) => p.id === feed?.provider);

  if (!feed) {
    if (!data.entitled) {
      return (
        <div className="mt-1 inline-flex items-center gap-1 text-xs text-muted-foreground">
          <Lock className="size-3" /> Automatic bank feed is a paid add-on
        </div>
      );
    }
    if (!canManage) return null;
    return (
      <>
        <button onClick={() => setConnecting(true)} className="mt-1 inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline cursor-pointer">
          <PlugZap className="size-3.5" /> Connect automatic bank feed
        </button>
        {connecting && <ConnectFeedDialog account={account} providers={data.providers} onClose={() => setConnecting(false)} />}
      </>
    );
  }

  const tone = feed.status === 'error' ? 'critical' : feed.status === 'paused' ? 'neutral' : 'good';
  return (
    <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
      <Badge tone={tone} icon={<PlugZap className="size-3" />}>
        {provider?.label ?? feed.provider} · {feed.status === 'paused' ? 'paused' : feed.status === 'error' ? 'sync failed' : 'connected'}
      </Badge>
      <span className="text-muted-foreground">
        {feed.last_sync_at ? `Last sync ${relativeTime(feed.last_sync_at)}` : 'Not synced yet'}
        {feed.synced_through && ` · complete to ${date(feed.synced_through)}`}
        {feed.auto_sync && feed.status !== 'paused' ? ' · syncs every morning' : ''}
      </span>
      {feed.status === 'error' && feed.last_error && <span className={clsx('w-full text-destructive')}>{feed.last_error}</span>}
      <span className="flex items-center gap-1">
        {canSync && feed.status !== 'paused' && (
          <Button size="sm" variant="ghost" icon={<RefreshCw className={clsx('size-3.5', sync.isPending && 'animate-spin')} />} onClick={() => sync.mutate()} disabled={sync.isPending}>
            Sync now
          </Button>
        )}
        <Button size="sm" variant="ghost" icon={<History className="size-3.5" />} onClick={() => setHistory(true)}>
          History
        </Button>
        {canManage && (
          <>
            <Button
              size="sm"
              variant="ghost"
              icon={feed.status === 'paused' ? <Play className="size-3.5" /> : <Pause className="size-3.5" />}
              onClick={() => update.mutate({ paused: feed.status !== 'paused' })}
            >
              {feed.status === 'paused' ? 'Resume' : 'Pause'}
            </Button>
            <Button size="sm" variant="ghost" icon={<Unplug className="size-3.5" />} onClick={() => setDisconnecting(true)}>
              Disconnect
            </Button>
          </>
        )}
      </span>
      {history && <RunsDrawer feed={feed} onClose={() => setHistory(false)} />}
      <ConfirmDialog
        open={disconnecting}
        title="Disconnect this bank feed?"
        body="Automatic syncing stops and the saved API credentials are deleted. Transactions already imported stay."
        confirmLabel="Disconnect"
        danger
        loading={disconnect.isPending}
        onConfirm={() => disconnect.mutate()}
        onCancel={() => setDisconnecting(false)}
      />
    </div>
  );
}
