/**
 * One-shot: refresh the `zone` field's options in the customer form
 * definition so the in-DB dropdown carries the same values as the code
 * (East, West, North, South, Delhi, Ghaziabad, Noida).
 *
 * Idempotent — overwrites the options array unconditionally.
 *
 * Run via:
 *   npx tsx prisma/seed/update-zone-options.ts
 */
import { PrismaClient } from '@prisma/client';

const ZONE_OPTIONS = [
  { label: 'East', value: 'East' },
  { label: 'West', value: 'West' },
  { label: 'North', value: 'North' },
  { label: 'South', value: 'South' },
  { label: 'Delhi', value: 'Delhi' },
  { label: 'Ghaziabad', value: 'Ghaziabad' },
  { label: 'Noida', value: 'Noida' },
];

async function main() {
  const prisma = new PrismaClient();
  try {
    const customerForm = await prisma.formDefinition.findFirst({
      where: { formName: 'customer', shopId: null },
    });
    if (!customerForm) {
      console.warn('No global customer form definition found — nothing to do.');
      return;
    }

    const result = await prisma.formField.updateMany({
      where: { formDefinitionId: customerForm.id, fieldName: 'zone' },
      data: { options: ZONE_OPTIONS as any },
    });
    console.log(`Updated ${result.count} zone form_field row(s).`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
