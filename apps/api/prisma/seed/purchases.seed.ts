import type { PrismaClient, Shop, ProductCategory, Distributor, Purchase, Product } from '@prisma/client';
import { randomUUID } from 'crypto';

// ---------------------------------------------------------------------------
// Bulk purchases + products seed — 500 purchases per shop (2000 total).
// Each purchase creates 3-8 products (status = in_stock).
//
// Integrity rules enforced:
//   - Each purchase has shopId + distributorId + unique (distributor, invoice_number)
//   - Distributor chosen from those linked to category of products bought
//   - Products inherit shopId from their parent purchase
//   - Products' categoryId must be a leaf category from distributor's linked set
//   - MRP / purchasePrice / sellingPrice have reasonable relationships:
//         purchasePrice <= sellingPrice <= mrp
//   - Serial numbers unique per shop (shop_code + counter)
//   - Payment status mix: ~60% paid / ~25% partial / ~15% pending
//   - Invoice dates spread across last 18 months
// ---------------------------------------------------------------------------

const PURCHASES_PER_SHOP = 500;

// Category → price band (min MRP, max MRP)
const PRICE_BANDS: Record<string, [number, number]> = {
  'led-tv': [15000, 85000],
  'oled-tv': [60000, 200000],
  'qled-tv': [45000, 150000],
  'plasma-tv': [25000, 60000],
  'smartphone': [8000, 120000],
  'feature-phone': [1500, 5000],
  'top-load': [15000, 45000],
  'front-load': [25000, 70000],
  'semi-automatic': [10000, 22000],
  'window-ac': [22000, 45000],
  'split-ac': [28000, 80000],
  'tower-ac': [60000, 130000],
  'single-door': [12000, 25000],
  'double-door': [25000, 60000],
  'side-by-side': [55000, 140000],
  'sofa': [15000, 80000],
  'bed': [10000, 60000],
  'dining-table': [12000, 50000],
  'wardrobe': [15000, 60000],
  'mixer-grinder': [2500, 8000],
  'water-purifier': [8000, 25000],
  'iron': [800, 3500],
};

const BRAND_BY_SLUG: Record<string, string[]> = {
  'led-tv': ['Samsung', 'LG', 'Sony', 'TCL', 'Mi', 'OnePlus', 'Vu', 'Hisense'],
  'oled-tv': ['Samsung', 'LG', 'Sony'],
  'qled-tv': ['Samsung', 'TCL', 'Hisense'],
  'plasma-tv': ['Samsung', 'LG', 'Panasonic'],
  'smartphone': ['Samsung', 'Apple', 'Xiaomi', 'OnePlus', 'Vivo', 'Oppo', 'Realme'],
  'feature-phone': ['Nokia', 'Samsung', 'Lava', 'Micromax'],
  'top-load': ['Samsung', 'LG', 'Whirlpool', 'Godrej', 'IFB'],
  'front-load': ['Samsung', 'LG', 'IFB', 'Bosch', 'Whirlpool'],
  'semi-automatic': ['Samsung', 'LG', 'Whirlpool', 'Godrej'],
  'window-ac': ['Blue Star', 'Voltas', 'Lloyd', 'Carrier', 'Hitachi'],
  'split-ac': ['LG', 'Samsung', 'Daikin', 'Blue Star', 'Voltas', 'Carrier', 'Lloyd'],
  'tower-ac': ['Blue Star', 'Voltas', 'Carrier'],
  'single-door': ['Samsung', 'LG', 'Whirlpool', 'Godrej', 'Haier'],
  'double-door': ['Samsung', 'LG', 'Whirlpool', 'Godrej', 'Haier', 'Bosch'],
  'side-by-side': ['Samsung', 'LG', 'Whirlpool', 'Bosch'],
  'sofa': ['Godrej', 'Nilkamal', 'Durian', 'Urban Ladder'],
  'bed': ['Godrej', 'Nilkamal', 'Durian', 'Wakefit'],
  'dining-table': ['Godrej', 'Nilkamal', 'Durian', 'HomeTown'],
  'wardrobe': ['Godrej', 'Nilkamal', 'Durian'],
  'mixer-grinder': ['Bajaj', 'Preethi', 'Philips', 'Butterfly'],
  'water-purifier': ['Kent', 'Aquaguard', 'Pureit', 'Livpure'],
  'iron': ['Philips', 'Bajaj', 'Havells', 'Usha'],
};

