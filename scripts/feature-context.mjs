import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifestPath = 'docs/features/manifest.json';
const checkpointPath = 'docs/features/checkpoints.json';
const text = (repo, file) => readFileSync(path.join(repo, file), 'utf8');
const hash = (value) => createHash('sha256').update(value.toString().replace(/\r\n/g, '\n')).digest('hex');
// Git normalizes paths with "/" on Windows too.
export const matchesSource = (file, source) => file === source || file.startsWith(`${source}/`);

export function changedPaths(previous, current) {
  return [...new Set([...Object.keys(previous), ...Object.keys(current)])]
    .sort()
    .filter((file) => previous[file] !== current[file])
    .map((file) => ({
      file,
      kind: !(file in previous) ? 'added' : !(file in current) ? 'removed' : 'changed',
    }));
}

export function sourceHashes(inventory, sources) {
  return Object.fromEntries(Object.entries(inventory).filter(([file]) =>
    sources.some((source) => matchesSource(file, source))));
}

export function readInventory(repo) {
  const files = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], {
    cwd: repo, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024,
  }).split('\0').filter(Boolean);
  return Object.fromEntries([...new Set(files)].sort()
    .filter((file) => existsSync(path.join(repo, file)))
    .filter((file) => /^(apps|packages|scripts|infra|\.github)\//.test(file) || /^(package\.json|turbo\.json|tsconfig.*\.json)$/.test(file))
    .filter((file) => /\.(ts|tsx|js|jsx|mjs|json|prisma|sql|dart|yaml|yml|bicep|md|kt|kts|swift|m|mm|h|pbxproj|plist|xml|xcconfig|entitlements|lock|xcscheme|xcworkspacedata)$/.test(file))
    .filter((file) => !/(^|\/)(node_modules|dev-dist|dist|build|\.dart_tool)\//.test(file))
    .map((file) => [file, hash(readFileSync(path.join(repo, file)))]));
}

export function featureState(repo, manifest, checkpoints, inventory, feature) {
  const extraSources = [...manifest.sharedSources, ...feature.sources];
  // Documentation inputs (ADRs and handoffs) are not part of the global code inventory.
  const documentationInputs = extraSources.filter((file) => file.endsWith('.md') && existsSync(path.join(repo, file)));
  const inputs = {
    ...sourceHashes(inventory, extraSources),
    ...Object.fromEntries(documentationInputs.map((file) => [file, hash(readFileSync(path.join(repo, file)))])),
  };
  const doc = `docs/features/${feature.doc}`;
  const docHash = existsSync(path.join(repo, doc)) ? hash(readFileSync(path.join(repo, doc))) : null;
  const previous = checkpoints.features?.[feature.id];
  return {
    inputs, docHash,
    changes: changedPaths(previous?.sources ?? {}, inputs),
    docChanged: docHash !== previous?.docHash,
    missing: docHash === null,
    unreviewed: !previous,
  };
}

export const requiredHeadings = [
  'Purpose and scope', 'Implementation status', 'Business rules and invariants',
  'Access, tenancy, and shop scope', 'User workflows', 'API contracts and data',
  'Web behavior', 'Mobile behavior and differences', 'Dependencies and cross-feature effects',
  'Code and source references', 'Verification and acceptance', 'Known gaps and next work',
  'Decisions and review checkpoint',
];

export function validateDocuments(repo, manifest) {
  const errors = [];
  const ids = new Set();
  const routes = new Set();
  const indexFile = 'docs/features/README.md';
  const index = existsSync(path.join(repo, indexFile)) ? text(repo, indexFile) : '';
  for (const feature of manifest.features) {
    if (ids.has(feature.id)) errors.push(`Duplicate feature id: ${feature.id}`);
    ids.add(feature.id);
    for (const route of feature.routes) {
      if (routes.has(route)) errors.push(`Duplicate menu route: ${route}`);
      routes.add(route);
    }
    const file = `docs/features/${feature.doc}`;
    if (!existsSync(path.join(repo, file))) {
      errors.push(`Missing feature doc: ${file}`);
      continue;
    }
    const doc = text(repo, file);
    for (const heading of requiredHeadings) {
      if (!doc.split(/\r?\n/).includes(`## ${heading}`)) errors.push(`${file}: missing heading "${heading}"`);
    }
    if (!index.includes(`](${feature.doc})`)) errors.push(`Feature index missing link: ${feature.doc}`);
  }
  const sidebar = 'apps/web/src/layouts/components/Sidebar.tsx';
  if (existsSync(path.join(repo, sidebar))) {
    const navigation = new Set([...text(repo, sidebar).matchAll(/\bto:\s*'([^']+)'/g)].map((match) => match[1]));
    for (const route of navigation) if (!routes.has(route)) errors.push(`Undocumented left-rail route: ${route}`);
    for (const route of routes) if (!navigation.has(route)) errors.push(`Manifest route not in left rail: ${route}`);
  }
  const files = [
    ...manifest.features.map((feature) => `docs/features/${feature.doc}`),
    indexFile, 'docs/features/_template.md', 'docs/FEATURE_CONTEXT_WORKFLOW.md',
    'docs/mobile/customer-searching-handoff.md', '.claude/skills/update-feature-docs/SKILL.md',
  ];
  for (const file of files) {
    if (!existsSync(path.join(repo, file))) {
      errors.push(`Missing workflow document: ${file}`);
      continue;
    }
    for (const match of text(repo, file).matchAll(/(?<!!)\[[^\]\n]*\]\((<[^>\n]+>|(?:[^()\n]|\([^()\n]*\))+)\)/g)) {
      const target = match[1].replace(/^<|>$/g, '').split('#')[0];
      if (!target || /^[a-z][a-z\d+.-]*:/i.test(target)) continue;
      const resolved = path.resolve(repo, path.dirname(file), decodeURIComponent(target));
      if (!existsSync(resolved)) errors.push(`${file}: broken link "${target}"`);
    }
  }
  return errors;
}

export function run(repo, args) {
  const [command = 'status', ...flags] = args;
  if (!['status', 'check', 'checkpoint'].includes(command)) throw new Error('Use status, check, or checkpoint.');
  const manifest = JSON.parse(text(repo, manifestPath));
  const checkpoints = existsSync(path.join(repo, checkpointPath))
    ? JSON.parse(text(repo, checkpointPath)) : { version: 1, features: {}, inventory: {} };
  const requested = flags.filter((flag) => !flag.startsWith('--'));
  const knownFlags = new Set(['--all', '--reviewed']);
  for (const flag of flags.filter((flag) => flag.startsWith('--'))) {
    if (!knownFlags.has(flag)) throw new Error(`Unknown option: ${flag}`);
  }
  for (const id of requested) {
    if (!manifest.features.some((feature) => feature.id === id)) throw new Error(`Unknown feature: ${id}`);
  }
  if (flags.includes('--all') && requested.length) throw new Error('Use --all or explicit feature IDs, not both.');
  const selected = manifest.features.filter((feature) => !requested.length || requested.includes(feature.id));
  const inventory = readInventory(repo);
  const states = selected.map((feature) => ({ feature, state: featureState(repo, manifest, checkpoints, inventory, feature) }));
  const owned = [...manifest.sharedSources, ...manifest.features.flatMap((feature) => feature.sources)];
  const unmapped = changedPaths(checkpoints.inventory ?? {}, inventory)
    .filter(({ file }) => !owned.some((source) => matchesSource(file, source)));
  const errors = validateDocuments(repo, manifest);
  if (command === 'checkpoint') {
    if (!flags.includes('--reviewed') || (!requested.length && !flags.includes('--all'))) {
      throw new Error('Checkpoint requires explicit feature IDs (or --all) and --reviewed after source review.');
    }
    if (errors.length) throw new Error(errors.join('\n'));
    const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim();
    const reviewedAt = new Date().toISOString();
    for (const { feature, state } of states) {
      checkpoints.features[feature.id] = { reviewedAt, head, docHash: state.docHash, sources: state.inputs };
    }
    // Keep an explicit baseline for otherwise unmapped code; partial refreshes must not hide it.
    if (flags.includes('--all')) checkpoints.inventory = inventory;
    writeFileSync(path.join(repo, checkpointPath), `${JSON.stringify(checkpoints, null, 2)}\n`);
    console.log(`Recorded source-review checkpoints for ${states.length} feature(s). No runtime certification implied.`);
    return 0;
  }
  let stale = false;
  for (const { feature, state } of states) {
    const dirty = state.unreviewed || state.missing || state.docChanged || state.changes.length > 0;
    stale ||= dirty;
    console.log(`${dirty ? 'STALE' : 'CURRENT'} ${feature.id}${state.missing ? ' (missing doc)' : ''}${state.docChanged ? ' (doc changed)' : ''}`);
    for (const change of state.changes) console.log(`  ${change.kind}: ${change.file}`);
  }
  if (unmapped.length) {
    console.log('UNMAPPED changes: classify these; add new feature/source ownership where relevant.');
    for (const change of unmapped) console.log(`  ${change.kind}: ${change.file}`);
  }
  for (const error of errors) console.error(error);
  return command === 'check' && (stale || errors.length || unmapped.length) ? 1 : 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    process.exitCode = run(root, process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
