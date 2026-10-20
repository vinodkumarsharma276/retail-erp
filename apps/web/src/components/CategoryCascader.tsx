import { useState, useEffect, useCallback } from 'react';
import { Loader2, Plus } from 'lucide-react';
import { AddCategoryDialog } from './AddCategoryDialog';
import { Button } from './ui/button';
import { Label } from './ui/label';
import { Select } from './ui/select';
import { useCategoryTreeQuery } from '../hooks/useProducts';
import { useCanCheck } from '../hooks/usePermission';
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
  /**
   * Offer a way to add a type that is not on the list yet.
   *
   * Off by default: on a filter, a missing category means nothing was
   * bought of it, not that one needs creating.
   */
  allowCreate?: boolean;
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
  allowCreate = false,
}: CategoryCascaderProps) {
  const { data: tree, isLoading } = useCategoryTreeQuery();
  const [adding, setAdding] = useState(false);
  const can = useCanCheck();
  const mayCreate = allowCreate && can('categories.create');

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

  /** Show the new type as chosen, under whatever it was filed beneath. */
  const useNewCategory = (category: ProductCategory) => {
    setAdding(false);
    setSelections(category.parentId ? [...selections.filter(Boolean), category.id] : [category.id]);
    onCategorySelect(category.id);
  };

  const addDialog = adding ? (
    <AddCategoryDialog
      parentChoices={(tree ?? []).map((node) => ({ id: node.id, label: node.name }))}
      parentId={selections.filter(Boolean).at(-1) ?? null}
      onCreated={useNewCategory}
      onClose={() => setAdding(false)}
    />
  ) : null;

  const addButton = mayCreate ? (
    <Button type="button" variant="outline" size="sm" onClick={() => setAdding(true)}>
      <Plus className="mr-1 h-3.5 w-3.5" />
      New type
    </Button>
  ) : null;

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
      <div className="flex flex-wrap items-center gap-3 py-2">
        <p className="text-sm text-muted-foreground">No categories available.</p>
        {addButton}
        {addDialog}
      </div>
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
    <div className="flex flex-wrap items-end gap-3">
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

      {addButton}
      {addDialog}
    </div>
  );
}
