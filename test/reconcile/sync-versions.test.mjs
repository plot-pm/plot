// Contract test for .dev/scripts/sync-versions.sh — the release step that writes
// Plot's version into the plugin metadata files.
//
// The marketplace lists two plugins: `plot`, which installs from this
// repository at the release tag `v<version>`, and the `plot-follow` mod (source
// `./mods/plot-follow`). The tag, not the marketplace clone's default branch,
// decides what a user installs, so the sync writes the tag beside the version.
// At install time a plugin's own `.claude-plugin/plugin.json` version wins, and
// `claude plugin validate --strict` refuses a marketplace entry that disagrees
// with it. So the sync writes the release version into the `plot` entry only,
// and every entry must equal its plugin.json version after a sync and in the
// tree as committed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(here, '..', '..');

const readJson = (file) => JSON.parse(readFileSync(file, 'utf8'));

/** The directory in this repository that holds an entry's plugin: a relative source, or this repository's root for a remote one. */
const localDir = (source) => (typeof source === 'string' ? source : '.');

const plotEntry = (root) => readJson(path.join(root, '.claude-plugin', 'marketplace.json')).plugins.find((e) => e.name === 'plot');

/** Each marketplace entry's version beside the version its plugin.json declares. */
const entryVersions = (root) =>
  readJson(path.join(root, '.claude-plugin', 'marketplace.json')).plugins.map((entry) => ({
    name: entry.name,
    entry: entry.version,
    pluginJson: readJson(path.join(root, localDir(entry.source), '.claude-plugin', 'plugin.json')).version,
  }));

/** A copy of the files the sync reads and writes, with package.json at `version`. */
const fixture = (version) => {
  const root = mkdtempSync(path.join(tmpdir(), 'plot-sync-versions-'));
  mkdirSync(path.join(root, '.dev', 'scripts'), { recursive: true });
  cpSync(path.join(repoRoot, '.dev', 'scripts', 'sync-versions.sh'), path.join(root, '.dev', 'scripts', 'sync-versions.sh'));
  cpSync(path.join(repoRoot, '.claude-plugin'), path.join(root, '.claude-plugin'), { recursive: true });
  for (const entry of readJson(path.join(repoRoot, '.claude-plugin', 'marketplace.json')).plugins) {
    const dir = localDir(entry.source);
    if (dir === '.' || dir === './') continue;
    cpSync(path.join(repoRoot, dir), path.join(root, dir), { recursive: true });
  }
  const pkg = readJson(path.join(repoRoot, 'package.json'));
  writeFileSync(path.join(root, 'package.json'), `${JSON.stringify({ ...pkg, version }, null, 2)}\n`);
  return root;
};

const claudeOnPath = spawnSync('claude', ['--version'], { encoding: 'utf8' }).status === 0;

test('every committed marketplace entry declares the version its plugin.json declares', () => {
  const versions = entryVersions(repoRoot);
  assert.ok(versions.length >= 2, `expected the plot entry and the mod, got ${versions.length}`);
  for (const v of versions) assert.equal(v.entry, v.pluginJson, `${v.name}: marketplace ${v.entry}, plugin.json ${v.pluginJson}`);
});

test('the committed plot entry installs from the release tag of its version, never from the default branch', () => {
  const { version } = readJson(path.join(repoRoot, 'package.json'));
  assert.deepEqual(plotEntry(repoRoot).source, { source: 'url', url: 'https://github.com/plot-pm/plot.git', ref: `v${version}` });
});

test('a sync writes the release version into plot only, and every entry still equals its plugin.json', (t) => {
  const root = fixture('97.98.99');
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const before = entryVersions(root);

  const run = spawnSync('bash', [path.join(root, '.dev', 'scripts', 'sync-versions.sh')], { encoding: 'utf8' });
  assert.equal(run.status, 0, run.stderr);

  const after = entryVersions(root);
  assert.equal(after.find((v) => v.name === 'plot').entry, '97.98.99');
  assert.equal(after.find((v) => v.name === 'plot').pluginJson, '97.98.99');
  assert.equal(plotEntry(root).source.ref, 'v97.98.99');
  for (const v of after) assert.equal(v.entry, v.pluginJson, `${v.name}: marketplace ${v.entry}, plugin.json ${v.pluginJson}`);
  for (const v of after.filter((x) => x.name !== 'plot')) {
    assert.equal(v.entry, before.find((b) => b.name === v.name).entry, `${v.name} changed version`);
  }
});

test('a sync over a plot entry that installs from the default branch fails and writes nothing', (t) => {
  const root = fixture('97.98.99');
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const file = path.join(root, '.claude-plugin', 'marketplace.json');
  const relative = readJson(file);
  relative.plugins = relative.plugins.map((e) => (e.name === 'plot' ? { ...e, source: './' } : e));
  writeFileSync(file, `${JSON.stringify(relative, null, 2)}\n`);

  const run = spawnSync('bash', [path.join(root, '.dev', 'scripts', 'sync-versions.sh')], { encoding: 'utf8' });
  assert.notEqual(run.status, 0, 'a relative plot source must fail the sync');
  assert.deepEqual(readJson(file), relative);
});

test('claude plugin validate --strict accepts the marketplace after a sync', { skip: !claudeOnPath && 'claude is not on PATH' }, (t) => {
  const root = fixture('97.98.99');
  t.after(() => rmSync(root, { recursive: true, force: true }));
  assert.equal(spawnSync('bash', [path.join(root, '.dev', 'scripts', 'sync-versions.sh')]).status, 0);

  const validate = spawnSync('claude', ['plugin', 'validate', '--strict', root], { encoding: 'utf8', cwd: root });
  assert.equal(validate.status, 0, `${validate.stdout}${validate.stderr}`);
});
