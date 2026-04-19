/**
 * Delete the Apr 28 duplicate #6.1 row on VE0072.
 * Only runs if the row has zero payments.
 */
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  const APR28_ID = 'f1dfe710-6ac0-409b-832c-60fd00eeb8e2';
  const APR23_ID = 'a52b10a5-c1f7-45fc-bea0-c0ca5b61a5fe';

  const apr28 = await prisma.installment.findUnique({
    where: { id: APR28_ID },
    include: { payments: true },
  });
  if (!apr28) {
    console.log('Apr 28 row already gone.');
    return;
  }
  if (apr28.payments.length > 0) {
    console.log('Apr 28 row has payments; NOT deleting.');
    return;
  }

  await prisma.$transaction(async (tx) => {
    // Clear the FK on Apr 23 pointing at Apr 28 so we can delete.
    await tx.installment.update({
      where: { id: APR23_ID },
      data: { rescheduledFromId: null },
    });
    await tx.installment.delete({ where: { id: APR28_ID } });
  });

  console.log('Deleted Apr 28 row and cleared Apr 23 back-reference.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
