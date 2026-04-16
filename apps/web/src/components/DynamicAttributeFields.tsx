import { useEffect } from 'react';
import { useFormContext } from 'react-hook-form';
import { Loader2 } from 'lucide-react';
import { cn } from '../lib/utils';
import { useCategoryAttributesQuery } from '../hooks/useProducts';

interface DynamicAttributeFieldsProps {
  /** The leaf category ID to fetch attributes for */
  categoryId: string | undefined;
  /** Pre-filled values for edit mode: { attributeName: value } */
  values?: Record<string, unknown>;
}

/**
 * Renders dynamic form fields based on the category's attribute definitions.
 * Must be used within a react-hook-form FormProvider context.
 */
export function DynamicAttributeFields({
  categoryId,
  values,
}: DynamicAttributeFieldsProps) {
  const { register, setValue, formState: { errors } } = useFormContext();
  const { data: attributes, isLoading } = useCategoryAttributesQuery(categoryId);

  // Pre-fill values when editing
  useEffect(() => {
    if (values && attributes) {
      for (const attr of attributes) {
        const val = values[attr.attributeName];
        if (val !== undefined) {
          setValue(`dynamicAttributes.${attr.attributeName}`, val);
        }
      }
    }
  }, [values, attributes, setValue]);

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
      {attributes
        .sort((a, b) => a.displayOrder - b.displayOrder)
        .map((attr) => {
          const fieldName = `dynamicAttributes.${attr.attributeName}`;
          const fieldError = (errors as Record<string, any>)?.dynamicAttributes?.[attr.attributeName];

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
                    'w-full rounded-md border bg-background px-3 py-2.5 text-sm',
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
                    'w-full rounded-md border bg-background px-3 py-2.5 text-sm',
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
                      'w-full appearance-none rounded-md border bg-background px-3 py-2.5 pr-8 text-sm',
                      'focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2',
                      fieldError && 'border-destructive',
                    )}
                  >
                    <option value="">Select...</option>
                    {Array.isArray(attr.options) &&
                      attr.options.map((opt) => {
                        const optValue = typeof opt === 'object' && opt !== null
                          ? (opt as Record<string, string>).value ?? String(opt)
                          : String(opt);
                        const optLabel = typeof opt === 'object' && opt !== null
                          ? (opt as Record<string, string>).label ?? String(opt)
                          : String(opt);
                        return (
                          <option key={optValue} value={optValue}>
                            {optLabel}
                          </option>
                        );
                      })}
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
                    'w-full rounded-md border bg-background px-3 py-2.5 text-sm',
                    'placeholder:text-muted-foreground',
                    'focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2',
                    fieldError && 'border-destructive',
                  )}
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
