import { describe, expect, it } from 'vitest';
import { buildUnbilledTypes, unbilledSeriesService } from '../../src/modules/purchases/unbilled-series.js';

/**
 * What the "without a bill" screen offers, and the number it hands out.
 *
 * Anything can turn up without a supplier invoice, so every type is offered.
 * The numbering belongs to the type — a wardrobe and a sofa bought off the
 * books both take a FURN number — but the product is still filed as the
 * wardrobe it is, so the picker has to show both levels.
 */

const category = (
  id: string,
  name: string,
  parentId: string | null,
  purchaseModes: string,
  displayOrder = 0,
) => ({ id, name, parentId, purchaseModes, displayOrder });

const CATEGORIES = [
  category('furn', 'Furniture', null, 'both', 1),
  category('sofa', 'Sofa', 'furn', 'billed', 1),
  category('bed', 'Bed', 'furn', 'billed', 2),
  category('wardrobe', 'Wardrobe', 'furn', 'billed', 3),
  category('almirah', 'Almirah', null, 'unbilled', 2),
  category('mobiles', 'Mobiles', null, 'billed', 3),
  category('samsung', 'Samsung', 'mobiles', 'billed', 1),
];

describe('what the picker offers', () => {
  it('offers every type, since anything may be bought without a bill', () => {
    const types = buildUnbilledTypes(CATEGORIES, []);
    expect(types.map((t) => t.series.categoryName)).toEqual(['Furniture', 'Almirah', 'Mobiles']);
  });

  it('gives a type never marked as unbilled its own numbering all the same', () => {
    const mobiles = buildUnbilledTypes(CATEGORIES, []).find((t) => t.series.categoryId === 'mobiles')!;
    expect(mobiles.series).toMatchObject({ started: false, nextInvoiceNumber: 'MOBI1' });
    expect(mobiles.choices.map((c) => c.categoryName)).toEqual(['Samsung']);
  });

  it('files the goods under the type rather than against it', () => {
    const [furniture] = buildUnbilledTypes(CATEGORIES, []);
    expect(furniture.choices.map((c) => c.categoryName)).toEqual(['Sofa', 'Bed', 'Wardrobe']);
    expect(furniture.choices.map((c) => c.label)).toContain('Furniture › Wardrobe');
  });

  it('offers a type with no kinds beneath it as the choice itself', () => {
    const almirah = buildUnbilledTypes(CATEGORIES, []).find((t) => t.series.categoryId === 'almirah')!;
    expect(almirah.choices).toEqual([
      { categoryId: 'almirah', categoryName: 'Almirah', label: 'Almirah' },
    ]);
  });

  it('suggests the letters the shop already uses, for a type nobody has numbered', () => {
    const types = buildUnbilledTypes(CATEGORIES, []);
    expect(types[0].series).toMatchObject({ started: false, prefix: 'FURN', nextInvoiceNumber: 'FURN1' });
    expect(types[1].series).toMatchObject({ started: false, prefix: 'ALMR', nextInvoiceNumber: 'ALMR1' });
  });

  it('says where a started series has reached', () => {
    const types = buildUnbilledTypes(CATEGORIES, [
      { categoryId: 'furn', prefix: 'FURN', nextNumber: 7 },
      { categoryId: 'almirah', prefix: 'ALMR', nextNumber: 46 },
    ]);
    expect(types[0].series).toMatchObject({ started: true, nextInvoiceNumber: 'FURN7' });
    expect(types[1].series).toMatchObject({ started: true, nextInvoiceNumber: 'ALMR46' });
  });

  it('gives a type nested inside another its own numbering, not its parent’s', () => {
    const nested = [...CATEGORIES, category('recliner', 'Recliner', 'furn', 'unbilled', 4)];
    const types = buildUnbilledTypes(nested, []);
    expect(types.map((t) => t.series.categoryName).sort()).toEqual([
      'Almirah', 'Furniture', 'Mobiles', 'Recliner',
    ]);
    const furniture = types.find((t) => t.series.categoryId === 'furn')!;
    expect(furniture.choices.map((c) => c.categoryId)).not.toContain('recliner');
  });
});

describe('taking the next number', () => {
  const fakeSeries = (prefix: string, nextNumber: number) => {
    const row = { id: 's1', prefix, nextNumber };
    return {
      row,
      tx: {
        purchaseInvoiceSeries: {
          findFirst: async () => row,
          update: async ({ data }: { data: { nextNumber: { increment: number } } }) => {
            row.nextNumber += data.nextNumber.increment;
            return { ...row };
          },
        },
      },
    };
  };

  it('hands out the number the series is on and moves it along', async () => {
    const { row, tx } = fakeSeries('FURN', 7);
    expect(await unbilledSeriesService.take(tx, 'tenant', 'furn')).toBe('FURN7');
    expect(row.nextNumber).toBe(8);
  });

  it('never hands the same number out twice', async () => {
    const { tx } = fakeSeries('ALMR', 41);
    const issued = [
      await unbilledSeriesService.take(tx, 'tenant', 'almirah'),
      await unbilledSeriesService.take(tx, 'tenant', 'almirah'),
      await unbilledSeriesService.take(tx, 'tenant', 'almirah'),
    ];
    expect(issued).toEqual(['ALMR41', 'ALMR42', 'ALMR43']);
  });

  it('refuses when nobody has said where the numbering starts', async () => {
    const tx = {
      purchaseInvoiceSeries: { findFirst: async () => null, update: async () => undefined },
    };
    await expect(unbilledSeriesService.take(tx, 'tenant', 'furn')).rejects.toThrow(
      /no numbering yet/,
    );
  });
});
