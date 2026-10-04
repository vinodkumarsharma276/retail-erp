import { afterAll, beforeAll, vi } from 'vitest';
import { testDatabaseUrl } from './helpers/test-db';

// Point the app's Prisma client at the test database before any app module loads it.
process.env.DATABASE_URL = testDatabaseUrl();
process.env.NODE_ENV = 'test';

/**
 * Every test runs on a fixed "today": Sunday 4 October 2026, midday in India.
 * Only Date is faked — timers stay real so Prisma works normally.
 */
export const TODAY = '2026-10-04';

beforeAll(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(`${TODAY}T06:30:00.000Z`));
});

afterAll(async () => {
  vi.useRealTimers();
  const { prisma } = await import('../src/config/database.js');
  await prisma.$disconnect();
});
