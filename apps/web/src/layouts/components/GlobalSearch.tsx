import { useState, useRef, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, X, Loader2, Package } from 'lucide-react';
import { cn } from '../../lib/utils';
import { useDebounce } from '../../hooks/useDebounce';
import { useProductSearchQuery } from '../../hooks/useProducts';
import { StatusBadge } from '../../components/StatusBadge';

export function GlobalSearch() {
  const navigate = useNavigate();
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState('');
  const debouncedQuery = useDebounce(query, 300);
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const { data: results, isLoading } = useProductSearchQuery(debouncedQuery);

  // Focus input when opened
  useEffect(() => {
    if (isOpen && inputRef.current) {
      inputRef.current.focus();
    }
  }, [isOpen]);

  // Close on click outside
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        close();
      }
    }
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen]);

  // Keyboard handler
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Escape') {
        close();
      }
    },
    [],
  );

  const close = () => {
    setIsOpen(false);
    setQuery('');
  };

  const handleResultClick = (productId: string) => {
    close();
    navigate(`/products/${productId}`);
  };

  // Collapsed: just an icon button
  if (!isOpen) {
    return (
      <button
        onClick={() => setIsOpen(true)}
        className="flex items-center gap-2 rounded-md px-3 py-1.5 text-sm text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
        title="Search products (Ctrl+K)"
      >
        <Search className="h-4 w-4" />
        <span className="hidden sm:inline">Search...</span>
      </button>
    );
  }

  // Expanded: search bar with results dropdown
  return (
    <div className="relative flex-1 max-w-lg" ref={containerRef}>
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Search products by brand, model, serial..."
          className={cn(
            'w-full rounded-md border bg-background pl-9 pr-9 py-2 text-sm',
            'placeholder:text-muted-foreground',
            'focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2',
          )}
        />
        <button
          onClick={close}
          className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Results dropdown */}
      {debouncedQuery.length >= 3 && (
        <div className="absolute top-full left-0 right-0 z-50 mt-1 max-h-80 overflow-y-auto rounded-md border bg-card shadow-lg">
          {isLoading ? (
            <div className="flex items-center gap-2 px-4 py-6 text-sm text-muted-foreground justify-center">
              <Loader2 className="h-4 w-4 animate-spin" />
              Searching...
            </div>
          ) : results && results.length > 0 ? (
            <ul className="py-1">
              {results.map((product) => (
                <li key={product.id}>
                  <button
                    onClick={() => handleResultClick(product.id)}
                    className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm hover:bg-muted transition-colors"
                  >
                    <Package className="h-4 w-4 shrink-0 text-muted-foreground" />
                    <div className="flex-1 min-w-0">
                      <p className="font-medium truncate">
                        {product.brand} {product.modelNumber}
                      </p>
                      {product.serialNumber && (
                        <p className="text-xs text-muted-foreground truncate font-mono">
                          SN: {product.serialNumber}
                        </p>
                      )}
                    </div>
                    <StatusBadge status={product.status} />
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <div className="px-4 py-6 text-center text-sm text-muted-foreground">
              No products found for &ldquo;{debouncedQuery}&rdquo;
            </div>
          )}
        </div>
      )}
    </div>
  );
}
