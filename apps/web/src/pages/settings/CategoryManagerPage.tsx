import { useState } from 'react';
import {
  ChevronRight,
  ChevronDown,
  FolderTree,
  Plus,
  Pencil,
  Trash2,
  Loader2,
  Save,
  X,
  AlertCircle,
  Leaf,
  FolderOpen,
} from 'lucide-react';
import { cn } from '../../lib/utils';
import {
  useCategoryTreeQuery,
  useCategoryAttributesQuery,
  useCreateCategoryMutation,
  useUpdateCategoryMutation,
  useDeleteCategoryMutation,
  useCreateCategoryAttributeMutation,
  useUpdateCategoryAttributeMutation,
  useDeleteCategoryAttributeMutation,
} from '../../hooks/useProducts';
import type { ProductCategory, CategoryAttribute } from '@retailerp/shared-types';

// ---------------------------------------------------------------------------
// Attribute type options
// ---------------------------------------------------------------------------
const ATTRIBUTE_TYPES = [
  { value: 'text', label: 'Text' },
  { value: 'number', label: 'Number' },
  { value: 'select', label: 'Select' },
  { value: 'checkbox', label: 'Checkbox' },
  { value: 'textarea', label: 'Textarea' },
  { value: 'tel', label: 'Phone' },
  { value: 'email', label: 'Email' },
  { value: 'date', label: 'Date' },
];

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------
export function CategoryManagerPage() {
  const { data: categories, isLoading, isError } = useCategoryTreeQuery();
  const [selectedCategoryId, setSelectedCategoryId] = useState<string | null>(null);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [showAddCategory, setShowAddCategory] = useState(false);
  const [addCategoryParentId, setAddCategoryParentId] = useState<string | undefined>();

  const toggleExpand = (id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // Find selected category across all levels
  const findCategory = (
    cats: ProductCategory[],
    id: string,
  ): ProductCategory | null => {
    for (const cat of cats) {
      if (cat.id === id) return cat;
      if (cat.children) {
        const found = findCategory(cat.children, id);
        if (found) return found;
      }
    }
    return null;
  };

  const selectedCategory = selectedCategoryId
    ? findCategory(categories ?? [], selectedCategoryId)
    : null;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (isError) {
    return (
      <div className="flex items-center gap-2 rounded-md bg-destructive/10 px-4 py-3 text-sm text-destructive">
        <AlertCircle className="h-4 w-4 shrink-0" />
        Failed to load categories. Please try again.
      </div>
    );
  }

  return (
    <div className="flex gap-6 h-[calc(100vh-12rem)]">
      {/* Left panel: category tree */}
      <div className="w-80 shrink-0 rounded-lg border bg-card flex flex-col">
        <div className="flex items-center justify-between p-4 border-b">
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
            Categories
          </h2>
          <button
            onClick={() => {
              setAddCategoryParentId(undefined);
              setShowAddCategory(true);
            }}
            className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
            title="Add root category"
          >
            <Plus className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-2">
          {!categories || categories.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">
              No categories yet.
            </p>
          ) : (
            <CategoryTree
              categories={categories}
              expandedIds={expandedIds}
              selectedId={selectedCategoryId}
              onToggle={toggleExpand}
              onSelect={setSelectedCategoryId}
              onAddSubcategory={(parentId) => {
                setAddCategoryParentId(parentId);
                setShowAddCategory(true);
              }}
              depth={0}
            />
          )}
        </div>

        {/* Add category form */}
        {showAddCategory && (
          <AddCategoryForm
            parentId={addCategoryParentId}
            onClose={() => setShowAddCategory(false)}
          />
        )}
      </div>

      {/* Right panel: category detail + attributes */}
      <div className="flex-1 min-w-0">
        {!selectedCategory ? (
          <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
            <FolderTree className="h-12 w-12 mb-4 opacity-30" />
            <p className="text-sm">
              Select a category to view its details and attributes.
            </p>
          </div>
        ) : (
          <CategoryDetail category={selectedCategory} />
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Recursive tree
// ---------------------------------------------------------------------------
function CategoryTree({
  categories,
  expandedIds,
  selectedId,
  onToggle,
  onSelect,
  onAddSubcategory,
  depth,
}: {
  categories: ProductCategory[];
  expandedIds: Set<string>;
  selectedId: string | null;
  onToggle: (id: string) => void;
  onSelect: (id: string) => void;
  onAddSubcategory: (parentId: string) => void;
  depth: number;
}) {
  return (
    <ul className="space-y-0.5">
      {categories.map((cat) => {
        const hasChildren = cat.children && cat.children.length > 0;
        const isExpanded = expandedIds.has(cat.id);
        const isSelected = selectedId === cat.id;

        return (
          <li key={cat.id}>
            <div
              className={cn(
                'flex items-center gap-1 rounded-md py-1.5 px-2 transition-colors group',
                isSelected
                  ? 'bg-primary text-primary-foreground'
                  : 'hover:bg-muted',
              )}
              style={{ paddingLeft: `${depth * 16 + 8}px` }}
            >
              {/* Expand/collapse */}
              {hasChildren ? (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onToggle(cat.id);
                  }}
                  className="shrink-0 p-0.5"
                >
                  {isExpanded ? (
                    <ChevronDown className="h-3.5 w-3.5" />
                  ) : (
                    <ChevronRight className="h-3.5 w-3.5" />
                  )}
                </button>
              ) : (
                <span className="w-4.5 shrink-0" />
              )}

              {/* Category icon */}
              {cat.isLeaf ? (
                <Leaf className="h-3.5 w-3.5 shrink-0 opacity-60" />
              ) : (
                <FolderOpen className="h-3.5 w-3.5 shrink-0 opacity-60" />
              )}

              {/* Name and info */}
              <button
                onClick={() => onSelect(cat.id)}
                className="flex-1 text-left text-sm font-medium truncate ml-1"
              >
                {cat.name}
              </button>

              {/* Level badge */}
              <span
                className={cn(
                  'text-xs shrink-0',
                  isSelected
                    ? 'text-primary-foreground/70'
                    : 'text-muted-foreground',
                )}
              >
                L{cat.level}
              </span>

              {/* Add subcategory */}
              {!cat.isLeaf && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onAddSubcategory(cat.id);
                  }}
                  className={cn(
                    'opacity-0 group-hover:opacity-100 shrink-0 p-0.5 rounded transition-opacity',
                    isSelected
                      ? 'text-primary-foreground/70 hover:text-primary-foreground'
                      : 'text-muted-foreground hover:text-foreground',
                  )}
                  title="Add subcategory"
                >
                  <Plus className="h-3 w-3" />
                </button>
              )}
            </div>

            {/* Children */}
            {hasChildren && isExpanded && (
              <CategoryTree
                categories={cat.children!}
                expandedIds={expandedIds}
                selectedId={selectedId}
                onToggle={onToggle}
                onSelect={onSelect}
                onAddSubcategory={onAddSubcategory}
                depth={depth + 1}
              />
            )}
          </li>
        );
      })}
    </ul>
  );
}

