import { useEffect, useMemo } from 'react';
import { useForm, FormProvider, useFormContext, Controller } from 'react-hook-form';
import {  AlertCircle } from 'lucide-react';
import { cn } from '../lib/utils';
import { useFormDefinitionByNameQuery } from '../hooks/useForms';
import type { FormField } from '@retailerp/shared-types';
import { FormFieldType } from '@retailerp/shared-types';

// ---------------------------------------------------------------------------
// Public props
// ---------------------------------------------------------------------------
export interface DynamicFormProps {
  /** The form definition name to fetch from API (e.g. 'customer', 'distributor') */
  formName: string;
  /** Pre-filled values for edit mode */
  initialValues?: Record<string, unknown>;
  /** Called when the form is submitted */
  onSubmit: (data: Record<string, unknown>) => void;
  /** Render prop for submit/cancel buttons */
  children?: React.ReactNode;
  /** Read-only mode for detail views */
  readOnly?: boolean;
  /** Additional CSS class on the outer wrapper */
  className?: string;
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------
export function DynamicForm({
  formName,
  initialValues,
  onSubmit,
  children,
  readOnly = false,
  className,
}: DynamicFormProps) {
  const {
    data: definition,
    isLoading,
    isError,
  } = useFormDefinitionByNameQuery(formName);

  const methods = useForm<Record<string, unknown>>({
    defaultValues: initialValues ?? {},
  });

  // Reset form when initialValues change (e.g. when editing data loads)
  useEffect(() => {
    if (initialValues) {
      methods.reset(initialValues);
    }
  }, [initialValues, methods]);

  // Group fields by section
  const sections = useMemo(() => {
    if (!definition?.fields) return [];

    const sortedFields = [...definition.fields].sort(
      (a, b) => a.displayOrder - b.displayOrder,
    );

    const sectionMap = new Map<string, FormField[]>();
    for (const field of sortedFields) {
      if (!field.isVisible) continue;
      const section = field.sectionName || 'General';
      if (!sectionMap.has(section)) {
        sectionMap.set(section, []);
      }
      sectionMap.get(section)!.push(field);
    }

    return Array.from(sectionMap.entries()).map(([name, fields]) => ({
      name,
      fields,
    }));
  }, [definition]);

  if (isLoading) {
    return <DynamicFormSkeleton />;
  }

  if (isError || !definition) {
    return (
      <div className="flex items-center gap-2 rounded-md bg-destructive/10 px-4 py-3 text-sm text-destructive">
        <AlertCircle className="h-4 w-4 shrink-0" />
        Failed to load form definition for &quot;{formName}&quot;. Please try
        again later.
      </div>
    );
  }

  if (definition.fields.length === 0) {
    return (
      <div className="rounded-lg border bg-card p-6">
        <p className="text-sm text-muted-foreground">
          No fields configured for this form. Contact your administrator.
        </p>
      </div>
    );
  }

  return (
    <FormProvider {...methods}>
      <form
        onSubmit={methods.handleSubmit(onSubmit)}
        className={cn('space-y-8', className)}
      >
        {sections.map((section) => (
          <section key={section.name} className="rounded-lg border bg-card p-6">
            <h2 className="text-lg font-medium mb-4">{section.name}</h2>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {section.fields.map((field) => (
                <DynamicField
                  key={field.id}
                  field={field}
                  readOnly={readOnly}
                />
              ))}
            </div>
          </section>
        ))}

        {children}
      </form>
    </FormProvider>
  );
}

// ---------------------------------------------------------------------------
// Individual field renderer with dependsOn visibility logic
// ---------------------------------------------------------------------------
interface DynamicFieldProps {
  field: FormField;
  readOnly: boolean;
}

function DynamicField({ field, readOnly }: DynamicFieldProps) {
  const {
    register,
    watch,
    control,
    formState: { errors },
  } = useFormContext();

  // Handle conditional visibility via dependsOn
  const dependsOnField = field.dependsOn?.field;
  const dependsOnValue = field.dependsOn?.value;
  const watchedValue = watch(dependsOnField ?? '');

  if (dependsOnField && dependsOnValue !== undefined) {
    // Support comma-separated values for OR logic
    const allowedValues = String(dependsOnValue).split(',').map((v) => v.trim());
    if (!allowedValues.includes(String(watchedValue))) {
      return null;
    }
  }

  // Hidden fields
  if (field.fieldType === FormFieldType.HIDDEN) {
    return (
      <input
        type="hidden"
        {...register(field.fieldName)}
        defaultValue={field.defaultValue ?? ''}
      />
    );
  }

  // Build validation rules
  const validationRules: Record<string, unknown> = {};
  if (field.isRequired) {
    validationRules.required = `${field.fieldLabel} is required`;
  }
  if (field.validationRules) {
    const rules = field.validationRules as Record<string, unknown>;
    if (rules.pattern) {
      validationRules.pattern = {
        value: new RegExp(rules.pattern as string),
        message: (rules.patternMessage as string) ?? `Invalid ${field.fieldLabel}`,
      };
    }
    if (rules.min !== undefined) {
      validationRules.min = {
        value: Number(rules.min),
        message: `${field.fieldLabel} must be at least ${rules.min}`,
      };
    }
    if (rules.max !== undefined) {
      validationRules.max = {
        value: Number(rules.max),
        message: `${field.fieldLabel} must be at most ${rules.max}`,
      };
    }
    if (rules.minLength !== undefined) {
      validationRules.minLength = {
        value: Number(rules.minLength),
        message: `${field.fieldLabel} must be at least ${rules.minLength} characters`,
      };
    }
    if (rules.maxLength !== undefined) {
      validationRules.maxLength = {
        value: Number(rules.maxLength),
        message: `${field.fieldLabel} must be at most ${rules.maxLength} characters`,
      };
    }
  }

  const fieldError = (errors as Record<string, any>)[field.fieldName];
  const wrapperClass = cn(field.cssClass);

  const inputClasses = cn(
    'w-full rounded-md border bg-field px-3 py-2.5 text-sm',
    'placeholder:text-muted-foreground',
    'focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2',
    fieldError && 'border-destructive',
    readOnly && 'bg-muted cursor-not-allowed',
  );

  return (
    <div className={wrapperClass}>
      {/* Label */}
      {field.fieldType !== FormFieldType.CHECKBOX && (
        <label
          htmlFor={field.fieldName}
          className="block text-sm font-medium mb-1.5"
        >
          {field.fieldLabel}
          {field.isRequired && (
            <span className="text-destructive ml-0.5">*</span>
          )}
        </label>
      )}

      {/* TEXT */}
      {field.fieldType === FormFieldType.TEXT && (
        <input
          id={field.fieldName}
          type="text"
          {...register(field.fieldName, validationRules)}
          placeholder={field.placeholder ?? `Enter ${field.fieldLabel.toLowerCase()}`}
          defaultValue={field.defaultValue ?? ''}
          readOnly={readOnly}
          className={inputClasses}
        />
      )}

      {/* NUMBER */}
      {field.fieldType === FormFieldType.NUMBER && (
        <input
          id={field.fieldName}
          type="number"
          step="any"
          {...register(field.fieldName, {
            ...validationRules,
            valueAsNumber: true,
          })}
          placeholder={field.placeholder ?? '0'}
          readOnly={readOnly}
          className={inputClasses}
        />
      )}

      {/* TEL */}
      {field.fieldType === FormFieldType.TEL && (
        <input
          id={field.fieldName}
          type="tel"
          {...register(field.fieldName, validationRules)}
          placeholder={field.placeholder ?? 'Phone number'}
          defaultValue={field.defaultValue ?? ''}
          readOnly={readOnly}
          className={inputClasses}
        />
      )}

      {/* EMAIL */}
      {field.fieldType === FormFieldType.EMAIL && (
        <input
          id={field.fieldName}
          type="email"
          {...register(field.fieldName, {
            ...validationRules,
            pattern: (validationRules.pattern as { value: RegExp; message: string } | undefined) ?? {
              value: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
              message: 'Enter a valid email address',
            },
          })}
          placeholder={field.placeholder ?? 'email@example.com'}
          defaultValue={field.defaultValue ?? ''}
          readOnly={readOnly}
          className={inputClasses}
        />
      )}

      {/* DATE */}
      {field.fieldType === FormFieldType.DATE && (
        <input
          id={field.fieldName}
          type="date"
          {...register(field.fieldName, validationRules)}
          defaultValue={field.defaultValue ?? ''}
          readOnly={readOnly}
          className={inputClasses}
        />
      )}

      {/* TEXTAREA */}
      {field.fieldType === FormFieldType.TEXTAREA && (
        <textarea
          id={field.fieldName}
          rows={3}
          {...register(field.fieldName, validationRules)}
          placeholder={field.placeholder ?? `Enter ${field.fieldLabel.toLowerCase()}`}
          defaultValue={field.defaultValue ?? ''}
          readOnly={readOnly}
          className={inputClasses}
        />
      )}

      {/* SELECT */}
      {field.fieldType === FormFieldType.SELECT && (
        <div className="relative">
          <select
            id={field.fieldName}
            {...register(field.fieldName, validationRules)}
            disabled={readOnly}
            className={cn(
              'w-full appearance-none rounded-md border bg-field px-3 py-2.5 pr-8 text-sm',
              'focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2',
              fieldError && 'border-destructive',
              readOnly && 'bg-muted cursor-not-allowed',
            )}
          >
            <option value="">Select...</option>
            {field.options?.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>
      )}

      {/* MULTI_SELECT (checkbox group) */}
      {field.fieldType === FormFieldType.MULTI_SELECT && (
        <Controller
          name={field.fieldName}
          control={control}
          defaultValue={[]}
          rules={
            field.isRequired
              ? {
                  validate: (v: string[]) =>
                    (v && v.length > 0) || `${field.fieldLabel} is required`,
                }
              : undefined
          }
          render={({ field: controllerField }) => {
            const selected: string[] = controllerField.value ?? [];
            const toggle = (val: string) => {
              if (readOnly) return;
              const next = selected.includes(val)
                ? selected.filter((v) => v !== val)
                : [...selected, val];
              controllerField.onChange(next);
            };

            return (
              <div className="flex flex-wrap gap-2">
                {field.options?.map((opt) => (
                  <label
                    key={opt.value}
                    className={cn(
                      'flex items-center gap-2 rounded-md border px-3 py-1.5 text-sm cursor-pointer transition-colors',
                      selected.includes(opt.value)
                        ? 'border-primary bg-primary/5'
                        : 'hover:bg-muted',
                      readOnly && 'cursor-not-allowed opacity-70',
                    )}
                  >
                    <input
                      type="checkbox"
                      checked={selected.includes(opt.value)}
                      onChange={() => toggle(opt.value)}
                      disabled={readOnly}
                      className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary"
                    />
                    {opt.label}
                  </label>
                ))}
              </div>
            );
          }}
        />
      )}

      {/* RADIO */}
      {field.fieldType === FormFieldType.RADIO && (
        <div className="flex flex-wrap gap-4">
          {field.options?.map((opt) => (
            <label
              key={opt.value}
              className="flex items-center gap-2 text-sm cursor-pointer"
            >
              <input
                type="radio"
                value={opt.value}
                {...register(field.fieldName, validationRules)}
                disabled={readOnly}
                className="h-4 w-4 border-gray-300 text-primary focus:ring-primary"
              />
              {opt.label}
            </label>
          ))}
        </div>
      )}

      {/* CHECKBOX */}
      {field.fieldType === FormFieldType.CHECKBOX && (
        <div className="flex items-center gap-2 pt-1">
          <input
            id={field.fieldName}
            type="checkbox"
            {...register(field.fieldName)}
            disabled={readOnly}
            className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary"
          />
          <label
            htmlFor={field.fieldName}
            className="text-sm font-medium"
          >
            {field.fieldLabel}
            {field.isRequired && (
              <span className="text-destructive ml-0.5">*</span>
            )}
          </label>
        </div>
      )}

      {/* FILE */}
      {field.fieldType === FormFieldType.FILE && (
        <input
          id={field.fieldName}
          type="file"
          {...register(field.fieldName, validationRules)}
          disabled={readOnly}
          className={cn(
            'w-full rounded-md border bg-field px-3 py-2 text-sm',
            'file:mr-4 file:py-1 file:px-4 file:rounded-md file:border-0',
            'file:text-sm file:font-medium file:bg-primary file:text-primary-foreground',
            'hover:file:bg-primary/90',
            fieldError && 'border-destructive',
          )}
        />
      )}

      {/* Error message */}
      {fieldError && (
        <p className="mt-1 text-xs text-destructive">
          {fieldError.message as string}
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Loading skeleton
// ---------------------------------------------------------------------------
function DynamicFormSkeleton() {
  return (
    <div className="space-y-8">
      {[1, 2].map((section) => (
        <div key={section} className="rounded-lg border bg-card p-6">
          <div className="h-6 w-40 skeleton rounded mb-4" />
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {[1, 2, 3, 4, 5, 6].map((i) => (
              <div key={i}>
                <div className="h-4 w-24 skeleton rounded mb-2" />
                <div className="h-10 w-full skeleton rounded" />
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
