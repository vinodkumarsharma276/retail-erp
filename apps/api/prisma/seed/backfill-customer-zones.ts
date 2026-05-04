/**
 * Backfill script — adds the `zone` field to the customer form definition
 * (if missing) and assigns a random zone (East/West/North/South) to every
 * existing customer that does not already have one.
 *
 * Run via:
 *   npx tsx prisma/seed/backfill-customer-zones.ts
 */
import { PrismaClient } from '@prisma/client';

const ZONES = ['East', 'West', 'North', 'South'] as const;

async function ensureCustomerZoneFormField(prisma: PrismaClient) {
  const customerForm = await prisma.formDefinition.findFirst({
    where: { formName: 'customer', shopId: null },
    include: { fields: true },
  });

  if (!customerForm) {
    console.warn('  [skip] No global customer form definition found.');
    return;
  }

  const existing = customerForm.fields.find((f) => f.fieldName === 'zone');
  if (existing) {
    console.log('  [ok] customer form already has a `zone` field.');
    return;
  }

  await prisma.formField.create({
    data: {
      formDefinitionId: customerForm.id,
      fieldName: 'zone',
      fieldLabel: 'Zone',
      fieldType: 'select',
      isRequired: false,
      options: [
        { label: 'East', value: 'East' },
        { label: 'West', value: 'West' },
        { label: 'North', value: 'North' },
        { label: 'South', value: 'South' },
      ],
      displayOrder: 9,
      sectionName: 'Address',
      isVisible: true,
    },
  });
  console.log('  [add] Added `zone` field to customer form definition.');
}

async function backfillCustomerZones(prisma: PrismaClient) {
  const customers = await prisma.customer.findMany({
    where: { zone: null },
    select: { id: true, customerCode: true },
  });

  if (customers.length === 0) {
    console.log('  [ok] All customers already have a zone assigned.');
    return;
  }

  // Round-robin through the 4 zones for an even distribution. Mixing in the
  // customer code's hashCode keeps results deterministic across re-runs while
  // looking random enough for demo data.
  let updated = 0;
  for (const c of customers) {
    const hash = c.customerCode
      .split('')
      .reduce((acc, ch) => (acc * 31 + ch.charCodeAt(0)) & 0xffff, 0);
    const zone = ZONES[hash % ZONES.length];
    await prisma.customer.update({
      where: { id: c.id },
      data: { zone },
    });
    updated++;
  }

  console.log(`  [backfill] Assigned zones to ${updated} customers.`);
}

async function main() {
  const prisma = new PrismaClient();
  try {
    console.log('Backfilling customer zones...');
    await ensureCustomerZoneFormField(prisma);
    await backfillCustomerZones(prisma);
    console.log('Done.');
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
