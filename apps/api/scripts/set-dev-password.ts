/**
 * DEV ONLY — set every tenant user's and platform admin's password to `1234`.
 * Local convenience for the seeded database. Never run against production.
 */
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const NEW_PASSWORD = '1234';
const prisma = new PrismaClient();

async function main() {
  const url = process.env.DATABASE_URL ?? '';
  if (!/localhost|127\.0\.0\.1/.test(url)) {
    throw new Error(`Refusing to run: DATABASE_URL is not local (${url.replace(/:[^:@]*@/, ':***@')})`);
  }

  const passwordHash = await bcrypt.hash(NEW_PASSWORD, 10);

  const users = await prisma.user.updateMany({ data: { passwordHash } });
  const platform = await prisma.platformUser.updateMany({ data: { passwordHash } });

  // Existing refresh tokens were issued against the old credentials.
  const revoked = await prisma.refreshToken.deleteMany({});
  const revokedPlatform = await prisma.platformRefreshToken.deleteMany({});

  console.log(`Password set to "${NEW_PASSWORD}" for:`);
  console.log(`  tenant users:    ${users.count}`);
  console.log(`  platform admins: ${platform.count}`);
  console.log(`Revoked refresh tokens: ${revoked.count} tenant, ${revokedPlatform.count} platform`);
}

main()
  .catch((e) => {
    console.error(e.message ?? e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
