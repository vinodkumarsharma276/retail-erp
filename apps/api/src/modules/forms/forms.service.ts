import { prisma } from '../../config/database.js';
import type { Prisma } from '@prisma/client';

export const formsService = {
  async listDefinitions() {
    const definitions = await prisma.formDefinition.findMany({
      include: {
        _count: {
          select: { fields: true },
        },
        shop: {
          select: { id: true, name: true, code: true },
        },
      },
      orderBy: { formName: 'asc' },
    });

    return definitions.map((d) => ({
      ...d,
      fieldCount: d._count.fields,
      _count: undefined,
    }));
  },

  async getDefinitionByName(formName: string, shopId?: string) {
    // If shopId provided, try shop-specific first
    if (shopId) {
      const shopSpecific = await prisma.formDefinition.findFirst({
        where: { formName, shopId, isActive: true },
        include: {
          fields: {
            where: { isVisible: true },
            orderBy: { displayOrder: 'asc' },
          },
        },
        orderBy: { version: 'desc' },
      });

      if (shopSpecific) {
        return shopSpecific;
      }
    }

    // Fall back to global (shopId = null)
    const global = await prisma.formDefinition.findFirst({
      where: { formName, shopId: null, isActive: true },
      include: {
        fields: {
          where: { isVisible: true },
          orderBy: { displayOrder: 'asc' },
        },
      },
      orderBy: { version: 'desc' },
    });

    return global;
  },

  async getDefinitionById(id: string) {
    const definition = await prisma.formDefinition.findUnique({
      where: { id },
      include: {
        fields: {
          orderBy: { displayOrder: 'asc' },
        },
        shop: {
          select: { id: true, name: true, code: true },
        },
      },
    });

    return definition;
  },

  async createDefinition(data: {
    formName: string;
    shopId?: string | null;
    description?: string | null;
  }) {
    const definition = await prisma.formDefinition.create({
      data: {
        formName: data.formName,
        shopId: data.shopId ?? null,
        description: data.description ?? null,
      },
    });

    return definition;
  },

  async updateDefinition(id: string, data: {
    formName?: string;
    description?: string | null;
    isActive?: boolean;
  }) {
    const existing = await prisma.formDefinition.findUnique({ where: { id } });
    if (!existing) {
      return null;
    }

    const updated = await prisma.formDefinition.update({
      where: { id },
      data,
    });

    return updated;
  },

  async getFields(definitionId: string) {
    const definition = await prisma.formDefinition.findUnique({
      where: { id: definitionId },
    });
    if (!definition) {
      return null;
    }

    const fields = await prisma.formField.findMany({
      where: { formDefinitionId: definitionId },
      orderBy: { displayOrder: 'asc' },
    });

    return fields;
  },

  async addField(definitionId: string, data: {
    fieldName: string;
    fieldLabel: string;
    fieldType: string;
    placeholder?: string | null;
    defaultValue?: string | null;
    isRequired?: boolean;
    validationRules?: unknown;
    options?: unknown;
    sectionName?: string | null;
    isVisible?: boolean;
    cssClass?: string | null;
    dependsOn?: unknown;
  }) {
    const definition = await prisma.formDefinition.findUnique({
      where: { id: definitionId },
    });
    if (!definition) {
      throw new Error('Form definition not found');
    }

    // Auto-set displayOrder to max + 1
    const maxOrder = await prisma.formField.aggregate({
      where: { formDefinitionId: definitionId },
      _max: { displayOrder: true },
    });
    const nextOrder = (maxOrder._max.displayOrder ?? -1) + 1;

    const field = await prisma.formField.create({
      data: {
        formDefinitionId: definitionId,
        fieldName: data.fieldName,
        fieldLabel: data.fieldLabel,
        fieldType: data.fieldType as any,
        placeholder: data.placeholder ?? null,
        defaultValue: data.defaultValue ?? null,
        isRequired: data.isRequired ?? false,
        validationRules: data.validationRules ? data.validationRules as Prisma.InputJsonValue : undefined,
        options: data.options ? data.options as Prisma.InputJsonValue : undefined,
        displayOrder: nextOrder,
        sectionName: data.sectionName ?? null,
        isVisible: data.isVisible ?? true,
        cssClass: data.cssClass ?? null,
        dependsOn: data.dependsOn ? data.dependsOn as Prisma.InputJsonValue : undefined,
      },
    });

    return field;
  },

  async updateField(fieldId: string, data: {
    fieldName?: string;
    fieldLabel?: string;
    fieldType?: string;
    placeholder?: string | null;
    defaultValue?: string | null;
    isRequired?: boolean;
    validationRules?: unknown;
    options?: unknown;
    sectionName?: string | null;
    isVisible?: boolean;
    cssClass?: string | null;
    dependsOn?: unknown;
  }) {
    const existing = await prisma.formField.findUnique({ where: { id: fieldId } });
    if (!existing) {
      return null;
    }

    const updateData: Record<string, unknown> = {};

    if (data.fieldName !== undefined) updateData.fieldName = data.fieldName;
    if (data.fieldLabel !== undefined) updateData.fieldLabel = data.fieldLabel;
    if (data.fieldType !== undefined) updateData.fieldType = data.fieldType;
    if (data.placeholder !== undefined) updateData.placeholder = data.placeholder;
    if (data.defaultValue !== undefined) updateData.defaultValue = data.defaultValue;
    if (data.isRequired !== undefined) updateData.isRequired = data.isRequired;
    if (data.validationRules !== undefined) updateData.validationRules = data.validationRules as Prisma.InputJsonValue;
    if (data.options !== undefined) updateData.options = data.options as Prisma.InputJsonValue;
    if (data.sectionName !== undefined) updateData.sectionName = data.sectionName;
    if (data.isVisible !== undefined) updateData.isVisible = data.isVisible;
    if (data.cssClass !== undefined) updateData.cssClass = data.cssClass;
    if (data.dependsOn !== undefined) updateData.dependsOn = data.dependsOn as Prisma.InputJsonValue;

    const updated = await prisma.formField.update({
      where: { id: fieldId },
      data: updateData,
    });

    return updated;
  },

  async deleteField(fieldId: string) {
    const existing = await prisma.formField.findUnique({ where: { id: fieldId } });
    if (!existing) {
      return null;
    }

    await prisma.formField.delete({ where: { id: fieldId } });

    return existing;
  },

  async reorderFields(definitionId: string, fieldIds: string[]) {
    const definition = await prisma.formDefinition.findUnique({
      where: { id: definitionId },
    });
    if (!definition) {
      throw new Error('Form definition not found');
    }

    // Verify all fieldIds belong to this definition
    const existingFields = await prisma.formField.findMany({
      where: { formDefinitionId: definitionId },
      select: { id: true },
    });
    const existingIds = new Set(existingFields.map((f) => f.id));

    for (const id of fieldIds) {
      if (!existingIds.has(id)) {
        throw new Error(`Field ${id} does not belong to this form definition`);
      }
    }

    // Update displayOrder for each field in a transaction
    await prisma.$transaction(
      fieldIds.map((id, index) =>
        prisma.formField.update({
          where: { id },
          data: { displayOrder: index },
        }),
      ),
    );

    // Return updated fields
    const fields = await prisma.formField.findMany({
      where: { formDefinitionId: definitionId },
      orderBy: { displayOrder: 'asc' },
    });

    return fields;
  },
};
