import { useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, CheckCircle2, FileSpreadsheet, Sparkles, Tags, UploadCloud, Users } from 'lucide-react';
import { parseRegisterSheet, type RegisterSheetRow } from '@retailerp/shared-utils';
import { PageHeader } from '../../components/PageHeader';
import { Button } from '../../components/ui/button';
import { Badge } from '../../components/ui/badge';
import { Input } from '../../components/ui/input';
import { Select } from '../../components/ui/select';
import { cn } from '../../lib/utils';
import * as XLSX from 'xlsx';
import { useMeQuery } from '../../hooks/useAuth';
import { useToast } from '../../stores/toast-store';
import { useShopStore, isAllShops } from '../../stores/shop-store';
import {
  apiErrorMessage,
  useImportBatchesQuery,
  useImportCommitMutation,
  useImportPreviewMutation,
  type ImportNameGroup,
  type ImportPreview,
  type ImportPreviewRow,
  type ImportProductType,
  type ImportResult,
  type ProductTypeDecision,
} from '../../hooks/useCustomerSearch';
import { useCanCheck } from '../../hooks/usePermission';

const DEFAULT_RANGE = 500;
const MAX_RANGE = 10_000;
/** Preview rows drawn at once; a 10,000-row table would make the page crawl. */
const PREVIEW_PAGE = 500;

type Resolution = Record<string, string>;
type RowFilter = 'problems' | 'all' | 'new' | 'move' | 'exists' | 'invalid';

/**
 * Every sheet's rows, as SheetJS reads them. A CSV is read as plain text:
 * SheetJS would otherwise turn "1/3/2021" into a US month-first date
 * (3 January) — the register is day-first, and `parseRegisterSheet` reads it so.
 */
async function readRegisterFile(file: File): Promise<unknown[][][]> {
  const data = await file.arrayBuffer();
  const wb = XLSX.read(data, { type: 'array', raw: /\.csv$/i.test(file.name), cellDates: false });
  return wb.SheetNames.map((name) =>
    XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[name], { header: 1, raw: true, defval: '', blankrows: true }),
  );
}

const shopKey = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '');

