import type { PrismaClient, Product, Shop, ProductCategory, Distributor, Purchase } from '@prisma/client';

// ---------------------------------------------------------------------------
// Product template types
// ---------------------------------------------------------------------------

interface ProductTemplate {
  categorySlug: string;
  brand: string;
  modelNumber: string;
  mrp: number;
  color: string;
  weightKg: number;
  warrantyMonths: number;
  dynamicAttributes: Record<string, unknown>;
}

interface ProductDef extends ProductTemplate {
  shopId: string;
  serialNumber: string;
  purchasePrice: number;
  sellingPrice: number;
  barcode: string;
  createdBy: string | null;
}

// ---------------------------------------------------------------------------
// Distributor-category mapping for deterministic assignment
// ---------------------------------------------------------------------------

const DISTRIBUTOR_CATEGORY_MAP: Record<string, string[]> = {
  Samsung: ['led-tv', 'oled-tv', 'qled-tv', 'smartphone', 'split-ac', 'window-ac', 'single-door', 'double-door', 'side-by-side', 'front-load', 'top-load', 'semi-automatic'],
  LG: ['led-tv', 'oled-tv', 'qled-tv', 'split-ac', 'window-ac', 'tower-ac', 'single-door', 'double-door', 'side-by-side', 'front-load', 'top-load', 'semi-automatic'],
  Xiaomi: ['smartphone', 'led-tv'],
  Godrej: ['sofa', 'bed', 'dining-table', 'wardrobe'],
  Whirlpool: ['front-load', 'top-load', 'semi-automatic', 'single-door', 'double-door', 'side-by-side', 'split-ac', 'window-ac'],
};

// ---------------------------------------------------------------------------
// Product templates — 25 per-shop templates, reused across 4 shops
// Each shop gets the same mix but with unique serial numbers/barcodes
// ---------------------------------------------------------------------------

const SHOP_CODES = ['VE', 'NE', 'VHA', 'NHE'] as const;

