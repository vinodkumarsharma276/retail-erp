import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { changedPaths, featureState, matchesSource, readInventory, requiredHeadings, run, sourceHashes, validateDocuments } from './feature-context.mjs';

test('source ownership respects directory boundaries', () => {
  assert.equal(matchesSource('apps/api/src/modules/sales/sales.ts', 'apps/api/src/modules/sales'), true);
  assert.equal(matchesSource('apps/api/src/modules/sales-extra/a.ts', 'apps/api/src/modules/sales'), false);
  assert.deepEqual(sourceHashes({ 'a/b.ts': '1', 'a-other/c.ts': '2' }, ['a']), { 'a/b.ts': '1' });
});

test('hash comparison detects additions, edits, deletions and renames', () => {
  assert.deepEqual(changedPaths({ edited: 'old', deleted: 'd', renamed: 'r' }, { edited: 'new', added: 'a', moved: 'r' }), [
    { file: 'added', kind: 'added' }, { file: 'deleted', kind: 'removed' },
    { file: 'edited', kind: 'changed' }, { file: 'moved', kind: 'added' }, { file: 'renamed', kind: 'removed' },
  ]);
  assert.deepEqual(changedPaths({ unchanged: 'same' }, { unchanged: 'same' }), []);
});

test('inventory includes uncommitted and untracked code, excludes ignored files and reports deletion', (t) => {
  const repo = mkdtempSync(path.join(tmpdir(), 'retailerp-feature-context-'));
  t.after(() => rmSync(repo, { recursive: true, force: true }));
  const git = (...args) => execFileSync('git', args, { cwd: repo, stdio: 'pipe' });
  git('init');
  mkdirSync(path.join(repo, 'apps', 'api'), { recursive: true });
  writeFileSync(path.join(repo, '.gitignore'), 'apps/api/ignored.ts\n');
  const file = path.join(repo, 'apps', 'api', 'tracked.ts');
  writeFileSync(file, 'original');
  writeFileSync(path.join(repo, 'apps', 'api', 'native.kt'), 'native fixture');
  writeFileSync(path.join(repo, 'apps', 'api', 'secure.entitlements'), '<plist/>');
  git('add', '.');
  const original = readInventory(repo);
  assert.ok(original['apps/api/native.kt']);
  assert.ok(original['apps/api/secure.entitlements']);
  writeFileSync(file, 'original\r\nline\r\n');
  const windowsLines = readInventory(repo);
  writeFileSync(file, 'original\nline\n');
  assert.deepEqual(readInventory(repo), windowsLines);
  writeFileSync(file, 'edited');
  writeFileSync(path.join(repo, 'apps', 'api', 'new.ts'), 'untracked');
  writeFileSync(path.join(repo, 'apps', 'api', 'ignored.ts'), 'ignored');
  const updated = readInventory(repo);
  assert.deepEqual(changedPaths(original, updated).map(({ file, kind }) => [file, kind]), [
    ['apps/api/new.ts', 'added'], ['apps/api/tracked.ts', 'changed'],
  ]);
  rmSync(file);
  assert.ok(changedPaths(updated, readInventory(repo)).some(({ file, kind }) => file === 'apps/api/tracked.ts' && kind === 'removed'));
});

test('feature state catches changed docs, shared inputs, and deleted markdown inputs', (t) => {
  const repo = mkdtempSync(path.join(tmpdir(), 'retailerp-feature-state-'));
  t.after(() => rmSync(repo, { recursive: true, force: true }));
  mkdirSync(path.join(repo, 'docs', 'features'), { recursive: true });
  writeFileSync(path.join(repo, 'docs', 'features', 'sample.md'), 'doc');
  writeFileSync(path.join(repo, 'docs', 'decision.md'), 'decision');
  const manifest = { sharedSources: ['shared'], features: [] };
  const feature = { id: 'sample', doc: 'sample.md', sources: ['module', 'docs/decision.md'] };
  const inventory = { 'shared/access.ts': 'one', 'module/a.ts': 'one' };
  const initial = featureState(repo, manifest, {}, inventory, feature);
  assert.equal(initial.unreviewed, true);
  const checkpoints = { features: { sample: { sources: initial.inputs, docHash: initial.docHash } } };
  assert.deepEqual(featureState(repo, manifest, checkpoints, inventory, feature).changes, []);
  writeFileSync(path.join(repo, 'docs', 'features', 'sample.md'), 'updated doc');
  rmSync(path.join(repo, 'docs', 'decision.md'));
  const state = featureState(repo, manifest, checkpoints, { ...inventory, 'shared/access.ts': 'two' }, feature);
  assert.equal(state.docChanged, true);
  assert.deepEqual(state.changes.map(({ file, kind }) => [file, kind]), [
    ['docs/decision.md', 'removed'], ['shared/access.ts', 'changed'],
  ]);
});

