# Bank Statements — Review queue

## Purpose and scope

**Review queue** (`/bank/review`) lets authorized reviewers inspect transactions the analyzer
could not confidently explain, verify them, mark suspicious or reopen them. Review is an
analysis decision, **not** expense approval, bank settlement or supplier-payment authorization.
See [Upload](bank-upload.md) for parsing and [Rules](bank-rules.md) for category/policy inputs.

## Implementation status

| Surface | Status | Evidence / limits |
|---|---|---|
| API | Implemented | Computed flags, filtered row reads and category/review patching; not a separate case-management API. |
| Web | Implemented, bounded queue | Three status tabs, reason/statement filters, reviewer notes, keyboard review; first 200 results only. |
| Flutter | Planned only | Touch-first review and authorized transaction actions proposed toward eventual full authorized web parity. |

Reviewed **2026-11-10**, source-reviewed, **not runtime-certified**. No fraud detection or
financial reconciliation guarantee follows from an anomaly flag or “verified” label.

## Business rules and invariants

Flagging reads the **whole shop** and tenant settings, not just the current on-screen date
range. It can change other visible rows after import, category edits, deletion or policy updates.
Current reasons include:

- Uncategorized; confidence below policy threshold except human/user-rule categories;
  AI notes beginning with `⚠`.
- Large amounts to new/occasional payees (default threshold ₹100,000). Payees with at least
  three rows are recurring; large recurring payments can instead trigger a spike over three
  times their median, subject to the source minimum amount.
- Category/direction statistical outliers (at least eight rows, above mean plus four standard
  deviations and a minimum amount); large cash withdrawals (default ₹20,000).
- First-time personal transfers (default ₹5,000); large round debit transfers of at least
  ₹50,000 divisible by ₹10,000 in designated transfer/cash/uncategorized categories.
- Possible duplicates from another statement: narration/day/amount and earlier-copy
  account/file/balance comparisons. The earliest copy stays clean; later copies can name
  the earlier file/shop. This warns; it neither deletes nor removes a row from totals.

Review state is `pending`, `verified`, `suspicious` or null. Reflagging creates pending for
newly flagged/null-state rows, clears pending when no flags remain, and **preserves human
verified/suspicious decisions**. Category edits are marked source `user`, confidence 1.
Review decisions do not remove flag reasons, post accounting entries, or notify a collector.

The server stamps the signed-in user's full name (username fallback), not an arbitrary supplied
reviewer identity. Verified/suspicious sets time/name; pending/null clears that attribution.
Notes may be null or up to 1,000 characters; this is current-row metadata, not an append-only
audit history of every review.

## Access, tenancy, and shop scope

Shared [bank scope](bank-overview.md) applies: `bank.reconciliation`, tenant identity and current
or accessible All Shops set. Rail needs `nav.bank`; route/read needs `bank.view`.
Review/category/note/supplier-choice patches need `bank.reconcile`; read-only users can
inspect the queue but cannot decide.

Supplier payment recording in the review panel is independently guarded by `bank.view`,
`purchases.record_payment` and the `purchases` feature, not by review status. Row deletion
needs `bank.delete_statement` and sometimes purchase-payment permission; see
[Transactions](bank-transactions.md).

## User workflows

1. Open Needs review, optionally narrow global dates/shops, reason or linked statement.
2. Select a row; inspect narration, amount, category source/confidence, reasons and supplier.
3. Correct category if necessary, add a team note and Verify or mark Suspicious.
   The pending list refreshes and selection advances to a valid remaining row.
4. Inspect previously verified/suspicious tabs or reopen a decision.
   Open the shared drawer for detailed actions; supplier accounting remains an explicit step.
5. Read-only users inspect without mutation controls; request errors appear as mutation toasts.

## API contracts and data

Prefix `/api/v1/bank-statements`; JSON success envelope wraps results.

| Method | Path | Contract |
|---|---|---|
| GET | `/transactions` | `bank.view`; shared filters plus pagination/sort; review page uses `review`, `reason`, statementIds, `sort=abs&dir=desc&pageSize=200` |
| GET | `/transactions/:id` | `bank.view`; scoped row details |
| GET | `/analytics` | `bank.view`; review totals and pending reason counts |
| PATCH | `/transactions/:id` | `bank.reconcile`; category, nullable review_status/reviewer_note, nullable distributor_id |
| POST | `/transactions/bulk` | `bank.reconcile`; same patch plus 1–5,000 UUID `ids`; Transactions surface uses it |

