import { execSync } from 'node:child_process';
import { PrismaClient } from '@prisma/client';
import { apiRoot, testDatabaseUrl } from './helpers/test-db';

/** Create (if needed), migrate and empty the test database once per run. */
export default async function globalSetup() {
  const url = testDatabaseUrl();

  // Create the database if it doesn't exist yet.
  const admin = new URL(url);
  const dbName = admin.pathname.slice(1);
  admin.pathname = '/postgres';
  const server = new PrismaClient({ datasourceUrl: admin.toString() });
  try {
    const exists = await server.$queryRaw<Array<{ one: number }>>`SELECT 1 AS one FROM pg_database WHERE datname = ${dbName}`;
    if (exists.length === 0) await server.$executeRawUnsafe(`CREATE DATABASE "${dbName}"`);
  } finally {
    await server.$disconnect();
  }

  execSync('npx prisma migrate deploy', {
    cwd: apiRoot,
    env: { ...process.env, DATABASE_URL: url },
    stdio: 'pipe',
  });

  const db = new PrismaClient({ datasourceUrl: url });
  try {
    const tables = await db.$queryRaw<Array<{ tablename: string }>>`
      SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
    if (tables.length > 0) {
      await db.$executeRawUnsafe(`TRUNCATE ${tables.map((t) => `"${t.tablename}"`).join(', ')} CASCADE`);
    }
  } finally {
    await db.$disconnect();
  }
}
