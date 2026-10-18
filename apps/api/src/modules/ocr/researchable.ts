import type { SpecAttributeDef } from './providers/openai-vision.provider.js';

/**
 * Which product attributes a web search may be asked about.
 *
 * Asked about anything, a model answers. Put the demo flag in front of one
 * and it dutifully replies "false" for every unit it sees — which arrives as
 * a string, and a non-empty string is true wherever the flag is later checked
 * plainly. That silently turned 55 units into display pieces once already.
 *
 * So the rule lives here, in one place, next to the resolver it guards:
 *
 *  - a demo or display flag is a fact about the box standing in the shop, not
 *    about the model, and no amount of searching can establish it;
 *  - IMEI and serial numbers identify one unit, not a product;
 *  - `brand` only repeats the column the product already has;
 *  - a free list of values (`multi_text`) has no single answer to find.
 *
 * Attributes beginning with `__` are the callers' own pseudo-attributes, such
 * as the one used to ask for an MRP alongside the real fields; they are not
 * category attributes and pass through untouched.
 */

const UNRESEARCHABLE_NAME = /^(isdemounit|brand)$/i;
const UNRESEARCHABLE_LABEL = /(demo|display unit)/i;
const PER_UNIT_IDENTIFIER = /imei|serial/i;

/** True when the web could sensibly be asked about this attribute. */
export function isResearchable(attribute: {
  attributeName: string;
  attributeLabel?: string;
  attributeType?: string;
}): boolean {
  if (attribute.attributeName.startsWith('__')) return true;
  if (String(attribute.attributeType ?? '') === 'multi_text') return false;
  if (PER_UNIT_IDENTIFIER.test(attribute.attributeName)) return false;
  if (UNRESEARCHABLE_NAME.test(attribute.attributeName)) return false;
  if (attribute.attributeLabel && UNRESEARCHABLE_LABEL.test(attribute.attributeLabel)) return false;
  return true;
}

/** The subset of `attributes` worth putting to a web search. */
export function researchableAttributes<T extends { attributeName: string; attributeLabel?: string; attributeType?: string }>(
  attributes: T[],
): T[] {
  return attributes.filter(isResearchable);
}

/** Narrowed to the resolver's own shape, for callers that build defs directly. */
export const researchableSpecs = (attributes: SpecAttributeDef[]): SpecAttributeDef[] =>
  attributes.filter(isResearchable);
