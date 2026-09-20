import type { PrismaClient, ProductCategory } from '@prisma/client';

// Standard Indian GST HSN codes per product category.
// Leaf entries inherit their parent's code unless overridden.
const HSN_CODES: Record<string, string> = {
  // TVs - HSN 8528
  'tv': '8528',
  'led-tv': '8528',
  'oled-tv': '8528',
  'qled-tv': '8528',
  'plasma-tv': '8528',
  // Mobile - HSN 8517
  'mobile': '8517',
  'smartphone': '8517',
  'feature-phone': '8517',
  // Washing machines - HSN 8450
  'washing-machine': '8450',
  'top-load': '8450',
  'front-load': '8450',
  'semi-automatic': '8450',
  // Air conditioners - HSN 8415
  'ac': '8415',
  'window-ac': '8415',
  'split-ac': '8415',
  'tower-ac': '8415',
  // Refrigerators - HSN 8418
  'refrigerator': '8418',
  'single-door': '8418',
  'double-door': '8418',
  'side-by-side': '8418',
  // Furniture - HSN 9403
  'furniture': '9403',
  'sofa': '9403',
  'bed': '9403',
  'dining-table': '9403',
  'wardrobe': '9403',
  // Small appliances
  'small-appliances': '8509',
  'mixer-grinder': '8509',
  'water-purifier': '8421',
  'iron': '8516',
  // Batteries - HSN 8507 (electric accumulators: lead-acid, lithium-ion, etc.)
  'battery': '8507',
  'inverter-battery': '8507',
  'automotive-battery': '8507',
  'ups-battery': '8507',
};

export async function seedCategories(prisma: PrismaClient, tenantId: string): Promise<ProductCategory[]> {
  const categories: ProductCategory[] = [];

  // Root categories with subcategories
  const tree = [
    {
      name: 'TV', slug: 'tv', icon: 'tv', children: [
        { name: 'LED TV', slug: 'led-tv' },
        { name: 'OLED TV', slug: 'oled-tv' },
        { name: 'QLED TV', slug: 'qled-tv' },
        { name: 'Plasma TV', slug: 'plasma-tv' },
      ],
    },
    {
      name: 'Mobile', slug: 'mobile', icon: 'smartphone', children: [
        { name: 'Smartphone', slug: 'smartphone' },
        { name: 'Feature Phone', slug: 'feature-phone' },
      ],
    },
    {
      name: 'Washing Machine', slug: 'washing-machine', icon: 'washing-machine', children: [
        { name: 'Top Load', slug: 'top-load' },
        { name: 'Front Load', slug: 'front-load' },
        { name: 'Semi Automatic', slug: 'semi-automatic' },
      ],
    },
    {
      name: 'AC', slug: 'ac', icon: 'snowflake', children: [
        { name: 'Window AC', slug: 'window-ac' },
        { name: 'Split AC', slug: 'split-ac' },
        { name: 'Tower AC', slug: 'tower-ac' },
      ],
    },
    {
      name: 'Refrigerator', slug: 'refrigerator', icon: 'refrigerator', children: [
        { name: 'Single Door', slug: 'single-door' },
        { name: 'Double Door', slug: 'double-door' },
        { name: 'Side by Side', slug: 'side-by-side' },
      ],
    },
    {
      name: 'Furniture', slug: 'furniture', icon: 'sofa', children: [
        { name: 'Sofa', slug: 'sofa' },
        { name: 'Bed', slug: 'bed' },
        { name: 'Dining Table', slug: 'dining-table' },
        { name: 'Wardrobe', slug: 'wardrobe' },
      ],
    },
    {
      name: 'Small Appliances', slug: 'small-appliances', icon: 'zap', children: [
        { name: 'Mixer Grinder', slug: 'mixer-grinder' },
        { name: 'Water Purifier', slug: 'water-purifier' },
        { name: 'Iron', slug: 'iron' },
      ],
    },
    {
      name: 'Battery', slug: 'battery', icon: 'battery', children: [
        { name: 'Inverter Battery', slug: 'inverter-battery' },
        { name: 'Automotive Battery', slug: 'automotive-battery' },
        { name: 'UPS Battery', slug: 'ups-battery' },
      ],
    },
  ];

  for (let i = 0; i < tree.length; i++) {
    const parent = tree[i];
    // Root categories have null parentId — can't use composite unique upsert
    let parentCat = await prisma.productCategory.findFirst({
      where: { tenantId, slug: parent.slug, parentId: null },
    });
    if (!parentCat) {
      parentCat = await prisma.productCategory.create({
        data: {
          name: parent.name,
          tenantId,
          slug: parent.slug,
          level: 0,
          path: parent.slug,
          displayOrder: i,
          isLeaf: false,
          icon: parent.icon,
          hsnCode: HSN_CODES[parent.slug] ?? null,
        },
      });
    } else if (!parentCat.hsnCode && HSN_CODES[parent.slug]) {
      parentCat = await prisma.productCategory.update({
        where: { id: parentCat.id },
        data: { hsnCode: HSN_CODES[parent.slug] },
      });
    }
    categories.push(parentCat);

    for (let j = 0; j < parent.children.length; j++) {
      const child = parent.children[j];
      let childCat = await prisma.productCategory.findFirst({
        where: { tenantId, slug: child.slug, parentId: parentCat.id },
      });
      if (!childCat) {
        childCat = await prisma.productCategory.create({
          data: {
            name: child.name,
            tenantId,
            slug: child.slug,
            parentId: parentCat.id,
            level: 1,
            path: `${parent.slug}.${child.slug}`,
            displayOrder: j,
            isLeaf: true,
            icon: parent.icon,
            hsnCode: HSN_CODES[child.slug] ?? HSN_CODES[parent.slug] ?? null,
          },
        });
      } else if (!childCat.hsnCode && (HSN_CODES[child.slug] || HSN_CODES[parent.slug])) {
        childCat = await prisma.productCategory.update({
          where: { id: childCat.id },
          data: { hsnCode: HSN_CODES[child.slug] ?? HSN_CODES[parent.slug] },
        });
      }
      categories.push(childCat);
    }
  }

  // Seed category-specific attributes for leaf categories
  await seedCategoryAttributes(prisma, categories, tenantId);

  return categories;
}

