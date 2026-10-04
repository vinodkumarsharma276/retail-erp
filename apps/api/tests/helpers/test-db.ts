import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'dotenv';

export const apiRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/**
 * The test database: the dev DATABASE_URL with the database name changed to
 * `<name>_test`. Refuses anything that isn't a local `_test` database, so a
 * misconfigured run can never empty real data.
 */
export function testDatabaseUrl(): string {
  if (process.env.TEST_DATABASE_URL) return guard(process.env.TEST_DATABASE_URL);
  const envFile = path.join(apiRoot, '.env');
  const base = process.env.DATABASE_URL ?? (fs.existsSync(envFile) ? parse(fs.readFileSync(envFile)).DATABASE_URL : undefined);
  if (!base) throw new Error('No DATABASE_URL to derive the test database from (set TEST_DATABASE_URL).');
  const url = new URL(base);
  const name = url.pathname.replace(/^\//, '');
  url.pathname = `/${name.endsWith('_test') ? name : `${name}_test`}`;
  return guard(url.toString());
}

function guard(raw: string): string {
  const url = new URL(raw);
  if (!/^(localhost|127\.0\.0\.1)$/.test(url.hostname) || !url.pathname.endsWith('_test')) {
    throw new Error(`Refusing to run tests against ${url.hostname}${url.pathname}: needs a local *_test database.`);
  }
  return raw;
}
