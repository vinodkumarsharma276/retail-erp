// Production build: one ESM bundle at dist/index.js.
// The @retailerp/* workspace packages ship TypeScript sources only, so they are
// inlined; every other runtime dependency stays in node_modules.
import { build } from 'esbuild';
import { readFileSync, rmSync } from 'node:fs';

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const external = Object.keys(pkg.dependencies ?? {})
  .filter((name) => !name.startsWith('@retailerp/'))
  .flatMap((name) => [name, `${name}/*`]);

rmSync(new URL('../dist', import.meta.url), { recursive: true, force: true });

await build({
  entryPoints: ['src/index.ts'],
  outfile: 'dist/index.js',
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  sourcemap: true,
  external,
  // Some CommonJS dependencies call require() from inside the ESM bundle.
  banner: { js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);" },
  logLevel: 'info',
});
