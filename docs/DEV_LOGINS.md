# Dev logins (local database only)

> **Local development only.** These accounts exist only in the seeded local
> database. Never use these passwords on a live server. Before going live,
> every real user must get their own strong password.

- **App:** http://localhost:5174
- **Password for every account below:** `1234`
- Checked against the local database on 2026-10-04: all 42 accounts are active and `1234` works for each.

If the database is re-seeded, passwords go back to the seed default
`RetailERP@2026`. To set them all to `1234` again:

```bash
cd apps/api
npx tsx scripts/set-dev-password.ts
```

Shop codes: **VE** Vinod Electronics · **VHA** Vinod Home Appliances ·
**NE** Naveen Electronics · **NHE** New Harshita Electronics

---

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

## Accountants (no dashboard; can switch to all 4 shops)

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

## Staff — "Others" role (own shop only; no dashboard or installments; sees cash-only sales)

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

## Platform admin (SaaS operator console) — not created yet

The local database has **no** platform admin account yet. The console is a
separate login at http://admin.localhost:5174. To create the account:

```bash
cd apps/api
npx tsx prisma/seed/bootstrap-platform-admin.ts
```

| Username | Email | Password |
|---|---|---|
| `platform_admin` | admin@retailerp.com | `PlatformAdmin@2026` (or `1234` after running `set-dev-password.ts` again) |
