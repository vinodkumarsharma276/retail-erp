import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  const username = process.argv[2] ?? 've_admin1';
  const candidates = ['1234', 'RetailERP@2026', 'admin', 'password', 'Admin@123'];

  const tenantUsers = await prisma.user.findMany({
    where: { username },
    select: { id: true, username: true, passwordHash: true, tenantId: true, role: true },
  });
  console.log(`Tenant users matching "${username}":`, tenantUsers.length);
  for (const u of tenantUsers) {
    console.log(`  id=${u.id} tenantId=${u.tenantId} role=${u.role}`);
    for (const c of candidates) {
      const ok = await bcrypt.compare(c, u.passwordHash);
      if (ok) console.log(`    ✅ matches: ${c}`);
    }
  }

  // Also check platform users in case it's there
  try {
    // @ts-expect-error platformUser may or may not exist
    const platform = await prisma.platformUser?.findMany?.({
      where: { username },
      select: { id: true, username: true, passwordHash: true },
    });
    if (platform?.length) {
      console.log(`Platform users matching "${username}":`, platform.length);
      for (const u of platform) {
        for (const c of candidates) {
          const ok = await bcrypt.compare(c, u.passwordHash);
          if (ok) console.log(`    ✅ platform match: ${c}`);
        }
      }
    }
  } catch {
    /* ignore */
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
