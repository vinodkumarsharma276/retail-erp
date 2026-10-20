import { Bot, Download, FileStack, Landmark, MoreHorizontal, Pencil, Trash2, UploadCloud } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import { METHOD_LABEL } from './components/domain';
import { PageHeader, ShopAvatar } from './components/BankLayout';
import { Badge, Button, Card, ConfirmDialog, EmptyState, Input, Select, Skeleton, useToast } from './components/ui';
import { api, downloadStatementFile, type Statement } from './lib/api';
import { compactMoney, count, date, fileSize, pct, relativeTime } from './lib/format';
import { useInvalidateData, useMeta, useStatements } from './lib/queries';
import { useScope } from './lib/store';
import { useCanCheck } from '../../hooks/usePermission';
import { useEscapeKey } from '../../hooks/useEscapeKey';

function Menu({ s, onDelete, onEdit }: { s: Statement; onDelete: () => void; onEdit: () => void }) {
  const can = useCanCheck();
  const canChange = can('bank.upload_statement');
  const canDelete = can('bank.delete_statement');
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const toast = useToast();
  const invalidate = useInvalidateData();
  const { data: meta } = useMeta();
  const recat = useMutation({
    mutationFn: () => api.recategorize(s.id),
    onSuccess: (r) => {
      toast(r.aiError ? `Rules re-applied; AI failed: ${r.aiError}` : `Re-categorized ${r.updated} transactions`, r.aiError ? 'critical' : 'good');
      invalidate();
    },
    onError: (e: Error) => toast(e.message, 'critical'),
  });
  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [open]);
  useEscapeKey(open, () => setOpen(false));
  if (!canChange && !canDelete && !s.has_file) return null;
  return (
    <div className="relative" ref={ref}>
      <Button variant="ghost" size="sm" onClick={() => setOpen(!open)} aria-label="Statement actions" loading={recat.isPending}>
        {!recat.isPending && <MoreHorizontal className="size-4" />}
      </Button>
      {open && (
        <div className="absolute right-0 z-30 mt-1 w-60 rounded-xl border border-border bg-card p-1.5 shadow-lg">
          {s.has_file && (
            <button
              className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[13px] hover:bg-subtle cursor-pointer"
              onClick={() => {
                setOpen(false);
                downloadStatementFile(s).catch((e: Error) => toast(e.message, 'critical'));
              }}
            >
              <Download className="size-4 text-muted-foreground" /> Download original file
            </button>
          )}
          {canChange && <>
          <button className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[13px] hover:bg-subtle cursor-pointer" onClick={() => { setOpen(false); recat.mutate(); }}>
            <Bot className="size-4 text-muted-foreground" /> Re-run categorization{meta?.ai.enabled ? ' (rules + AI)' : ''}
          </button>
          <button className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[13px] hover:bg-subtle cursor-pointer" onClick={() => { setOpen(false); onEdit(); }}>
            <Pencil className="size-4 text-muted-foreground" /> Change bank or shop
          </button>
          </>}
          {canChange && canDelete && <div className="my-1 h-px bg-border" />}
          {canDelete && <button className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[13px] text-destructive hover:bg-destructive-muted cursor-pointer" onClick={() => { setOpen(false); onDelete(); }}>
            <Trash2 className="size-4" /> Delete statement
          </button>}
        </div>
      )}
    </div>
  );
}