async function seedCategoryAttributes(prisma: PrismaClient, categories: ProductCategory[], tenantId: string) {
  // Brand options per leaf category slug
  const brandMap: Record<string, string[]> = {
    'led-tv': ['Samsung', 'LG', 'Sony', 'TCL', 'Mi', 'OnePlus', 'Vu', 'Hisense'],
    'oled-tv': ['Samsung', 'LG', 'Sony'],
    'qled-tv': ['Samsung', 'TCL', 'Hisense'],
    'plasma-tv': ['Samsung', 'LG', 'Panasonic'],
    'smartphone': ['Samsung', 'Apple', 'Xiaomi', 'OnePlus', 'Vivo', 'Oppo', 'Realme', 'Nothing', 'Google'],
    'feature-phone': ['Nokia', 'Samsung', 'Lava', 'Micromax', 'Jio'],
    'top-load': ['Samsung', 'LG', 'Whirlpool', 'Godrej', 'IFB', 'Bosch'],
    'front-load': ['Samsung', 'LG', 'IFB', 'Bosch', 'Whirlpool'],
    'semi-automatic': ['Samsung', 'LG', 'Whirlpool', 'Godrej'],
    'window-ac': ['Blue Star', 'Voltas', 'Lloyd', 'Carrier', 'Hitachi'],
    'split-ac': ['LG', 'Samsung', 'Daikin', 'Blue Star', 'Voltas', 'Carrier', 'Lloyd', 'Hitachi'],
    'tower-ac': ['Blue Star', 'Voltas', 'Carrier'],
    'single-door': ['Samsung', 'LG', 'Whirlpool', 'Godrej', 'Haier'],
    'double-door': ['Samsung', 'LG', 'Whirlpool', 'Godrej', 'Haier', 'Bosch'],
    'side-by-side': ['Samsung', 'LG', 'Whirlpool', 'Bosch', 'Haier'],
    'sofa': ['Godrej', 'Nilkamal', 'Durian', 'Urban Ladder', 'Pepperfry', 'Wakefit'],
    'bed': ['Godrej', 'Nilkamal', 'Durian', 'Urban Ladder', 'Wakefit'],
    'dining-table': ['Godrej', 'Nilkamal', 'Durian', 'Urban Ladder', 'HomeTown'],
    'wardrobe': ['Godrej', 'Nilkamal', 'Durian', 'Urban Ladder'],
    'mixer-grinder': ['Bajaj', 'Preethi', 'Philips', 'Butterfly', 'Maharaja Whiteline'],
    'water-purifier': ['Kent', 'Aquaguard', 'Pureit', 'Livpure', 'Blue Star'],
    'iron': ['Philips', 'Bajaj', 'Morphy Richards', 'Havells', 'Usha'],
    'inverter-battery': ['Exide', 'Amaron', 'Luminous', 'Livguard', 'Microtek', 'Okaya', 'SF Sonic', 'Tata Green'],
    'automotive-battery': ['Exide', 'Amaron', 'SF Sonic', 'Tata Green', 'Livguard', 'Bosch', 'ACDelco'],
    'ups-battery': ['Exide', 'Amaron', 'Luminous', 'Livguard', 'APC', 'Microtek', 'Okaya'],
  };

  // Other category-specific attributes (displayOrder will be shifted by +1 to make room for brand at 0).
  // For multi_text fields, `options` holds the validation rules
  // (pattern / minItems / maxItems) since multi_text doesn't carry a list
  // of dropdown choices. The seed loop below routes these into the
  // dedicated `validationRules` column on insert.
  const attrMap: Record<string, { attributeName: string; attributeLabel: string; attributeType: string; isRequired: boolean; options?: unknown }[]> = {
    'smartphone': [
      // Multi-IMEI: most modern smartphones carry 2 IMEIs (dual-SIM); some
      // hybrid eSIM phones go up to 3. Stored as `string[]` in
      // dynamicAttributes.imeiNumbers, validated as 15-digit numeric.
      { attributeName: 'imeiNumbers', attributeLabel: 'IMEI Number', attributeType: 'multi_text', isRequired: true, options: { pattern: '^\\d{15}$', patternMessage: 'IMEI must be 15 digits', minItems: 1, maxItems: 3 } },
      { attributeName: 'ram', attributeLabel: 'RAM (GB)', attributeType: 'select', isRequired: true, options: ['4', '6', '8', '12', '16'] },
      { attributeName: 'storage', attributeLabel: 'Storage (GB)', attributeType: 'select', isRequired: true, options: ['64', '128', '256', '512'] },
      { attributeName: 'os', attributeLabel: 'Operating System', attributeType: 'select', isRequired: false, options: ['Android', 'iOS'] },
    ],
    'feature-phone': [
      { attributeName: 'imeiNumbers', attributeLabel: 'IMEI Number', attributeType: 'multi_text', isRequired: true, options: { pattern: '^\\d{15}$', patternMessage: 'IMEI must be 15 digits', minItems: 1, maxItems: 3 } },
    ],
    'split-ac': [
      { attributeName: 'tonnage', attributeLabel: 'Tonnage', attributeType: 'select', isRequired: true, options: ['1', '1.5', '2'] },
      { attributeName: 'star_rating', attributeLabel: 'Star Rating', attributeType: 'select', isRequired: true, options: ['1', '2', '3', '4', '5'] },
      { attributeName: 'inverter', attributeLabel: 'Inverter', attributeType: 'checkbox', isRequired: false },
      { attributeName: 'refrigerant', attributeLabel: 'Refrigerant', attributeType: 'select', isRequired: false, options: ['R32', 'R410A', 'R22'] },
    ],
    'window-ac': [
      { attributeName: 'tonnage', attributeLabel: 'Tonnage', attributeType: 'select', isRequired: true, options: ['1', '1.5', '2'] },
      { attributeName: 'star_rating', attributeLabel: 'Star Rating', attributeType: 'select', isRequired: true, options: ['1', '2', '3', '4', '5'] },
    ],
    'tower-ac': [
      { attributeName: 'tonnage', attributeLabel: 'Tonnage', attributeType: 'select', isRequired: true, options: ['2', '2.5', '3'] },
      { attributeName: 'star_rating', attributeLabel: 'Star Rating', attributeType: 'select', isRequired: true, options: ['3', '4', '5'] },
    ],
    'led-tv': [
      { attributeName: 'screen_size', attributeLabel: 'Screen Size (inches)', attributeType: 'number', isRequired: true },
      { attributeName: 'resolution', attributeLabel: 'Resolution', attributeType: 'select', isRequired: true, options: ['HD', 'Full HD', '4K', '8K'] },
      { attributeName: 'smart_tv', attributeLabel: 'Smart TV', attributeType: 'checkbox', isRequired: false },
      { attributeName: 'hdmi_ports', attributeLabel: 'HDMI Ports', attributeType: 'number', isRequired: false },
    ],
    'oled-tv': [
      { attributeName: 'screen_size', attributeLabel: 'Screen Size (inches)', attributeType: 'number', isRequired: true },
      { attributeName: 'resolution', attributeLabel: 'Resolution', attributeType: 'select', isRequired: true, options: ['4K', '8K'] },
      { attributeName: 'smart_tv', attributeLabel: 'Smart TV', attributeType: 'checkbox', isRequired: false },
    ],
    'qled-tv': [
      { attributeName: 'screen_size', attributeLabel: 'Screen Size (inches)', attributeType: 'number', isRequired: true },
      { attributeName: 'resolution', attributeLabel: 'Resolution', attributeType: 'select', isRequired: true, options: ['4K', '8K'] },
      { attributeName: 'smart_tv', attributeLabel: 'Smart TV', attributeType: 'checkbox', isRequired: false },
    ],
    'sofa': [
      { attributeName: 'material', attributeLabel: 'Material', attributeType: 'select', isRequired: true, options: ['Wood', 'Metal', 'Fabric', 'Leather', 'Rexine'] },
      { attributeName: 'seating_capacity', attributeLabel: 'Seating Capacity', attributeType: 'select', isRequired: true, options: ['2', '3', '4', '5', '6+'] },
      { attributeName: 'dimensions', attributeLabel: 'Dimensions (LxWxH cm)', attributeType: 'text', isRequired: false },
    ],
    'bed': [
      { attributeName: 'material', attributeLabel: 'Material', attributeType: 'select', isRequired: true, options: ['Wood', 'Metal', 'Engineered Wood'] },
      { attributeName: 'size', attributeLabel: 'Size', attributeType: 'select', isRequired: true, options: ['Single', 'Double', 'Queen', 'King'] },
      { attributeName: 'storage', attributeLabel: 'With Storage', attributeType: 'checkbox', isRequired: false },
    ],
    'single-door': [
      { attributeName: 'capacity_litres', attributeLabel: 'Capacity (Litres)', attributeType: 'number', isRequired: true },
      { attributeName: 'star_rating', attributeLabel: 'Star Rating', attributeType: 'select', isRequired: true, options: ['1', '2', '3', '4', '5'] },
    ],
    'double-door': [
      { attributeName: 'capacity_litres', attributeLabel: 'Capacity (Litres)', attributeType: 'number', isRequired: true },
      { attributeName: 'star_rating', attributeLabel: 'Star Rating', attributeType: 'select', isRequired: true, options: ['2', '3', '4', '5'] },
      { attributeName: 'frost_free', attributeLabel: 'Frost Free', attributeType: 'checkbox', isRequired: false },
    ],
    'top-load': [
      { attributeName: 'capacity_kg', attributeLabel: 'Capacity (KG)', attributeType: 'select', isRequired: true, options: ['6', '6.5', '7', '7.5', '8', '9', '10'] },
      { attributeName: 'fully_automatic', attributeLabel: 'Fully Automatic', attributeType: 'checkbox', isRequired: false },
    ],
    'front-load': [
      { attributeName: 'capacity_kg', attributeLabel: 'Capacity (KG)', attributeType: 'select', isRequired: true, options: ['6', '7', '8', '9', '10'] },
      { attributeName: 'rpm', attributeLabel: 'Max RPM', attributeType: 'number', isRequired: false },
    ],
    'inverter-battery': [
      { attributeName: 'capacity_ah', attributeLabel: 'Capacity (Ah)', attributeType: 'select', isRequired: true, options: ['80', '100', '120', '135', '150', '180', '200', '220'] },
      { attributeName: 'voltage', attributeLabel: 'Voltage (V)', attributeType: 'select', isRequired: true, options: ['12', '24'] },
      { attributeName: 'battery_type', attributeLabel: 'Battery Type', attributeType: 'select', isRequired: true, options: ['Tubular', 'Flat Plate', 'Gel', 'Lithium-Ion', 'SMF'] },
    ],
    'automotive-battery': [
      { attributeName: 'capacity_ah', attributeLabel: 'Capacity (Ah)', attributeType: 'select', isRequired: true, options: ['32', '35', '38', '40', '45', '55', '60', '65', '70', '80', '100'] },
      { attributeName: 'voltage', attributeLabel: 'Voltage (V)', attributeType: 'select', isRequired: true, options: ['6', '12'] },
      { attributeName: 'vehicle_type', attributeLabel: 'Vehicle Type', attributeType: 'select', isRequired: true, options: ['Car', 'Bike', 'Auto Rickshaw', 'Tractor', 'Truck/Bus', 'Commercial Vehicle'] },
      { attributeName: 'battery_type', attributeLabel: 'Battery Type', attributeType: 'select', isRequired: false, options: ['Lead Acid', 'Maintenance Free (MF)', 'AGM', 'Lithium-Ion'] },
    ],
    'ups-battery': [
      { attributeName: 'capacity_ah', attributeLabel: 'Capacity (Ah)', attributeType: 'select', isRequired: true, options: ['7', '9', '12', '18', '26', '42', '65', '100'] },
      { attributeName: 'voltage', attributeLabel: 'Voltage (V)', attributeType: 'select', isRequired: true, options: ['6', '12'] },
      { attributeName: 'battery_type', attributeLabel: 'Battery Type', attributeType: 'select', isRequired: false, options: ['SMF / VRLA', 'Lead Acid', 'Lithium-Ion'] },
    ],
  };

  // First, seed brand attributes for ALL leaf categories (displayOrder = 0)
  for (const [slug, brands] of Object.entries(brandMap)) {
    const cat = categories.find((c) => c.slug === slug);
    if (!cat) continue;

    await prisma.categoryAttribute.upsert({
      where: { categoryId_attributeName: { categoryId: cat.id, attributeName: 'brand' } },
      update: {
        options: brands,
        displayOrder: 0,
      },
      create: {
        tenantId,
        categoryId: cat.id,
        attributeName: 'brand',
        attributeLabel: 'Brand',
        attributeType: 'select' as any,
        isRequired: true,
        options: brands,
        displayOrder: 0,
      },
    });
  }

  // Then seed other attributes with displayOrder shifted by +1 (brand is at 0)
  for (const [slug, attrs] of Object.entries(attrMap)) {
    const cat = categories.find((c) => c.slug === slug);
    if (!cat) continue;

    for (let i = 0; i < attrs.length; i++) {
      const attr = attrs[i];
      // For multi_text the `options` payload above is actually the
      // validation rules object — store it in the right column.
      const isMultiText = attr.attributeType === 'multi_text';
      const optionsValue = isMultiText ? undefined : attr.options;
      const validationRulesValue = isMultiText ? attr.options : undefined;
      await prisma.categoryAttribute.upsert({
        where: { categoryId_attributeName: { categoryId: cat.id, attributeName: attr.attributeName } },
        update: {
          displayOrder: i + 1,
          attributeType: attr.attributeType as any,
          isRequired: attr.isRequired,
          options: optionsValue ? (optionsValue as any) : undefined,
          validationRules: validationRulesValue ? (validationRulesValue as any) : undefined,
          isActive: true,
        },
        create: {
          tenantId,
          categoryId: cat.id,
          attributeName: attr.attributeName,
          attributeLabel: attr.attributeLabel,
          attributeType: attr.attributeType as any,
          isRequired: attr.isRequired,
          options: optionsValue ? (optionsValue as any) : undefined,
          validationRules: validationRulesValue ? (validationRulesValue as any) : undefined,
          displayOrder: i + 1,
        },
      });
    }
  }
}
