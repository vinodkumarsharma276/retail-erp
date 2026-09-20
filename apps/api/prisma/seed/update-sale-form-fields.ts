/**
 * Incremental update for the `sale` form definition:
 *  - Adds `0%` to the interestRate options (if missing).
 *  - Inserts the new `effectiveMonthlyRate` read-only field.
 *  - Bumps the displayOrder on `numInstallments` so the new field slots in
 *    between File Charge and Number of Installments.
 *
 * Run:  npx tsx prisma/seed/update-sale-form-fields.ts
 */

import { PrismaClient, Prisma } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const def = await prisma.formDefinition.findFirst({
    where: { formName: 'sale', shopId: null },
  });
  if (!def) {
    console.log("No 'sale' form definition found. Run db:seed first.");
    return;
  }

  // 1. Update interestRate options (add 0%).
  const interestField = await prisma.formField.findFirst({
    where: { formDefinitionId: def.id, fieldName: 'interestRate' },
  });
  if (interestField) {
    const newOptions = [
      { label: '0%', value: '0' },
      { label: '1%', value: '1' },
      { label: '1.5%', value: '1.5' },
      { label: '2%', value: '2' },
      { label: '2.5%', value: '2.5' },
      { label: '3%', value: '3' },
    ];
    await prisma.formField.update({
      where: { id: interestField.id },
      data: {
        options: newOptions as unknown as Prisma.InputJsonValue,
        defaultValue: '0',
      },
    });
    console.log('  interestRate → added 0% option, default set to 0');
  }

  // 2. Push numInstallments to displayOrder 7 so the new field fits at 6.
  await prisma.formField.updateMany({
    where: { formDefinitionId: def.id, fieldName: 'numInstallments' },
    data: { displayOrder: 7 },
  });

  // 3. Upsert the new effectiveMonthlyRate field.
  const existing = await prisma.formField.findFirst({
    where: { formDefinitionId: def.id, fieldName: 'effectiveMonthlyRate' },
  });
  if (existing) {
    await prisma.formField.update({
      where: { id: existing.id },
      data: {
        fieldLabel: 'Effective Monthly Rate (%)',
        fieldType: 'readonly' as any,
        placeholder: 'Auto-calculated: interest + file charge spread over tenure',
        displayOrder: 6,
        sectionName: 'Self Finance',
        isVisible: true,
        dependsOn: { field: 'saleType', value: 'self_finance' } as Prisma.InputJsonValue,
      },
    });
    console.log('  effectiveMonthlyRate → updated');
  } else {
    await prisma.formField.create({
      data: {
        formDefinitionId: def.id,
        fieldName: 'effectiveMonthlyRate',
        fieldLabel: 'Effective Monthly Rate (%)',
        fieldType: 'readonly' as any,
        placeholder: 'Auto-calculated: interest + file charge spread over tenure',
        isRequired: false,
        displayOrder: 6,
        sectionName: 'Self Finance',
        isVisible: true,
        dependsOn: { field: 'saleType', value: 'self_finance' } as Prisma.InputJsonValue,
      },
    });
    console.log('  effectiveMonthlyRate → inserted');
  }

  console.log('Done.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
