import { useState, useCallback } from 'react';
import {
  Plus,
  Pencil,
  Trash2,
  ChevronUp,
  ChevronDown,
  ChevronRight,
  Loader2,
  Save,
  X,
  AlertCircle,
  GripVertical,
  FileText,
} from 'lucide-react';
import { cn } from '../../lib/utils';
import {
  useFormDefinitionsQuery,
  useFormDefinitionByIdQuery,
  useCreateFormDefinitionMutation,
  useUpdateFormDefinitionMutation,
  useAddFormFieldMutation,
  useUpdateFormFieldMutation,
  useDeleteFormFieldMutation,
  useReorderFormFieldsMutation,
} from '../../hooks/useForms';
import { FormFieldType } from '@retailerp/shared-types';
import type { FormField, FormDefinition } from '@retailerp/shared-types';

// ---------------------------------------------------------------------------
// Field type options for dropdown
// ---------------------------------------------------------------------------
const FIELD_TYPE_OPTIONS: { value: FormFieldType; label: string }[] = [
  { value: FormFieldType.TEXT, label: 'Text' },
  { value: FormFieldType.NUMBER, label: 'Number' },
  { value: FormFieldType.SELECT, label: 'Select Dropdown' },
  { value: FormFieldType.MULTI_SELECT, label: 'Multi-Select' },
  { value: FormFieldType.DATE, label: 'Date' },
  { value: FormFieldType.TEL, label: 'Phone' },
  { value: FormFieldType.EMAIL, label: 'Email' },
  { value: FormFieldType.TEXTAREA, label: 'Textarea' },
  { value: FormFieldType.CHECKBOX, label: 'Checkbox' },
  { value: FormFieldType.RADIO, label: 'Radio Group' },
  { value: FormFieldType.FILE, label: 'File Upload' },
  { value: FormFieldType.HIDDEN, label: 'Hidden' },
];

const FIELD_TYPE_COLORS: Record<string, string> = {
  text: 'bg-blue-100 text-blue-700',
  number: 'bg-green-100 text-green-700',
  select: 'bg-purple-100 text-purple-700',
  multi_select: 'bg-purple-100 text-purple-700',
  date: 'bg-orange-100 text-orange-700',
  tel: 'bg-blue-100 text-blue-700',
  email: 'bg-blue-100 text-blue-700',
  textarea: 'bg-gray-100 text-gray-700',
  checkbox: 'bg-yellow-100 text-yellow-700',
  radio: 'bg-yellow-100 text-yellow-700',
  file: 'bg-pink-100 text-pink-700',
  hidden: 'bg-gray-100 text-gray-500',
};

// ---------------------------------------------------------------------------
// Empty field template
// ---------------------------------------------------------------------------
function emptyFieldForm(): FieldFormData {
  return {
    fieldName: '',
    fieldLabel: '',
    fieldType: FormFieldType.TEXT,
    placeholder: '',
    defaultValue: '',
    isRequired: false,
    sectionName: '',
    cssClass: '',
    isVisible: true,
    options: [],
    validationRules: {},
    dependsOn: { field: '', value: '' },
  };
}