// ---------------------------------------------------------------------------
// Add category form
// ---------------------------------------------------------------------------
function AddCategoryForm({
  parentId,
  onClose,
}: {
  parentId?: string;
  onClose: () => void;
}) {
  const [name, setName] = useState('');
  const [icon, setIcon] = useState('');
  const [hsnCode, setHsnCode] = useState('');
  const createMutation = useCreateCategoryMutation();

  const handleCreate = () => {
    if (!name.trim()) return;
    createMutation.mutate(
      {
        name: name.trim(),
        parentId: parentId || undefined,
        icon: icon.trim() || undefined,
        hsnCode: hsnCode.trim() || undefined,
      },
      { onSuccess: () => onClose() },
    );
  };

  return (
    <div className="border-t p-3 space-y-2">
      <p className="text-xs font-medium text-muted-foreground">
        {parentId ? 'Add Subcategory' : 'Add Root Category'}
      </p>
      <input
        type="text"
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Category name"
        className="w-full rounded-md border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
        autoFocus
      />
      <input
        type="text"
        value={icon}
        onChange={(e) => setIcon(e.target.value)}
        placeholder="Icon (optional)"
        className="w-full rounded-md border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
      />
      <input
        type="text"
        value={hsnCode}
        onChange={(e) => setHsnCode(e.target.value)}
        placeholder="HSN Code (e.g., 8528)"
        maxLength={8}
        className="w-full rounded-md border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
      />
      <div className="flex items-center gap-2">
        <button
          onClick={handleCreate}
          disabled={createMutation.isPending || !name.trim()}
          className="flex-1 flex items-center justify-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
        >
          {createMutation.isPending ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Plus className="h-3.5 w-3.5" />
          )}
          Create
        </button>
        <button
          onClick={onClose}
          className="rounded-md border px-3 py-1.5 text-sm text-muted-foreground hover:bg-muted transition-colors"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Category detail panel
// ---------------------------------------------------------------------------
function CategoryDetail({ category }: { category: ProductCategory }) {
  const [isEditing, setIsEditing] = useState(false);
  const [editName, setEditName] = useState(category.name);
  const [editIcon, setEditIcon] = useState(category.icon ?? '');
  const [editHsnCode, setEditHsnCode] = useState(category.hsnCode ?? '');

  const updateMutation = useUpdateCategoryMutation();

  const handleSave = () => {
    updateMutation.mutate(
      {
        id: category.id,
        payload: {
          name: editName.trim(),
          icon: editIcon.trim() || undefined,
          hsnCode: editHsnCode.trim() || undefined,
        },
      },
      { onSuccess: () => setIsEditing(false) },
    );
  };

  // Reset edit fields when category changes
  const resetEdit = () => {
    setEditName(category.name);
    setEditIcon(category.icon ?? '');
    setEditHsnCode(category.hsnCode ?? '');
    setIsEditing(false);
  };

  return (
    <div className="rounded-lg border bg-card flex flex-col h-full">
      {/* Header */}
      <div className="p-4 border-b">
        {isEditing ? (
          <div className="space-y-2">
            <input
              type="text"
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              className="w-full rounded-md border bg-background px-3 py-2 text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-ring"
            />
            <input
              type="text"
              value={editIcon}
              onChange={(e) => setEditIcon(e.target.value)}
              placeholder="Icon (optional)"
              className="w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            />
            <input
              type="text"
              value={editHsnCode}
              onChange={(e) => setEditHsnCode(e.target.value)}
              placeholder="HSN Code (e.g., 8528)"
              maxLength={8}
              className="w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            />
            <div className="flex items-center gap-2">
              <button
                onClick={handleSave}
                disabled={updateMutation.isPending || !editName.trim()}
                className="flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
              >
                {updateMutation.isPending ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Save className="h-3.5 w-3.5" />
                )}
                Save
              </button>
              <button
                onClick={resetEdit}
                className="rounded-md border px-3 py-1.5 text-sm text-muted-foreground hover:bg-muted transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-semibold">{category.name}</h2>
              <div className="flex items-center gap-3 mt-1 text-sm text-muted-foreground">
                <span>Slug: {category.slug}</span>
                <span>Level: {category.level}</span>
                {category.hsnCode && (
                  <span>HSN: {category.hsnCode}</span>
                )}
                {category.isLeaf && (
                  <span className="inline-flex items-center rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700">
                    Leaf
                  </span>
                )}
                {!category.isActive && (
                  <span className="inline-flex items-center rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700">
                    Inactive
                  </span>
                )}
              </div>
            </div>
            <button
              onClick={() => {
                setEditName(category.name);
                setEditIcon(category.icon ?? '');
                setEditHsnCode(category.hsnCode ?? '');
                setIsEditing(true);
              }}
              className="rounded-md p-2 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
              title="Edit category"
            >
              <Pencil className="h-4 w-4" />
            </button>
          </div>
        )}
      </div>

      {/* Attributes */}
      <div className="flex-1 overflow-y-auto p-4">
        <CategoryAttributes categoryId={category.id} />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Category attributes section
// ---------------------------------------------------------------------------
function CategoryAttributes({ categoryId }: { categoryId: string }) {
  const { data: attributes, isLoading } = useCategoryAttributesQuery(categoryId);
  const [showAddAttr, setShowAddAttr] = useState(false);
  const [editingAttrId, setEditingAttrId] = useState<string | null>(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);

  // Add attribute form state
  const [addName, setAddName] = useState('');
  const [addLabel, setAddLabel] = useState('');
  const [addType, setAddType] = useState('text');
  const [addRequired, setAddRequired] = useState(false);
  const [addOptions, setAddOptions] = useState('');

  const createAttrMutation = useCreateCategoryAttributeMutation();
  const deleteAttrMutation = useDeleteCategoryAttributeMutation();

  const handleAddAttribute = () => {
    if (!addName.trim() || !addLabel.trim()) return;

    const payload: any = {
      attributeName: addName.trim(),
      attributeLabel: addLabel.trim(),
      attributeType: addType,
      isRequired: addRequired,
      displayOrder: (attributes?.length ?? 0),
    };

    if (addOptions.trim() && (addType === 'select' || addType === 'checkbox')) {
      payload.options = addOptions
        .split(',')
        .map((o) => o.trim())
        .filter(Boolean)
        .map((o) => ({ value: o, label: o }));
    }

    createAttrMutation.mutate(
      { categoryId, payload },
      {
        onSuccess: () => {
          setShowAddAttr(false);
          setAddName('');
          setAddLabel('');
          setAddType('text');
          setAddRequired(false);
          setAddOptions('');
        },
      },
    );
  };

  const handleDeleteAttr = (attrId: string) => {
    deleteAttrMutation.mutate(
      { categoryId, attrId },
      { onSuccess: () => setDeleteConfirmId(null) },
    );
  };

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground py-4">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading attributes...
      </div>
    );
  }

  const inputClass =
    'w-full rounded-md border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring';

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Attributes
        </h3>
        {!showAddAttr && (
          <button
            onClick={() => setShowAddAttr(true)}
            className="flex items-center gap-1.5 text-xs text-primary hover:underline"
          >
            <Plus className="h-3 w-3" />
            Add Attribute
          </button>
        )}
      </div>

      {(!attributes || attributes.length === 0) && !showAddAttr && (
        <p className="text-sm text-muted-foreground">
          No attributes defined for this category.
        </p>
      )}

      {/* Attribute list */}
      <div className="space-y-2">
        {attributes
          ?.sort((a, b) => a.displayOrder - b.displayOrder)
          .map((attr) => (
            <div key={attr.id} className="rounded-md border bg-background">
              {editingAttrId === attr.id ? (
                <InlineAttributeEditor
                  categoryId={categoryId}
                  attribute={attr}
                  onClose={() => setEditingAttrId(null)}
                />
              ) : (
                <div className="flex items-center gap-3 px-3 py-2.5">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-sm">
                        {attr.attributeLabel}
                      </span>
                      <span className="inline-flex items-center rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-700">
                        {attr.attributeType}
                      </span>
                      {attr.isRequired && (
                        <span className="text-xs text-destructive font-medium">
                          Required
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-muted-foreground mt-0.5">
                      {attr.attributeName}
                    </div>
                  </div>

                  <button
                    onClick={() => setEditingAttrId(attr.id)}
                    className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
                    title="Edit attribute"
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </button>

                  {deleteConfirmId === attr.id ? (
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => handleDeleteAttr(attr.id)}
                        disabled={deleteAttrMutation.isPending}
                        className="rounded-md px-2 py-1 text-xs bg-destructive text-destructive-foreground hover:bg-destructive/90 transition-colors"
                      >
                        {deleteAttrMutation.isPending ? '...' : 'Confirm'}
                      </button>
                      <button
                        onClick={() => setDeleteConfirmId(null)}
                        className="rounded-md p-1 text-muted-foreground hover:text-foreground"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => setDeleteConfirmId(attr.id)}
                      className="rounded-md p-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-colors"
                      title="Delete attribute"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
              )}
            </div>
          ))}
      </div>

      {/* Add attribute form */}
      {showAddAttr && (
        <div className="mt-3 rounded-md border border-dashed border-primary/50 bg-primary/5 p-4 space-y-3">
          <h4 className="text-sm font-semibold">New Attribute</h4>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">
                Attribute Name (key)
              </label>
              <input
                type="text"
                value={addName}
                onChange={(e) => setAddName(e.target.value)}
                placeholder="e.g. screenSize"
                className={inputClass}
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">
                Label
              </label>
              <input
                type="text"
                value={addLabel}
                onChange={(e) => setAddLabel(e.target.value)}
                placeholder="e.g. Screen Size"
                className={inputClass}
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">
                Type
              </label>
              <select
                value={addType}
                onChange={(e) => setAddType(e.target.value)}
                className={cn(inputClass, 'appearance-none')}
              >
                {ATTRIBUTE_TYPES.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex items-end">
              <label className="flex items-center gap-2 text-sm cursor-pointer pb-2">
                <input
                  type="checkbox"
                  checked={addRequired}
                  onChange={(e) => setAddRequired(e.target.checked)}
                  className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary"
                />
                Required
              </label>
            </div>
          </div>
          {(addType === 'select' || addType === 'checkbox') && (
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">
                Options (comma-separated)
              </label>
              <input
                type="text"
                value={addOptions}
                onChange={(e) => setAddOptions(e.target.value)}
                placeholder="e.g. Small, Medium, Large"
                className={inputClass}
              />
            </div>
          )}
          <div className="flex items-center gap-2">
            <button
              onClick={handleAddAttribute}
              disabled={
                createAttrMutation.isPending ||
                !addName.trim() ||
                !addLabel.trim()
              }
              className="flex items-center gap-1.5 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
            >
              {createAttrMutation.isPending ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Plus className="h-3.5 w-3.5" />
              )}
              Add
            </button>
            <button
              onClick={() => setShowAddAttr(false)}
              className="rounded-md border px-4 py-2 text-sm text-muted-foreground hover:bg-muted transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Inline attribute editor
// ---------------------------------------------------------------------------
function InlineAttributeEditor({
  categoryId,
  attribute,
  onClose,
}: {
  categoryId: string;
  attribute: CategoryAttribute;
  onClose: () => void;
}) {
  const [name, setName] = useState(attribute.attributeName);
  const [label, setLabel] = useState(attribute.attributeLabel);
  const [type, setType] = useState(attribute.attributeType);
  const [required, setRequired] = useState(attribute.isRequired);
  const [options, setOptions] = useState(() => {
    if (Array.isArray(attribute.options)) {
      return attribute.options
        .map((o: unknown) => {
          if (typeof o === 'object' && o !== null && 'label' in o) {
            return (o as { label: string }).label;
          }
          return String(o);
        })
        .join(', ');
    }
    return '';
  });

  const updateMutation = useUpdateCategoryAttributeMutation();

  const handleSave = () => {
    const payload: any = {
      attributeName: name.trim(),
      attributeLabel: label.trim(),
      attributeType: type,
      isRequired: required,
    };

    if (options.trim() && (type === 'select' || type === 'checkbox')) {
      payload.options = options
        .split(',')
        .map((o) => o.trim())
        .filter(Boolean)
        .map((o) => ({ value: o, label: o }));
    }

    updateMutation.mutate(
      { categoryId, attrId: attribute.id, payload },
      { onSuccess: () => onClose() },
    );
  };

  const inputClass =
    'w-full rounded-md border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring';

  return (
    <div className="p-3 bg-muted/30 space-y-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label className="block text-xs font-medium text-muted-foreground mb-1">
            Name (key)
          </label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className={inputClass}
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-muted-foreground mb-1">
            Label
          </label>
          <input
            type="text"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            className={inputClass}
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-muted-foreground mb-1">
            Type
          </label>
          <select
            value={type}
            onChange={(e) => setType(e.target.value)}
            className={cn(inputClass, 'appearance-none')}
          >
            {ATTRIBUTE_TYPES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
        </div>
        <div className="flex items-end">
          <label className="flex items-center gap-2 text-sm cursor-pointer pb-2">
            <input
              type="checkbox"
              checked={required}
              onChange={(e) => setRequired(e.target.checked)}
              className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary"
            />
            Required
          </label>
        </div>
      </div>
      {(type === 'select' || type === 'checkbox') && (
        <div>
          <label className="block text-xs font-medium text-muted-foreground mb-1">
            Options (comma-separated)
          </label>
          <input
            type="text"
            value={options}
            onChange={(e) => setOptions(e.target.value)}
            className={inputClass}
          />
        </div>
      )}
      <div className="flex items-center gap-2">
        <button
          onClick={handleSave}
          disabled={updateMutation.isPending || !name.trim() || !label.trim()}
          className="flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
        >
          {updateMutation.isPending ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Save className="h-3.5 w-3.5" />
          )}
          Save
        </button>
        <button
          onClick={onClose}
          className="rounded-md border px-3 py-1.5 text-sm text-muted-foreground hover:bg-muted transition-colors"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
