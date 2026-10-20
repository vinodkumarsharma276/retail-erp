import { prisma } from '../../config/database.js';
import type { ProductCategory, CategoryAttribute } from '@prisma/client';

interface CategoryTreeNode {
  id: string;
  name: string;
  slug: string;
  parentId: string | null;
  level: number;
  path: string;
  displayOrder: number;
  isLeaf: boolean;
  purchaseModes: string;
  icon: string | null;
  hsnCode: string | null;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
  children: CategoryTreeNode[];
}

/** Raised when a category would be the second of its name in the same place. */
export class DuplicateCategoryError extends Error {}

/**
 * The sibling that already is what this category is about to become.
 *
 * Two types of the same name side by side split one kind of goods across two
 * rows — some products filed under the first, some under the second, both
 * showing in every picker, and nothing in the tree to say which is the real
 * one. So a name, and a slug, may appear only once among the categories that
 * sit together under the same parent.
 *
 * The database cannot see this on its own. Its unique index is on
 * (slug, parent_id), and Postgres counts two NULL parents as different
 * values, so nothing down there stops a second top-level row — which is
 * exactly where the shop adds most of its types.
 *
 * Switched-off categories count: re-adding one by name would leave two rows
 * wearing the same name, which is the muddle this guards against.
 */
export function siblingClash<T extends { id: string; name: string; slug: string }>(
  siblings: T[],
  candidate: { name: string; slug: string; exceptId?: string },
): T | null {
  const name = candidate.name.trim().toLowerCase();
  const slug = candidate.slug.trim().toLowerCase();
  return (
    siblings.find(
      (sibling) =>
        sibling.id !== candidate.exceptId &&
        (sibling.name.trim().toLowerCase() === name || sibling.slug.trim().toLowerCase() === slug),
    ) ?? null
  );
}

/** What to tell somebody who has just tried to add a type twice. */
export function clashMessage(
  clash: { name: string; isActive: boolean },
  parentName: string | null,
): string {
  const place = parentName ? ` under ${parentName}` : '';
  return clash.isActive
    ? `${clash.name} is already there${place}.`
    : `${clash.name} is already there${place}, switched off. Switch it back on rather than adding it again.`;
}

/** Stop before writing a category that would be the second of its name. */
async function assertNoSiblingClash(
  parentId: string | null,
  candidate: { name: string; slug: string; exceptId?: string },
) {
  const siblings = await prisma.productCategory.findMany({
    where: { parentId },
    select: { id: true, name: true, slug: true, isActive: true },
  });
  const clash = siblingClash(siblings, candidate);
  if (!clash) return;

  const parent = parentId
    ? await prisma.productCategory.findUnique({ where: { id: parentId }, select: { name: true } })
    : null;
  throw new DuplicateCategoryError(clashMessage(clash, parent?.name ?? null));
}

