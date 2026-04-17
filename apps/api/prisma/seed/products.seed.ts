import type { PrismaClient, Product, Shop, ProductCategory, Distributor, Purchase } from '@prisma/client';

export async function seedProducts(
  prisma: PrismaClient,
  shops: Shop[],
  categories: ProductCategory[],
  distributors: Distributor[],
): Promise<Product[]> {
  const products: Product[] = [];

  // Helper to find shop by code
  const shopByCode = (code: string) => shops.find((s) => s.code === code)!;

  // Helper to find leaf category by slug
  const catBySlug = (slug: string) => categories.find((c) => c.slug === slug)!;

  // Helper to find distributor by partial company name
  const distByName = (partial: string) =>
    distributors.find((d) => d.companyName.toLowerCase().includes(partial.toLowerCase()));

  // Helper to get first admin user for a shop
  async function getFirstAdmin(shopId: string) {
    const userShop = await prisma.userShop.findFirst({
      where: { shopId, isPrimary: true, user: { role: 'admin' } },
      include: { user: true },
    });
    return userShop?.user;
  }

  const ve = shopByCode('VE');
  const ne = shopByCode('NE');
  const vha = shopByCode('VHA');
  const nhe = shopByCode('NHE');

  const veAdmin = await getFirstAdmin(ve.id);
  const neAdmin = await getFirstAdmin(ne.id);
  const vhaAdmin = await getFirstAdmin(vha.id);
  const nheAdmin = await getFirstAdmin(nhe.id);

  // Primary distributor for each shop (used to create purchase records)
  const shopDistributorMap: Record<string, { distributor: Distributor; invoiceNumber: string; adminId: string | null }> = {
    [ve.id]: { distributor: distByName('Samsung')!, invoiceNumber: 'SAM/VE/2026/001', adminId: veAdmin?.id ?? null },
    [ne.id]: { distributor: distByName('Samsung')!, invoiceNumber: 'SAM/NE/2026/001', adminId: neAdmin?.id ?? null },
    [vha.id]: { distributor: distByName('Godrej')!, invoiceNumber: 'GOD/VHA/2026/001', adminId: vhaAdmin?.id ?? null },
    [nhe.id]: { distributor: distByName('Samsung')!, invoiceNumber: 'SAM/NHE/2026/001', adminId: nheAdmin?.id ?? null },
  };

  const productDefs = [
    // === VE: 2 TVs, 1 Mobile, 1 AC, 1 Washing Machine ===
    {
      shopId: ve.id,
      categorySlug: 'qled-tv',
      brand: 'Samsung',
      modelNumber: 'QA55Q60BAKXXL',
      serialNumber: 'SN-SAM-TV-55Q60-001',
      mrp: 89990,
      sellingPrice: 79990,
      purchasePrice: 62000,
      color: 'Titan Gray',
      weightKg: 16.8,
      warrantyMonths: 24,
      barcode: 'SAM55Q60B001',
      dynamicAttributes: { screen_size: 55, resolution: '4K', smart_tv: true },
      createdBy: veAdmin?.id,
    },
    {
      shopId: ve.id,
      categorySlug: 'led-tv',
      brand: 'LG',
      modelNumber: '43LM5760PTC',
      serialNumber: 'SN-LG-TV-43LM-002',
      mrp: 37990,
      sellingPrice: 32990,
      purchasePrice: 26000,
      color: 'Black',
      weightKg: 8.4,
      warrantyMonths: 12,
      barcode: 'LG43LM5760002',
      dynamicAttributes: { screen_size: 43, resolution: 'Full HD', smart_tv: true, hdmi_ports: 2 },
      createdBy: veAdmin?.id,
    },
    {
      shopId: ve.id,
      categorySlug: 'smartphone',
      brand: 'Apple',
      modelNumber: 'iPhone 15 128GB',
      serialNumber: 'SN-APL-IP15-003',
      mrp: 79900,
      sellingPrice: 76900,
      purchasePrice: 68000,
      color: 'Blue',
      weightKg: 0.171,
      warrantyMonths: 12,
      barcode: 'APLIP15128003',
      dynamicAttributes: { imei: '356789012345678', imei2: '356789012345679', ram: '6', storage: '128', os: 'iOS' },
      createdBy: veAdmin?.id,
    },
    {
      shopId: ve.id,
      categorySlug: 'split-ac',
      brand: 'LG',
      modelNumber: 'RS-Q19YNZE',
      serialNumber: 'SN-LG-AC-15SP-004',
      mrp: 52990,
      sellingPrice: 46990,
      purchasePrice: 37000,
      color: 'White',
      weightKg: 36,
      warrantyMonths: 12,
      barcode: 'LGRSQ19004',
      dynamicAttributes: { tonnage: '1.5', star_rating: '5', inverter: true, refrigerant: 'R32' },
      createdBy: veAdmin?.id,
    },
    {
      shopId: ve.id,
      categorySlug: 'front-load',
      brand: 'Samsung',
      modelNumber: 'WW70T502DAW/TL',
      serialNumber: 'SN-SAM-WM-7FL-005',
      mrp: 36990,
      sellingPrice: 32990,
      purchasePrice: 26500,
      color: 'White',
      weightKg: 62,
      warrantyMonths: 24,
      barcode: 'SAMWW70T005',
      dynamicAttributes: { capacity_kg: '7', rpm: 1200 },
      createdBy: veAdmin?.id,
    },

    // === NE: 2 Mobiles, 1 TV, 1 Refrigerator, 1 Sofa ===
    {
      shopId: ne.id,
      categorySlug: 'smartphone',
      brand: 'Samsung',
      modelNumber: 'Galaxy S24 256GB',
      serialNumber: 'SN-SAM-S24-006',
      mrp: 79999,
      sellingPrice: 74999,
      purchasePrice: 64000,
      color: 'Cobalt Violet',
      weightKg: 0.167,
      warrantyMonths: 12,
      barcode: 'SAMS24256006',
      dynamicAttributes: { imei: '356789022345678', imei2: '356789022345679', ram: '8', storage: '256', os: 'Android' },
      createdBy: neAdmin?.id,
    },
    {
      shopId: ne.id,
      categorySlug: 'smartphone',
      brand: 'Xiaomi',
      modelNumber: 'Xiaomi 14 512GB',
      serialNumber: 'SN-XI-14-007',
      mrp: 69999,
      sellingPrice: 64999,
      purchasePrice: 55000,
      color: 'Jade Green',
      weightKg: 0.193,
      warrantyMonths: 12,
      barcode: 'XI14512007',
      dynamicAttributes: { imei: '356789032345678', imei2: '356789032345679', ram: '12', storage: '512', os: 'Android' },
      createdBy: neAdmin?.id,
    },
    {
      shopId: ne.id,
      categorySlug: 'led-tv',
      brand: 'Sony',
      modelNumber: 'KD-50X74K',
      serialNumber: 'SN-SONY-TV-50-008',
      mrp: 59990,
      sellingPrice: 52990,
      purchasePrice: 42000,
      color: 'Black',
      weightKg: 11.5,
      warrantyMonths: 24,
      barcode: 'SONYKD50X008',
      dynamicAttributes: { screen_size: 50, resolution: '4K', smart_tv: true, hdmi_ports: 3 },
      createdBy: neAdmin?.id,
    },
    {
      shopId: ne.id,
      categorySlug: 'double-door',
      brand: 'Whirlpool',
      modelNumber: 'IF INV CNV 278 GD',
      serialNumber: 'SN-WP-RF-265-009',
      mrp: 30990,
      sellingPrice: 27490,
      purchasePrice: 21500,
      color: 'Steel Onyx',
      weightKg: 60,
      warrantyMonths: 12,
      barcode: 'WPIFCNV278009',
      dynamicAttributes: { capacity_litres: 265, star_rating: '3', frost_free: true },
      createdBy: neAdmin?.id,
    },
    {
      shopId: ne.id,
      categorySlug: 'sofa',
      brand: 'Godrej',
      modelNumber: 'Interio Meridian 3S',
      serialNumber: 'SN-GOD-SOFA-3S-010',
      mrp: 45990,
      sellingPrice: 42990,
      purchasePrice: 33000,
      color: 'Mahogany Brown',
      weightKg: 48,
      warrantyMonths: 36,
      barcode: 'GODMER3S010',
      dynamicAttributes: { material: 'Fabric', seating_capacity: '3', dimensions: '195x85x90' },
      createdBy: neAdmin?.id,
    },

    // === VHA: 2 Furniture, 1 AC, 1 Refrigerator, 1 WM ===
    {
      shopId: vha.id,
      categorySlug: 'bed',
      brand: 'Godrej',
      modelNumber: 'Interio Viva Queen',
      serialNumber: 'SN-GOD-BED-QN-011',
      mrp: 35990,
      sellingPrice: 32990,
      purchasePrice: 25000,
      color: 'Walnut',
      weightKg: 75,
      warrantyMonths: 60,
      barcode: 'GODBEDQN011',
      dynamicAttributes: { material: 'Engineered Wood', size: 'Queen', storage: true },
      createdBy: vhaAdmin?.id,
    },
    {
      shopId: vha.id,
      categorySlug: 'dining-table',
      brand: 'Nilkamal',
      modelNumber: 'Garnet 6-Seater',
      serialNumber: 'SN-NIL-DT-6S-012',
      mrp: 28990,
      sellingPrice: 25990,
      purchasePrice: 19500,
      color: 'Wenge',
      weightKg: 52,
      warrantyMonths: 36,
      barcode: 'NILGAR6S012',
      dynamicAttributes: {},
      createdBy: vhaAdmin?.id,
    },
    {
      shopId: vha.id,
      categorySlug: 'split-ac',
      brand: 'Daikin',
      modelNumber: 'FTKL50UV16',
      serialNumber: 'SN-DAI-AC-15SP-013',
      mrp: 49990,
      sellingPrice: 44990,
      purchasePrice: 35000,
      color: 'White',
      weightKg: 35,
      warrantyMonths: 12,
      barcode: 'DAIFTKL50013',
      dynamicAttributes: { tonnage: '1.5', star_rating: '3', inverter: true, refrigerant: 'R32' },
      createdBy: vhaAdmin?.id,
    },
    {
      shopId: vha.id,
      categorySlug: 'double-door',
      brand: 'LG',
      modelNumber: 'GL-S292RDSX',
      serialNumber: 'SN-LG-RF-260-014',
      mrp: 28490,
      sellingPrice: 25990,
      purchasePrice: 20000,
      color: 'Dazzle Steel',
      weightKg: 58,
      warrantyMonths: 12,
      barcode: 'LGGLS292014',
      dynamicAttributes: { capacity_litres: 260, star_rating: '3', frost_free: true },
      createdBy: vhaAdmin?.id,
    },
    {
      shopId: vha.id,
      categorySlug: 'top-load',
      brand: 'LG',
      modelNumber: 'T80SPSF2Z',
      serialNumber: 'SN-LG-WM-8TL-015',
      mrp: 25990,
      sellingPrice: 22990,
      purchasePrice: 17500,
      color: 'Middle Free Silver',
      weightKg: 32,
      warrantyMonths: 24,
      barcode: 'LGT80SP015',
      dynamicAttributes: { capacity_kg: '8', fully_automatic: true },
      createdBy: vhaAdmin?.id,
    },

    // === NHE: 2 TVs, 1 Mobile, 1 AC, 1 Mixer Grinder ===
    {
      shopId: nhe.id,
      categorySlug: 'led-tv',
      brand: 'Samsung',
      modelNumber: 'UA32T4380AKXXL',
      serialNumber: 'SN-SAM-TV-32-016',
      mrp: 17990,
      sellingPrice: 15490,
      purchasePrice: 12000,
      color: 'Black',
      weightKg: 4.2,
      warrantyMonths: 12,
      barcode: 'SAMUA32T016',
      dynamicAttributes: { screen_size: 32, resolution: 'HD', smart_tv: true, hdmi_ports: 2 },
      createdBy: nheAdmin?.id,
    },
    {
      shopId: nhe.id,
      categorySlug: 'led-tv',
      brand: 'TCL',
      modelNumber: '43S5400A',
      serialNumber: 'SN-TCL-TV-43-017',
      mrp: 27990,
      sellingPrice: 23990,
      purchasePrice: 18000,
      color: 'Black',
      weightKg: 7.5,
      warrantyMonths: 12,
      barcode: 'TCL43S5017',
      dynamicAttributes: { screen_size: 43, resolution: 'Full HD', smart_tv: true, hdmi_ports: 2 },
      createdBy: nheAdmin?.id,
    },
    {
      shopId: nhe.id,
      categorySlug: 'smartphone',
      brand: 'Realme',
      modelNumber: 'Realme 12 128GB',
      serialNumber: 'SN-RM-12-018',
      mrp: 19999,
      sellingPrice: 17999,
      purchasePrice: 14500,
      color: 'Skyline Blue',
      weightKg: 0.187,
      warrantyMonths: 12,
      barcode: 'RM12128018',
      dynamicAttributes: { imei: '356789042345678', imei2: '356789042345679', ram: '8', storage: '128', os: 'Android' },
      createdBy: nheAdmin?.id,
    },
    {
      shopId: nhe.id,
      categorySlug: 'window-ac',
      brand: 'Blue Star',
      modelNumber: 'WFA312LN',
      serialNumber: 'SN-BS-AC-1W-019',
      mrp: 29990,
      sellingPrice: 26990,
      purchasePrice: 21000,
      color: 'White',
      weightKg: 40,
      warrantyMonths: 12,
      barcode: 'BSWFA312019',
      dynamicAttributes: { tonnage: '1', star_rating: '3' },
      createdBy: nheAdmin?.id,
    },
    {
      shopId: nhe.id,
      categorySlug: 'mixer-grinder',
      brand: 'Bajaj',
      modelNumber: 'GX-1 750W',
      serialNumber: 'SN-BAJ-MG-750-020',
      mrp: 4299,
      sellingPrice: 3799,
      purchasePrice: 2800,
      color: 'White',
      weightKg: 3.8,
      warrantyMonths: 24,
      barcode: 'BAJGX1750020',
      dynamicAttributes: {},
      createdBy: nheAdmin?.id,
    },
  ];

  // Group product definitions by shopId
  const productsByShop = new Map<string, typeof productDefs>();
  for (const def of productDefs) {
    const existing = productsByShop.get(def.shopId) ?? [];
    existing.push(def);
    productsByShop.set(def.shopId, existing);
  }

  // For each shop: create Purchase record, then create/link products
  for (const [shopId, shopProductDefs] of productsByShop) {
    const shopInfo = shopDistributorMap[shopId];
    if (!shopInfo) {
      console.warn(`  No distributor mapping for shop ${shopId}, skipping purchase creation`);
      continue;
    }

    const { distributor, invoiceNumber, adminId } = shopInfo;

    // Calculate total purchase price for this shop's products
    const totalPurchasePrice = shopProductDefs.reduce((sum, p) => sum + p.purchasePrice, 0);

    // Check if purchase already exists by invoiceNumber + shopId
    let purchase: Purchase | null = await prisma.purchase.findFirst({
      where: { invoiceNumber, shopId },
    });

    if (!purchase) {
      purchase = await prisma.purchase.create({
        data: {
          shopId,
          distributorId: distributor.id,
          invoiceNumber,
          invoiceDate: new Date('2026-04-01'),
          totalAmount: totalPurchasePrice,
          gstAmount: Math.round(totalPurchasePrice * 0.18),
          discountAmount: 0,
          netAmount: totalPurchasePrice,
          amountPaid: totalPurchasePrice,
          paymentStatus: 'paid',
          notes: 'Initial stock purchase (seed data)',
          createdBy: adminId,
        },
      });
    }

    // Create products and link to purchase + distributor
    for (const def of shopProductDefs) {
      const category = catBySlug(def.categorySlug);
      if (!category) {
        console.warn(`  Category "${def.categorySlug}" not found, skipping product ${def.modelNumber}`);
        continue;
      }

      // Check if product already exists by serialNumber
      let product: Product | null = null;
      if (def.serialNumber) {
        product = await prisma.product.findFirst({
          where: { serialNumber: def.serialNumber, shopId: def.shopId },
        });
      }

      if (!product) {
        product = await prisma.product.create({
          data: {
            shopId: def.shopId,
            categoryId: category.id,
            brand: def.brand,
            modelNumber: def.modelNumber,
            serialNumber: def.serialNumber ?? null,
            mrp: def.mrp,
            sellingPrice: def.sellingPrice,
            purchasePrice: def.purchasePrice,
            color: def.color ?? null,
            weightKg: def.weightKg ?? null,
            distributorId: distributor.id,
            purchaseId: purchase.id,
            status: 'in_stock',
            dynamicAttributes: def.dynamicAttributes ?? {},
            warrantyMonths: def.warrantyMonths ?? null,
            barcode: def.barcode ?? null,
            createdBy: def.createdBy ?? null,
          },
        });

        // Create initial audit trail entry
        await prisma.productAuditTrail.create({
          data: {
            productId: product.id,
            eventType: 'purchased',
            toShopId: def.shopId,
            performedBy: def.createdBy ?? null,
            notes: `Purchased from ${distributor.companyName} (Invoice: ${invoiceNumber})`,
          },
        });
      } else if (!product.distributorId || !product.purchaseId) {
        // Product exists but missing distributor/purchase link — update it
        // Only update if not already sold (preserve existing sale relationships)
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
  }

  return products;
}
