import { forwardRef, useId } from 'react';
import { Input, type InputProps } from './ui/input';
import { useBrandsQuery } from '../hooks/useLookup';

type Props = Omit<InputProps, 'list' | 'type'> & {
  /** The leaf category whose makes are suggested. */
  categoryId: string | undefined;
};

/**
 * Brand: type to narrow the list, or type a make that is not on it yet.
 *
 * A closed dropdown cannot be right here. A shop takes on a new supplier's
 * make the day the first unit arrives, and nobody is going to stop and edit
 * the category before they can book it in. So the list suggests rather than
 * restricts: the suggestions are the category's own brands plus every make
 * already on its stock, which means a new one joins the list by being used
 * once, with no master list for anyone to curate.
 *
 * Drop-in for `<Input />` — takes `ref`, `register(...)` and the rest.
 */
export const BrandInput = forwardRef<HTMLInputElement, Props>(function BrandInput(
  { categoryId, ...props },
  ref,
) {
  const listId = `brands-${useId()}`;
  const { data: brands = [] } = useBrandsQuery(categoryId);

  return (
    <>
      <Input ref={ref} type="text" list={listId} autoComplete="off" {...props} />
      <datalist id={listId}>
        {brands.map((brand) => (
          <option key={brand} value={brand} />
        ))}
      </datalist>
    </>
  );
});