export const categoriesService = {
  async getTree(): Promise<CategoryTreeNode[]> {
    const all = await prisma.productCategory.findMany({
      where: { isActive: true },
      orderBy: [{ level: 'asc' }, { displayOrder: 'asc' }],
    });

    // Build tree in memory
    const nodeMap = new Map<string, CategoryTreeNode>();
    const roots: CategoryTreeNode[] = [];

    for (const cat of all) {
      nodeMap.set(cat.id, { ...cat, children: [] });
    }

    for (const cat of all) {
      const node = nodeMap.get(cat.id)!;
      if (cat.parentId && nodeMap.has(cat.parentId)) {
        nodeMap.get(cat.parentId)!.children.push(node);
      } else {
        roots.push(node);
      }
    }

    return roots;
  },

  async getById(id: string) {
    const category = await prisma.productCategory.findUnique({
      where: { id },
      include: {
        attributes: {
          where: { isActive: true },
          orderBy: { displayOrder: 'asc' },
        },
        parent: {
          select: { id: true, name: true, slug: true },
        },
      },
    });
    return category;
  },

  async create(data: {
    name: string;
    slug: string;
    parentId?: string | null;
    isLeaf?: boolean;
    icon?: string | null;
    hsnCode?: string;
    displayOrder?: number;
    purchaseModes?: string;
  }) {
    let level = 0;
    let path = data.slug;

    if (data.parentId) {
      const parent = await prisma.productCategory.findUnique({
        where: { id: data.parentId },
      });
      if (!parent) {
        throw new Error('Parent category not found');
      }
      level = parent.level + 1;
      path = `${parent.path}.${data.slug}`;
    }

    await assertNoSiblingClash(data.parentId ?? null, { name: data.name, slug: data.slug });

    const category = await prisma.productCategory.create({
      data: {
        name: data.name,
        slug: data.slug,
        parentId: data.parentId ?? null,
        level,
        path,
        displayOrder: data.displayOrder ?? 0,
        isLeaf: data.isLeaf ?? false,
        icon: data.icon ?? null,
        hsnCode: data.hsnCode ?? null,
        // Billed unless the shop says otherwise, which is how goods arrive
        // for all but a few types.
        purchaseModes: data.purchaseModes ?? 'billed',
      },
    });

    return category;
  },

  async update(id: string, data: {
    purchaseModes?: string;
    name?: string;
    slug?: string;
    parentId?: string | null;
    isLeaf?: boolean;
    icon?: string | null;
    hsnCode?: string | null;
    displayOrder?: number;
    isActive?: boolean;
  }) {
    const existing = await prisma.productCategory.findUnique({ where: { id } });
    if (!existing) {
      return null;
    }

    // If parentId or slug changed, recalculate level and path
    const updateData: Record<string, unknown> = { ...data };

    const newSlug = data.slug ?? existing.slug;
    const newParentId = data.parentId !== undefined ? data.parentId : existing.parentId;

    if (data.slug !== undefined || data.parentId !== undefined) {
      if (newParentId) {
        const parent = await prisma.productCategory.findUnique({
          where: { id: newParentId },
        });
        if (!parent) {
          throw new Error('Parent category not found');
        }
        updateData.level = parent.level + 1;
        updateData.path = `${parent.path}.${newSlug}`;
      } else {
        updateData.level = 0;
        updateData.path = newSlug;
      }
    }

    // A rename, a new slug or a move can all land this category beside one
    // that is already what it is about to be.
    if (data.name !== undefined || data.slug !== undefined || data.parentId !== undefined) {
      await assertNoSiblingClash(newParentId, {
        name: data.name ?? existing.name,
        slug: newSlug,
        exceptId: id,
      });
    }

    const updated = await prisma.productCategory.update({
      where: { id },
      data: updateData,
    });

    return updated;
  },

  async softDelete(id: string) {
    const existing = await prisma.productCategory.findUnique({ where: { id } });
    if (!existing) {
      return null;
    }

    // Check if any products exist in this category
    const productCount = await prisma.product.count({
      where: { categoryId: id },
    });
    if (productCount > 0) {
      throw new Error(`Cannot delete category with ${productCount} product(s). Move or remove products first.`);
    }

    // Also check children categories
    const childCount = await prisma.productCategory.count({
      where: { parentId: id, isActive: true },
    });
    if (childCount > 0) {
      throw new Error(`Cannot delete category with ${childCount} active child category/categories. Delete children first.`);
    }

    const updated = await prisma.productCategory.update({
      where: { id },
      data: { isActive: false },
    });

    return updated;
  },

  async getAttributes(categoryId: string) {
    const category = await prisma.productCategory.findUnique({
      where: { id: categoryId },
    });
    if (!category) {
      return null;
    }

    const attributes = await prisma.categoryAttribute.findMany({
      where: { categoryId, isActive: true },
      orderBy: { displayOrder: 'asc' },
    });

    return attributes;
  },

  async addAttribute(categoryId: string, data: {
    attributeName: string;
    attributeLabel: string;
    attributeType: string;
    isRequired?: boolean;
    validationRules?: unknown;
    options?: unknown;
    displayOrder?: number;
  }) {
    const category = await prisma.productCategory.findUnique({
      where: { id: categoryId },
    });
    if (!category) {
      throw new Error('Category not found');
    }

    const attribute = await prisma.categoryAttribute.create({
      data: {
        categoryId,
        attributeName: data.attributeName,
        attributeLabel: data.attributeLabel,
        attributeType: data.attributeType as any,
        isRequired: data.isRequired ?? false,
        validationRules: data.validationRules ? data.validationRules as any : undefined,
        options: data.options ? data.options as any : undefined,
        displayOrder: data.displayOrder ?? 0,
      },
    });

    return attribute;
  },

  async updateAttribute(attrId: string, data: {
    attributeName?: string;
    attributeLabel?: string;
    attributeType?: string;
    isRequired?: boolean;
    validationRules?: unknown;
    options?: unknown;
    displayOrder?: number;
    isActive?: boolean;
  }) {
    const existing = await prisma.categoryAttribute.findUnique({
      where: { id: attrId },
    });
    if (!existing) {
      return null;
    }

    const updated = await prisma.categoryAttribute.update({
      where: { id: attrId },
      data: data as any,
    });

    return updated;
  },

  async deleteAttribute(attrId: string) {
    const existing = await prisma.categoryAttribute.findUnique({
      where: { id: attrId },
    });
    if (!existing) {
      return null;
    }

    // Soft delete by marking inactive
    const updated = await prisma.categoryAttribute.update({
      where: { id: attrId },
      data: { isActive: false },
    });

    return updated;
  },
};
