# Dev logins (local database only)

> **Local development only.** These accounts exist only in the seeded local
> database. Never use these passwords on a live server. Before going live,
> every real user must get their own strong password.

- **Password for every account below:** `1234`
- Checked against the local database on 2026-10-06: all 51 accounts (42 Vinod
  Electronics + 9 Star Electronics) are active and `1234` works for each.

## Two tenants — log in at the tenant's own address

Each business (tenant) has its own address, and its usernames only work
there. A Vinod Electronics login is refused at the Star Electronics address
and the other way round.

| Tenant | Local address | Live address (when hosted) | Plan | Shops | Users |
|---|---|---|---|---|---|
| **Vinod Electronics** | http://localhost:5174 (or http://vn.localhost:5174) | vn.retailerp.com | Enterprise — every module | 4 | 42 |
| **Star Electronics** | http://star.localhost:5174 | star.retailerp.com | Standard — no Bank Statements, OCR, mobile app, push notifications, sale approvals or year-on-year reports | 2 | 9 |

If the database is re-seeded, passwords go back to the seed default
`RetailERP@2026`. To set every account in both tenants to `1234` again:

```bash
cd apps/api
npx tsx scripts/set-dev-password.ts
```

Star Electronics is created by its own script (it refuses to run twice):

```bash
cd apps/api
npx tsx prisma/seed/star-electronics.seed.ts
```

**What each role can do** is set in Settings → Roles & Users and can be
changed per role or per user. The descriptions below are the defaults.

---

# Tenant 1 — Vinod Electronics

Address: http://localhost:5174

Shop codes: **VE** Vinod Electronics · **VHA** Vinod Home Appliances ·
**NE** Naveen Electronics · **NHE** New Harshita Electronics

## Owners (full access, all 4 shops)

| Username | Name | Password |
|---|---|---|
| `vinod_owner` | Vinod Sharma | `1234` |
| `nishant_owner` | Nishant Sharma | `1234` |

## Admins (full access; home shop first, can switch to all 4)

| Username | Name | Shops | Password |
|---|---|---|---|
| `ve_admin1` | Vinod Electronics Admin 1 | VE, NE, VHA, NHE | `1234` |
| `ve_admin2` | Vinod Electronics Admin 2 | VE, NE, VHA, NHE | `1234` |
| `vha_admin1` | Vinod Home Appliances Admin 1 | VHA, VE, NE, NHE | `1234` |
| `vha_admin2` | Vinod Home Appliances Admin 2 | VHA, VE, NE, NHE | `1234` |
| `ne_admin1` | Naveen Electronics Admin 1 | NE, VE, VHA, NHE | `1234` |
| `ne_admin2` | Naveen Electronics Admin 2 | NE, VE, VHA, NHE | `1234` |
| `nhe_admin1` | New Harshita Electronics Admin 1 | NHE, VE, NE, VHA | `1234` |
| `nhe_admin2` | New Harshita Electronics Admin 2 | NHE, VE, NE, VHA | `1234` |

## Accountants (no dashboard, users or transfers; can switch to all 4 shops)

| Username | Name | Shops | Password |
|---|---|---|---|
| `ve_acc1` | Vinod Electronics Accountant 1 | VE, NE, VHA, NHE | `1234` |
| `ve_acc2` | Vinod Electronics Accountant 2 | VE, NE, VHA, NHE | `1234` |
| `ve_acc3` | Vinod Electronics Accountant 3 | VE, NE, VHA, NHE | `1234` |
| `vha_acc1` | Vinod Home Appliances Accountant 1 | VHA, VE, NE, NHE | `1234` |
| `vha_acc2` | Vinod Home Appliances Accountant 2 | VHA, VE, NE, NHE | `1234` |
| `vha_acc3` | Vinod Home Appliances Accountant 3 | VHA, VE, NE, NHE | `1234` |
| `ne_acc1` | Naveen Electronics Accountant 1 | NE, VE, VHA, NHE | `1234` |
| `ne_acc2` | Naveen Electronics Accountant 2 | NE, VE, VHA, NHE | `1234` |
| `ne_acc3` | Naveen Electronics Accountant 3 | NE, VE, VHA, NHE | `1234` |
| `nhe_acc1` | New Harshita Electronics Accountant 1 | NHE, VE, NE, VHA | `1234` |
| `nhe_acc2` | New Harshita Electronics Accountant 2 | NHE, VE, NE, VHA | `1234` |
| `nhe_acc3` | New Harshita Electronics Accountant 3 | NHE, VE, NE, VHA | `1234` |

