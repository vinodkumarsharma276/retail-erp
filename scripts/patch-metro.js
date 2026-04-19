/**
 * Patch metro-* packages for Node.js 22 compatibility.
 *
 * Metro 0.83.x uses restrictive `exports` in package.json that block
 * internal `./src/*` sub-path imports under Node 22's strict ESM resolution.
 * This script adds `"./src/*"` alongside the existing `"./private/*"` entry
 * so that Metro's own internal requires work correctly.
 *
 * Run automatically via `postinstall` in root package.json.
 */
const fs = require('fs');
const path = require('path');

const nmDir = path.resolve(__dirname, '..', 'node_modules');

fs.readdirSync(nmDir)
  .filter((name) => name.startsWith('metro'))
  .forEach((name) => {
    const pkgPath = path.join(nmDir, name, 'package.json');
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
      if (
        pkg.exports &&
        pkg.exports['./private/*'] &&
        !pkg.exports['./src/*']
      ) {
        pkg.exports['./src/*'] = pkg.exports['./private/*'];
        fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
        console.log(`  patched: ${pkg.name}@${pkg.version}`);
      }
    } catch {
      // skip non-existent or unparseable
    }
  });
