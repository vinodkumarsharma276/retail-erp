import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const tenants = await prisma.tenant.findMany({
    select: {
      id: true,
      slug: true,
      name: true,
      _count: { select: { users: true } },
    },
    orderBy: { slug: 'asc' },
  });
  console.log('Tenants:');
  for (const t of tenants) {
    console.log(`  slug=${t.slug}  id=${t.id}  users=${t._count.users}  name=${t.name}`);
  }

  console.log('\nve_admin1 across tenants:');
  const matches = await prisma.user.findMany({
    where: { username: 've_admin1' },
    select: { id: true, tenantId: true, isActive: true, role: true },
  });
  for (const u of matches) {
    const t = tenants.find((x) => x.id === u.tenantId);
    console.log(`  tenantSlug=${t?.slug ?? '?'}  active=${u.isActive}  role=${u.role}`);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
