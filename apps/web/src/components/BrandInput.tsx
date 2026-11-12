import { forwardRef } from 'react';
import type { InputProps } from './ui/input';
import { SuggestInput } from './SuggestInput';
import { useBrandsQuery } from '../hooks/useLookup';

type Props = Omit<InputProps, 'list' | 'type' | 'icon'> & {
  /** The product type whose makes are offered. */
  categoryId: string | undefined;
};

/**
 * Brand: pick one of the makes sold under the product type, or type a new one.
 *
 * A closed dropdown cannot be right here. A shop takes on a new supplier's
 * make the day the first unit arrives, and nobody is going to stop and edit
 * the category before they can book it in. So the list suggests rather than
 * restricts: it is the type's Brand catalog (filled from the register, stock
 * and the type's brand list), and a new make joins it once it is saved.
 *
 * Drop-in for `<Input />` — takes `ref`, `register(...)` and the rest.
 */
export const BrandInput = forwardRef<HTMLInputElement, Props>(function BrandInput({ categoryId, ...props }, ref) {
  const { data: brands = [], isFetching } = useBrandsQuery(categoryId);
  return (
    <SuggestInput
      ref={ref}
      options={brands}
      loading={isFetching && brands.length === 0}
      emptyText={categoryId ? 'No brands saved for this type yet — type one' : 'Pick a product type first'}
      newHint={(typed) => `“${typed}” is new — it is added to this type's brands when saved`}
      {...props}
    />
  );
});
