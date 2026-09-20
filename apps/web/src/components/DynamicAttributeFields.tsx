import { useEffect } from 'react';
import { useFormContext, useFieldArray } from 'react-hook-form';
import { Loader2, Plus, X } from 'lucide-react';
import { cn } from '../lib/utils';
import { useCategoryAttributesQuery } from '../hooks/useProducts';

interface DynamicAttributeFieldsProps {
  /** The leaf category ID to fetch attributes for */
  categoryId: string | undefined;
  /** Pre-filled values for edit mode: { attributeName: value } */
  values?: Record<string, unknown>;
  /** Field name prefix for react-hook-form registration (default: 'dynamicAttributes') */
  fieldPrefix?: string;
}

/**
 * Renders dynamic form fields based on the category's attribute definitions.
 * Must be used within a react-hook-form FormProvider context.
 */
export function DynamicAttributeFields({
  categoryId,
  values,
  fieldPrefix = 'dynamicAttributes',
}: DynamicAttributeFieldsProps) {
  const { register, setValue, watch, formState: { errors } } = useFormContext();
  const { data: attributes, isLoading } = useCategoryAttributesQuery(categoryId);

  // Pre-fill values when editing; case-correct existing select values to
  // canonical option labels so OCR-parsed values like "samsung" or "SAMSUNG"
  // resolve to the dropdown option "Samsung".
  useEffect(() => {
    if (!attributes) return;
    for (const attr of attributes) {
      const valFromProp = values?.[attr.attributeName];
      if (valFromProp !== undefined) {
        setValue(`${fieldPrefix}.${attr.attributeName}`, valFromProp);
      }
      if (attr.attributeType === 'select' && Array.isArray(attr.options)) {
        const current = watch(`${fieldPrefix}.${attr.attributeName}`);
        if (typeof current === 'string' && current.trim()) {
          const normalized = current.trim().toLowerCase();
          const canonical = attr.options
            .map((o) => (typeof o === 'object' && o !== null ? ((o as Record<string, string>).value ?? String(o)) : String(o)))
            .find((opt) => opt.toLowerCase() === normalized);
          if (canonical && canonical !== current) {
            setValue(`${fieldPrefix}.${attr.attributeName}`, canonical);
          }
        }
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [values, attributes, fieldPrefix]);

  if (!categoryId) {
    return (
      <p className="text-sm text-muted-foreground py-2">
        Select a category to see additional fields.
      </p>
    );
  }

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground py-2">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading category fields...
      </div>
    );
  }

  if (!attributes || attributes.length === 0) {
    return (
      <p className="text-sm text-muted-foreground py-2">
        No additional fields for this category.
      </p>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {/* Defensive de-duplication by attributeName — protects the form from
          ever rendering two inputs for the same logical field if upstream
          data (legacy DB rows, stale TanStack Query cache, etc.) ever
          returns duplicates. The first occurrence wins after sorting by
          displayOrder. */}
      {Array.from(
        new Map(
          [...attributes]
            .sort((a, b) => a.displayOrder - b.displayOrder)
            .map((attr) => [attr.attributeName, attr] as const),
        ).values(),
      )
        .map((attr) => {
          const fieldName = `${fieldPrefix}.${attr.attributeName}`;
          // Resolve error by walking the fieldPrefix path (e.g. 'items.0.dynamicAttributes' -> errors.items[0].dynamicAttributes)
          const fieldError = fieldPrefix.split('.').reduce(
            (obj: any, key) => obj?.[key],
            errors as Record<string, any>,
          )?.[attr.attributeName];

          return (
            <div key={attr.id}>
              <label
                htmlFor={fieldName}
                className="block text-sm font-medium mb-1.5"
              >
                {attr.attributeLabel}
                {attr.isRequired && (
                  <span className="text-destructive ml-0.5">*</span>
                )}
              </label>

              {/* Text input */}
              {(attr.attributeType === 'text' || attr.attributeType === 'tel' || attr.attributeType === 'email') && (
                <input
                  id={fieldName}
                  type={attr.attributeType === 'tel' ? 'tel' : attr.attributeType === 'email' ? 'email' : 'text'}
                  {...register(fieldName, {
                    required: attr.isRequired ? `${attr.attributeLabel} is required` : false,
                  })}
                  placeholder={`Enter ${attr.attributeLabel.toLowerCase()}`}
                  className={cn(
                    'w-full rounded-md border bg-field px-3 py-2.5 text-sm',
                    'placeholder:text-muted-foreground',
                    'focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2',
                    fieldError && 'border-destructive',
                  )}
                />
              )}

              {/* Number input */}
              {attr.attributeType === 'number' && (
                <input
                  id={fieldName}
                  type="number"
                  step="any"
                  {...register(fieldName, {
                    required: attr.isRequired ? `${attr.attributeLabel} is required` : false,
                    valueAsNumber: true,
                  })}
                  placeholder={`Enter ${attr.attributeLabel.toLowerCase()}`}
                  className={cn(
                    'w-full rounded-md border bg-field px-3 py-2.5 text-sm',
                    'placeholder:text-muted-foreground',
                    'focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2',
                    fieldError && 'border-destructive',
                  )}
                />
              )}

              {/* Select */}
              {attr.attributeType === 'select' && (
                <div className="relative">
                  <select
                    id={fieldName}
                    {...register(fieldName, {
                      required: attr.isRequired ? `${attr.attributeLabel} is required` : false,
                    })}
                    className={cn(
                      'w-full appearance-none rounded-md border bg-field px-3 py-2.5 pr-8 text-sm',
                      'focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2',
                      fieldError && 'border-destructive',
                    )}
                  >
                    <option value="">Select...</option>
                    {(() => {
                      const opts = Array.isArray(attr.options) ? attr.options : [];
                      const normalized = opts.map((opt) => {
                        const optValue = typeof opt === 'object' && opt !== null
                          ? (opt as Record<string, string>).value ?? String(opt)
                          : String(opt);
                        const optLabel = typeof opt === 'object' && opt !== null
                          ? (opt as Record<string, string>).label ?? String(opt)
                          : String(opt);
                        return { value: optValue, label: optLabel };
                      });
                      const current = watch(fieldName);
                      const missing =
                        typeof current === 'string' &&
                        current.trim() &&
                        !normalized.some((o) => o.value === current);
                      return (
                        <>
                          {missing && (
                            <option value={current as string}>{`${current} (custom)`}</option>
                          )}
                          {normalized.map((o) => (
                            <option key={o.value} value={o.value}>{o.label}</option>
                          ))}
                        </>
                      );
                    })()}
                  </select>
                </div>
              )}

              {/* Checkbox */}
              {attr.attributeType === 'checkbox' && (
                <div className="flex items-center gap-2 pt-1">
                  <input
                    id={fieldName}
                    type="checkbox"
                    {...register(fieldName)}
                    className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary"
                  />
                  <label
                    htmlFor={fieldName}
                    className="text-sm text-muted-foreground"
                  >
                    {attr.attributeLabel}
                  </label>
                </div>
              )}

              {/* Textarea */}
              {attr.attributeType === 'textarea' && (
                <textarea
                  id={fieldName}
                  {...register(fieldName, {
                    required: attr.isRequired ? `${attr.attributeLabel} is required` : false,
                  })}
                  rows={3}
                  placeholder={`Enter ${attr.attributeLabel.toLowerCase()}`}
                  className={cn(
                    'w-full rounded-md border bg-field px-3 py-2.5 text-sm',
                    'placeholder:text-muted-foreground',
                    'focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2',
                    fieldError && 'border-destructive',
                  )}
                />
              )}

              {/* Multi-text — list of free-text rows with add/remove. Used
                  for fields like IMEI numbers where one product may carry
                  multiple values. The validationRules can carry:
                    - pattern: regex applied to each row
                    - patternMessage: message to show when the pattern fails
                    - minItems: min rows required (default 1 if isRequired)
                    - maxItems: cap (default 5)                                       */}
              {attr.attributeType === 'multi_text' && (
                <MultiTextField
                  fieldName={fieldName}
                  isRequired={attr.isRequired}
                  label={attr.attributeLabel}
                  validationRules={attr.validationRules as Record<string, unknown> | null | undefined}
                  initialValues={values?.[attr.attributeName] as string[] | undefined}
                />
              )}

              {fieldError && (
                <p className="mt-1 text-xs text-destructive">
                  {fieldError.message as string}
                </p>
              )}
            </div>
          );
        })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// MultiTextField — renders a list of text inputs with add/remove buttons.
// Stores the value as `string[]` on the form via setValue. Supports per-row
// regex validation (e.g. 15-digit IMEI) and min/max row counts.
// ---------------------------------------------------------------------------
function MultiTextField({
  fieldName,
  isRequired,
  label,
  validationRules,
  initialValues,
}: {
  fieldName: string;
  isRequired: boolean;
  label: string;
  validationRules?: Record<string, unknown> | null;
  initialValues?: string[];
}) {
  const { register, control, setValue, getValues, formState: { errors } } =
    useFormContext();

  // We use useFieldArray on a parallel "_rows" sub-tree of objects, then
  // sync the final string[] back to `fieldName`. This sidesteps the
  // limitation that useFieldArray needs object items, while still giving us
  // stable row keys + add/remove animations.
  const rowsFieldName = `${fieldName}__rows`;
  const { fields, append, remove } = useFieldArray({
    control,
    name: rowsFieldName,
  });

  const minItems =
    typeof validationRules?.minItems === 'number'
      ? (validationRules.minItems as number)
      : isRequired
        ? 1
        : 0;
  const maxItems =
    typeof validationRules?.maxItems === 'number'
      ? (validationRules.maxItems as number)
      : 5;
  const pattern =
    typeof validationRules?.pattern === 'string'
      ? new RegExp(validationRules.pattern as string)
      : null;
  const patternMessage =
    typeof validationRules?.patternMessage === 'string'
      ? (validationRules.patternMessage as string)
      : `Invalid ${label.toLowerCase()}`;

  // Seed rows from initialValues (edit mode) or from any existing form
  // value, and ensure at least one input is shown.
  useEffect(() => {
    if (fields.length > 0) return;
    const existingArray = (getValues(fieldName) as unknown[] | undefined) ?? [];
    const seed: string[] = initialValues && initialValues.length > 0
      ? initialValues
      : Array.isArray(existingArray) && existingArray.length > 0
        ? existingArray.map((v) => String(v ?? ''))
        : [''];
    seed.forEach((value) => append({ value }, { shouldFocus: false }));
    setValue(fieldName, seed.filter((v) => v.trim().length > 0));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Whenever any row input changes, recompute the canonical string[]
  // and write it to the form under `fieldName`.
  const handleRowChange = (index: number, value: string) => {
    const current = (getValues(rowsFieldName) as Array<{ value: string }> | undefined) ?? [];
    current[index] = { value };
    setValue(rowsFieldName, current as any);
    const flat = current
      .map((r) => (r?.value ?? '').trim())
      .filter((v) => v.length > 0);
    setValue(fieldName, flat, { shouldDirty: true, shouldValidate: true });
  };

  const handleRemove = (index: number) => {
    remove(index);
    const after = ((getValues(rowsFieldName) as Array<{ value: string }> | undefined) ?? [])
      .map((r) => (r?.value ?? '').trim())
      .filter((v) => v.length > 0);
    setValue(fieldName, after, { shouldDirty: true, shouldValidate: true });
  };

  // Hidden field that carries the canonical array + holds validation rules.
  // We register here so RHF runs validate on submit.
  register(fieldName, {
    validate: (value: unknown) => {
      const arr = Array.isArray(value)
        ? (value as unknown[]).map((v) => String(v ?? '').trim()).filter(Boolean)
        : [];
      if (arr.length < minItems) {
        return minItems === 1
          ? `${label} is required`
          : `Add at least ${minItems} ${label.toLowerCase()}`;
      }
      if (pattern) {
        for (const v of arr) {
          if (!pattern.test(v)) return patternMessage;
        }
      }
      return true;
    },
  });

  // Resolve nested error path (handles items.0.dynamicAttributes.imeiNumbers etc.)
  const fieldError = fieldName.split('.').reduce(
    (obj: any, key) => obj?.[key],
    errors as Record<string, any>,
  );

  return (
    <div className="space-y-2">
      {fields.map((row, index) => {
        const rowValue = (getValues(`${rowsFieldName}.${index}.value`) as string) ?? '';
        return (
          <div key={row.id} className="flex items-center gap-2">
            <input
              type="text"
              defaultValue={rowValue}
              onChange={(e) => handleRowChange(index, e.target.value)}
              placeholder={`${label} ${index + 1}`}
              className={cn(
                'flex-1 rounded-md border bg-field px-3 py-2 text-sm',
                'placeholder:text-muted-foreground',
                'focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2',
              )}
            />
            {fields.length > minItems && (
              <button
                type="button"
                onClick={() => handleRemove(index)}
                title="Remove"
                className="rounded-md border p-1.5 text-muted-foreground hover:bg-destructive hover:text-destructive-foreground transition-colors"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        );
      })}
      {fields.length < maxItems && (
        <button
          type="button"
          onClick={() => append({ value: '' })}
          className={cn(
            'inline-flex items-center gap-1.5 rounded-md border border-dashed px-3 py-1.5 text-xs font-medium text-muted-foreground',
            'hover:bg-accent hover:text-foreground transition-colors',
          )}
        >
          <Plus className="h-3 w-3" /> Add another
        </button>
      )}
      {fieldError && (
        <p className="mt-1 text-xs text-destructive">
          {(fieldError as any).message as string}
        </p>
      )}
    </div>
  );
}
