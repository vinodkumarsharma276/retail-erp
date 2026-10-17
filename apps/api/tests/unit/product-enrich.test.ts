import { describe, expect, it } from 'vitest';
import { isBlank, mergeIntoAttributes, parseMrp } from '../../src/modules/products/products.enrich.js';

/**
 * Fetching a product's details from the web.
 *
 * The lookup itself needs an API key and the live internet, so what is worth
 * pinning down here is the part that must never go wrong: what counts as an
 * empty field, and the rule that nothing already entered is overwritten — by
 * any answer, on any number of re-runs.
 */

const AT = '2026-10-17T10:00:00.000Z';

describe('isBlank', () => {
  it('treats nothing, blank text and empty lists as empty', () => {
    expect(isBlank(undefined)).toBe(true);
    expect(isBlank(null)).toBe(true);
    expect(isBlank('')).toBe(true);
    expect(isBlank('   ')).toBe(true);
    expect(isBlank([])).toBe(true);
  });

  it('treats a real value as filled in — including false and zero', () => {
    expect(isBlank('Full HD')).toBe(false);
    expect(isBlank(0)).toBe(false);
    expect(isBlank(false)).toBe(false);
    expect(isBlank(['352099001761481'])).toBe(false);
  });
});

describe('parseMrp', () => {
  it('reads a price out of whatever the model wrote', () => {
    expect(parseMrp('24990')).toBe(24990);
    expect(parseMrp('Rs. 24,990')).toBe(24990);
    expect(parseMrp('24990.50')).toBe(24991);
  });

  it('refuses anything outside the range a retail price can be', () => {
    expect(parseMrp(undefined)).toBeNull();
    expect(parseMrp('')).toBeNull();
    expect(parseMrp('unknown')).toBeNull();
    expect(parseMrp('43')).toBeNull();
    expect(parseMrp('999999999')).toBeNull();
  });
});

describe('mergeIntoAttributes', () => {
  it('fills only the empty fields and reports which', () => {
    const { next, filled } = mergeIntoAttributes(
      { importedFrom: 'excel', screen_size: '', resolution: null },
      { screen_size: '43', resolution: '4K UHD' },
      null,
      AT,
    );

    expect(filled.sort()).toEqual(['resolution', 'screen_size']);
    expect(next.screen_size).toBe('43');
    expect(next.resolution).toBe('4K UHD');
    expect(next.importedFrom).toBe('excel');
    expect(next.specsLookedUpAt).toBe(AT);
  });

  it('never overwrites a value somebody entered', () => {
    const { next, filled } = mergeIntoAttributes(
      { screen_size: '32', smart_tv: false },
      { screen_size: '43', smart_tv: 'true' },
      null,
      AT,
    );

    expect(filled).toEqual([]);
    expect(next.screen_size).toBe('32');
    expect(next.smart_tv).toBe(false);
  });

  it('keeps an MRP as a suggestion, and only for a unit still sitting at cost', () => {
    const atCost = mergeIntoAttributes({ priceNotSet: true }, {}, 24990, AT);
    expect(atCost.next.mrpSuggestion).toBe(24990);
    // No price was written: that stays a decision for a person.
    expect(atCost.next.mrp).toBeUndefined();
    expect(atCost.next.sellingPrice).toBeUndefined();

    const priced = mergeIntoAttributes({}, {}, 24990, AT);
    expect(priced.next.mrpSuggestion).toBeUndefined();

    const alreadySuggested = mergeIntoAttributes(
      { priceNotSet: true, mrpSuggestion: 19990 },
      {},
      24990,
      AT,
    );
    expect(alreadySuggested.next.mrpSuggestion).toBe(19990);
  });

  it('is safe to run twice: the second pass changes nothing', () => {
    const first = mergeIntoAttributes(
      { priceNotSet: true },
      { resolution: '4K UHD' },
      24990,
      AT,
    );
    const second = mergeIntoAttributes(
      first.next,
      { resolution: 'Full HD' },
      29990,
      '2026-11-01T10:00:00.000Z',
    );

    expect(second.filled).toEqual([]);
    expect(second.next.resolution).toBe('4K UHD');
    expect(second.next.mrpSuggestion).toBe(24990);
  });
});
