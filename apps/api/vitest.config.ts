import { defineConfig } from 'vitest/config';

/**
 * Unit tests (tests/unit) need nothing. Integration tests (tests/integration)
 * run the real installment engine against a separate `retailerp_test`
 * database, which global-setup migrates and empties before every run —
 * the dev database is never touched.
 */
export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    globalSetup: ['tests/global-setup.ts'],
    setupFiles: ['tests/setup-env.ts'],
    // One database, so one test file at a time.
    fileParallelism: false,
    pool: 'forks',
    poolOptions: { forks: { singleFork: true } },
    testTimeout: 30_000,
    hookTimeout: 120_000,
  },
});
