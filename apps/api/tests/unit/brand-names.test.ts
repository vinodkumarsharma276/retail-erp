import { describe, expect, it } from 'vitest';
import { brandKey, canonicalBrand, isCatalogBrand } from '@retailerp/shared-utils';

describe('brand names', () => {
  it('maps the register’s misspellings to one make, ignoring stray marks', () => {
    expect(['WHIRLPHOOL', 'whir', 'Whiphool', 'WHIRLPOO;'].map(canonicalBrand)).toEqual(['WHIRLPOOL', 'WHIRLPOOL', 'WHIRLPOOL', 'WHIRLPOOL']);
    expect(['SAM', 'SAM.', 'sam,sung', 'Samsung'].map(canonicalBrand)).toEqual(['SAMSUNG', 'SAMSUNG', 'SAMSUNG', 'SAMSUNG']);
    expect(['T SERIES', 'T.SERIES', 'tseries'].map(canonicalBrand)).toEqual(['T-SERIES', 'T-SERIES', 'T-SERIES']);
    expect(canonicalBrand('`LG')).toBe('LG');
    expect(canonicalBrand('  ')).toBe('');
  });

  it('corrects each make in a cell naming several, without splitting a product written W/M', () => {
    expect(canonicalBrand('TRUE/LUM')).toBe('TRUFAST, LUMINOUS');
    expect(canonicalBrand('LG - SAM - USHA')).toBe('LG, SAMSUNG, USHA');
    expect(canonicalBrand('VOLTAS WHIRLPOOL LG')).toBe('VOLTAS, WHIRLPOOL, LG');
    expect(canonicalBrand('SAM-HAIER')).toBe('SAMSUNG, HAIER');
    expect(canonicalBrand('LG,W/M,')).toBe('LG, W/M');
    expect(canonicalBrand('W/M')).toBe('W/M');
  });

  it('keeps an unknown make as typed', () => {
    expect(canonicalBrand(' Nilkamal ')).toBe('Nilkamal');
    expect(canonicalBrand('O GENERAL')).toBe('O GENERAL');
    expect(brandKey('Nilkamal,')).toBe('NILKAMAL');
  });

  it('offers only single real makes as brands', () => {
    expect(isCatalogBrand('whirlphool')).toBe(true);
    expect(isCatalogBrand('Nilkamal')).toBe(true);
    expect(['TRU, LUM', 'W/M', 'LED', '2 BRAND', '----', '', null].map(isCatalogBrand)).toEqual([false, false, false, false, false, false, false]);
  });
});
