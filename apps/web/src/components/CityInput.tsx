import { forwardRef, useId } from 'react';
import { useCitiesQuery } from '../hooks/useLookup';

type Props = Omit<React.InputHTMLAttributes<HTMLInputElement>, 'list' | 'type'>;

/**
 * Text input with native browser autocomplete sourced from `/lookup/cities`.
 * Drop-in replacement for `<input type="text" />` — accepts all standard
 * input props (including `ref`, `register(...)` from react-hook-form etc.).
 */
export const CityInput = forwardRef<HTMLInputElement, Props>(function CityInput(
  props,
  ref,
) {
  const reactId = useId();
  const listId = `cities-${reactId}`;
  const { data: cities = [] } = useCitiesQuery();

  return (
    <>
      <input ref={ref} type="text" list={listId} autoComplete="off" {...props} />
      <datalist id={listId}>
        {cities.map((c) => (
          <option key={c} value={c} />
        ))}
      </datalist>
    </>
  );
});
