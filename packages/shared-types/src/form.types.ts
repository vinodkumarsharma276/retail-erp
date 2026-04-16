import { FormFieldType } from './enums';

export interface FormDefinition {
  id: string;
  formName: string;
  shopId?: string;
  version: number;
  isActive: boolean;
  description?: string;
  fields: FormField[];
  createdAt: string;
  updatedAt: string;
}

export interface FormField {
  id: string;
  formDefinitionId: string;
  fieldName: string;
  fieldLabel: string;
  fieldType: FormFieldType;
  placeholder?: string;
  defaultValue?: string;
  isRequired: boolean;
  validationRules?: Record<string, unknown>;
  options?: { value: string; label: string }[];
  displayOrder: number;
  sectionName?: string;
  isVisible: boolean;
  cssClass?: string;
  dependsOn?: { field: string; value: string };
  createdAt: string;
}
