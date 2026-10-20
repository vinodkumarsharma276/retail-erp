import { describe, expect, it } from 'vitest';
import { tenantContext } from '../../src/config/tenant-context.js';
import { categoriesService, DuplicateCategoryError } from '../../src/modules/categories/categories.service.js';
import { createInstallmentSale, prisma } from '../helpers/fixtures';

/**
 * C — No type twice in the same place.
 *
 * The database cannot enforce this for the top level on its own: the unique
 * index is on (slug, parent_id), and Postgres counts two NULL parents as
 * different values, so two top-level rows of the same name go straight in.
 * These tests run against the real database to prove the guard above it
 * actually holds, and that a tenant's own tree is all it is measured against.
 */
describe('C. Duplicate categories', () => {
  it('C1 refuses a second top-level type of the same name', async () => {
    const { tenantId } = await createInstallmentSale({ emis: [{ due: '2026-11-04', amount: 1000 }] });

    await tenantContext.runAs(tenantId, () =>
      categoriesService.create({ name: 'Geyser', slug: 'geyser', parentId: null }),
    );

    await expect(
      tenantContext.runAs(tenantId, () =>
        categoriesService.create({ name: 'Geyser', slug: 'water-heater', parentId: null }),
      ),
    ).rejects.toThrow(DuplicateCategoryError);

    const rows = await prisma.productCategory.findMany({ where: { tenantId, name: 'Geyser' } });
    expect(rows).toHaveLength(1);
  });

  it('C2 refuses a second top-level type reusing the same slug', async () => {
    const { tenantId } = await createInstallmentSale({ emis: [{ due: '2026-11-04', amount: 1000 }] });

    await tenantContext.runAs(tenantId, () =>
      categoriesService.create({ name: 'Fan', slug: 'fan', parentId: null }),
    );

    await expect(
      tenantContext.runAs(tenantId, () =>
        categoriesService.create({ name: 'Ceiling Fan', slug: 'fan', parentId: null }),
      ),
    ).rejects.toThrow(DuplicateCategoryError);

    const rows = await prisma.productCategory.findMany({ where: { tenantId, slug: 'fan' } });
    expect(rows).toHaveLength(1);
  });

  it('C3 refuses a second child of the same name under one parent', async () => {
    const { tenantId } = await createInstallmentSale({ emis: [{ due: '2026-11-04', amount: 1000 }] });

    const furniture = await tenantContext.runAs(tenantId, () =>
      categoriesService.create({ name: 'Furniture', slug: 'furniture', parentId: null }),
    );
    await tenantContext.runAs(tenantId, () =>
      categoriesService.create({ name: 'Sofa', slug: 'sofa', parentId: furniture.id, isLeaf: true }),
    );

    await expect(
      tenantContext.runAs(tenantId, () =>
        categoriesService.create({ name: 'Sofa', slug: 'couch', parentId: furniture.id, isLeaf: true }),
      ),
    ).rejects.toThrow(/already there under Furniture/);
  });

  it('C4 refuses a rename onto a sibling, and leaves the category as it was', async () => {
    const { tenantId } = await createInstallmentSale({ emis: [{ due: '2026-11-04', amount: 1000 }] });

    await tenantContext.runAs(tenantId, () =>
      categoriesService.create({ name: 'Almirah', slug: 'almirah', parentId: null }),
    );
    const speaker = await tenantContext.runAs(tenantId, () =>
      categoriesService.create({ name: 'Speaker', slug: 'speaker', parentId: null }),
    );

    await expect(
      tenantContext.runAs(tenantId, () => categoriesService.update(speaker.id, { name: 'Almirah' })),
    ).rejects.toThrow(DuplicateCategoryError);

    const unchanged = await prisma.productCategory.findUniqueOrThrow({ where: { id: speaker.id } });
    expect(unchanged.name).toBe('Speaker');
  });

  it('C5 lets a category keep its own name when something else about it is edited', async () => {
    const { tenantId } = await createInstallmentSale({ emis: [{ due: '2026-11-04', amount: 1000 }] });

    const microphone = await tenantContext.runAs(tenantId, () =>
      categoriesService.create({ name: 'Microphone', slug: 'microphone', parentId: null }),
    );
    const saved = await tenantContext.runAs(tenantId, () =>
      categoriesService.update(microphone.id, { name: 'Microphone', hsnCode: '8518' }),
    );
    expect(saved?.hsnCode).toBe('8518');
  });

  it('C6 is no business of another tenant\'s tree: the same name may exist in both', async () => {
    const a = await createInstallmentSale({ emis: [{ due: '2026-11-04', amount: 1000 }] });
    const b = await createInstallmentSale({ emis: [{ due: '2026-11-04', amount: 1000 }] });

    const mine = await tenantContext.runAs(a.tenantId, () =>
      categoriesService.create({ name: 'Sewing Machine', slug: 'sewing-machine', parentId: null }),
    );
    const theirs = await tenantContext.runAs(b.tenantId, () =>
      categoriesService.create({ name: 'Sewing Machine', slug: 'sewing-machine', parentId: null }),
    );

    expect(mine.id).not.toBe(theirs.id);
    expect(mine.tenantId).toBe(a.tenantId);
    expect(theirs.tenantId).toBe(b.tenantId);
  });
});