interface FieldFormData {
  fieldName: string;
  fieldLabel: string;
  fieldType: FormFieldType;
  placeholder: string;
  defaultValue: string;
  isRequired: boolean;
  sectionName: string;
  cssClass: string;
  isVisible: boolean;
  options: { value: string; label: string }[];
  validationRules: Record<string, unknown>;
  dependsOn: { field: string; value: string };
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------
export function FormBuilderPage() {
  const [selectedDefId, setSelectedDefId] = useState<string | null>(null);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [newFormName, setNewFormName] = useState('');
  const [newFormDescription, setNewFormDescription] = useState('');

  // Queries
  const { data: definitions, isLoading: loadingDefs } = useFormDefinitionsQuery();
  const { data: selectedDef, isLoading: loadingSelected } =
    useFormDefinitionByIdQuery(selectedDefId ?? undefined);

  // Mutations
  const createDefMutation = useCreateFormDefinitionMutation();

  const handleCreateDef = () => {
    if (!newFormName.trim()) return;
    createDefMutation.mutate(
      {
        formName: newFormName.trim(),
        description: newFormDescription.trim() || undefined,
      },
      {
        onSuccess: (created) => {
          setSelectedDefId(created.id);
          setShowCreateForm(false);
          setNewFormName('');
          setNewFormDescription('');
        },
      },
    );
  };

  return (
    <div className="flex gap-6 h-[calc(100vh-12rem)]">
      {/* Left sidebar: Definition list */}
      <div className="w-72 shrink-0 rounded-lg border bg-card flex flex-col">
        <div className="p-4 border-b">
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
            Form Definitions
          </h2>
        </div>

        <div className="flex-1 overflow-y-auto p-2">
          {loadingDefs ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : !definitions || definitions.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">
              No form definitions yet.
            </p>
          ) : (
            <ul className="space-y-1">
              {definitions.map((def) => (
                <li key={def.id}>
                  <button
                    onClick={() => setSelectedDefId(def.id)}
                    className={cn(
                      'w-full flex items-center gap-3 rounded-md px-3 py-2.5 text-sm text-left transition-colors',
                      selectedDefId === def.id
                        ? 'bg-primary text-primary-foreground'
                        : 'text-foreground hover:bg-muted',
                    )}
                  >
                    <FileText className="h-4 w-4 shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="font-medium truncate">{def.formName}</div>
                      {def.description && (
                        <div
                          className={cn(
                            'text-xs truncate mt-0.5',
                            selectedDefId === def.id
                              ? 'text-primary-foreground/70'
                              : 'text-muted-foreground',
                          )}
                        >
                          {def.description}
                        </div>
                      )}
                    </div>
                    <ChevronRight className="h-4 w-4 shrink-0 opacity-50" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Create new form */}
        <div className="border-t p-3">
          {showCreateForm ? (
            <div className="space-y-2">
              <input
                type="text"
                value={newFormName}
                onChange={(e) => setNewFormName(e.target.value)}
                placeholder="Form name (e.g. customer)"
                className="w-full rounded-md border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              />
              <input
                type="text"
                value={newFormDescription}
                onChange={(e) => setNewFormDescription(e.target.value)}
                placeholder="Description (optional)"
                className="w-full rounded-md border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              />
              <div className="flex items-center gap-2">
                <button
                  onClick={handleCreateDef}
                  disabled={createDefMutation.isPending || !newFormName.trim()}
                  className="flex-1 flex items-center justify-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
                >
                  {createDefMutation.isPending ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Save className="h-3.5 w-3.5" />
                  )}
                  Create
                </button>
                <button
                  onClick={() => {
                    setShowCreateForm(false);
                    setNewFormName('');
                    setNewFormDescription('');
                  }}
                  className="rounded-md border px-3 py-1.5 text-sm text-muted-foreground hover:bg-muted transition-colors"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <button
              onClick={() => setShowCreateForm(true)}
              className="w-full flex items-center justify-center gap-2 rounded-md border border-dashed px-3 py-2 text-sm text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
            >
              <Plus className="h-4 w-4" />
              New Form
            </button>
          )}
        </div>
      </div>

      {/* Right panel: Field editor */}
      <div className="flex-1 min-w-0">
        {!selectedDefId ? (
          <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
            <FileText className="h-12 w-12 mb-4 opacity-30" />
            <p className="text-sm">Select a form definition to manage its fields.</p>
          </div>
        ) : loadingSelected ? (
          <div className="flex items-center justify-center h-full">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : selectedDef ? (
          <FieldEditor definition={selectedDef} />
        ) : (
          <div className="flex items-center gap-2 rounded-md bg-destructive/10 px-4 py-3 text-sm text-destructive">
            <AlertCircle className="h-4 w-4 shrink-0" />
            Failed to load form definition.
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Field editor panel
// ---------------------------------------------------------------------------
function FieldEditor({ definition }: { definition: FormDefinition }) {
  const [expandedFieldId, setExpandedFieldId] = useState<string | null>(null);
  const [showAddField, setShowAddField] = useState(false);
  const [addFieldData, setAddFieldData] = useState<FieldFormData>(emptyFieldForm());
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);

  // Mutations
  const addFieldMutation = useAddFormFieldMutation();
  const updateFieldMutation = useUpdateFormFieldMutation();
  const deleteFieldMutation = useDeleteFormFieldMutation();
  const reorderMutation = useReorderFormFieldsMutation();

  const sortedFields = [...definition.fields].sort(
    (a, b) => a.displayOrder - b.displayOrder,
  );

  // Reorder helpers
  const moveField = useCallback(
    (fieldId: string, direction: 'up' | 'down') => {
      const ids = sortedFields.map((f) => f.id);
      const idx = ids.indexOf(fieldId);
      if (idx < 0) return;
      const newIdx = direction === 'up' ? idx - 1 : idx + 1;
      if (newIdx < 0 || newIdx >= ids.length) return;
      [ids[idx], ids[newIdx]] = [ids[newIdx], ids[idx]];
      reorderMutation.mutate({ definitionId: definition.id, fieldIds: ids });
    },
    [sortedFields, definition.id, reorderMutation],
  );

  const handleAddField = () => {
    if (!addFieldData.fieldName.trim() || !addFieldData.fieldLabel.trim()) return;

    const payload: any = {
      fieldName: addFieldData.fieldName.trim(),
      fieldLabel: addFieldData.fieldLabel.trim(),
      fieldType: addFieldData.fieldType,
      placeholder: addFieldData.placeholder.trim() || undefined,
      defaultValue: addFieldData.defaultValue.trim() || undefined,
      isRequired: addFieldData.isRequired,
      sectionName: addFieldData.sectionName.trim() || undefined,
      cssClass: addFieldData.cssClass.trim() || undefined,
      isVisible: addFieldData.isVisible,
      displayOrder: sortedFields.length,
      options:
        addFieldData.options.length > 0 ? addFieldData.options : undefined,
      validationRules:
        Object.keys(addFieldData.validationRules).length > 0
          ? addFieldData.validationRules
          : undefined,
      dependsOn:
        addFieldData.dependsOn.field.trim()
          ? addFieldData.dependsOn
          : undefined,
    };

    addFieldMutation.mutate(
      { definitionId: definition.id, payload },
      {
        onSuccess: () => {
          setShowAddField(false);
          setAddFieldData(emptyFieldForm());
        },
      },
    );
  };

  const handleDeleteField = (fieldId: string) => {
    deleteFieldMutation.mutate(fieldId, {
      onSuccess: () => setDeleteConfirmId(null),
    });
  };

  return (
    <div className="rounded-lg border bg-card flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b">
        <div>
          <h2 className="text-lg font-semibold">{definition.formName}</h2>
          {definition.description && (
            <p className="text-sm text-muted-foreground mt-0.5">
              {definition.description}
            </p>
          )}
        </div>
        <span className="text-xs text-muted-foreground">
          v{definition.version} &middot; {sortedFields.length} field
          {sortedFields.length !== 1 ? 's' : ''}
        </span>
      </div>

      {/* Field list */}
      <div className="flex-1 overflow-y-auto p-4 space-y-2">
        {sortedFields.length === 0 && !showAddField && (
          <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
            <p className="text-sm">No fields yet. Add one below.</p>
          </div>
        )}

        {sortedFields.map((field, idx) => (
          <div
            key={field.id}
            className="rounded-md border bg-background"
          >
            {/* Field row */}
            <div className="flex items-center gap-2 px-3 py-2.5">
              {/* Reorder buttons */}
              <div className="flex flex-col">
                <button
                  onClick={() => moveField(field.id, 'up')}
                  disabled={idx === 0 || reorderMutation.isPending}
                  className="text-muted-foreground hover:text-foreground disabled:opacity-20 transition-colors"
                  title="Move up"
                >
                  <ChevronUp className="h-3.5 w-3.5" />
                </button>
                <button
                  onClick={() => moveField(field.id, 'down')}
                  disabled={
                    idx === sortedFields.length - 1 ||
                    reorderMutation.isPending
                  }
                  className="text-muted-foreground hover:text-foreground disabled:opacity-20 transition-colors"
                  title="Move down"
                >
                  <ChevronDown className="h-3.5 w-3.5" />
                </button>
              </div>

              <GripVertical className="h-4 w-4 text-muted-foreground/40" />

              {/* Field info */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-sm truncate">
                    {field.fieldLabel}
                  </span>
                  <span
                    className={cn(
                      'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium',
                      FIELD_TYPE_COLORS[field.fieldType] ?? 'bg-gray-100 text-gray-700',
                    )}
                  >
                    {field.fieldType}
                  </span>
                  {field.isRequired && (
                    <span className="text-destructive text-xs font-medium">
                      Required
                    </span>
                  )}
                  {field.sectionName && (
                    <span className="text-xs text-muted-foreground">
                      [{field.sectionName}]
                    </span>
                  )}
                </div>
                <div className="text-xs text-muted-foreground mt-0.5">
                  {field.fieldName}
                  {field.dependsOn?.field && (
                    <span className="ml-2 text-orange-600">
                      depends on: {field.dependsOn.field}={field.dependsOn.value}
                    </span>
                  )}
                </div>
              </div>

              {/* Actions */}
              <button
                onClick={() =>
                  setExpandedFieldId(
                    expandedFieldId === field.id ? null : field.id,
                  )
                }
                className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
                title="Edit field"
              >
                <Pencil className="h-3.5 w-3.5" />
              </button>

              {deleteConfirmId === field.id ? (
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => handleDeleteField(field.id)}
                    disabled={deleteFieldMutation.isPending}
                    className="rounded-md px-2 py-1 text-xs bg-destructive text-destructive-foreground hover:bg-destructive/90 transition-colors"
                  >
                    {deleteFieldMutation.isPending ? 'Deleting...' : 'Confirm'}
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
                  onClick={() => setDeleteConfirmId(field.id)}
                  className="rounded-md p-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-colors"
                  title="Delete field"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              )}
            </div>

            {/* Expanded inline editor */}
            {expandedFieldId === field.id && (
              <InlineFieldEditor
                field={field}
                allFields={sortedFields}
                onClose={() => setExpandedFieldId(null)}
              />
            )}
          </div>
        ))}

        {/* Add field form */}
        {showAddField && (
          <div className="rounded-md border border-dashed border-primary/50 bg-primary/5 p-4 space-y-3">
            <h3 className="text-sm font-semibold">Add New Field</h3>
            <FieldFormFields
              data={addFieldData}
              onChange={setAddFieldData}
              allFields={sortedFields}
            />
            <div className="flex items-center gap-2 pt-2">
              <button
                onClick={handleAddField}
                disabled={
                  addFieldMutation.isPending ||
                  !addFieldData.fieldName.trim() ||
                  !addFieldData.fieldLabel.trim()
                }
                className="flex items-center gap-1.5 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
              >
                {addFieldMutation.isPending ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Plus className="h-3.5 w-3.5" />
                )}
                Add Field
              </button>
              <button
                onClick={() => {
                  setShowAddField(false);
                  setAddFieldData(emptyFieldForm());
                }}
                className="rounded-md border px-4 py-2 text-sm text-muted-foreground hover:bg-muted transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Footer */}
      {!showAddField && (
        <div className="border-t p-3">
          <button
            onClick={() => setShowAddField(true)}
            className="w-full flex items-center justify-center gap-2 rounded-md border border-dashed px-3 py-2.5 text-sm text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
          >
            <Plus className="h-4 w-4" />
            Add Field
          </button>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Inline field editor (expanded row)
// ---------------------------------------------------------------------------
function InlineFieldEditor({
  field,
  allFields,
  onClose,
}: {
  field: FormField;
  allFields: FormField[];
  onClose: () => void;
}) {
  const [data, setData] = useState<FieldFormData>({
    fieldName: field.fieldName,
    fieldLabel: field.fieldLabel,
    fieldType: field.fieldType as FormFieldType,
    placeholder: field.placeholder ?? '',
    defaultValue: field.defaultValue ?? '',
    isRequired: field.isRequired,
    sectionName: field.sectionName ?? '',
    cssClass: field.cssClass ?? '',
    isVisible: field.isVisible,
    options: field.options ?? [],
    validationRules: (field.validationRules as Record<string, unknown>) ?? {},
    dependsOn: field.dependsOn ?? { field: '', value: '' },
  });

  const updateMutation = useUpdateFormFieldMutation();

  const handleSave = () => {
    const payload: any = {
      fieldName: data.fieldName.trim(),
      fieldLabel: data.fieldLabel.trim(),
      fieldType: data.fieldType,
      placeholder: data.placeholder.trim() || undefined,
      defaultValue: data.defaultValue.trim() || undefined,
      isRequired: data.isRequired,
      sectionName: data.sectionName.trim() || undefined,
      cssClass: data.cssClass.trim() || undefined,
      isVisible: data.isVisible,
      options: data.options.length > 0 ? data.options : undefined,
      validationRules:
        Object.keys(data.validationRules).length > 0
          ? data.validationRules
          : undefined,
      dependsOn: data.dependsOn.field.trim()
        ? data.dependsOn
        : undefined,
    };

    updateMutation.mutate(
      { fieldId: field.id, payload },
      { onSuccess: () => onClose() },
    );
  };

  return (
    <div className="border-t bg-muted/30 p-4 space-y-3">
      <FieldFormFields data={data} onChange={setData} allFields={allFields} />
      <div className="flex items-center gap-2 pt-2">
        <button
          onClick={handleSave}
          disabled={
            updateMutation.isPending ||
            !data.fieldName.trim() ||
            !data.fieldLabel.trim()
          }
          className="flex items-center gap-1.5 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
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
          className="rounded-md border px-4 py-2 text-sm text-muted-foreground hover:bg-muted transition-colors"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Shared field-editing form inputs
// ---------------------------------------------------------------------------
function FieldFormFields({
  data,
  onChange,
  allFields,
}: {
  data: FieldFormData;
  onChange: (d: FieldFormData) => void;
  allFields: FormField[];
}) {
  const needsOptions =
    data.fieldType === FormFieldType.SELECT ||
    data.fieldType === FormFieldType.MULTI_SELECT ||
    data.fieldType === FormFieldType.RADIO;

  const update = (partial: Partial<FieldFormData>) =>
    onChange({ ...data, ...partial });

  // Option helpers
  const addOption = () => {
    update({ options: [...data.options, { value: '', label: '' }] });
  };

  const updateOption = (
    idx: number,
    key: 'value' | 'label',
    val: string,
  ) => {
    const next = [...data.options];
    next[idx] = { ...next[idx], [key]: val };
    update({ options: next });
  };

  const removeOption = (idx: number) => {
    update({ options: data.options.filter((_, i) => i !== idx) });
  };

  // Validation rule helpers
  const updateRule = (key: string, val: string) => {
    const next = { ...data.validationRules };
    if (val) {
      next[key] = val;
    } else {
      delete next[key];
    }
    update({ validationRules: next });
  };

  const inputClass =
    'w-full rounded-md border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring';

  return (
    <div className="space-y-4">
      {/* Row 1: Name, Label, Type */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div>
          <label className="block text-xs font-medium text-muted-foreground mb-1">
            Field Name (key)
          </label>
          <input
            type="text"
            value={data.fieldName}
            onChange={(e) => update({ fieldName: e.target.value })}
            placeholder="e.g. customerName"
            className={inputClass}
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-muted-foreground mb-1">
            Field Label
          </label>
          <input
            type="text"
            value={data.fieldLabel}
            onChange={(e) => update({ fieldLabel: e.target.value })}
            placeholder="e.g. Customer Name"
            className={inputClass}
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-muted-foreground mb-1">
            Field Type
          </label>
          <select
            value={data.fieldType}
            onChange={(e) =>
              update({ fieldType: e.target.value as FormFieldType })
            }
            className={cn(inputClass, 'appearance-none')}
          >
            {FIELD_TYPE_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Row 2: Placeholder, Default Value, Section */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div>
          <label className="block text-xs font-medium text-muted-foreground mb-1">
            Placeholder
          </label>
          <input
            type="text"
            value={data.placeholder}
            onChange={(e) => update({ placeholder: e.target.value })}
            placeholder="Placeholder text"
            className={inputClass}
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-muted-foreground mb-1">
            Default Value
          </label>
          <input
            type="text"
            value={data.defaultValue}
            onChange={(e) => update({ defaultValue: e.target.value })}
            placeholder="Default value"
            className={inputClass}
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-muted-foreground mb-1">
            Section Name
          </label>
          <input
            type="text"
            value={data.sectionName}
            onChange={(e) => update({ sectionName: e.target.value })}
            placeholder="e.g. Personal Info"
            className={inputClass}
          />
        </div>
      </div>

      {/* Row 3: CSS Class, Required, Visible */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div>
          <label className="block text-xs font-medium text-muted-foreground mb-1">
            CSS Class
          </label>
          <input
            type="text"
            value={data.cssClass}
            onChange={(e) => update({ cssClass: e.target.value })}
            placeholder="e.g. col-span-2"
            className={inputClass}
          />
        </div>
        <div className="flex items-end gap-4">
          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <input
              type="checkbox"
              checked={data.isRequired}
              onChange={(e) => update({ isRequired: e.target.checked })}
              className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary"
            />
            Required
          </label>
          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <input
              type="checkbox"
              checked={data.isVisible}
              onChange={(e) => update({ isVisible: e.target.checked })}
              className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary"
            />
            Visible
          </label>
        </div>
      </div>

      {/* Depends On */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label className="block text-xs font-medium text-muted-foreground mb-1">
            Depends On (field name)
          </label>
          <select
            value={data.dependsOn.field}
            onChange={(e) =>
              update({
                dependsOn: { ...data.dependsOn, field: e.target.value },
              })
            }
            className={cn(inputClass, 'appearance-none')}
          >
            <option value="">None</option>
            {allFields
              .filter((f) => f.fieldName !== data.fieldName)
              .map((f) => (
                <option key={f.id} value={f.fieldName}>
                  {f.fieldLabel} ({f.fieldName})
                </option>
              ))}
          </select>
        </div>
        {data.dependsOn.field && (
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1">
              Depends On (value)
            </label>
            <input
              type="text"
              value={data.dependsOn.value}
              onChange={(e) =>
                update({
                  dependsOn: { ...data.dependsOn, value: e.target.value },
                })
              }
              placeholder="Value to match"
              className={inputClass}
            />
          </div>
        )}
      </div>

      {/* Options (for select, multi_select, radio) */}
      {needsOptions && (
        <div>
          <label className="block text-xs font-medium text-muted-foreground mb-1">
            Options
          </label>
          <div className="space-y-2">
            {data.options.map((opt, idx) => (
              <div key={idx} className="flex items-center gap-2">
                <input
                  type="text"
                  value={opt.value}
                  onChange={(e) => updateOption(idx, 'value', e.target.value)}
                  placeholder="Value"
                  className={cn(inputClass, 'flex-1')}
                />
                <input
                  type="text"
                  value={opt.label}
                  onChange={(e) => updateOption(idx, 'label', e.target.value)}
                  placeholder="Label"
                  className={cn(inputClass, 'flex-1')}
                />
                <button
                  onClick={() => removeOption(idx)}
                  className="rounded-md p-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-colors"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
            <button
              onClick={addOption}
              className="flex items-center gap-1.5 text-xs text-primary hover:underline"
            >
              <Plus className="h-3 w-3" />
              Add Option
            </button>
          </div>
        </div>
      )}

      {/* Validation rules */}
      <div>
        <label className="block text-xs font-medium text-muted-foreground mb-1">
          Validation Rules
        </label>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          <input
            type="text"
            value={(data.validationRules.pattern as string) ?? ''}
            onChange={(e) => updateRule('pattern', e.target.value)}
            placeholder="Regex pattern"
            className={inputClass}
          />
          <input
            type="text"
            value={(data.validationRules.min as string) ?? ''}
            onChange={(e) => updateRule('min', e.target.value)}
            placeholder="Min value"
            className={inputClass}
          />
          <input
            type="text"
            value={(data.validationRules.max as string) ?? ''}
            onChange={(e) => updateRule('max', e.target.value)}
            placeholder="Max value"
            className={inputClass}
          />
          <input
            type="text"
            value={(data.validationRules.minLength as string) ?? ''}
            onChange={(e) => updateRule('minLength', e.target.value)}
            placeholder="Min length"
            className={inputClass}
          />
          <input
            type="text"
            value={(data.validationRules.maxLength as string) ?? ''}
            onChange={(e) => updateRule('maxLength', e.target.value)}
            placeholder="Max length"
            className={inputClass}
          />
          <input
            type="text"
            value={(data.validationRules.patternMessage as string) ?? ''}
            onChange={(e) => updateRule('patternMessage', e.target.value)}
            placeholder="Pattern error message"
            className={inputClass}
          />
        </div>
      </div>
    </div>
  );
}