## Staff — "Others" role (own shop only; no dashboard, installments or cost prices; self-finance sales show as cash sales)

| Username | Name | Shop | Password |
|---|---|---|---|
| `ve_staff1` | Vinod Electronics Staff 1 | VE | `1234` |
| `ve_staff2` | Vinod Electronics Staff 2 | VE | `1234` |
| `vha_staff1` | Vinod Home Appliances Staff 1 | VHA | `1234` |
| `vha_staff2` | Vinod Home Appliances Staff 2 | VHA | `1234` |
| `ne_staff1` | Naveen Electronics Staff 1 | NE | `1234` |
| `ne_staff2` | Naveen Electronics Staff 2 | NE | `1234` |
| `nhe_staff1` | New Harshita Electronics Staff 1 | NHE | `1234` |
| `nhe_staff2` | New Harshita Electronics Staff 2 | NHE | `1234` |

## Employees (installment collectors — mobile app only)

The web app turns these accounts away with "Please use the mobile app".

| Username | Name | Shop | Password |
|---|---|---|---|
| `ve_emp1` | Vinod Electronics Employee 1 | VE | `1234` |
| `ve_emp2` | Vinod Electronics Employee 2 | VE | `1234` |
| `ve_emp3` | Vinod Electronics Employee 3 | VE | `1234` |
| `vha_emp1` | Vinod Home Appliances Employee 1 | VHA | `1234` |
| `vha_emp2` | Vinod Home Appliances Employee 2 | VHA | `1234` |
| `vha_emp3` | Vinod Home Appliances Employee 3 | VHA | `1234` |
| `ne_emp1` | Naveen Electronics Employee 1 | NE | `1234` |
| `ne_emp2` | Naveen Electronics Employee 2 | NE | `1234` |
| `ne_emp3` | Naveen Electronics Employee 3 | NE | `1234` |
| `nhe_emp1` | New Harshita Electronics Employee 1 | NHE | `1234` |
| `nhe_emp2` | New Harshita Electronics Employee 2 | NHE | `1234` |
| `nhe_emp3` | New Harshita Electronics Employee 3 | NHE | `1234` |

---

# Tenant 2 — Star Electronics (demo tenant)

Address: **http://star.localhost:5174** — these logins don't work at
http://localhost:5174.

Sample data: 2 suppliers, 2 purchases (10 units), 8 customers, 5 sales
(2 cash, 1 Bajaj Finance, 2 self-finance with some EMIs collected) and
3 expenses — enough to check that neither tenant sees the other's records.

Shop codes: **SE** Star Electronics · **SM** Star Mobiles (both in Lucknow)

## Owner (full access, both shops — within the Standard plan)

| Username | Name | Password |
|---|---|---|
| `star_owner` | Ravi Agarwal | `1234` |

## Admins (home shop first, can switch to both)

| Username | Name | Shops | Password |
|---|---|---|---|
| `se_admin1` | Star Electronics Admin | SE, SM | `1234` |
| `sm_admin1` | Star Mobiles Admin | SM, SE | `1234` |

## Accountants (can switch to both shops)

| Username | Name | Shops | Password |
|---|---|---|---|
| `se_acc1` | Star Electronics Accountant | SE, SM | `1234` |
| `sm_acc1` | Star Mobiles Accountant | SM, SE | `1234` |

## Staff — "Others" role (own shop only; self-finance sales show as cash sales)

| Username | Name | Shop | Password |
|---|---|---|---|
| `se_staff1` | Star Electronics Staff | SE | `1234` |
| `sm_staff1` | Star Mobiles Staff | SM | `1234` |

## Employees (installment collectors — mobile app only)

The web app turns these accounts away with "Please use the mobile app".
Star's plan doesn't include the mobile app, which hides employee management
for Star's managers — but these collector logins still work against the API
for installment collection.

| Username | Name | Shop | Password |
|---|---|---|---|
| `se_emp1` | Star Electronics Collector | SE | `1234` |
| `sm_emp1` | Star Mobiles Collector | SM | `1234` |

---

## Platform admin (SaaS operator console) — not created yet

This is where tenants are onboarded and their features switched on or off.

The local database has **no** platform admin account yet. The console is a
separate login at http://admin.localhost:5174. To create the account:

```bash
cd apps/api
npx tsx prisma/seed/bootstrap-platform-admin.ts
```

| Username | Email | Password |
|---|---|---|
| `platform_admin` | admin@retailerp.com | `PlatformAdmin@2026` (or `1234` after running `set-dev-password.ts` again) |
