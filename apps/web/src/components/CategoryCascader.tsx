import { useState, useEffect, useCallback } from 'react';
import {  Loader2 } from 'lucide-react';
import { Label } from './ui/label';
import { Select } from './ui/select';
import { useCategoryTreeQuery } from '../hooks/useProducts';
import type { ProductCategory } from '@retailerp/shared-types';

interface CategoryCascaderProps {
  /** Called when a leaf category is selected (or any category if allowNonLeaf) */
  onCategorySelect: (categoryId: string | undefined) => void;
  /** Pre-selected category ID for edit mode */
  initialCategoryId?: string;
  /** Marks the first level with a required asterisk. */
  required?: boolean;
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
  required = false,
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
    <div className="flex flex-wrap gap-3">
      {levels.map((level) => {
        const options = getLevelOptions(level);
        if (options.length === 0) return null;

        const levelLabel = levelLabels[level] ?? `Level ${level + 1}`;

        return (
          <div key={level} className="min-w-[180px] flex-1">
            {/* The cascader owns its own labels — each level has a distinct
                name (Category / Subcategory / Type). Callers must not add an
                outer "Category" label on top, or it renders twice. */}
            <Label required={required && level === 0}>{levelLabel}</Label>
            <Select
              value={selections[level] ?? ''}
              onChange={(e) => handleChange(level, e.target.value)}
              aria-label={levelLabel}
            >
              <option value="">Select {levelLabel.toLowerCase()}…</option>
              {options.map((cat) => (
                <option key={cat.id} value={cat.id}>
                  {cat.name}
                </option>
              ))}
            </Select>
          </div>
        );
      })}
    </div>
  );
}