const COLORS = ['Black', 'White', 'Silver', 'Grey', 'Blue', 'Red', 'Graphite', 'Champagne'];

function rand(seed: number): number {
  const x = Math.sin(seed * 9301 + 49297) * 233280;
  return x - Math.floor(x);
}

function pick<T>(arr: T[], seed: number): T {
  return arr[Math.floor(rand(seed) * arr.length) % arr.length];
}

function pad(n: number, width: number): string {
  return String(n).padStart(width, '0');
}

function daysAgo(n: number): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - n);
  return d;
}

export async function seedPurchases(
  prisma: PrismaClient,
  shops: Shop[],
  categories: ProductCategory[],
  distributors: Distributor[],
): Promise<{ purchases: Purchase[]; products: Product[] }> {
  const existingPurchases = await prisma.purchase.count();
  if (existingPurchases >= 2000) {
    const purchases = await prisma.purchase.findMany();
    const products = await prisma.product.findMany();
    return { purchases, products };
  }

  const leafCategories = categories.filter((c) => c.isLeaf);
  const catById = new Map(categories.map((c) => [c.id, c]));

  // Build distributor → [leaf category] map from DistributorCategory
  const distribCats = await prisma.distributorCategory.findMany();
  const distribToCats = new Map<string, ProductCategory[]>();
  for (const dc of distribCats) {
    const cat = catById.get(dc.categoryId);
    if (!cat || !cat.isLeaf) continue;
    if (!distribToCats.has(dc.distributorId)) {
      distribToCats.set(dc.distributorId, []);
    }
    distribToCats.get(dc.distributorId)!.push(cat);
  }

  // Map shopId → primary admin user (createdBy)
  const shopAdminMap: Record<string, string | null> = {};
  for (const shop of shops) {
    const us = await prisma.userShop.findFirst({
      where: { shopId: shop.id, isPrimary: true, user: { role: 'admin' } },
      include: { user: true },
    });
    shopAdminMap[shop.id] = us?.user.id ?? null;
  }

  // Pre-compute purchases + products (batched insert at end)
  type PurchaseRow = Parameters<typeof prisma.purchase.createMany>[0]['data'] extends (infer U)[] ? U : never;
  type ProductRow = Parameters<typeof prisma.product.createMany>[0]['data'] extends (infer U)[] ? U : never;

  const purchaseRows: any[] = [];
  const productRows: any[] = [];
  const paymentRows: any[] = [];

  // Per-distributor invoice counter
  const invoiceCounter = new Map<string, number>();
  // Per-shop product serial counter
  const serialCounter = new Map<string, number>();

  let seedBase = 1;

  for (const shop of shops) {
    const createdBy = shopAdminMap[shop.id];

    for (let i = 0; i < PURCHASES_PER_SHOP; i++) {
      const seed = seedBase++;

      // Pick a distributor (weighted per shop — first 10 are "preferred")
      const shopIndex = shops.findIndex((s) => s.id === shop.id);
      const preferredStart = shopIndex * 10;
      // 70% from preferred 10, 30% from any
      const distributor = rand(seed) < 0.7
        ? distributors[(preferredStart + Math.floor(rand(seed + 1) * 10)) % distributors.length]
        : distributors[Math.floor(rand(seed + 2) * distributors.length)];

      // Determine valid categories for this distributor
      const validCats = distribToCats.get(distributor.id) ?? leafCategories;
      if (validCats.length === 0) continue;

      // How many products in this purchase (3-8)
      const numProducts = 3 + Math.floor(rand(seed + 3) * 6);

      // Invoice date spread across last 540 days
      const daysBack = Math.floor(rand(seed + 4) * 540);
      const invoiceDate = daysAgo(daysBack);

      // Invoice number sequential per distributor
      const distCode = distributor.companyName
        .split(' ')[0]
        .toUpperCase()
        .replace(/[^A-Z]/g, '')
        .slice(0, 4)
        .padEnd(3, 'X');
      const invNum = (invoiceCounter.get(distributor.id) ?? 0) + 1;
      invoiceCounter.set(distributor.id, invNum);
      const invoiceNumber = `INV-${distCode}-${pad(invNum, 5)}`;

      const purchaseId = randomUUID();
      let purchaseTotal = 0;
      let purchaseGst = 0;

      // Generate products for this purchase
      for (let p = 0; p < numProducts; p++) {
        const pSeed = seed * 100 + p;
        const cat = validCats[Math.floor(rand(pSeed) * validCats.length)];
        const brandList = BRAND_BY_SLUG[cat.slug] ?? ['Generic'];
        const brand = brandList[Math.floor(rand(pSeed + 1) * brandList.length)];
        const band = PRICE_BANDS[cat.slug] ?? [5000, 25000];
        const mrp = Math.round(band[0] + rand(pSeed + 2) * (band[1] - band[0]));
        // Purchase price: 70-85% of MRP
        const purchasePrice = Math.round(mrp * (0.70 + rand(pSeed + 3) * 0.15));
        // Selling price: 90-100% of MRP
        const sellingPrice = Math.round(mrp * (0.90 + rand(pSeed + 4) * 0.10));

        const gstRate = brand === 'Apple' || cat.slug === 'smartphone' ? 18 : [5, 12, 18, 28][Math.floor(rand(pSeed + 5) * 4)];
        const gstOnPurchase = Math.round(purchasePrice * gstRate / (100 + gstRate));
        purchaseTotal += purchasePrice;
        purchaseGst += gstOnPurchase;

        const serialN = (serialCounter.get(shop.id) ?? 0) + 1;
        serialCounter.set(shop.id, serialN);
        const serialNumber = `${shop.code}-SN-${pad(serialN, 7)}`;
        const barcode = `BC${shop.code}${pad(serialN, 9)}`;

        productRows.push({
          id: randomUUID(),
          shopId: shop.id,
          categoryId: cat.id,
          brand,
          modelNumber: `${brand.slice(0, 3).toUpperCase()}-${pad(pSeed % 100000, 5)}`,
          serialNumber,
          mrp,
          sellingPrice,
          purchasePrice,
          color: pick(COLORS, pSeed + 6),
          distributorId: distributor.id,
          purchaseId,
          status: 'in_stock' as const,
          warrantyMonths: [12, 18, 24, 36][Math.floor(rand(pSeed + 7) * 4)],
          barcode,
          createdBy,
          dynamicAttributes: {},
        });
      }

      // Payment status mix
      const pStatusRoll = rand(seed + 5);
      let paymentStatus: string;
      let amountPaid: number;
      if (pStatusRoll < 0.60) {
        paymentStatus = 'paid';
        amountPaid = purchaseTotal;
      } else if (pStatusRoll < 0.85) {
        paymentStatus = 'partial';
        amountPaid = Math.round(purchaseTotal * (0.3 + rand(seed + 6) * 0.5));
      } else {
        paymentStatus = 'pending';
        amountPaid = 0;
      }

      purchaseRows.push({
        id: purchaseId,
        shopId: shop.id,
        distributorId: distributor.id,
        invoiceNumber,
        invoiceDate,
        totalAmount: purchaseTotal,
        gstAmount: purchaseGst,
        discountAmount: 0,
        netAmount: purchaseTotal,
        amountPaid,
        paymentStatus,
        createdBy,
      });

      // Payment records
      if (amountPaid > 0) {
        const paymentModes = ['bank_transfer', 'cheque', 'upi', 'cash'];
        paymentRows.push({
          id: randomUUID(),
          purchaseId,
          amount: amountPaid,
          paymentMode: paymentModes[Math.floor(rand(seed + 7) * paymentModes.length)] as any,
          paymentDate: invoiceDate,
          referenceNumber: `PAY-${pad(seed, 6)}`,
          createdBy,
        });
      }
    }
  }

  // Batch insert — purchases first, then products (products FK → purchase)
  console.log(`  Inserting ${purchaseRows.length} purchases...`);
  const CHUNK = 500;
  for (let i = 0; i < purchaseRows.length; i += CHUNK) {
    await prisma.purchase.createMany({ data: purchaseRows.slice(i, i + CHUNK) });
  }

  console.log(`  Inserting ${productRows.length} products...`);
  for (let i = 0; i < productRows.length; i += CHUNK) {
    await prisma.product.createMany({ data: productRows.slice(i, i + CHUNK) });
  }

  if (paymentRows.length > 0) {
    console.log(`  Inserting ${paymentRows.length} purchase payments...`);
    for (let i = 0; i < paymentRows.length; i += CHUNK) {
      await prisma.purchasePayment.createMany({ data: paymentRows.slice(i, i + CHUNK) });
    }
  }

  const purchases = await prisma.purchase.findMany();
  const products = await prisma.product.findMany();
  return { purchases, products };
}