test('validation reports missing headings, broken links and uncovered rail items', (t) => {
  const repo = mkdtempSync(path.join(tmpdir(), 'retailerp-feature-validation-'));
  t.after(() => rmSync(repo, { recursive: true, force: true }));
  mkdirSync(path.join(repo, 'docs', 'features'), { recursive: true });
  mkdirSync(path.join(repo, 'apps', 'web', 'src', 'layouts', 'components'), { recursive: true });
  mkdirSync(path.join(repo, 'apps', 'mobile', 'app', '(auth)'), { recursive: true });
  writeFileSync(path.join(repo, 'apps', 'mobile', 'app', '(auth)', 'login.tsx'), 'fixture');
  writeFileSync(path.join(repo, 'docs', 'features', 'sample.md'),
    '# Sample\n[Missing](missing.md)\n[Existing](../../apps/mobile/app/(auth)/login.tsx)\n');
  writeFileSync(path.join(repo, 'apps', 'web', 'src', 'layouts', 'components', 'Sidebar.tsx'), "{ to: '/new-feature' }");
  const errors = validateDocuments(repo, { features: [{ id: 'sample', doc: 'sample.md', routes: [] }] });
  assert.ok(errors.some((error) => error.includes('missing heading')));
  assert.ok(errors.some((error) => error.includes('broken link')));
  assert.ok(errors.some((error) => error.includes('Undocumented left-rail route: /new-feature')));
  assert.ok(errors.some((error) => error.includes('Feature index missing link')));
  assert.ok(!errors.some((error) => error.includes('broken link "../../apps/mobile')));
});

test('checkpoint requires review acknowledgment and partial refresh cannot hide unrelated changes', (t) => {
  const repo = mkdtempSync(path.join(tmpdir(), 'retailerp-feature-cli-'));
  t.after(() => rmSync(repo, { recursive: true, force: true }));
  const git = (...args) => execFileSync('git', args, { cwd: repo, stdio: 'pipe' });
  git('init');
  git('-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '--allow-empty', '-m', 'Test fixture');
  const write = (file, value) => {
    mkdirSync(path.dirname(path.join(repo, file)), { recursive: true });
    writeFileSync(path.join(repo, file), value);
  };
  write('docs/features/manifest.json', JSON.stringify({
    sharedSources: [], features: [{ id: 'sample', doc: 'sample.md', routes: [], sources: ['apps/api'] }],
  }));
  write('docs/features/sample.md', requiredHeadings.map((heading) => `## ${heading}\n`).join('\n'));
  write('docs/features/README.md', '[Sample](sample.md)');
  for (const file of ['docs/features/_template.md', 'docs/FEATURE_CONTEXT_WORKFLOW.md',
    'docs/mobile/customer-searching-handoff.md', '.claude/skills/update-feature-docs/SKILL.md']) write(file, '# Fixture');
  write('apps/api/a.ts', 'original');
  assert.throws(() => run(repo, ['checkpoint', 'sample']), /--reviewed/);
  assert.throws(() => run(repo, ['status', 'unknown']), /Unknown feature/);
  assert.throws(() => run(repo, ['checkpoint', 'sample', '--all', '--reviewed']), /not both/);
  assert.equal(run(repo, ['checkpoint', '--all', '--reviewed']), 0);
  assert.equal(run(repo, ['check']), 0);
  write('apps/api/a.ts', 'edited');
  assert.equal(run(repo, ['check']), 1);
  write('scripts/unmapped.mjs', 'unrelated');
  assert.equal(run(repo, ['checkpoint', 'sample', '--reviewed']), 0);
  assert.equal(run(repo, ['check']), 1);
  assert.equal(run(repo, ['checkpoint', '--all', '--reviewed']), 0);
  assert.equal(run(repo, ['check']), 0);
});
