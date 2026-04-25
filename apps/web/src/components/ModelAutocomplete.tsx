import { useState, useRef, useEffect, useCallback } from 'react';
import { Loader2, Search } from 'lucide-react';
import { cn } from '../lib/utils';
import { apiClient } from '../lib/api-client';

interface ProductMatch {
  id: string;
  modelNumber: string;
  brand: string;
  mrp: number;
  sellingPrice: number;
  purchasePrice: number;
  color?: string;
  warrantyMonths?: number;
  categoryId: string;
  dynamicAttributes?: Record<string, unknown>;
  category?: { name: string };
}

interface ModelAutocompleteProps {
  value: string;
  onChange: (value: string) => void;
  onSelect: (product: ProductMatch) => void;
  placeholder?: string;
  error?: boolean;
  className?: string;
}

export function ModelAutocomplete({
  value,
  onChange,
  onSelect,
  placeholder = 'Type model number...',
  error,
  className,
}: ModelAutocompleteProps) {
  const [query, setQuery] = useState(value);
  const [results, setResults] = useState<ProductMatch[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const [highlightIdx, setHighlightIdx] = useState(-1);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();

  // Sync external value
  useEffect(() => {
    setQuery(value);
  }, [value]);

  // Close dropdown on outside click
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const searchProducts = useCallback(async (q: string) => {
    if (q.length < 3) {
      setResults([]);
      setIsOpen(false);
      return;
    }

    setIsLoading(true);
    try {
      const { data } = await apiClient.get('/products/search', {
        params: { query: q },
      });
      const products: ProductMatch[] = data?.data ?? [];

      // Deduplicate by model number (show unique models)
      const seen = new Map<string, ProductMatch>();
      for (const p of products) {
        const key = p.modelNumber.toLowerCase();
        if (!seen.has(key)) {
          seen.set(key, p);
        }
      }
      const unique = Array.from(seen.values());

      setResults(unique);
      setIsOpen(unique.length > 0);
      setHighlightIdx(-1);
    } catch {
      setResults([]);
      setIsOpen(false);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const handleInputChange = (text: string) => {
    setQuery(text);
    onChange(text);

    // Debounce search — 250ms
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      searchProducts(text.trim());
    }, 250);
  };

  const handleSelect = (product: ProductMatch) => {
    setQuery(product.modelNumber);
    onChange(product.modelNumber);
    onSelect(product);
    setIsOpen(false);
    setResults([]);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!isOpen || results.length === 0) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlightIdx((prev) => Math.min(prev + 1, results.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlightIdx((prev) => Math.max(prev - 1, 0));
    } else if (e.key === 'Enter' && highlightIdx >= 0) {
      e.preventDefault();
      handleSelect(results[highlightIdx]);
    } else if (e.key === 'Escape') {
      setIsOpen(false);
    }
  };

  return (
    <div ref={wrapperRef} className="relative">
      <div className="relative">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
        <input
          type="text"
          value={query}
          onChange={(e) => handleInputChange(e.target.value)}
          onFocus={() => {
            if (results.length > 0) setIsOpen(true);
          }}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          className={cn(
            'w-full rounded-md border bg-background pl-9 pr-8 py-2.5 text-sm',
            'placeholder:text-muted-foreground',
            'focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2',
            error && 'border-destructive',
            className,
          )}
        />
        {isLoading && (
          <Loader2 className="absolute right-2.5 top-1/2 -translate-y-1/2 h-4 w-4 animate-spin text-muted-foreground" />
        )}
      </div>

      {/* Dropdown */}
      {isOpen && results.length > 0 && (
        <div className="absolute z-50 mt-1 w-full max-h-60 overflow-y-auto rounded-md border border-border bg-card shadow-xl ring-1 ring-black/5">
          {results.map((product, idx) => (
            <button
              key={product.id}
              type="button"
              onClick={() => handleSelect(product)}
              onMouseEnter={() => setHighlightIdx(idx)}
              className={cn(
                'flex w-full items-start gap-3 px-3 py-2.5 text-left text-sm transition-colors border-b border-border last:border-0',
                idx === highlightIdx
                  ? 'bg-primary/10 text-foreground'
                  : 'bg-card text-foreground hover:bg-muted',
              )}
            >
              <div className="flex-1 min-w-0">
                <p className="font-medium truncate">{product.modelNumber}</p>
                <p className="text-xs text-muted-foreground truncate">
                  {product.brand}
                  {product.category?.name ? ` · ${product.category.name}` : ''}
                </p>
              </div>
              <div className="text-right shrink-0">
                <p className="text-xs text-muted-foreground">
                  DP: ₹{Number(product.purchasePrice).toLocaleString('en-IN')}
                </p>
                <p className="text-xs text-muted-foreground">
                  MRP: ₹{Number(product.mrp).toLocaleString('en-IN')}
                </p>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
