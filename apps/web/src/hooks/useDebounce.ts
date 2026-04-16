import { useState, useEffect } from 'react';

/**
 * Debounce a value by the given delay (in ms).
 * Returns the debounced value that only updates after the delay has elapsed
 * since the last change.
 */
export function useDebounce<T>(value: T, delay = 300): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);

  return debounced;
}