// Template index 0..24 per shop = 100 total products
const TEMPLATES: ProductTemplate[] = [
  // ===== TVs (5) =====
  // 0: Samsung 55" QLED
  {
    categorySlug: 'qled-tv', brand: 'Samsung', modelNumber: 'QA55Q60BAKXXL',
    mrp: 89990, color: 'Titan Gray', weightKg: 16.8, warrantyMonths: 24,
    dynamicAttributes: { screen_size: 55, resolution: '4K', smart_tv: true },
  },
  // 1: LG 43" LED
  {
    categorySlug: 'led-tv', brand: 'LG', modelNumber: '43LM5760PTC',
    mrp: 37990, color: 'Black', weightKg: 8.4, warrantyMonths: 12,
    dynamicAttributes: { screen_size: 43, resolution: 'Full HD', smart_tv: true, hdmi_ports: 2 },
  },
  // 2: Sony 50" LED 4K
  {
    categorySlug: 'led-tv', brand: 'Sony', modelNumber: 'KD-50X74K',
    mrp: 59990, color: 'Black', weightKg: 11.5, warrantyMonths: 24,
    dynamicAttributes: { screen_size: 50, resolution: '4K', smart_tv: true, hdmi_ports: 3 },
  },
  // 3: TCL 43" LED FHD
  {
    categorySlug: 'led-tv', brand: 'TCL', modelNumber: '43S5400A',
    mrp: 27990, color: 'Black', weightKg: 7.5, warrantyMonths: 12,
    dynamicAttributes: { screen_size: 43, resolution: 'Full HD', smart_tv: true, hdmi_ports: 2 },
  },
  // 4: Samsung 32" LED HD
  {
    categorySlug: 'led-tv', brand: 'Samsung', modelNumber: 'UA32T4380AKXXL',
    mrp: 17990, color: 'Black', weightKg: 4.2, warrantyMonths: 12,
    dynamicAttributes: { screen_size: 32, resolution: 'HD', smart_tv: true, hdmi_ports: 2 },
  },

  // ===== Mobiles (5) =====
  // 5: Apple iPhone 15 128GB
  {
    categorySlug: 'smartphone', brand: 'Apple', modelNumber: 'iPhone 15 128GB',
    mrp: 79900, color: 'Blue', weightKg: 0.171, warrantyMonths: 12,
    dynamicAttributes: { imei: '', imei2: '', ram: '6', storage: '128', os: 'iOS' },
  },
  // 6: Samsung Galaxy S24 256GB
  {
    categorySlug: 'smartphone', brand: 'Samsung', modelNumber: 'Galaxy S24 256GB',
    mrp: 79999, color: 'Cobalt Violet', weightKg: 0.167, warrantyMonths: 12,
    dynamicAttributes: { imei: '', imei2: '', ram: '8', storage: '256', os: 'Android' },
  },
  // 7: Xiaomi 14 512GB
  {
    categorySlug: 'smartphone', brand: 'Xiaomi', modelNumber: 'Xiaomi 14 512GB',
    mrp: 69999, color: 'Jade Green', weightKg: 0.193, warrantyMonths: 12,
    dynamicAttributes: { imei: '', imei2: '', ram: '12', storage: '512', os: 'Android' },
  },
  // 8: OnePlus 12 256GB
  {
    categorySlug: 'smartphone', brand: 'OnePlus', modelNumber: 'OnePlus 12 256GB',
    mrp: 64999, color: 'Flowy Emerald', weightKg: 0.220, warrantyMonths: 12,
    dynamicAttributes: { imei: '', imei2: '', ram: '12', storage: '256', os: 'Android' },
  },
  // 9: Realme 12 128GB
  {
    categorySlug: 'smartphone', brand: 'Realme', modelNumber: 'Realme 12 128GB',
    mrp: 19999, color: 'Skyline Blue', weightKg: 0.187, warrantyMonths: 12,
    dynamicAttributes: { imei: '', imei2: '', ram: '8', storage: '128', os: 'Android' },
  },

  // ===== ACs (4) =====
  // 10: LG 1.5T Split AC 5-star
  {
    categorySlug: 'split-ac', brand: 'LG', modelNumber: 'RS-Q19YNZE',
    mrp: 52990, color: 'White', weightKg: 36, warrantyMonths: 12,
    dynamicAttributes: { tonnage: '1.5', star_rating: '5', inverter: true, refrigerant: 'R32' },
  },
  // 11: Samsung 1.5T Split AC 3-star
  {
    categorySlug: 'split-ac', brand: 'Samsung', modelNumber: 'AR18CY3AAGBNNA',
    mrp: 42990, color: 'White', weightKg: 34, warrantyMonths: 12,
    dynamicAttributes: { tonnage: '1.5', star_rating: '3', inverter: true, refrigerant: 'R32' },
  },
  // 12: Daikin 1.5T Split AC 3-star
  {
    categorySlug: 'split-ac', brand: 'Daikin', modelNumber: 'FTKL50UV16',
    mrp: 49990, color: 'White', weightKg: 35, warrantyMonths: 12,
    dynamicAttributes: { tonnage: '1.5', star_rating: '3', inverter: true, refrigerant: 'R32' },
  },
  // 13: Blue Star 1T Window AC
  {
    categorySlug: 'window-ac', brand: 'Blue Star', modelNumber: 'WFA312LN',
    mrp: 29990, color: 'White', weightKg: 40, warrantyMonths: 12,
    dynamicAttributes: { tonnage: '1', star_rating: '3' },
  },

  // ===== Washing Machines (3) =====
  // 14: Samsung 7kg Front Load
  {
    categorySlug: 'front-load', brand: 'Samsung', modelNumber: 'WW70T502DAW/TL',
    mrp: 36990, color: 'White', weightKg: 62, warrantyMonths: 24,
    dynamicAttributes: { capacity_kg: '7', rpm: 1200 },
  },
  // 15: LG 8kg Top Load
  {
    categorySlug: 'top-load', brand: 'LG', modelNumber: 'T80SPSF2Z',
    mrp: 25990, color: 'Middle Free Silver', weightKg: 32, warrantyMonths: 24,
    dynamicAttributes: { capacity_kg: '8', fully_automatic: true },
  },
  // 16: Whirlpool 7.5kg Top Load
  {
    categorySlug: 'top-load', brand: 'Whirlpool', modelNumber: 'STAINWASH PRO H 7.5',
    mrp: 22490, color: 'Grey', weightKg: 30, warrantyMonths: 24,
    dynamicAttributes: { capacity_kg: '7.5', fully_automatic: true },
  },

  // ===== Refrigerators (3) =====
  // 17: Whirlpool 265L Double Door
  {
    categorySlug: 'double-door', brand: 'Whirlpool', modelNumber: 'IF INV CNV 278 GD',
    mrp: 30990, color: 'Steel Onyx', weightKg: 60, warrantyMonths: 12,
    dynamicAttributes: { capacity_litres: 265, star_rating: '3', frost_free: true },
  },
  // 18: LG 260L Double Door
  {
    categorySlug: 'double-door', brand: 'LG', modelNumber: 'GL-S292RDSX',
    mrp: 28490, color: 'Dazzle Steel', weightKg: 58, warrantyMonths: 12,
    dynamicAttributes: { capacity_litres: 260, star_rating: '3', frost_free: true },
  },
  // 19: Samsung 192L Single Door
  {
    categorySlug: 'single-door', brand: 'Samsung', modelNumber: 'RR20C1Y23S8/HL',
    mrp: 18990, color: 'Elegant Inox', weightKg: 39, warrantyMonths: 12,
    dynamicAttributes: { capacity_litres: 192, star_rating: '4' },
  },

  // ===== Furniture (3) =====
  // 20: Godrej Sofa 3-seater
  {
    categorySlug: 'sofa', brand: 'Godrej', modelNumber: 'Interio Meridian 3S',
    mrp: 45990, color: 'Mahogany Brown', weightKg: 48, warrantyMonths: 36,
    dynamicAttributes: { material: 'Fabric', seating_capacity: '3', dimensions: '195x85x90' },
  },
  // 21: Godrej Queen Bed
  {
    categorySlug: 'bed', brand: 'Godrej', modelNumber: 'Interio Viva Queen',
    mrp: 35990, color: 'Walnut', weightKg: 75, warrantyMonths: 60,
    dynamicAttributes: { material: 'Engineered Wood', size: 'Queen', storage: true },
  },
  // 22: Nilkamal 6-seater Dining Table
  {
    categorySlug: 'dining-table', brand: 'Nilkamal', modelNumber: 'Garnet 6-Seater',
    mrp: 28990, color: 'Wenge', weightKg: 52, warrantyMonths: 36,
    dynamicAttributes: {},
  },

  // ===== Small Appliances (2) =====
  // 23: Bajaj Mixer Grinder
  {
    categorySlug: 'mixer-grinder', brand: 'Bajaj', modelNumber: 'GX-1 750W',
    mrp: 4299, color: 'White', weightKg: 3.8, warrantyMonths: 24,
    dynamicAttributes: {},
  },
  // 24: Kent Water Purifier
  {
    categorySlug: 'water-purifier', brand: 'Kent', modelNumber: 'Grand Star RO+UV+UF+TDS',
    mrp: 22500, color: 'White', weightKg: 9.5, warrantyMonths: 12,
    dynamicAttributes: {},
  },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Deterministic purchase-price: 72-80% of MRP based on index */
function calcPurchasePrice(mrp: number, idx: number): number {
  const margins = [0.72, 0.74, 0.75, 0.76, 0.78, 0.80, 0.73, 0.77];
  const factor = margins[idx % margins.length];
  return Math.round(mrp * factor);
}

/** Deterministic selling-price: 88-95% of MRP based on index */
function calcSellingPrice(mrp: number, idx: number): number {
  const margins = [0.89, 0.91, 0.88, 0.93, 0.90, 0.95, 0.92, 0.87];
  const factor = margins[idx % margins.length];
  return Math.round(mrp * factor);
}

/** Generate deterministic IMEI from base + shop + sequence */
function makeImei(shopIdx: number, prodIdx: number, second: boolean): string {
  const base = 356789000000000 + shopIdx * 100000 + prodIdx * 100 + (second ? 1 : 0);
  return String(base);
}

/** Brand abbreviation for serial numbers */
function brandAbbr(brand: string): string {
  const map: Record<string, string> = {
    Samsung: 'SAM', LG: 'LG', Sony: 'SONY', TCL: 'TCL', Apple: 'APL',
    Xiaomi: 'XI', OnePlus: 'OP', Realme: 'RM', Vivo: 'VV', Daikin: 'DAI',
    'Blue Star': 'BS', Whirlpool: 'WP', Godrej: 'GOD', Nilkamal: 'NIL',
    Bajaj: 'BAJ', Kent: 'KENT', Philips: 'PHL', 'Urban Ladder': 'UL',
  };
  return map[brand] ?? brand.substring(0, 3).toUpperCase();
}

/** Category abbreviation for serial numbers */
function catAbbr(slug: string): string {
  const map: Record<string, string> = {
    'qled-tv': 'TV', 'led-tv': 'TV', 'oled-tv': 'TV', 'plasma-tv': 'TV',
    smartphone: 'PH', 'feature-phone': 'FP',
    'split-ac': 'AC', 'window-ac': 'AC', 'tower-ac': 'AC',
    'front-load': 'WM', 'top-load': 'WM', 'semi-automatic': 'WM',
    'single-door': 'RF', 'double-door': 'RF', 'side-by-side': 'RF',
    sofa: 'SF', bed: 'BD', 'dining-table': 'DT', wardrobe: 'WR',
    'mixer-grinder': 'MG', 'water-purifier': 'WP', iron: 'IR',
  };
  return map[slug] ?? 'XX';
}

/** Distributor code for invoice numbers */
const DIST_CODES: Record<string, string> = {
  Samsung: 'SAM', LG: 'LGE', Xiaomi: 'XIA', Godrej: 'GOD', Whirlpool: 'WPL',
};

/** Pick distributor name for a category slug, deterministically by index */
function pickDistributor(slug: string, idx: number): string {
  // Build list of matching distributors for this category
  const matching: string[] = [];
  for (const [distKey, slugs] of Object.entries(DISTRIBUTOR_CATEGORY_MAP)) {
    if (slugs.includes(slug)) matching.push(distKey);
  }
  if (matching.length === 0) return 'Samsung'; // fallback
  return matching[idx % matching.length];
}

/** Invoice date spread: March 1 to April 15, 2026 */
function invoiceDate(purchaseIdx: number): Date {
  // 20 purchases total (5 per shop) spread across 46 days
  const baseDate = new Date('2026-03-01');
  const dayOffset = (purchaseIdx * 7) % 46; // 0, 7, 14, 21, 28, 35, 42, 3, 10, ...
  return new Date(baseDate.getTime() + dayOffset * 86400000);
}

/** Payment status based on index */
function paymentStatus(idx: number): { status: string; paidFraction: number } {
  // 80% paid, 10% partial, 10% pending
  const cycle = idx % 10;
  if (cycle === 7) return { status: 'partial', paidFraction: 0.6 };
  if (cycle === 9) return { status: 'pending', paidFraction: 0 };
  return { status: 'paid', paidFraction: 1.0 };
}

// ---------------------------------------------------------------------------
// Main seed function
// ---------------------------------------------------------------------------

export async function seedProducts(
  prisma: PrismaClient,
  shops: Shop[],
  categories: ProductCategory[],
  distributors: Distributor[],
): Promise<Product[]> {
  const products: Product[] = [];

  const shopByCode = (code: string) => shops.find((s) => s.code === code)!;
  const catBySlug = (slug: string) => categories.find((c) => c.slug === slug)!;
  const distByName = (partial: string) =>
    distributors.find((d) => d.companyName.toLowerCase().includes(partial.toLowerCase()));

  async function getFirstAdmin(shopId: string) {
    const userShop = await prisma.userShop.findFirst({
      where: { shopId, isPrimary: true, user: { role: 'admin' } },
      include: { user: true },
    });
    return userShop?.user;
  }

  // Resolve shops and admins
  const shopEntries = SHOP_CODES.map((code) => {
    const shop = shopByCode(code);
    return { code, shop };
  });
  const adminMap: Record<string, string | null> = {};
  for (const { code, shop } of shopEntries) {
    const admin = await getFirstAdmin(shop.id);
    adminMap[code] = admin?.id ?? null;
  }

  // Build all 100 product definitions
  const allProductDefs: ProductDef[] = [];
  let globalIdx = 0;

  for (let shopIdx = 0; shopIdx < SHOP_CODES.length; shopIdx++) {
    const shopCode = SHOP_CODES[shopIdx];
    const shop = shopByCode(shopCode);

    for (let tplIdx = 0; tplIdx < TEMPLATES.length; tplIdx++) {
      const tpl = TEMPLATES[tplIdx];
      const seqNum = String(globalIdx + 1).padStart(3, '0');
      const sn = `SN-${brandAbbr(tpl.brand)}-${catAbbr(tpl.categorySlug)}-${shopCode}-${seqNum}`;
      const barcode = `${brandAbbr(tpl.brand)}${tpl.modelNumber.replace(/[\s\/\-\+]/g, '').substring(0, 8)}${seqNum}`;

      // Clone dynamic attributes and fill IMEI for phones
      const dynAttrs = { ...tpl.dynamicAttributes };
      if (tpl.categorySlug === 'smartphone' || tpl.categorySlug === 'feature-phone') {
        dynAttrs.imei = makeImei(shopIdx, tplIdx, false);
        dynAttrs.imei2 = makeImei(shopIdx, tplIdx, true);
      }

      allProductDefs.push({
        ...tpl,
        shopId: shop.id,
        serialNumber: sn,
        purchasePrice: calcPurchasePrice(tpl.mrp, globalIdx),
        sellingPrice: calcSellingPrice(tpl.mrp, globalIdx),
        barcode,
        createdBy: adminMap[shopCode],
        dynamicAttributes: dynAttrs,
      });

      globalIdx++;
    }
  }

  // ---------------------------------------------------------------------------
  // Group products by (shop, distributor) to create purchases
  // ---------------------------------------------------------------------------
  type PurchaseGroup = {
    shopCode: string;
    shopId: string;
    distName: string;
    products: ProductDef[];
  };

  const groupKey = (shopCode: string, distName: string) => `${shopCode}|${distName}`;
  const groupMap = new Map<string, PurchaseGroup>();

  for (let i = 0; i < allProductDefs.length; i++) {
    const def = allProductDefs[i];
    const shopCode = SHOP_CODES.find((c) => shopByCode(c).id === def.shopId)!;
    const distName = pickDistributor(def.categorySlug, i);
    const key = groupKey(shopCode, distName);

    if (!groupMap.has(key)) {
      groupMap.set(key, { shopCode, shopId: def.shopId, distName, products: [] });
    }
    groupMap.get(key)!.products.push(def);
  }

  // Create purchases and products
  let purchaseIdx = 0;
  for (const [, group] of groupMap) {
    const distributor = distByName(group.distName);
    if (!distributor) {
      console.warn(`  Distributor "${group.distName}" not found, skipping group`);
      continue;
    }

    const distCode = DIST_CODES[group.distName] ?? group.distName.substring(0, 3).toUpperCase();
    const invoiceNum = `${distCode}/${group.shopCode}/${2026}/${String(purchaseIdx + 1).padStart(3, '0')}`;
    const totalPurchasePrice = group.products.reduce((sum, p) => sum + p.purchasePrice, 0);
    const invDate = invoiceDate(purchaseIdx);
    const ps = paymentStatus(purchaseIdx);
    const amountPaid = Math.round(totalPurchasePrice * ps.paidFraction);

    // Check if purchase already exists
    let purchase: Purchase | null = await prisma.purchase.findFirst({
      where: { invoiceNumber: invoiceNum, shopId: group.shopId },
    });

    if (!purchase) {
      purchase = await prisma.purchase.create({
        data: {
          shopId: group.shopId,
          distributorId: distributor.id,
          invoiceNumber: invoiceNum,
          invoiceDate: invDate,
          totalAmount: totalPurchasePrice,
          gstAmount: Math.round(totalPurchasePrice * 0.18),
          discountAmount: 0,
          netAmount: totalPurchasePrice,
          amountPaid,
          paymentStatus: ps.status,
          notes: `Stock purchase from ${distributor.companyName} (seed data)`,
          createdBy: adminMap[group.shopCode],
        },
      });
    }

    // Create each product in this purchase group
    for (const def of group.products) {
      const category = catBySlug(def.categorySlug);
      if (!category) {
        console.warn(`  Category "${def.categorySlug}" not found, skipping product ${def.modelNumber}`);
        continue;
      }

      // Idempotent: check by serialNumber + shopId
      let product: Product | null = await prisma.product.findFirst({
        where: { serialNumber: def.serialNumber, shopId: def.shopId },
      });

      if (!product) {
        product = await prisma.product.create({
          data: {
            shopId: def.shopId,
            categoryId: category.id,
            brand: def.brand,
            modelNumber: def.modelNumber,
            serialNumber: def.serialNumber,
            mrp: def.mrp,
            sellingPrice: def.sellingPrice,
            purchasePrice: def.purchasePrice,
            color: def.color,
            weightKg: def.weightKg,
            distributorId: distributor.id,
            purchaseId: purchase.id,
            status: 'in_stock',
            dynamicAttributes: def.dynamicAttributes,
            warrantyMonths: def.warrantyMonths,
            barcode: def.barcode,
            createdBy: def.createdBy,
          },
        });

        // Audit trail
        await prisma.productAuditTrail.create({
          data: {
            productId: product.id,
            eventType: 'purchased',
            toShopId: def.shopId,
            performedBy: def.createdBy,
            notes: `Purchased from ${distributor.companyName} (Invoice: ${invoiceNum})`,
          },
        });
      } else if (!product.distributorId || !product.purchaseId) {
        product = await prisma.product.update({
          where: { id: product.id },
          data: {
            distributorId: product.distributorId ?? distributor.id,
            purchaseId: product.purchaseId ?? purchase.id,
          },
        });
      }

      products.push(product);
    }

    purchaseIdx++;
  }

  return products;
}
