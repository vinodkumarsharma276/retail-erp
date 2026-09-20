/**
 * Bootstrap an initial platform admin (SaaS operator). Idempotent —
 * re-running with the same username updates name/email but leaves the
 * password unchanged.
 *
 * Defaults:
 *   username: platform_admin
 *   password: PlatformAdmin@2026   (override via PLATFORM_ADMIN_PASSWORD env)
 *   email:    admin@retailerp.com
 *
 * Usage:
 *   cd apps/api
 *   npx tsx prisma/seed/bootstrap-platform-admin.ts
 */
import bcrypt from 'bcryptjs';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const USERNAME = process.env.PLATFORM_ADMIN_USERNAME ?? 'platform_admin';
const PASSWORD = process.env.PLATFORM_ADMIN_PASSWORD ?? 'PlatformAdmin@2026';
const EMAIL = process.env.PLATFORM_ADMIN_EMAIL ?? 'admin@retailerp.com';
const FULL_NAME = process.env.PLATFORM_ADMIN_FULLNAME ?? 'Platform Administrator';

async function main() {
  const existing = await prisma.platformUser.findUnique({ where: { username: USERNAME } });

  if (existing) {
    await prisma.platformUser.update({
      where: { id: existing.id },
      data: { fullName: FULL_NAME, email: EMAIL, isActive: true },
    });
    console.log(`Platform admin '${USERNAME}' already exists — refreshed metadata only.`);
    return;
  }

  const passwordHash = await bcrypt.hash(PASSWORD, 10);
  const created = await prisma.platformUser.create({
    data: {
      username: USERNAME,
      passwordHash,
      email: EMAIL,
      fullName: FULL_NAME,
    },
  });
  console.log(`Created platform admin '${created.username}'.`);
  console.log(`  Username: ${USERNAME}`);
  console.log(`  Password: ${PASSWORD}`);
  console.log(`  Email:    ${EMAIL}`);
  console.log(`\nRotate the password from the platform admin UI on first login.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