/** The shop the file's Shop column names most often, matched by name or code. */
function mostCommonShop(rows: RegisterSheetRow[], shops: Array<{ id: string; name: string; code: string }>): string | null {
  const counts = new Map<string, number>();
  for (const r of rows) {
    const key = shopKey(r.shop ?? '');
    if (!key) continue;
    const shop = shops.find((s) => shopKey(s.name) === key || shopKey(s.code) === key);
    if (shop) counts.set(shop.id, (counts.get(shop.id) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
}
type EditableField = 'accountNumber' | 'customerName' | 'mobile' | 'purchaseDate' | 'coMobile' | 'shop';

/** Point `key` (and anything pointing at it) at `target`'s person. */
function joinPerson(res: Resolution, key: string, target: string): Resolution {
  const root = res[target] ?? target;
  const out = { ...res };
  for (const k of Object.keys(out)) if (k === key || out[k] === key) out[k] = root;
  return out;
}

/** Take `key` out of its person: it becomes a person of its own. */
function splitPerson(res: Resolution, key: string): Resolution {
  const out = { ...res };
  const wasTarget = out[key] === key;
  out[key] = key;
  if (wasTarget) {
    const others = Object.keys(out).filter((k) => k !== key && out[k] === key);
    for (const k of others) out[k] = others[0];
  }
  return out;
}

/** Keep `key`'s spelling for its person. */
function keepName(res: Resolution, key: string): Resolution {
  const root = res[key];
  const out = { ...res };
  for (const k of Object.keys(out)) if (out[k] === root) out[k] = key;
  return out;
}

function NameGroupCard({
  group,
  resolution,
  onChange,
}: {
  group: ImportNameGroup;
  resolution: Resolution;
  onChange: (res: Resolution) => void;
}) {
  const byKey = new Map(group.variants.map((v) => [v.key, v]));
  const aiNotes = group.verdicts.filter((v) => v.by === 'ai');
  const people = new Set(Object.values(resolution)).size;
  return (
    <div className="rounded-lg border bg-card p-4">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <span className="font-mono text-sm font-semibold">{group.mobile}</span>
        <Badge tone={group.needsReview ? 'warning' : 'neutral'}>{people === 1 ? '1 person' : `${people} people`}</Badge>
      </div>
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs text-muted-foreground">
            <th className="py-1 pr-3 font-medium">Name as written</th>
            <th className="py-1 pr-3 font-medium">Rows</th>
            <th className="py-1 pr-3 font-medium">Is the same person as</th>
            <th className="py-1 font-medium">Name kept</th>
          </tr>
        </thead>
        <tbody>
          {group.variants.map((v) => {
            const target = resolution[v.key];
            const isTarget = target === v.key;
            const clusterSize = Object.values(resolution).filter((t) => t === target).length;
            return (
              <tr key={v.key} className="border-t">
                <td className="py-1.5 pr-3">
                  <span className="font-medium">{v.name}</span>
                  {v.customerCode && <Badge tone="primary" className="ml-1.5">{v.customerCode}</Badge>}
                </td>
                <td className="py-1.5 pr-3 tabular-nums">{v.customerId ? (v.rows ? `${v.rows} + existing` : 'existing') : v.rows}</td>
                <td className="py-1.5 pr-3">
                  <Select
                    value={isTarget ? '' : target}
                    onChange={(e) => onChange(e.target.value ? joinPerson(resolution, v.key, e.target.value) : splitPerson(resolution, v.key))}
                    className="h-8 text-sm"
                  >
                    <option value="">{isTarget && clusterSize > 1 ? '— this person (others join here) —' : '— a separate person —'}</option>
                    {group.variants
                      .filter((o) => o.key !== v.key)
                      .map((o) => (
                        <option key={o.key} value={resolution[o.key]}>
                          {o.name}
                          {o.customerCode ? ` (${o.customerCode})` : ''}
                        </option>
                      ))}
                  </Select>
                </td>
                <td className="py-1.5">
                  {clusterSize > 1 ? (
                    <label className="inline-flex cursor-pointer items-center gap-1.5">
                      <input type="radio" checked={isTarget} onChange={() => onChange(keepName(resolution, v.key))} />
                      <span className="text-xs">{isTarget ? 'Kept' : 'Use this'}</span>
                    </label>
                  ) : (
                    <span className="text-xs text-muted-foreground">—</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {aiNotes.length > 0 && (
        <ul className="mt-2 space-y-0.5 text-xs text-muted-foreground">
          {aiNotes.map((n) => (
            <li key={`${n.a}|${n.b}`} className="flex items-center gap-1">
              <Sparkles className="h-3 w-3 text-primary" />
              {byKey.get(n.a)?.name} / {byKey.get(n.b)?.name}: AI says {n.same ? 'same person' : 'different people'}
              {n.reason ? ` — ${n.reason}` : ''}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

const KIND_LABEL: Record<ImportProductType['kind'], { label: string; tone: 'success' | 'neutral' | 'warning' | 'info' }> = {
  mapped: { label: 'Chosen before', tone: 'neutral' },
  matched: { label: 'Matches', tone: 'success' },
  similar: { label: 'Looks like', tone: 'warning' },
  new: { label: 'Not in the app', tone: 'info' },
};

const decisionValue = (d: ProductTypeDecision | undefined) =>
  !d || d.action === 'blank' ? 'blank' : d.action === 'create' ? 'create' : `existing:${d.categoryId}`;

/** The sheet's Product values, each matched to a top-level product type or offered as a new one. */
function ProductTypesCard({
  types,
  topLevel,
  decisions,
  canCreate,
  onChange,
}: {
  types: ImportProductType[];
  topLevel: Array<{ id: string; name: string }>;
  decisions: Record<string, ProductTypeDecision>;
  canCreate: boolean;
  onChange: (textKey: string, decision: ProductTypeDecision) => void;
}) {
  const toCreate = types.filter((t) => decisions[t.textKey]?.action === 'create');
  return (
    <section className="mb-4 rounded-lg border bg-card p-4">
      <h2 className="mb-1 flex items-center gap-2 text-base font-semibold">
        <Tags className="h-4 w-4" /> Product types
      </h2>
      <p className="mb-3 text-sm text-muted-foreground">
        The sheet's Product column, matched to the app's top-level product types. Confirm each one; choices are remembered for the next ranges.
      </p>
      {toCreate.length > 0 && (
        <div className="mb-3 rounded-md border border-info/30 bg-info-muted px-3 py-2 text-sm text-info">
          {toCreate.length} new product type{toCreate.length === 1 ? '' : 's'} will be created: <strong>{toCreate.map((t) => t.text).join(', ')}</strong>
        </div>
      )}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-left text-xs text-muted-foreground">
            <tr>
              <th className="py-1 pr-3 font-medium">On the sheet</th>
              <th className="py-1 pr-3 font-medium">Rows</th>
              <th className="py-1 pr-3 font-medium">Found</th>
              <th className="py-1 font-medium">Product type in the app</th>
            </tr>
          </thead>
          <tbody>
            {types.map((t) => (
              <tr key={t.textKey} className="border-t">
                <td className="py-1.5 pr-3 font-medium">{t.text}</td>
                <td className="py-1.5 pr-3 tabular-nums">{t.rows}</td>
                <td className="py-1.5 pr-3">
                  <Badge tone={KIND_LABEL[t.kind].tone}>
                    {KIND_LABEL[t.kind].label}
                    {t.kind === 'similar' && t.categoryName ? ` ${t.categoryName}` : ''}
                    {t.kind === 'matched' && t.categoryName && !topLevel.some((c) => c.id === t.categoryId) ? ` (sub-type)` : ''}
                  </Badge>
                </td>
                <td className="py-1.5">
                  <Select
                    className="h-8 min-w-56 text-sm"
                    value={decisionValue(decisions[t.textKey])}
                    onChange={(e) => {
                      const v = e.target.value;
                      onChange(
                        t.textKey,
                        v === 'blank'
                          ? { action: 'blank' }
                          : v === 'create'
                            ? { action: 'create', name: t.text }
                            : { action: 'existing', categoryId: v.slice('existing:'.length) },
                      );
                    }}
                  >
                    {canCreate && t.kind !== 'matched' && <option value="create">+ Create new type “{t.text}”</option>}
                    {t.categoryId && !topLevel.some((c) => c.id === t.categoryId) && (
                      <option value={`existing:${t.categoryId}`}>{t.categoryName ?? 'Chosen before'}</option>
                    )}
                    {topLevel.map((c) => (
                      <option key={c.id} value={`existing:${c.id}`}>
                        {c.name}
                      </option>
                    ))}
                    <option value="blank">— Leave blank (keep the text) —</option>
                  </Select>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!canCreate && types.some((t) => t.kind === 'new') && (
        <p className="mt-2 text-xs text-muted-foreground">You can't create product types; ask someone who can, or leave these blank and set them later.</p>
      )}
    </section>
  );
}

function StatChip({ label, value, tone }: { label: string; value: number; tone: 'success' | 'neutral' | 'danger' | 'warning' }) {
  const colours = {
    success: 'border-success/30 bg-success-muted text-success',
    neutral: 'border-border bg-muted text-muted-foreground',
    danger: 'border-destructive/30 bg-destructive-muted text-destructive',
    warning: 'border-warning/30 bg-warning-muted text-warning',
  }[tone];
  return (
    <div className={cn('rounded-lg border px-4 py-2', colours)}>
      <p className="text-xl font-semibold tabular-nums">{value}</p>
      <p className="text-xs">{label}</p>
    </div>
  );
}

/**
 * Bringing the Google Sheet in: upload the file once, then import a range of
 * records at a time (1–500, 501–1000…), fixing problems and deciding name
 * variants before each range is saved.
 */
export function CustomerSearchImportPage() {
  const toast = useToast();
  const fileInput = useRef<HTMLInputElement>(null);
  const me = useMeQuery();
  const currentShopId = useShopStore((s) => s.currentShopId);
  const batches = useImportBatchesQuery();
  const previewMutation = useImportPreviewMutation();
  const commitMutation = useImportCommitMutation();

  const [fileName, setFileName] = useState('');
  const [rows, setRows] = useState<RegisterSheetRow[]>([]);
  const [readError, setReadError] = useState<string | null>(null);
  const [reading, setReading] = useState(false);
  // Kept as typed, so a box can be emptied and retyped; read as numbers below.
  const [fromText, setFromText] = useState('1');
  const [toText, setToText] = useState(String(DEFAULT_RANGE));
  const from = /^\d+$/.test(fromText.trim()) ? Number(fromText) : 0;
  const to = /^\d+$/.test(toText.trim()) ? Number(toText) : 0;
  const setFrom = (n: number) => setFromText(String(n));
  const setTo = (n: number) => setToText(String(n));
  const [shopId, setShopId] = useState(isAllShops(currentShopId) ? '' : currentShopId ?? '');
  const [edits, setEdits] = useState<Record<number, Partial<RegisterSheetRow>>>({});
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [stale, setStale] = useState(false);
  const [resolutions, setResolutions] = useState<Record<string, Resolution>>({});
  const [typeDecisions, setTypeDecisions] = useState<Record<string, ProductTypeDecision>>({});
  const can = useCanCheck();
  const canCreateTypes = can('categories.create');
  const [filter, setFilter] = useState<RowFilter>('problems');
  const [shown, setShown] = useState(PREVIEW_PAGE);
  const [result, setResult] = useState<ImportResult | null>(null);

  const shops = me.data?.shops ?? [];
  const total = rows.length;
  const doneForFile = useMemo(
    () => (batches.data ?? []).filter((b) => b.fileName === fileName).sort((a, b) => a.rowFrom - b.rowFrom),
    [batches.data, fileName],
  );
  const nextFrom = doneForFile.length ? Math.max(...doneForFile.map((b) => b.rowTo)) + 1 : 1;

  const resetPreview = () => {
    setPreview(null);
    setResolutions({});
    setTypeDecisions({});
    setResult(null);
  };

  const loadFile = async (file: File) => {
    setReadError(null);
    resetPreview();
    setEdits({});
    if (!/\.(xlsx|xls|csv)$/i.test(file.name)) {
      setReadError('Choose an Excel (.xlsx) or CSV file. In Google Sheets: File → Download → Microsoft Excel (.xlsx).');
      return;
    }
    setReading(true);
    try {
      const sheets = await readRegisterFile(file);
      const parsed = sheets
        .map((rows) => parseRegisterSheet(rows))
        .filter((p) => p.headerRow > 0)
        .sort((a, b) => b.rows.length - a.rows.length)[0];
      if (!parsed) {
        setReadError('No sheet in that file has an "Account Number" (or "ID") column.');
        return;
      }
      if (parsed.missing.length) {
        setReadError(`The sheet is missing: ${parsed.missing.join(', ')}.`);
        return;
      }
      setFileName(file.name);
      setRows(parsed.rows);
      // Rows with a blank Shop go to the shop the file names most often (else the current shop).
      const named = mostCommonShop(parsed.rows, shops);
      if (named) setShopId(named);
      const done = (batches.data ?? []).filter((b) => b.fileName === file.name);
      const start = done.length ? Math.max(...done.map((b) => b.rowTo)) + 1 : 1;
      setFrom(Math.min(start, parsed.rows.length || 1));
      setTo(Math.min(start + DEFAULT_RANGE - 1, parsed.rows.length));
    } catch {
      setReadError("Couldn't read that file. Download it from Google Sheets again as .xlsx or .csv.");
    } finally {
      setReading(false);
    }
  };

  const rangeRows = useMemo(
    () => rows.filter((r) => r.recordNo >= from && r.recordNo <= to).map((r) => ({ ...r, ...edits[r.recordNo] })),
    [rows, from, to, edits],
  );
  const rangeError =
    from < 1 || to < from
      ? 'Pick a range like 1 to 500.'
      : to - from + 1 > MAX_RANGE
        ? `At most ${MAX_RANGE} records at a time.`
        : rangeRows.length === 0
          ? 'No records in that range.'
          : null;

  const request = () => ({ fileName, shopId, rowFrom: from, rowTo: to, rows: rangeRows });

  const check = async () => {
    setResult(null);
    try {
      const data = await previewMutation.mutateAsync(request());
      setPreview(data);
      setStale(false);
      setResolutions(Object.fromEntries(data.groups.map((g) => [g.mobile, g.suggestion])));
      setTypeDecisions((prev) =>
        Object.fromEntries(
          data.productTypes.map((t): [string, ProductTypeDecision] => [
            t.textKey,
            prev[t.textKey] ??
              (t.categoryId
                ? { action: 'existing', categoryId: t.categoryId }
                : t.kind === 'new' && canCreateTypes
                  ? { action: 'create', name: t.text }
                  : { action: 'blank' }),
          ]),
        ),
      );
      setFilter(data.rows.some((r) => r.status === 'invalid' || r.status === 'move' || r.issues.length > 0) ? 'problems' : 'all');
      setShown(PREVIEW_PAGE);
    } catch (error) {
      toast.error(apiErrorMessage(error, "Couldn't check the rows"));
    }
  };

  const commit = async () => {
    try {
      const res = await commitMutation.mutateAsync({ ...request(), resolutions, productTypes: typeDecisions });
      setResult(res);
      setPreview(null);
      toast.success(`Imported ${res.inserted} entries`);
      batches.refetch();
      const start = to + 1;
      if (start <= total) {
        setFrom(start);
        setTo(Math.min(start + DEFAULT_RANGE - 1, total));
      }
    } catch (error) {
      toast.error(apiErrorMessage(error, "Couldn't import the rows"));
    }
  };

  const editRow = (recordNo: number, field: EditableField, value: string) => {
    setEdits((e) => ({ ...e, [recordNo]: { ...e[recordNo], [field]: value } }));
    setStale(true);
  };

  const visibleRows = (preview?.rows ?? []).filter((r) => {
    if (filter === 'all') return true;
    if (filter === 'problems') return r.status === 'invalid' || r.status === 'move' || r.issues.length > 0 || r.warnings.length > 0;
    return r.status === filter;
  });
  const reviewGroups = (preview?.groups ?? []).filter((g) => g.needsReview);
  const otherGroups = (preview?.groups ?? []).filter((g) => !g.needsReview);

  const importButton = preview ? (
    <Button
      onClick={commit}
      loading={commitMutation.isPending}
      disabled={stale || preview.summary.new + preview.summary.move === 0 || !shopId}
    >
      Import {preview.summary.new.toLocaleString('en-IN')} entr{preview.summary.new === 1 ? 'y' : 'ies'}
      {preview.summary.move ? `, move ${preview.summary.move}` : ''}
    </Button>
  ) : null;

  return (
    <div>
      <PageHeader
        title="Import the register"
        description="Download the Google Sheet as Excel (.xlsx), then bring it in a range of records at a time. Rows already imported are skipped, so a range can be run again."
        backTo="/customer-search"
      />

      {/* Step 1 — file */}
      <section className="mb-4 rounded-lg border bg-card p-4">
        <input
          ref={fileInput}
          type="file"
          accept=".xlsx,.xls,.csv"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) loadFile(file);
            e.target.value = '';
          }}
        />
        <div className="flex flex-wrap items-center gap-3">
          <Button onClick={() => fileInput.current?.click()} loading={reading} icon={<UploadCloud className="h-3.5 w-3.5" />}>
            {fileName ? 'Choose another file' : 'Choose the sheet (.xlsx)'}
          </Button>
          {fileName && (
            <span className="inline-flex items-center gap-1.5 text-sm">
              <FileSpreadsheet className="h-4 w-4 text-success" />
              <strong>{fileName}</strong> — {total.toLocaleString('en-IN')} records
            </span>
          )}
        </div>
        {readError && <p className="mt-2 text-sm text-destructive">{readError}</p>}
        {fileName && doneForFile.length > 0 && (
          <p className="mt-2 text-sm text-muted-foreground">
            Already imported from this file: {doneForFile.map((b) => `${b.rowFrom}–${b.rowTo}`).join(', ')}.{' '}
            {nextFrom <= total ? `Next: ${nextFrom}–${Math.min(nextFrom + DEFAULT_RANGE - 1, total)}.` : 'Every record has been imported.'}
          </p>
        )}
      </section>

      {/* Step 2 — range + shop */}
      {fileName && (
        <section className="mb-4 rounded-lg border bg-card p-4">
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">From record</label>
              <Input
                type="number"
                min={1}
                max={total}
                value={fromText}
                onChange={(e) => {
                  setFromText(e.target.value);
                  resetPreview();
                }}
                className="w-28"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">To record</label>
              <Input
                type="number"
                min={1}
                max={total}
                value={toText}
                onChange={(e) => {
                  setToText(e.target.value);
                  resetPreview();
                }}
                className="w-28"
              />
            </div>
            <div className="w-64">
              <label className="mb-1 block text-xs font-medium text-muted-foreground" title="Each row goes to the shop in its Shop column; this is for rows where it is blank">
                Shop for rows with no Shop
              </label>
              <Select value={shopId} onChange={(e) => setShopId(e.target.value)}>
                <option value="">Choose a shop…</option>
                {shops.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.code} — {s.name}
                  </option>
                ))}
              </Select>
            </div>
            <Button
              onClick={check}
              loading={previewMutation.isPending}
              disabled={!!rangeError || !shopId}
              variant={preview && !stale ? 'secondary' : 'default'}
            >
              {preview ? 'Check again' : 'Check these rows'}
            </Button>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            Record 1 is the first row under the headings (sheet row {rows[0]?.sheetRow ?? 2}).
            {rangeError ? <span className="ml-1 text-destructive">{rangeError}</span> : null}
          </p>
        </section>
      )}

      {result && (
        <section className="mb-4 flex flex-wrap items-center gap-3 rounded-lg border border-success/30 bg-success-muted p-4 text-sm text-success">
          <CheckCircle2 className="h-5 w-5" />
          Imported {result.inserted} entries · {result.customersCreated} new customers · {result.customersLinked} existing customers linked
          {result.productTypesCreated ? ` · ${result.productTypesCreated} new product types` : ''}
          {result.moved ? ` · ${result.moved} moved to another shop` : ''}
          {result.skipped ? ` · ${result.skipped} skipped (already imported)` : ''}
          {result.invalid ? ` · ${result.invalid} left out (fix and run the range again)` : ''}
          {result.flagged ? (
            <Link to="/customer-search?view=review" className="font-medium underline">
              {result.flagged} need review
            </Link>
          ) : null}
          <Link to="/customer-search" className="ml-auto font-medium underline">See the register</Link>
        </section>
      )}

      {/* Step 3 — preview */}
      {preview && (
        <>
          <div className="mb-4 flex flex-wrap gap-3">
            <StatChip label="Ready to import" value={preview.summary.new} tone="success" />
            <StatChip label="…of which need review" value={preview.summary.flagged} tone={preview.summary.flagged ? 'warning' : 'neutral'} />
            <StatChip label="Already imported" value={preview.summary.exists} tone="neutral" />
            <StatChip label="Move to another shop" value={preview.summary.move} tone={preview.summary.move ? 'warning' : 'neutral'} />
            <StatChip label="Can't import" value={preview.summary.invalid} tone={preview.summary.invalid ? 'danger' : 'neutral'} />
            <StatChip label="Mobiles with several names" value={preview.summary.groups} tone={preview.summary.groupsNeedingReview ? 'warning' : 'neutral'} />
            <StatChip label="Product types not in the app" value={preview.summary.newProductTypes} tone={preview.summary.newProductTypes ? 'warning' : 'neutral'} />
          </div>

          {/* The same button as at the bottom, so a long preview needn't be scrolled through. */}
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-card p-3">
            <p className="text-sm text-muted-foreground">
              {stale
                ? 'You fixed rows below — check again before importing.'
                : preview.summary.new + preview.summary.move === 0
                  ? 'Nothing new to import in this range.'
                  : `${preview.summary.flagged > 0 ? `${preview.summary.flagged.toLocaleString('en-IN')} will be listed under Needs review. ` : ''}Product type and name choices below are pre-filled; change any you disagree with, or import as they are.`}
            </p>
            {importButton}
          </div>

          {preview.productTypes.length > 0 && (
            <ProductTypesCard
              types={preview.productTypes}
              topLevel={preview.topLevelTypes}
              decisions={typeDecisions}
              canCreate={canCreateTypes}
              onChange={(key, decision) => setTypeDecisions((d) => ({ ...d, [key]: decision }))}
            />
          )}

          {preview.groups.length > 0 && (
            <section className="mb-4">
              <h2 className="mb-1 flex items-center gap-2 text-base font-semibold">
                <Users className="h-4 w-4" /> Names on the same mobile
              </h2>
              <p className="mb-3 text-sm text-muted-foreground">
                Decide who is the same person and which spelling to keep. Suggestions are pre-filled
                {preview.summary.aiUsed
                  ? ' (with AI help on close spellings)'
                  : preview.summary.aiFailed
                    ? " from spelling similarity (AI didn't answer this time)"
                    : preview.summary.aiAvailable
                      ? ''
                      : ' from spelling similarity (AI is not set up)'}.
              </p>
              <div className="grid gap-3 xl:grid-cols-2">
                {reviewGroups.map((g) => (
                  <NameGroupCard
                    key={g.mobile}
                    group={g}
                    resolution={resolutions[g.mobile] ?? g.suggestion}
                    onChange={(res) => setResolutions((r) => ({ ...r, [g.mobile]: res }))}
                  />
                ))}
              </div>
              {otherGroups.length > 0 && (
                <details className="mt-3">
                  <summary className="cursor-pointer text-sm text-muted-foreground">
                    {otherGroups.length} mobile{otherGroups.length === 1 ? '' : 's'} with plainly different names (kept as separate people)
                  </summary>
                  <div className="mt-3 grid gap-3 xl:grid-cols-2">
                    {otherGroups.map((g) => (
                      <NameGroupCard
                        key={g.mobile}
                        group={g}
                        resolution={resolutions[g.mobile] ?? g.suggestion}
                        onChange={(res) => setResolutions((r) => ({ ...r, [g.mobile]: res }))}
                      />
                    ))}
                  </div>
                </details>
              )}
            </section>
          )}

          <section className="mb-4 rounded-lg border bg-card">
            <div className="flex flex-wrap items-center gap-2 border-b p-3">
              {(
                [
                  ['problems', 'Problems'],
                  ['all', 'All'],
                  ['new', 'Ready'],
                  ['move', 'Moves shop'],
                  ['exists', 'Already imported'],
                  ['invalid', "Can't import"],
                ] as Array<[RowFilter, string]>
              ).map(([key, label]) => (
                <Button
                  key={key}
                  size="sm"
                  variant={filter === key ? 'default' : 'ghost'}
                  onClick={() => {
                    setFilter(key);
                    setShown(PREVIEW_PAGE);
                  }}
                >
                  {label}
                </Button>
              ))}
              {stale && (
                <span className="ml-auto inline-flex items-center gap-1 text-xs text-warning">
                  <AlertTriangle className="h-3.5 w-3.5" /> You fixed rows — check again before importing
                </span>
              )}
            </div>
            <div className="max-h-[60vh] overflow-auto">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-muted text-left text-xs text-muted-foreground">
                  <tr>
                    <th className="px-2 py-2 font-medium">#</th>
                    <th className="px-2 py-2 font-medium">Account Number</th>
                    <th className="px-2 py-2 font-medium">Customer</th>
                    <th className="px-2 py-2 font-medium">Mobile</th>
                    <th className="px-2 py-2 font-medium">Purchase date</th>
                    <th className="px-2 py-2 font-medium">Co-applicant</th>
                    <th className="px-2 py-2 font-medium">Item</th>
                    <th className="px-2 py-2 font-medium">Shop</th>
                    <th className="px-2 py-2 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleRows.slice(0, shown).map((r) => (
                    <PreviewRow key={r.recordNo} row={r} edit={edits[r.recordNo]} onEdit={editRow} />
                  ))}
                  {visibleRows.length === 0 && (
                    <tr>
                      <td colSpan={9} className="px-3 py-6 text-center text-muted-foreground">Nothing to show here.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            {visibleRows.length > shown && (
              <div className="flex flex-wrap items-center justify-center gap-3 border-t p-3 text-sm text-muted-foreground">
                Showing {shown.toLocaleString('en-IN')} of {visibleRows.length.toLocaleString('en-IN')} rows
                <Button size="sm" variant="secondary" onClick={() => setShown((n) => n + PREVIEW_PAGE)}>
                  Show {Math.min(PREVIEW_PAGE, visibleRows.length - shown)} more
                </Button>
              </div>
            )}
          </section>

          <div className="flex flex-wrap items-center justify-end gap-3">
            {preview.summary.invalid > 0 && (
              <span className="text-sm text-muted-foreground">
                {preview.summary.invalid} row{preview.summary.invalid === 1 ? '' : 's'} can't be imported (unknown shop); fix the Shop and run the range again.
              </span>
            )}
            {preview.summary.flagged > 0 && (
              <span className="text-sm text-muted-foreground">
                {preview.summary.flagged} will be imported and listed under Needs review.
              </span>
            )}
            {importButton}
          </div>
        </>
      )}

      {(batches.data ?? []).length > 0 && (
        <section className="mt-8">
          <h2 className="mb-2 text-base font-semibold">Past imports</h2>
          <div className="overflow-x-auto rounded-lg border bg-card">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 font-medium">When</th>
                  <th className="px-3 py-2 font-medium">File</th>
                  <th className="px-3 py-2 font-medium">Records</th>
                  <th className="px-3 py-2 font-medium">Imported</th>
                  <th className="px-3 py-2 font-medium">Need review</th>
                  <th className="px-3 py-2 font-medium">Moved</th>
                  <th className="px-3 py-2 font-medium">Skipped</th>
                  <th className="px-3 py-2 font-medium">Left out</th>
                  <th className="px-3 py-2 font-medium">New customers</th>
                  <th className="px-3 py-2 font-medium" title="Shop used for rows with no Shop">Default shop</th>
                  <th className="px-3 py-2 font-medium">By</th>
                </tr>
              </thead>
              <tbody>
                {batches.data!.map((b) => (
                  <tr key={b.id} className="border-t">
                    <td className="whitespace-nowrap px-3 py-2">{new Date(b.createdAt).toLocaleString('en-IN')}</td>
                    <td className="px-3 py-2">{b.fileName}</td>
                    <td className="px-3 py-2 tabular-nums">{b.rowFrom}–{b.rowTo}</td>
                    <td className="px-3 py-2 tabular-nums">{b.inserted}</td>
                    <td className="px-3 py-2 tabular-nums">{b.flagged}</td>
                    <td className="px-3 py-2 tabular-nums">{b.moved}</td>
                    <td className="px-3 py-2 tabular-nums">{b.skipped}</td>
                    <td className="px-3 py-2 tabular-nums">{b.invalid}</td>
                    <td className="px-3 py-2 tabular-nums">{b.customersCreated}</td>
                    <td className="px-3 py-2">{b.shop.code}</td>
                    <td className="px-3 py-2">{b.creator?.fullName ?? '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}

function PreviewRow({
  row,
  edit,
  onEdit,
}: {
  row: ImportPreviewRow;
  edit: Partial<RegisterSheetRow> | undefined;
  onEdit: (recordNo: number, field: EditableField, value: string) => void;
}) {
  const invalid = row.status === 'invalid';
  // Rows that can't be imported, or will be imported with problems, can be fixed here first.
  const editable = invalid || (row.status === 'new' && row.issues.length > 0);
  const cell = (field: EditableField, className = 'w-32') =>
    editable ? (
      <input
        value={(edit?.[field] as string | undefined) ?? row[field]}
        onChange={(e) => onEdit(row.recordNo, field, e.target.value)}
        className={cn('h-7 rounded border bg-field px-1.5 text-xs', className)}
      />
    ) : (
      <span>{row[field] || '-'}</span>
    );
  const person = row.customer;
  return (
    <tr className={cn('border-t align-top', invalid && 'bg-destructive/5', !invalid && row.issues.length > 0 && 'bg-warning/5')}>
      <td className="px-2 py-1.5 text-xs text-muted-foreground" title={`Sheet row ${row.sheetRow}`}>{row.recordNo}</td>
      <td className="px-2 py-1.5 font-mono text-xs">{cell('accountNumber', 'w-24')}</td>
      <td className="px-2 py-1.5">
        {cell('customerName', 'w-40')}
        {person && (
          <div className="mt-0.5 text-xs">
            {person.kind === 'existing' ? (
              <span className="text-primary">Links to {person.customerCode}</span>
            ) : person.kind === 'group' ? (
              <span className="text-warning">See names on this mobile</span>
            ) : (
              <span className="text-muted-foreground">New customer</span>
            )}
          </div>
        )}
      </td>
      <td className="px-2 py-1.5 tabular-nums">{cell('mobile', 'w-28')}</td>
      <td className="px-2 py-1.5">{cell('purchaseDate', 'w-28')}</td>
      <td className="px-2 py-1.5">
        {row.coName || '-'}
        {(row.coMobile || editable) && <div className="text-xs text-muted-foreground">{cell('coMobile', 'w-28')}</div>}
      </td>
      <td className="px-2 py-1.5 text-xs">{[row.product, row.brand, row.model].filter(Boolean).join(' · ') || '-'}</td>
      <td className="px-2 py-1.5 text-xs">
        {invalid ? cell('shop', 'w-28') : row.moveFrom ? `${row.moveFrom} → ${row.shopCode}` : row.shopCode ?? '-'}
      </td>
      <td className="px-2 py-1.5">
        <Badge tone={row.status === 'new' ? (row.issues.length ? 'warning' : 'success') : row.status === 'exists' ? 'neutral' : row.status === 'move' ? 'info' : 'danger'}>
          {row.status === 'new'
            ? row.issues.length
              ? 'Ready, needs review'
              : 'Ready'
            : row.status === 'exists'
              ? 'Already imported'
              : row.status === 'move'
                ? 'Moves shop'
                : "Can't import"}
        </Badge>
        {[...row.errors, ...row.warnings].map((m) => (
          <p key={m} className={cn('mt-0.5 max-w-xs text-xs', row.errors.includes(m) ? 'text-destructive' : 'text-warning')}>{m}</p>
        ))}
      </td>
    </tr>
  );
}
