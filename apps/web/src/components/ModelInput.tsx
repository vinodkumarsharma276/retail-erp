import { forwardRef } from 'react';
import type { InputProps } from './ui/input';
import { SuggestInput } from './SuggestInput';
import { useModelsQuery } from '../hooks/useLookup';
import { useDebounce } from '../hooks/useDebounce';

type Props = Omit<InputProps, 'list' | 'type' | 'icon'> & {
  /** The product type and make whose model numbers are offered. */
  categoryId: string | undefined;
  brand: string | undefined;
};

/**
 * Model: pick one of the make's model numbers within the product type
 * (Cooler → SYMPHONY → its models), or type a new one, which joins the list
 * once saved. Drop-in for `<Input />` — takes `ref`, `register(...)` and the rest.
 */
export const ModelInput = forwardRef<HTMLInputElement, Props>(function ModelInput({ categoryId, brand, ...props }, ref) {
  const make = useDebounce((brand ?? '').trim(), 300);
  const { data: models = [], isFetching } = useModelsQuery(categoryId, make);
  return (
    <SuggestInput
      ref={ref}
      options={models}
      loading={isFetching && models.length === 0}
      emptyText={
        !categoryId ? 'Pick a product type first' : !make ? 'Pick a brand first' : `No ${make} models saved for this type yet — type one`
      }
      newHint={(typed) => `“${typed}” is new — it is added to ${make || 'this brand'}'s models when saved`}
      {...props}
    />
  );
});
