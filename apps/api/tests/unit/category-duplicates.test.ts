import { describe, expect, it } from 'vitest';
import { clashMessage, siblingClash } from '../../src/modules/categories/categories.service.js';

/**
 * One row per type, in the place it belongs.
 *
 * The shop adds most of its product types at the top level — Fan, Geyser,
 * Speaker — and the database cannot stop a second one of those on its own:
 * its unique index is on (slug, parent_id), and Postgres counts two NULL
 * parents as different values, so two top-level "Fan" rows slip straight
 * past it. Everything downstream then shows the type twice and its products
 * end up split between the two.
 */

const row = (id: string, name: string, slug: string, isActive = true) => ({ id, name, slug, isActive });

const ROOTS = [
  row('fan', 'Fan', 'fan'),
  row('furn', 'Furniture', 'furniture'),
  row('almirah', 'Almirah', 'almirah'),
];

describe('adding a type that is already there', () => {
  it('catches the same name again', () => {
    expect(siblingClash(ROOTS, { name: 'Fan', slug: 'ceiling-fan' })).toMatchObject({ id: 'fan' });
  });

  it('catches the same slug under a different name', () => {
    expect(siblingClash(ROOTS, { name: 'Ceiling Fan', slug: 'fan' })).toMatchObject({ id: 'fan' });
  });

  it('reads the name the way the shop does, not the way the database does', () => {
    expect(siblingClash(ROOTS, { name: ' fAn ', slug: 'something-else' })).toMatchObject({ id: 'fan' });
  });

  it('lets a genuinely new type through', () => {
    expect(siblingClash(ROOTS, { name: 'Geyser', slug: 'geyser' })).toBeNull();
  });

  it('does not count a category against itself when it is renamed', () => {
    expect(siblingClash(ROOTS, { name: 'Fan', slug: 'fan', exceptId: 'fan' })).toBeNull();
  });

  it('still catches a rename onto a sibling', () => {
    expect(siblingClash(ROOTS, { name: 'Fan', slug: 'almirah', exceptId: 'almirah' })).toMatchObject({ id: 'fan' });
  });

  it('only compares the categories it is given, so other parents are no business of its', () => {
    const underFurniture = [row('sofa', 'Sofa', 'sofa'), row('bed', 'Bed', 'bed')];
    expect(siblingClash(underFurniture, { name: 'Fan', slug: 'fan' })).toBeNull();
  });
});

describe('what it says', () => {
  it('names the place for a type filed under another', () => {
    expect(clashMessage(row('sofa', 'Sofa', 'sofa'), 'Furniture')).toBe('Sofa is already there under Furniture.');
  });

  it('says it plainly for a top-level type', () => {
    expect(clashMessage(row('fan', 'Fan', 'fan'), null)).toBe('Fan is already there.');
  });

  it('points at the switched-off row rather than letting a second one be added', () => {
    expect(clashMessage(row('fan', 'Fan', 'fan', false), null)).toBe(
      'Fan is already there, switched off. Switch it back on rather than adding it again.',
    );
  });
});