export default function BankStatementsPage() {
  const scope = useScope();
  const { data: meta } = useMeta();
  const { data, isLoading } = useStatements(scope.shopIds);
  const toast = useToast();
  const invalidate = useInvalidateData();
  const [toDelete, setToDelete] = useState<Statement | null>(null);
  const [editing, setEditing] = useState<Statement | null>(null);
  const [bank, setBank] = useState('');
  const [shop, setShop] = useState('');

  const del = useMutation({
    mutationFn: (id: string) => api.deleteStatement(id),
    onSuccess: () => {
      toast('Statement deleted', 'good');
      setToDelete(null);
      invalidate();
    },
    onError: (e: Error) => toast(e.message, 'critical'),
  });
  const save = useMutation({
    mutationFn: () => api.updateStatement(editing!.id, { bank, shopId: shop }),
    onSuccess: () => {
      toast('Statement updated', 'good');
      setEditing(null);
      invalidate();
    },
    onError: (e: Error) => toast(e.message, 'critical'),
  });

  const shopIndex = (id: string) => meta?.shops.findIndex((s) => s.id === id) ?? 0;

  return (
    <div className="pb-10">
      <PageHeader
        title="Statements"
        subtitle="Every uploaded file, how it was read, and whether its running balances reconcile."
        actions={
          <Link to="/bank/upload">
            <Button variant="primary" icon={<UploadCloud className="size-4" />}>
              Upload
            </Button>
          </Link>
        }
      />
      <div>
        <Card className="overflow-hidden">
          {isLoading ? (
            <div className="space-y-2 p-4">
              {[0, 1, 2].map((i) => (
                <Skeleton key={i} className="h-14" />
              ))}
            </div>
          ) : !data?.length ? (
            <EmptyState icon={<FileStack className="size-6" />} title="No statements yet" body="Uploaded files will appear here." />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[980px] text-[13px]">
                <thead className="border-b border-border bg-subtle text-left text-muted-foreground">
                  <tr>
                    <th className="px-4 py-2.5 font-medium">File</th>
                    <th className="px-3 py-2.5 font-medium">Shop</th>
                    <th className="px-3 py-2.5 font-medium">Bank</th>
                    <th className="px-3 py-2.5 font-medium">Period</th>
                    <th className="px-3 py-2.5 font-medium">Read by</th>
                    <th className="px-3 py-2.5 font-medium">Balance check</th>
                    <th className="px-3 py-2.5 text-right font-medium">Txns</th>
                    <th className="px-3 py-2.5 text-right font-medium">In / Out</th>
                    <th className="px-3 py-2.5 font-medium">Review</th>
                    <th className="w-10" />
                  </tr>
                </thead>
                <tbody>
                  {data.map((s) => {
                    const m = METHOD_LABEL[s.parse_method];
                    return (
                      <tr key={s.id} className="border-b border-border/70 last:border-0 hover:bg-subtle">
                        <td className="max-w-64 px-4 py-3">
                          <Link to={`/bank/transactions?statementIds=${s.id}`} className="block truncate font-medium hover:underline" title={s.file_name}>
                            {s.file_name}
                          </Link>
                          <div className="text-xs text-muted-foreground">
                            {s.source === 'api' ? 'Synced from bank' : `${s.file_type.toUpperCase()} · ${fileSize(s.file_size)}`} · {relativeTime(s.uploaded_at)}
                            {s.uploaded_by ? ` · by ${s.uploaded_by}` : ''}
                          </div>
                        </td>
                        <td className="px-3 py-3">
                          <span className="flex items-center gap-2">
                            <ShopAvatar name={s.shop_name} index={shopIndex(s.shop_id)} size={20} />
                            <span className="truncate">{s.shop_name}</span>
                          </span>
                        </td>
                        <td className="px-3 py-3">
                          {s.bank}
                          {s.account_hint && (
                            <div className="flex items-center gap-1 text-xs text-muted-foreground">
                              {s.account_hint}
                              {s.bank_account_id ? (
                                <span className="inline-flex items-center gap-0.5 text-success" title="Matched to a registered shop account">
                                  <Landmark className="size-3" /> registered
                                </span>
                              ) : (
                                <span title="Add this account under Rules & settings → Bank accounts">· not registered</span>
                              )}
                            </div>
                          )}
                        </td>
                        <td className="num px-3 py-3 whitespace-nowrap text-foreground/80">
                          {date(s.period_start)} –<br />
                          {date(s.period_end)}
                        </td>
                        <td className="px-3 py-3">
                          <Badge tone={m.tone}>{m.label}</Badge>
                        </td>
                        <td className="px-3 py-3">
                          {s.reconciliation == null ? (
                            <span className="text-xs text-muted-foreground">No balance column</span>
                          ) : (
                            <div className="w-28" title="Share of rows where previous balance ± amount = printed balance">
                              <div className="mb-1 text-xs font-medium">{pct(s.reconciliation)} match</div>
                              <div className="h-1.5 rounded-full bg-muted">
                                <div
                                  className="h-1.5 rounded-full"
                                  style={{
                                    width: pct(s.reconciliation),
                                    background: s.reconciliation >= 0.98 ? 'hsl(var(--success))' : s.reconciliation >= 0.9 ? 'hsl(var(--warning))' : 'hsl(var(--destructive))',
                                  }}
                                />
                              </div>
                            </div>
                          )}
                        </td>
                        <td className="num px-3 py-3 text-right">{count(s.tx_count)}</td>
                        <td className="num px-3 py-3 text-right whitespace-nowrap">
                          <div className="text-success">+{compactMoney(s.inflow, s.currency)}</div>
                          <div className="text-foreground/80">−{compactMoney(s.outflow, s.currency)}</div>
                        </td>
                        <td className="px-3 py-3">
                          {s.pending_review > 0 ? (
                            <Link to={`/bank/review?statementIds=${s.id}`}>
                              <Badge tone="warning">{s.pending_review} to review</Badge>
                            </Link>
                          ) : (
                            <Badge tone="good">Done</Badge>
                          )}
                          {s.warnings?.length > 0 && (
                            <div className="mt-1 max-w-48 truncate text-xs text-muted-foreground" title={s.warnings.join('\n')}>
                              ⓘ {s.warnings[0]}
                            </div>
                          )}
                        </td>
                        <td className="px-2 py-3">
                          <Menu
                            s={s}
                            onDelete={() => setToDelete(s)}
                            onEdit={() => {
                              setEditing(s);
                              setBank(s.bank);
                              setShop(s.shop_id);
                            }}
                          />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>

      <ConfirmDialog
        open={!!toDelete}
        title="Delete this statement?"
        body={
          <>
            <b>{toDelete?.file_name}</b> and its {count(toDelete?.tx_count ?? 0)} transactions — including any review notes — will be permanently removed. You can upload the file again afterwards.
          </>
        }
        confirmLabel="Delete"
        danger
        loading={del.isPending}
        onConfirm={() => toDelete && del.mutate(toDelete.id)}
        onCancel={() => setToDelete(null)}
      />

      {editing && (
        <ConfirmDialog
          open
          title="Edit statement"
          body={
            <div className="space-y-3 pt-1">
              <label className="block">
                <span className="mb-1 block text-[13px] font-medium">Bank</span>
                <Input value={bank} onChange={(e) => setBank(e.target.value)} />
              </label>
              <label className="block">
                <span className="mb-1 block text-[13px] font-medium">Shop</span>
                <Select value={shop} onChange={(e) => setShop(e.target.value)} className="w-full">
                  {meta?.shops.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </Select>
              </label>
            </div>
          }
          confirmLabel="Save"
          loading={save.isPending}
          onConfirm={() => save.mutate()}
          onCancel={() => setEditing(null)}
        />
      )}
    </div>
  );
}
