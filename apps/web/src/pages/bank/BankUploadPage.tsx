import clsx from 'clsx';
import {
  AlertCircle,
  CheckCircle2,
  FileImage,
  FileSpreadsheet,
  FileText,
  FolderOpen,
  KeyRound,
  ListChecks,
  Loader2,
  RotateCcw,
  Trash2,
  UploadCloud,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from 'react';
import { Link } from 'react-router-dom';
import { METHOD_LABEL } from './components/domain';
import { PageHeader, ShopAvatar } from './components/BankLayout';
import { Badge, Button, Card, Input, Select, useToast } from './components/ui';
import { api, ApiError, uploadStatement, type Statement } from './lib/api';
import { UploadProblemPanel, type RetryChanges, type UploadProblem } from './components/UploadProblem';
import { useQuery } from '@tanstack/react-query';
import { useCanCheck } from '../../hooks/usePermission';
import { count, date, fileSize, pct } from './lib/format';
import { useInvalidateData, useMeta } from './lib/queries';
import { readLocal, writeLocal } from './lib/store';
import { isAllShops, useShopStore } from '../../stores/shop-store';

/** `blocked` = the server needs a decision (which account, or what to do with already-imported rows). */
type Status = 'ready' | 'uploading' | 'processing' | 'done' | 'error' | 'needs-password' | 'duplicate' | 'blocked';

interface Item {
  id: string;
  file: File;
  shopId: string;
  /** Registered account picked by hand; '' = detect from the statement. */
  bankAccountId: string;
  password: string;
  duplicates?: 'skip' | 'keep';
  status: Status;
  progress: number;
  error?: string;
  problem?: UploadProblem;
  result?: Statement;
}

const EXT_ICON: Record<string, typeof FileText> = { pdf: FileText, png: FileImage, jpg: FileImage, jpeg: FileImage, webp: FileImage };
const extOf = (name: string) => name.split('.').pop()?.toLowerCase() ?? '';

export default function BankUploadPage() {
  const { data: meta } = useMeta();
  const toast = useToast();
  const invalidate = useInvalidateData();
  const accounts = useQuery({ queryKey: ['bank-accounts'], queryFn: api.accounts });
  const canAddAccount = useCanCheck()('bank.reconcile');
  const headerShopId = useShopStore((s) => s.currentShopId);
  // Default to the shop chosen in the header; in "All Shops" mode, the last shop used here.
  const [shopId, setShopIdState] = useState<string | null>(() =>
    headerShopId && !isAllShops(headerShopId) ? headerShopId : readLocal<string | null>('bank.uploadShop', null),
  );
  const [items, setItems] = useState<Item[]>([]);
  const [dragging, setDragging] = useState(false);
  const [running, setRunning] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const folderInput = useRef<HTMLInputElement>(null);

  const accept = useMemo(() => (meta?.supportedExtensions ?? ['.pdf', '.xlsx', '.xls', '.csv', '.png', '.jpg', '.jpeg']).join(','), [meta]);
  const shops = useMemo(() => meta?.shops ?? [], [meta]);

  // Only shops in the current header scope can receive uploads.
  useEffect(() => {
    if (!meta) return;
    if (shopId && shops.some((s) => s.id === shopId)) return;
    setShopIdState(shops.length === 1 ? shops[0].id : null);
  }, [meta, shops, shopId]);

  const setShopId = (id: string) => {
    setShopIdState(id);
    writeLocal('bank.uploadShop', id);
    // Re-point any not-yet-processed files to the newly chosen shop.
    setItems((prev) => prev.map((it) => (it.status === 'ready' ? { ...it, shopId: id, bankAccountId: '' } : it)));
  };

  const addFiles = useCallback(
    (files: FileList | File[]) => {
      const supported = new Set((meta?.supportedExtensions ?? []).map((e) => e.slice(1)));
      const list = Array.from(files);
      const ok = list.filter((f) => supported.size === 0 || supported.has(extOf(f.name)));
      const skipped = list.length - ok.length;
      if (skipped) toast(`${skipped} file${skipped === 1 ? '' : 's'} skipped (unsupported type)`, 'critical');
      setItems((prev) => {
        const seen = new Set(prev.map((p) => `${p.file.name}|${p.file.size}`));
        const next = ok
          .filter((f) => !seen.has(`${f.name}|${f.size}`))
          .map<Item>((file) => ({
            id: crypto.randomUUID(),
            file,
            shopId: shopId ?? '',
            bankAccountId: '',
            password: '',
            status: 'ready',
            progress: 0,
          }));
        return [...prev, ...next];
      });
    },
    [meta, shopId, toast],
  );

  const patch = (id: string, p: Partial<Item>) => setItems((prev) => prev.map((it) => (it.id === id ? { ...it, ...p } : it)));

  const processOne = async (it: Item) => {
    patch(it.id, { status: 'uploading', progress: 0, error: undefined, problem: undefined });
    const form = new FormData();
    // Fields go before the file: the API reads them from the multipart stream ahead of the file part.
    form.append('shopId', it.shopId);
    if (it.bankAccountId) form.append('bankAccountId', it.bankAccountId);
    if (it.duplicates) form.append('duplicates', it.duplicates);
    if (it.password) form.append('password', it.password);
    form.append('file', it.file, it.file.name);
    try {
      const res = await uploadStatement(form, (f) => patch(it.id, { progress: f, status: f >= 1 ? 'processing' : 'uploading' }));
      patch(it.id, { status: 'done', result: res.statement });
    } catch (e) {
      const err = e as ApiError;
      if (err.body?.needsPassword) patch(it.id, { status: 'needs-password', error: err.message });
      else if (err.body?.code) patch(it.id, { status: 'blocked', problem: err.body as UploadProblem });
      else if (err.status === 409) patch(it.id, { status: 'duplicate', error: err.message });
      else patch(it.id, { status: 'error', error: err.message });
    }
  };

  /** Apply the user's decision from a problem panel and upload that file again. */
  const retry = (it: Item, changes: RetryChanges) => {
    const next: Item = { ...it, ...changes, status: 'ready', problem: undefined, error: undefined };
    patch(it.id, next);
    runAll([next]);
  };

  const runAll = async (subset?: Item[]) => {
    const queue = (subset ?? items).filter((i) => i.status === 'ready' || i.status === 'error' || i.status === 'needs-password');
    if (!queue.length) return;
    if (queue.some((q) => !q.shopId)) {
      toast('Choose a shop for every file first', 'critical');
      return;
    }
    setRunning(true);
    let next = 0;
    // Two at a time keeps AI calls and the UI responsive.
    await Promise.all(
      Array.from({ length: Math.min(2, queue.length) }, async () => {
        while (next < queue.length) await processOne(queue[next++]);
      }),
    );
    setRunning(false);
    invalidate();
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    if (e.dataTransfer.files?.length) addFiles(e.dataTransfer.files);
  };

  const done = items.filter((i) => i.status === 'done');
  const totals = done.reduce((a, i) => ({ tx: a.tx + (i.result?.tx_count ?? 0), review: a.review + (i.result?.pending_review ?? 0) }), { tx: 0, review: 0 });
  const queued = items.filter((i) => ['ready', 'error', 'needs-password'].includes(i.status)).length;

  return (
    <div className="pb-10">
      <PageHeader
        title="Upload statements"
        subtitle="PDF, Excel/CSV or photos of bank statements. Only pages the built-in reader can't handle are sent to AI."
        filters={false}
      />
      <div className="mx-auto max-w-5xl space-y-5">
        {/* ---------------------------------------------------------------- step 1: shop */}
        <section>
          <h2 className="mb-2 flex items-center gap-2 text-[13px] font-semibold tracking-wide text-muted-foreground uppercase">
            <span className="grid size-5 place-items-center rounded-full bg-foreground text-[11px] text-card">1</span> Which shop are these statements for?
          </h2>
          <div role="radiogroup" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {shops.map((s, i) => (
              <button
                key={s.id}
                role="radio"
                aria-checked={shopId === s.id}
                onClick={() => setShopId(s.id)}
                className={clsx(
                  'flex items-center gap-3 rounded-xl border bg-card p-3.5 text-left shadow-xs transition-all cursor-pointer',
                  shopId === s.id ? 'border-primary ring-2 ring-primary/25' : 'border-border hover:border-border-strong',
                )}
              >
                <ShopAvatar name={s.name} index={i} size={34} />
                <span className="min-w-0 flex-1 text-[13.5px] leading-snug font-medium">{s.name}</span>
                <span className={clsx('size-4 shrink-0 rounded-full border-2', shopId === s.id ? 'border-primary bg-primary shadow-[inset_0_0_0_2px_hsl(var(--card))]' : 'border-border-strong')} />
              </button>
            ))}
          </div>
        </section>

        {/* ---------------------------------------------------------------- step 2: files */}
        <section>
          <h2 className="mb-2 flex items-center gap-2 text-[13px] font-semibold tracking-wide text-muted-foreground uppercase">
            <span className="grid size-5 place-items-center rounded-full bg-foreground text-[11px] text-card">2</span> Add statement files
          </h2>
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={onDrop}
            className={clsx(
              'flex flex-col items-center justify-center rounded-2xl border-2 border-dashed px-6 py-10 text-center transition-colors',
              dragging ? 'border-primary bg-primary-muted' : 'border-border-strong bg-card',
              !shopId && 'opacity-60',
            )}
          >
            <div className="grid size-12 place-items-center rounded-xl bg-primary-muted text-primary">
              <UploadCloud className="size-6" />
            </div>
            <p className="mt-3 text-[15px] font-semibold">Drop statements here</p>
            <p className="mt-1 text-sm text-muted-foreground">Multiple files and banks at once · PDF, XLSX, XLS, CSV, PNG, JPG · up to {meta?.maxFileMb ?? 30} MB each</p>
            <div className="mt-4 flex flex-wrap justify-center gap-2">
              <Button variant="primary" icon={<FileText className="size-4" />} onClick={() => fileInput.current?.click()} disabled={!shopId}>
                Browse files…
              </Button>
              <Button icon={<FolderOpen className="size-4" />} onClick={() => folderInput.current?.click()} disabled={!shopId}>
                Choose a folder…
              </Button>
            </div>
            {!shopId && <p className="mt-3 text-xs font-medium text-warning">Pick a shop above first.</p>}
            <input
              ref={fileInput}
              type="file"
              multiple
              accept={accept}
              hidden
              onChange={(e) => {
                if (e.target.files) addFiles(e.target.files);
                e.target.value = '';
              }}
            />
            <input
              ref={folderInput}
              type="file"
              multiple
              hidden
              // @ts-expect-error non-standard but supported by Chromium, Edge, Firefox & Safari
              webkitdirectory=""
              onChange={(e) => {
                if (e.target.files) addFiles(e.target.files);
                e.target.value = '';
              }}
            />
          </div>
        </section>

        {/* ---------------------------------------------------------------- queue */}
        {items.length > 0 && (
          <Card>
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-5 py-3">
              <div className="text-[15px] font-semibold">
                {items.length} file{items.length === 1 ? '' : 's'}
                <span className="ml-2 text-[13px] font-normal text-muted-foreground">Leave bank blank to auto-detect</span>
              </div>
              <div className="flex gap-2">
                <Button variant="ghost" onClick={() => setItems((p) => p.filter((i) => i.status !== 'done' && i.status !== 'duplicate'))} disabled={running}>
                  Clear finished
                </Button>
                <Button variant="primary" icon={<UploadCloud className="size-4" />} onClick={() => runAll()} loading={running} disabled={!queued}>
                  {running ? 'Processing…' : `Process ${queued || ''} file${queued === 1 ? '' : 's'}`}
                </Button>
              </div>
            </div>
            <ul className="divide-y divide-border">
              {items.map((it) => {
                const Icon = EXT_ICON[extOf(it.file.name)] ?? FileSpreadsheet;
                const editable = ['ready', 'error', 'needs-password'].includes(it.status);
                return (
                  <li key={it.id} className="px-5 py-3.5">
                    <div className="flex items-center gap-3">
                      <div className="grid size-9 shrink-0 place-items-center rounded-lg bg-muted text-foreground/80">
                        <Icon className="size-[18px]" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-[13.5px] font-medium" title={it.file.webkitRelativePath || it.file.name}>
                          {it.file.name}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {extOf(it.file.name).toUpperCase()} · {fileSize(it.file.size)}
                        </div>
                      </div>
                      <div className="flex w-44 shrink-0 justify-end">
                        <StatusCell item={it} />
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setItems((p) => p.filter((x) => x.id !== it.id))}
                        disabled={it.status === 'uploading' || it.status === 'processing'}
                        aria-label="Remove file"
                      >
                        <Trash2 className="size-4" />
                      </Button>
                    </div>
                    {editable && (
                      <div className="mt-2.5 flex flex-wrap items-center gap-2 sm:pl-12">
                        <Select
                          value={it.shopId || ''}
                          onChange={(e) => patch(it.id, { shopId: e.target.value, bankAccountId: '' })}
                          className="w-full sm:w-52"
                          aria-label="Shop"
                        >
                          <option value="" disabled>
                            Choose shop…
                          </option>
                          {shops.map((s) => (
                            <option key={s.id} value={s.id}>
                              {s.name}
                            </option>
                          ))}
                        </Select>
                        <Select
                          value={it.bankAccountId}
                          onChange={(e) => patch(it.id, { bankAccountId: e.target.value })}
                          className="w-full sm:w-56"
                          aria-label="Bank account"
                        >
                          <option value="">Account: detect from statement</option>
                          {(accounts.data ?? [])
                            .filter((a) => a.shop_id === it.shopId)
                            .map((a) => (
                              <option key={a.id} value={a.id}>
                                {a.bank_name} ••{a.account_number.slice(-4)}
                              </option>
                            ))}
                        </Select>
                        {extOf(it.file.name) === 'pdf' && (
                          <div className="relative w-full sm:w-56">
                            <KeyRound className="pointer-events-none absolute top-2.5 left-2.5 size-4 text-muted-foreground" />
                            <Input
                              type="password"
                              placeholder={it.status === 'needs-password' ? 'PDF password required' : 'PDF password (if any)'}
                              value={it.password}
                              onChange={(e) => patch(it.id, { password: e.target.value })}
                              className={clsx('pl-8', it.status === 'needs-password' && 'border-warning ring-2 ring-warning/30')}
                              name={`pdf-password-${it.id}`}
                              autoComplete="new-password"
                              data-1p-ignore
                              data-lpignore="true"
                              aria-label="PDF password"
                            />
                          </div>
                        )}
                        {it.status === 'needs-password' && (
                          <Button size="sm" onClick={() => runAll([it])} disabled={!it.password || running}>
                            Unlock & retry
                          </Button>
                        )}
                      </div>
                    )}
                    {it.error && (
                      <p className={clsx('mt-2 flex items-start gap-1.5 pl-12 text-[13px]', it.status === 'duplicate' ? 'text-foreground/80' : 'text-destructive')}>
                        <AlertCircle className="mt-0.5 size-4 shrink-0" />
                        {it.error}
                        {it.status === 'error' && (
                          <button className="ml-2 inline-flex items-center gap-1 font-medium text-primary hover:underline cursor-pointer" onClick={() => runAll([it])}>
                            <RotateCcw className="size-3.5" /> Retry
                          </button>
                        )}
                      </p>
                    )}
                    {it.status === 'blocked' && it.problem && (
                      <UploadProblemPanel
                        key={it.problem.code}
                        problem={it.problem}
                        canAddAccount={canAddAccount}
                        busy={running}
                        onRetry={(changes) => retry(it, changes)}
                        onRemove={() => setItems((p) => p.filter((x) => x.id !== it.id))}
                      />
                    )}
                    {it.result && <ResultLine s={it.result} />}
                  </li>
                );
              })}
            </ul>
          </Card>
        )}

        {done.length > 0 && !running && (
          <Card className="flex flex-wrap items-center gap-4 border-success/40 bg-success-muted p-5">
            <CheckCircle2 className="size-8 text-success" />
            <div className="flex-1">
              <div className="text-[15px] font-semibold">
                Imported {count(totals.tx)} transactions from {done.length} file{done.length === 1 ? '' : 's'}
              </div>
              <div className="text-[13px] text-foreground/80">{totals.review ? `${count(totals.review)} need a human check.` : 'Nothing needs review — all transactions look normal.'}</div>
            </div>
            {totals.review > 0 && (
              <Link to="/bank/review">
                <Button variant="primary" icon={<ListChecks className="size-4" />}>
                  Review flagged
                </Button>
              </Link>
            )}
            <Link to="/bank">
              <Button>View dashboard</Button>
            </Link>
          </Card>
        )}
      </div>
    </div>
  );
}

