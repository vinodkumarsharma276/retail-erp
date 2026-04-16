import type { PrismaClient, ProductCategory } from '@prisma/client';

export async function seedCategories(prisma: PrismaClient): Promise<ProductCategory[]> {
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
  ];

  for (let i = 0; i < tree.length; i++) {
    const parent = tree[i];
    // Root categories have null parentId — can't use composite unique upsert
    let parentCat = await prisma.productCategory.findFirst({
      where: { slug: parent.slug, parentId: null },
    });
    if (!parentCat) {
      parentCat = await prisma.productCategory.create({
        data: {
          name: parent.name,
          slug: parent.slug,
          level: 0,
          path: parent.slug,
          displayOrder: i,
          isLeaf: false,
          icon: parent.icon,
        },
      });
    }
    categories.push(parentCat);

    for (let j = 0; j < parent.children.length; j++) {
      const child = parent.children[j];
      let childCat = await prisma.productCategory.findFirst({
        where: { slug: child.slug, parentId: parentCat.id },
      });
      if (!childCat) {
        childCat = await prisma.productCategory.create({
          data: {
            name: child.name,
            slug: child.slug,
            parentId: parentCat.id,
            level: 1,
            path: `${parent.slug}.${child.slug}`,
            displayOrder: j,
            isLeaf: true,
            icon: parent.icon,
          },
        });
      }
      categories.push(childCat);
    }
  }

  // Seed category-specific attributes for leaf categories
  await seedCategoryAttributes(prisma, categories);

  return categories;
}

async function seedCategoryAttributes(prisma: PrismaClient, categories: ProductCategory[]) {
  const attrMap: Record<string, { attributeName: string; attributeLabel: string; attributeType: string; isRequired: boolean; options?: unknown }[]> = {
    'smartphone': [
      { attributeName: 'imei', attributeLabel: 'IMEI Number', attributeType: 'text', isRequired: true },
      { attributeName: 'imei2', attributeLabel: 'IMEI 2', attributeType: 'text', isRequired: false },
      { attributeName: 'ram', attributeLabel: 'RAM (GB)', attributeType: 'select', isRequired: true, options: ['4', '6', '8', '12', '16'] },
      { attributeName: 'storage', attributeLabel: 'Storage (GB)', attributeType: 'select', isRequired: true, options: ['64', '128', '256', '512'] },
      { attributeName: 'os', attributeLabel: 'Operating System', attributeType: 'select', isRequired: false, options: ['Android', 'iOS'] },
    ],
    'feature-phone': [
      { attributeName: 'imei', attributeLabel: 'IMEI Number', attributeType: 'text', isRequired: true },
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
  };

  for (const [slug, attrs] of Object.entries(attrMap)) {
    const cat = categories.find((c) => c.slug === slug);
    if (!cat) continue;

    for (let i = 0; i < attrs.length; i++) {
      const attr = attrs[i];
      await prisma.categoryAttribute.upsert({
        where: { categoryId_attributeName: { categoryId: cat.id, attributeName: attr.attributeName } },
        update: {},
        create: {
          categoryId: cat.id,
          attributeName: attr.attributeName,
          attributeLabel: attr.attributeLabel,
          attributeType: attr.attributeType as any,
          isRequired: attr.isRequired,
          options: attr.options ? attr.options : undefined,
          displayOrder: i,
        },
      });
    }
  }
}
