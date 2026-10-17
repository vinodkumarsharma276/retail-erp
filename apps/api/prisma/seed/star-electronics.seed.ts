/**
 * Second demo tenant: **Star Electronics** (subdomain `star`), used to prove
 * tenants never see each other's data.
 *
 * Builds its data through the app's own services (purchases, sales,
 * installment payments) inside a tenant context, so rows are created
 * exactly as the screens would create them.
 *
 * Usage (once; refuses to run if the tenant already exists):
 *   cd apps/api
 *   npx tsx prisma/seed/star-electronics.seed.ts
 *
 * Every user's password is `1234` (local dev only).
 */
import bcrypt from 'bcryptjs';
import { ALL_FEATURE_KEYS, FeatureKey } from '@retailerp/shared-types';
import { prisma, unscopedPrisma } from '../../src/config/database.js';
import { tenantContext } from '../../src/config/tenant-context.js';
import { purchasesService } from '../../src/modules/purchases/purchases.service.js';
import { salesService } from '../../src/modules/sales/sales.service.js';
import { recordPayment } from '../../src/modules/installments/installments.engine.js';
import { seedRolesAndPermissions } from './roles-permissions.seed';
import { seedCategories } from './categories.seed';
import { seedFormDefinitions } from './form-definitions.seed';
import { seedFinanceCompanies } from './finance-companies.seed';

const SLUG = 'star';
const PASSWORD = '1234';

/** "Standard" plan: everything except the add-ons Star hasn't bought. */
const STANDARD_OFF = new Set<string>([
  FeatureKey.BANK_RECONCILIATION,
  FeatureKey.BANK_STATEMENT_FILES,
  FeatureKey.BANK_API_FEEDS,
  FeatureKey.OCR_INVOICE_PARSING,
  FeatureKey.PUSH_NOTIFICATIONS,
  FeatureKey.MOBILE_APP,
  FeatureKey.SALE_APPROVAL_WORKFLOW,
  FeatureKey.YOY_REPORTING,
]);

async function ensureStandardPlan() {
  const plan = await unscopedPrisma.plan.upsert({
    where: { code: 'standard' },
    update: {},
    create: {
      code: 'standard', name: 'Standard', description: 'Core modules, installments, expenses and transfers.',
      priceMonthly: 0, priceYearly: 0, isPublic: true, isActive: true,
    },
  });
  for (const featureKey of ALL_FEATURE_KEYS) {
    const limit = featureKey === FeatureKey.MAX_SHOPS ? { max: 3 } : featureKey === FeatureKey.MAX_USERS ? { max: 25 } : featureKey === FeatureKey.MAX_PRODUCTS ? { max: null } : null;
    await unscopedPrisma.planFeature.upsert({
      where: { planId_featureKey: { planId: plan.id, featureKey } },
      update: {},
      create: { planId: plan.id, featureKey, enabled: !STANDARD_OFF.has(featureKey), valueJson: limit as any },
    });
  }
  return plan;
}

/** Fill a category's required attributes with plausible values. */
function attributesFor(attrs: Array<{ attributeName: string; attributeType: string; options: unknown }>, n: number) {
  const out: Record<string, unknown> = {};
  for (const a of attrs) {
    const opts = a.options as unknown;
    if (Array.isArray(opts) && opts.length) out[a.attributeName] = String(opts[Math.min(1, opts.length - 1)]);
    else if (a.attributeName.toLowerCase().includes('imei')) out[a.attributeName] = [`35${String(700000000000 + n).padStart(13, '0')}`];
    else if (a.attributeType === 'number') out[a.attributeName] = 1;
    else out[a.attributeName] = 'NA';
  }
  return out;
}

