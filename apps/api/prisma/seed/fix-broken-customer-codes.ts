/**
 * Repairs customer codes that ended up as `CUST-0NaN` (or otherwise non-numeric)
 * because of a bug in the code generator. Renumbers each broken row to the next
 * available `CUST-<NNNN>` slot, preserving creation order.
 *
 * Run:  npx tsx prisma/seed/fix-broken-customer-codes.ts
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  // Find candidates: anything with a leading `CUST-` followed by non-digits.
  const broken = await prisma.customer.findMany({
    where: {
      customerCode: { startsWith: 'CUST-' },
      NOT: { customerCode: { contains: 'CUST-0' } }, // cheap pre-filter
    },
    orderBy: { createdAt: 'asc' },
  });

  // Refine with regex on the application side.
  const reallyBroken = (
    await prisma.customer.findMany({
      where: { customerCode: { startsWith: 'CUST-' } },
      orderBy: { createdAt: 'asc' },
      select: { id: true, customerCode: true },
    })
  ).filter((c) => !/^CUST-\d+$/.test(c.customerCode));

  console.log(`Pre-filter hits: ${broken.length}, regex-confirmed broken: ${reallyBroken.length}`);

  if (reallyBroken.length === 0) {
    console.log('Nothing to repair.');
    return;
  }

  // Find current max numeric suffix.
  const all = await prisma.customer.findMany({
    where: { customerCode: { startsWith: 'CUST-' } },
    select: { customerCode: true },
  });
  let maxNum = 0;
  for (const c of all) {
    const m = /^CUST-(\d+)$/.exec(c.customerCode);
    if (m) {
      const n = parseInt(m[1], 10);
      if (n > maxNum) maxNum = n;
    }
  }
  console.log(`Current max valid code: CUST-${String(maxNum).padStart(4, '0')}`);

  let next = maxNum + 1;
  for (const cust of reallyBroken) {
    const newCode = `CUST-${String(next).padStart(4, '0')}`;
    await prisma.customer.update({
      where: { id: cust.id },
      data: { customerCode: newCode },
    });
    console.log(`  ${cust.customerCode}  →  ${newCode}`);
    next += 1;
  }

  console.log('Done.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
