import { useState, useEffect, useCallback } from 'react';
import { ChevronDown, Loader2 } from 'lucide-react';
import { cn } from '../lib/utils';
import { useCategoryTreeQuery } from '../hooks/useProducts';
import type { ProductCategory } from '@retailerp/shared-types';

interface CategoryCascaderProps {
  /** Called when a leaf category is selected (or any category if allowNonLeaf) */
  onCategorySelect: (categoryId: string | undefined) => void;
  /** Pre-selected category ID for edit mode */
  initialCategoryId?: string;
  /** Allow selecting non-leaf categories (e.g., for filtering) */
  allowNonLeaf?: boolean;
}

/**
 * Cascading dropdown for selecting a product category.
 * Fetches the category tree and renders a dropdown at each level.
 */
export function CategoryCascader({
  onCategorySelect,
  initialCategoryId,
  allowNonLeaf = false,
}: CategoryCascaderProps) {
  const { data: tree, isLoading } = useCategoryTreeQuery();

  // selections[i] = the category ID selected at level i
  const [selections, setSelections] = useState<(string | undefined)[]>([]);

  // Build the path from root to initialCategoryId once tree loads
  useEffect(() => {
    if (!tree || !initialCategoryId) return;

    const path: string[] = [];

    function findPath(nodes: ProductCategory[], targetId: string): boolean {
      for (const node of nodes) {
        if (node.id === targetId) {
          path.push(node.id);
          return true;
        }
        if (node.children?.length) {
          if (findPath(node.children, targetId)) {
            path.unshift(node.id);
            return true;
          }
        }
      }
      return false;
    }

    findPath(tree, initialCategoryId);
    if (path.length > 0) {
      setSelections(path);
    }
  }, [tree, initialCategoryId]);

  // Given the current selections, compute what options are available at each level
  const getLevelOptions = useCallback(
    (level: number): ProductCategory[] => {
      if (!tree) return [];
      if (level === 0) return tree;

      let current = tree;
      for (let i = 0; i < level; i++) {
        const selected = current.find((c) => c.id === selections[i]);
        if (!selected || !selected.children?.length) return [];
        current = selected.children;
      }
      return current;
    },
    [tree, selections],
  );

  // Get the selected node at a given level
  const getSelectedNode = useCallback(
    (level: number): ProductCategory | undefined => {
      const options = getLevelOptions(level);
      return options.find((c) => c.id === selections[level]);
    },
    [getLevelOptions, selections],
  );

  // Handle selection change at a given level
  const handleChange = useCallback(
    (level: number, categoryId: string) => {
      const newSelections = [...selections.slice(0, level), categoryId];
      setSelections(newSelections);

      // Determine if the selected node is a leaf
      const options = getLevelOptions(level);
      const node = options.find((c) => c.id === categoryId);

      if (node?.isLeaf || (allowNonLeaf && !node?.children?.length)) {
        onCategorySelect(categoryId);
      } else if (allowNonLeaf) {
        onCategorySelect(categoryId);
      } else {
        // Not a leaf yet — clear parent's callback
        onCategorySelect(undefined);
      }
    },
    [selections, getLevelOptions, allowNonLeaf, onCategorySelect],
  );

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground py-2">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading categories...
      </div>
    );
  }

  if (!tree || tree.length === 0) {
    return (
      <p className="text-sm text-muted-foreground py-2">
        No categories available.
      </p>
    );
  }

  // Determine how many levels to render
  const levels: number[] = [0];
  for (let i = 0; i < selections.length; i++) {
    const node = getSelectedNode(i);
    if (node && node.children && node.children.length > 0) {
      levels.push(i + 1);
    }
  }

  const levelLabels = ['Category', 'Subcategory', 'Type', 'Variant'];

  return (
    <div className="flex flex-wrap gap-4">
      {levels.map((level) => {
        const options = getLevelOptions(level);
        if (options.length === 0) return null;

        return (
          <div key={level} className="min-w-[200px] flex-1">
            <label className="block text-sm font-medium mb-1.5">
              {levelLabels[level] ?? `Level ${level + 1}`}
            </label>
            <div className="relative">
              <select
                value={selections[level] ?? ''}
                onChange={(e) => handleChange(level, e.target.value)}
                className={cn(
                  'w-full appearance-none rounded-md border bg-field px-3 py-2.5 pr-8 text-sm',
                  'focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2',
                )}
              >
                <option value="">Select {levelLabels[level] ?? 'option'}...</option>
                {options.map((cat) => (
                  <option key={cat.id} value={cat.id}>
                    {cat.name}
                  </option>
                ))}
              </select>
              <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            </div>
          </div>
        );
      })}
    </div>
  );
}
