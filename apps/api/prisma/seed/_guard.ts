/**
 * Safety guard for destructive DB scripts (clear / clear-all / reset).
 *
 * Refuses to run when:
 *   - NODE_ENV === 'production'  (always blocked; only an explicit flag can override)
 *   - The DATABASE_URL points at a non-local host, unless CONFIRM_DESTROY=yes
 *
 * This prevents accidental data loss during server startup, deploys, or when
 * a developer is connected to a shared/remote database.
 */
export function assertSafeToDestroy(scriptName: string): void {
  const env = process.env.NODE_ENV ?? 'development';
  const dbUrl = process.env.DATABASE_URL ?? '';
  const confirm = process.env.CONFIRM_DESTROY === 'yes';

  if (env === 'production' && !confirm) {
    console.error(
      `\n[${scriptName}] Refusing to run: NODE_ENV=production.\n` +
        `If you are REALLY sure, re-run with CONFIRM_DESTROY=yes.\n`,
    );
    process.exit(1);
  }

  // Allow common local hosts; block anything else without explicit confirmation.
  const isLocal =
    dbUrl === '' ||
    /@(localhost|127\.0\.0\.1|host\.docker\.internal|postgres|db)[:/]/i.test(dbUrl);

  if (!isLocal && !confirm) {
    console.error(
      `\n[${scriptName}] Refusing to run: DATABASE_URL does not look local.\n` +
        `  DATABASE_URL host appears to be remote.\n` +
        `If you are REALLY sure, re-run with CONFIRM_DESTROY=yes.\n`,
    );
    process.exit(1);
  }
}