Shared filters and response paging are detailed in [Transactions](bank-transactions.md).
`review=none` selects null state. Single-row missing/out-of-scope detail is 404.
An empty patch returns 400. Bulk updates only scoped matching rows and report actual count,
not an all-IDs-must-exist contract. Updating category recomputes flags; changing note/status
alone does not.

## Web behavior

Tabs are URL `tab=pending|verified|suspicious` (pending default); `reason` and `statementIds`
are URL filters. Global shop/date filters come from BankLayout.
The queue asks for **200 largest absolute-value rows without pagination/load-more UI**.
The badge requests pending count separately across header shop scope, not the current bank
date/reason filter. Progress uses global analytics scope, not necessarily the reason/statement
subset of the queue.

Keyboard shortcuts: J/K or arrow keys move, V verifies, S marks suspicious. Shortcuts avoid
form inputs, modified keypresses and open overlays. “Skip” advances local selection without
changing server review state. Mobile web may present detail responsively, but that is not Flutter.

## Mobile behavior and differences

Flutter is approved and planned only. Proposed workflows are scoped pending/status tabs,
reason filtering, detail inspection, category correction, notes and authorized decisions,
with touch controls instead of desktop keyboard shortcuts. Eventual full authorized web parity
also includes the linked drawer/accounting workflows, staged as needed.
Expo is legacy; offline review, push notification delivery and background synchronization
are not assumed implemented or decided.

## Dependencies and cross-feature effects

- [Rules](bank-rules.md) changes categories/thresholds for existing rows; [Upload](bank-upload.md)
  and [Statements](bank-statements.md) trigger/retrigger flag computation.
- [Transactions](bank-transactions.md) owns supplier-payment posting and destructive undo;
  a review decision alone does neither.
- [Overview](bank-overview.md) and the rail badge depend on review query invalidation.
  Any new reason/status requires synchronized engine, validation, UI labels, filters and exports.

## Code and source references

- [Flag engine](../../apps/api/src/modules/bank-statements/engine/categorize/flags.ts),
  [defaults](../../apps/api/src/modules/bank-statements/engine/db.ts),
  [patch/analytics service](../../apps/api/src/modules/bank-statements/bank-statements.service.ts),
  [controller reviewer stamping](../../apps/api/src/modules/bank-statements/bank-statements.controller.ts),
  [routes](../../apps/api/src/modules/bank-statements/bank-statements.routes.ts),
  [validation](../../apps/api/src/modules/bank-statements/bank-statements.validation.ts).
- [Review page](../../apps/web/src/pages/bank/BankReviewPage.tsx),
  [drawer](../../apps/web/src/pages/bank/components/TransactionDrawer.tsx),
  [badge](../../apps/web/src/pages/bank/components/BankReviewCount.tsx),
  [reason/status labels](../../apps/web/src/pages/bank/components/domain.tsx),
  [queries](../../apps/web/src/pages/bank/lib/queries.ts),
  [routes](../../apps/web/src/App.tsx); [context notes](../CONTEXT.md).

## Verification and acceptance

Source review only; no runtime/tests executed. Existing
[upload integration tests](../../apps/api/tests/integration/bank-statement-upload.test.ts)
include duplicate flags across shops, not the entire reviewer UI or policy matrix.
Acceptance must cover each reason, recurring-versus-new payee behavior, preserving human
decisions across reflags, clearing obsolete pending flags, attribution, note limits, keyboard
overlay safety, read-only permissions, two-tenant/shop isolation and queues above 200 rows.

## Known gaps and next work

- Queue UI omits paging beyond the first 200 results; counts can exceed actionable visible rows.
- Notes/reviewer fields are overwritten, not versioned case history. No assignment/escalation
  or notification delivery is implemented in this workflow.
- Statistical/AI flags can be false positives; flags and verified state do not certify legality,
  correctness or ERP reconciliation.
- Progress denominators can diverge from preserved human decision counts and local filters.
  Agree semantics before presenting it as completion certification.

## Decisions and review checkpoint

Checkpoint **2026-11-10**, source-reviewed only. Review remains distinct from bank matching,
expense approval and supplier posting. Flutter parity is approved direction, not delivered code.
No checkpoint inventory/hashes were modified in this documentation-only task.