function StatusCell({ item }: { item: Item }) {
  switch (item.status) {
    case 'ready':
      return <Badge>Ready</Badge>;
    case 'uploading':
      return (
        <div className="w-full">
          <div className="mb-1 text-right text-xs text-muted-foreground">Uploading {pct(item.progress)}</div>
          <div className="h-1.5 rounded-full bg-muted">
            <div className="h-1.5 rounded-full bg-primary transition-[width]" style={{ width: pct(item.progress) }} />
          </div>
        </div>
      );
    case 'processing':
      return (
        <span className="inline-flex items-center gap-1.5 text-xs font-medium text-primary">
          <Loader2 className="size-3.5 animate-spin" /> Reading & categorizing…
        </span>
      );
    case 'done':
      return <Badge tone="good" icon={<CheckCircle2 className="size-3" />}>Imported</Badge>;
    case 'needs-password':
      return <Badge tone="warning" icon={<KeyRound className="size-3" />}>Password needed</Badge>;
    case 'duplicate':
      return <Badge>Already uploaded</Badge>;
    case 'blocked':
      return (
        <Badge tone="warning" icon={<AlertCircle className="size-3" />}>
          Action needed
        </Badge>
      );
    default:
      return <Badge tone="critical">Failed</Badge>;
  }
}

function ResultLine({ s }: { s: Statement }) {
  const m = METHOD_LABEL[s.parse_method];
  return (
    <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 pl-12 text-[13px] text-foreground/80">
      <span>
        <b className="text-foreground">{count(s.tx_count)}</b> transactions
      </span>
      <span>{s.shop_name}</span>
      <span>{s.bank}{s.account_hint ? ` ${s.account_hint}` : ''}</span>
      <span>
        {date(s.period_start)} – {date(s.period_end)}
      </span>
      <Badge tone={m.tone}>{m.label}</Badge>
      {s.reconciliation != null && (
        <Badge tone={s.reconciliation >= 0.98 ? 'good' : s.reconciliation >= 0.9 ? 'warning' : 'critical'}>Balances match {pct(s.reconciliation)}</Badge>
      )}
      {s.pending_review > 0 && (
        <Link to={`/bank/review?statementIds=${s.id}`} className="font-medium text-warning hover:underline">
          {s.pending_review} to review →
        </Link>
      )}
      {s.warnings?.map((w) => (
        <span key={w} className="w-full text-xs text-muted-foreground">
          ⓘ {w}
        </span>
      ))}
    </div>
  );
}
