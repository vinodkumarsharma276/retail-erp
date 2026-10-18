import { describe, expect, it } from 'vitest';
import { isResearchable, researchableAttributes } from '../../src/modules/ocr/researchable.js';

/**
 * Which attributes a web search may be asked about.
 *
 * This rule exists because asking is not free of consequence: a model puts an
 * answer to whatever it is given, and the demo flag came back as the string
 * "false" for every unit — which reads as true wherever the flag is checked
 * plainly. The cases below are the ones that actually went wrong.
 */

describe('attributes a search cannot establish', () => {
  it('refuses the demo flag, by name and by label', () => {
    expect(isResearchable({ attributeName: 'isDemoUnit', attributeLabel: 'Display / demo unit' })).toBe(false);
    // A shop that names it something else is still protected by the label.
    expect(isResearchable({ attributeName: 'shopFloorPiece', attributeLabel: 'Demo piece' })).toBe(false);
    expect(isResearchable({ attributeName: 'floorModel', attributeLabel: 'Display unit' })).toBe(false);
  });

  it('refuses identifiers that belong to one unit, not a model', () => {
    expect(isResearchable({ attributeName: 'imeiNumbers', attributeLabel: 'IMEI Number' })).toBe(false);
    expect(isResearchable({ attributeName: 'serialNumber', attributeLabel: 'Serial number' })).toBe(false);
  });

  it('refuses a free list, which has no single answer to find', () => {
    expect(isResearchable({ attributeName: 'accessories', attributeLabel: 'In the box', attributeType: 'multi_text' })).toBe(false);
  });

  it('refuses brand, which the product already carries as a column', () => {
    expect(isResearchable({ attributeName: 'brand', attributeLabel: 'Brand' })).toBe(false);
  });
});

describe('attributes a search is good at', () => {
  it('allows real specifications, including checkbox ones', () => {
    expect(isResearchable({ attributeName: 'screen_size', attributeLabel: 'Screen Size (inches)' })).toBe(true);
    expect(isResearchable({ attributeName: 'resolution', attributeLabel: 'Resolution' })).toBe(true);
    // A checkbox is fine when it describes the model rather than the box.
    expect(isResearchable({ attributeName: 'smart_tv', attributeLabel: 'Smart TV', attributeType: 'checkbox' })).toBe(true);
    expect(isResearchable({ attributeName: 'capacity_ah', attributeLabel: 'Capacity (Ah)', attributeType: 'number' })).toBe(true);
  });

  it("lets a caller's own pseudo-attribute through", () => {
    // The bulk run asks for an MRP alongside the real fields this way.
    expect(isResearchable({ attributeName: '__mrp', attributeLabel: 'Official MRP in Indian rupees' })).toBe(true);
  });
});

describe('filtering a whole category', () => {
  it('keeps the specifications and drops the rest', () => {
    const smartphone = [
      { attributeName: 'brand', attributeLabel: 'Brand', attributeType: 'select' },
      { attributeName: 'imeiNumbers', attributeLabel: 'IMEI Number', attributeType: 'multi_text' },
      { attributeName: 'ram', attributeLabel: 'RAM (GB)', attributeType: 'select' },
      { attributeName: 'storage', attributeLabel: 'Storage (GB)', attributeType: 'select' },
      { attributeName: 'os', attributeLabel: 'Operating System', attributeType: 'select' },
      { attributeName: 'isDemoUnit', attributeLabel: 'Display / demo unit', attributeType: 'checkbox' },
    ];
    expect(researchableAttributes(smartphone).map((a) => a.attributeName)).toEqual(['ram', 'storage', 'os']);
  });

  it('can leave nothing at all, which callers must handle', () => {
    const onlyShopFacts = [
      { attributeName: 'imeiNumbers', attributeLabel: 'IMEI Number', attributeType: 'multi_text' },
      { attributeName: 'isDemoUnit', attributeLabel: 'Display / demo unit', attributeType: 'checkbox' },
    ];
    expect(researchableAttributes(onlyShopFacts)).toEqual([]);
  });
});
