# Feature context index

This is the coordinator's entry point. Agents load [AGENTS.md](../../AGENTS.md), this index,
then only the relevant feature documents and dependencies. Humans do not need to assemble
context manually. See the [maintenance workflow](../FEATURE_CONTEXT_WORKFLOW.md) and
[standard shape](_template.md).

## Status vocabulary

- **Source-reviewed** means current source was inspected; it does not mean every workflow passed
  runtime tests or that the feature is complete.
- **Legacy Expo** is the existing collection app, not the approved mobile target.
- **Flutter planned** means not implemented yet. Eventual parity applies only to capabilities
  the signed-in user and tenant are authorized to use.
- Monitored-source hashes, review timestamps and Git baselines live in
  [checkpoints.json](checkpoints.json). Run `npm run docs:status` to find drift.

The manifest includes broad shared roots conservatively: a checkpoint records their fingerprints,
not a claim that every line or every runtime path was examined.

## Left-rail features

One document per rail item, including all six Bank Statements items. Nested screens belong
with their parent feature. Settings documents its tabs; OCR belongs with purchases/sales.

| Rail group | Feature document | Web entry | Mobile direction |
|---|---|---|---|
| Overview | [Dashboard](dashboard.md) | `/dashboard` | Flutter planned |
| Inventory | [Products](products.md) | `/products` | Flutter planned |
| Inventory | [Purchases](purchases.md) | `/purchases` | Flutter planned |
| Inventory | [Distributors](distributors.md) | `/distributors` | Flutter planned |
| Inventory | [Transfers](transfers.md) | `/transfers` | Flutter planned |
| Revenue | [Sales](sales.md) | `/sales` | Flutter planned |
| Revenue | [Installments](installment.md) | `/installments` | Flutter planned; legacy Expo collections exist |
| Revenue | [Customers](customers.md) | `/customers` | Flutter planned |
| Revenue | [Customer Searching](customer-searching.md) | `/customer-search` | **Flutter first release implemented** (Android-verified): cached search/details + online create/edit |
| Finance | [Expenses](expenses.md) | `/expenses` | Flutter planned |
| Bank Statements | [Overview](bank-overview.md) | `/bank` | Flutter planned |
| Bank Statements | [Upload](bank-upload.md) | `/bank/upload` | Flutter planned |
| Bank Statements | [Review queue](bank-review.md) | `/bank/review` | Flutter planned |
| Bank Statements | [Transactions](bank-transactions.md) | `/bank/transactions` | Flutter planned |
| Bank Statements | [Statements](bank-statements.md) | `/bank/statements` | Flutter planned |
| Bank Statements | [Rules & settings](bank-rules.md) | `/bank/rules` | Flutter planned |
| Administration | [Employees](employees.md) | `/employees` | Flutter planned |
| Administration | [Settings](settings.md) | `/settings` | Flutter planned |

## Supporting capabilities

These are not tenant left-rail items, but feature work depends on them.

| Capability | Context |
|---|---|
| Identity, tenancy, shops, permissions | [Authentication and access](authentication-and-access.md) |
| In-app messages and device notifications | [Notifications](notifications.md) |
| Separate SaaS operator console | [Platform administration](platform-administration.md) |
| Flutter architecture and staged parity | [Mobile foundation](mobile-foundation.md) |
| Hosting, CI/CD, secrets, APK signing and shop-test releases | [Deployment and release](deployment-and-release.md) |

Shared Flutter shell/login/session infrastructure now exists in
[apps/mobile-flutter](../../apps/mobile-flutter/README.md). "Flutter planned" above refers to each
business feature's screens/workflows, not an absent app scaffold.

## Coordination rules

1. Select the workflow and feature, not a platform-wide rewrite. Follow dependencies before
   changing shared APIs, schemas, permissions or sync.
2. Keep this index small. Detailed rules and gaps belong in the owning feature document.
3. Keep architectural decisions in ADRs; link them instead of copying competing specifications.
4. Finish feature work with source verification, doc refresh, a checkpoint, and a short handoff.
5. Parallel coding chats need isolated worktrees and coordination for shared files. A separate
   chat alone does not isolate a working tree or synchronize another chat.

## Current next slice

Flutter Customer Searching (first release) is implemented and measured on Android; see its
[feature doc](customer-searching.md) and the [handoff](../mobile/customer-searching-handoff.md)
for the remaining checklist (background run observed on a device, Wi-Fi/release timings, iOS,
notifications, API compression decision). The next business module should follow its
cache/sync pattern inside the existing Flutter app; do not create a second app, login flow or
session store. ERP is authoritative; Google Sheets is import-only.