async function main() {
  if (await unscopedPrisma.tenant.findUnique({ where: { slug: SLUG } })) {
    console.log(`Tenant "${SLUG}" already exists — nothing to do.`);
    return;
  }

  const plan = await ensureStandardPlan();
  const tenant = await unscopedPrisma.tenant.create({
    data: {
      slug: SLUG, name: 'Star Electronics', status: 'active', planId: plan.id,
      contactEmail: 'owner@starelectronics.example', contactPhone: '9415000000',
      settings: { installment: { defaultPenaltyPerDay: 2, defaultPaymentAllocation: 'oldest_first' } },
    },
  });
  const financeCompanies = await seedFinanceCompanies(unscopedPrisma); // shared master list

  await tenantContext.runAs(tenant.id, async () => {
    const tenantId = tenant.id;

    // --- Shops, roles, users ------------------------------------------------
    const shops = [
      await prisma.shop.create({ data: { tenantId, name: 'Star Electronics', code: 'SE', gstNumber: '09AAPCS1111K1Z2', panNumber: 'AAPCS1111K', addressLine1: '12 Aminabad Road', city: 'Lucknow', state: 'Uttar Pradesh', pincode: '226018', phone: '9415000001' } }),
      await prisma.shop.create({ data: { tenantId, name: 'Star Mobiles', code: 'SM', gstNumber: '09AAPCS2222K1Z3', panNumber: 'AAPCS2222K', addressLine1: '4 Hazratganj', city: 'Lucknow', state: 'Uttar Pradesh', pincode: '226001', phone: '9415000002' } }),
    ];
    await seedRolesAndPermissions(prisma as any, tenantId);
    const roles = Object.fromEntries((await prisma.role.findMany({ where: { tenantId } })).map((r) => [r.code, r.id]));
    const passwordHash = await bcrypt.hash(PASSWORD, 10);

    const mkUser = async (username: string, fullName: string, role: 'owner' | 'admin' | 'accountant' | 'others' | 'employee', shopList: typeof shops) => {
      const user = await prisma.user.create({
        data: { tenantId, username, passwordHash, fullName, phone: '94150' + String(Math.floor(Math.random() * 1e5)).padStart(5, '0'), role, roleId: roles[role] ?? null, isMobileOnly: role === 'employee' },
      });
      for (const [i, shop] of shopList.entries()) {
        await prisma.userShop.create({ data: { tenantId, userId: user.id, shopId: shop.id, isPrimary: i === 0 } });
      }
      return user;
    };
    const owner = await mkUser('star_owner', 'Ravi Agarwal (Owner)', 'owner', shops);
    for (const shop of shops) {
      const p = shop.code.toLowerCase();
      await mkUser(`${p}_admin1`, `${shop.name} Admin`, 'admin', [shop, ...shops.filter((s) => s !== shop)]);
      await mkUser(`${p}_acc1`, `${shop.name} Accountant`, 'accountant', [shop, ...shops.filter((s) => s !== shop)]);
      await mkUser(`${p}_staff1`, `${shop.name} Staff`, 'others', [shop]);
      await mkUser(`${p}_emp1`, `${shop.name} Collector`, 'employee', [shop]);
    }

    // --- Catalogue and forms ------------------------------------------------
    await seedCategories(prisma as any, tenantId);
    await seedFormDefinitions(prisma as any, tenantId);
    const leaf = async (slug: string) => {
      const c = await prisma.productCategory.findFirstOrThrow({ where: { tenantId, slug, isLeaf: true }, include: { attributes: { where: { isRequired: true, isActive: true } } } });
      return c;
    };
    const [ledTv, fridge, washer, smartphone] = await Promise.all(['led-tv', 'double-door', 'front-load', 'smartphone'].map((s) => leaf(s).catch(() => null)));
    const fallback = await prisma.productCategory.findFirstOrThrow({ where: { tenantId, isLeaf: true }, include: { attributes: { where: { isRequired: true, isActive: true } } } });
    const cat = (c: typeof fallback | null) => c ?? fallback;

    // --- Suppliers ------------------------------------------------------------
    const distributor = (companyName: string, gst: string, phone: string) =>
      prisma.distributor.create({ data: { tenantId, companyName, contactPerson: companyName.split(' ')[0], phone, gstNumber: gst, addressLine1: 'Naka Hindola', city: 'Lucknow', state: 'Uttar Pradesh', pincode: '226001', createdBy: owner.id } });
    const awadh = await distributor('Awadh Electronics Distributors', '09AAACA5555B1Z9', '9839011111');
    const gomti = await distributor('Gomti Mobile Traders', '09AAACG6666C1Z8', '9839022222');

    // --- Purchases (through the purchase service) ------------------------------
    let unit = 0;
    const item = (c: typeof fallback, brand: string, modelNumber: string, purchasePrice: number, mrp: number) => {
      unit += 1;
      return { categoryId: c.id, brand, modelNumber, purchasePrice, mrp, sellingPrice: mrp - 500, dynamicAttributes: attributesFor(c.attributes as any, unit) };
    };
    const se = shops[0];
    const sm = shops[1];
    const p1 = await purchasesService.create(se.id, tenantId, {
      distributorId: awadh.id, invoiceNumber: 'AED/26-27/101', invoiceDate: '2026-06-02', totalAmount: 0, gstAmount: 0,
      items: [
        item(cat(ledTv), 'Sony', 'KD-43X74K', 36000, 44990), item(cat(ledTv), 'Sony', 'KD-43X74K', 36000, 44990),
        item(cat(ledTv), 'LG', '43UR7500', 28000, 34990), item(cat(fridge), 'Samsung', 'RT34C4522', 31000, 38990),
        item(cat(washer), 'Bosch', 'WAJ2426', 29000, 35990), item(cat(washer), 'Bosch', 'WAJ2426', 29000, 35990),
      ],
    }, owner.id);
    const p2 = await purchasesService.create(sm.id, tenantId, {
      distributorId: gomti.id, invoiceNumber: 'GMT-2207', invoiceDate: '2026-06-10', totalAmount: 0, gstAmount: 0,
      items: [
        item(cat(smartphone), 'Redmi', 'Note 13 Pro', 21000, 25999), item(cat(smartphone), 'Redmi', 'Note 13 Pro', 21000, 25999),
        item(cat(smartphone), 'Vivo', 'T3 5G', 17000, 20999), item(cat(smartphone), 'Samsung', 'Galaxy A35', 27000, 32999),
      ],
    }, owner.id);
    // Purchase totals: the service takes them as given; set them from the units.
    for (const p of [p1, p2]) {
      const total = (await prisma.product.aggregate({ where: { purchaseId: p!.id }, _sum: { purchasePrice: true } }))._sum.purchasePrice;
      await prisma.purchase.update({ where: { id: p!.id }, data: { totalAmount: total ?? 0, netAmount: total ?? 0 } });
    }

    // --- Customers -------------------------------------------------------------
    const names = ['Pooja Srivastava', 'Mohd. Arif', 'Sanjay Tripathi', 'Neha Kushwaha', 'Ramesh Yadav', 'Farha Naaz', 'Anil Kanaujia', 'Shweta Mishra'];
    const customers = [];
    for (const [i, name] of names.entries()) {
      customers.push(await prisma.customer.create({
        data: { tenantId, shopId: i < 5 ? se.id : sm.id, customerCode: `ST${String(i + 1).padStart(4, '0')}`, name, phone: `98390${String(30000 + i * 1111).slice(0, 5)}`, city: 'Lucknow', state: 'Uttar Pradesh', isGuarantor: i === 7, createdBy: owner.id },
      }));
    }
    const guarantor = customers[7];

    // --- Sales (through the sales service) --------------------------------------
    const stock = async (shopId: string, model: string) =>
      prisma.product.findFirstOrThrow({ where: { tenantId, shopId, modelNumber: model, status: 'in_stock' } });
    const sell = (shopId: string, data: Parameters<typeof salesService.create>[1]) => salesService.create(shopId, data, owner.id, { autoApprove: true });

    // Cash
    await sell(se.id, { productId: (await stock(se.id, '43UR7500')).id, customerId: customers[0].id, ledgerNumber: 'SE-001', saleDate: '2026-07-01', saleType: 'full_payment', sellingPrice: 33990, paymentMode: 'cash' });
    await sell(sm.id, { productId: (await stock(sm.id, 'T3 5G')).id, customerId: customers[5].id, ledgerNumber: 'SM-001', saleDate: '2026-07-03', saleType: 'full_payment', sellingPrice: 20499, paymentMode: 'upi' });
    // NBFC (Bajaj) — a legitimate finance sale, one copy only
    const bajaj = financeCompanies.find((f) => f.code === 'BAJAJ') ?? financeCompanies[0];
    await sell(se.id, { productId: (await stock(se.id, 'RT34C4522')).id, customerId: customers[1].id, ledgerNumber: 'SE-002', saleDate: '2026-07-05', saleType: 'company_finance', sellingPrice: 37990, downPayment: 7990, paymentMode: 'cash', financeCompanyId: bajaj.id, financedAmount: 30000, expectedPaymentDate: '2026-07-20' });
    // Self-finance (shop's own EMI) — two copies; the second shows as a cash sale
    const sf1 = await sell(se.id, { productId: (await stock(se.id, 'KD-43X74K')).id, customerId: customers[2].id, ledgerNumber: 'SE-003', saleDate: '2026-07-10', saleType: 'self_finance', sellingPrice: 43990, downPayment: 10000, paymentMode: 'cash', interestRate: 2, fileCharge: 500, numInstallments: 6, guarantorId: guarantor.id });
    const sf2 = await sell(sm.id, { productId: (await stock(sm.id, 'Note 13 Pro')).id, customerId: customers[6].id, ledgerNumber: 'SM-002', saleDate: '2026-08-12', saleType: 'self_finance', sellingPrice: 25499, downPayment: 5000, paymentMode: 'cash', interestRate: 2, fileCharge: 300, numInstallments: 4, guarantorId: guarantor.id });

    // Installment collections: SE-003 paid EMIs 1–2, SM-002 paid EMI 1 short.
    for (const [sale, payments] of [[sf1, [['2026-08-10', 1], ['2026-09-12', 1]]], [sf2, [['2026-09-12', 0.6]]]] as const) {
      const schedule = await prisma.installmentSchedule.findUniqueOrThrow({ where: { saleId: sale!.id }, include: { installments: { orderBy: { installmentNumber: 'asc' } } } });
      for (const [date, share] of payments) {
        await recordPayment(prisma, {
          scheduleId: schedule.id, amount: Math.round(Number(schedule.emiAmount) * share), paymentMode: 'cash',
          paymentDate: new Date(`${date}T00:00:00.000Z`),
        }, { tenantId, actorUserId: owner.id });
      }
    }

    // --- Expenses -------------------------------------------------------------
    for (const [shop, category, amount, desc] of [[se, 'rent', 25000, 'Shop rent — September'], [se, 'electricity', 6200, 'Electricity bill'], [sm, 'salary', 18000, 'Staff salary — September']] as const) {
      await prisma.expense.create({ data: { tenantId, shopId: shop.id, category: category as any, amount, expenseDate: new Date('2026-09-30T00:00:00.000Z'), description: desc, createdBy: owner.id } });
    }
  });

  const counts = await tenantContext.runAs(tenant.id, async () => ({
    shops: await prisma.shop.count(), users: await prisma.user.count(), products: await prisma.product.count(),
    purchases: await prisma.purchase.count(), sales: await prisma.saleRecord.count(), customers: await prisma.customer.count(),
  }));
  console.log('Star Electronics created:', counts);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => unscopedPrisma.$disconnect());
