// Contract test for skills/plot/scripts/plot-board-probe.sh — the board
// adoption probe. It answers "can the board run here, and what is already
// configured?" so /plot-board-setup can PROPOSE rather than interview.
//
// Strictly READ-ONLY: it is run in a stranger's repo before anything is
// agreed to, so it must not create, modify, or delete anything.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const probeScript = path.join(
  here, '..', '..', 'skills', 'plot', 'scripts', 'plot-board-probe.sh',
);

let tmp;

function git(cwd, ...args) {
  return execFileSync('git', args, { encoding: 'utf8', cwd });
}

/** Run the probe in `cwd`, optionally with a stub dir prepended to PATH. */
function probe(cwd, { stubDir, env = {} } = {}) {
  const out = execFileSync('bash', [probeScript], {
    encoding: 'utf8',
    cwd,
    env: {
      ...process.env,
      ...(stubDir ? { PATH: `${stubDir}:${process.env.PATH}` } : {}),
      ...env,
    },
  });
  return JSON.parse(out);
}

/** A git repo containing `files`, committed. */
function repoWith(files = {}, { config } = {}) {
  const r = fs.mkdtempSync(path.join(tmp, 'repo-'));
  git(r, 'init', '-q', '-b', 'main');
  git(r, 'config', 'user.email', 'test@example.invalid');
  git(r, 'config', 'user.name', 'Plot Test');
  git(r, 'config', 'commit.gpgsign', 'false');
  if (config !== undefined) {
    files['CLAUDE.md'] = `# Sandbox\n\n## Plot Config\n\n${config}\n`;
  }
  for (const [p, content] of Object.entries(files)) {
    fs.mkdirSync(path.join(r, path.dirname(p)), { recursive: true });
    fs.writeFileSync(path.join(r, p), content);
  }
  git(r, 'add', '-A');
  git(r, 'commit', '-qm', 'init');
  return r;
}

before(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-boardprobe-')); });
after(() => fs.rmSync(tmp, { recursive: true, force: true }));

test('probe: emits the documented top-level fields', () => {
  const r = repoWith({ 'a.txt': 'x' }, { config: '- **Plan directory:** docs/plans/\n' });
  const p = probe(r);
  for (const key of [
    'node', 'node_ok', 'bash', 'git_root', 'cwd_is_root',
    'artifact', 'artifact_source', 'has_plot_config', 'plan_dir',
    'plan_files', 'git_host', 'gh', 'bb', 'jen', 'ci_signals',
  ]) {
    assert.ok(key in p, `missing field: ${key}`);
  }
});

test('probe: reports has_plot_config false when no hub doc carries the section', () => {
  const r = repoWith({ 'a.txt': 'x' });
  assert.equal(probe(r).has_plot_config, false);
});

test('probe: reports has_plot_config true and reads the plan directory', () => {
  const r = repoWith({}, { config: '- **Plan directory:** docs/plans/\n' });
  const p = probe(r);
  assert.equal(p.has_plot_config, true);
  assert.equal(p.plan_dir, 'docs/plans/');
});

test('probe: is strictly read-only', () => {
  const r = repoWith({ 'a.txt': 'x' }, { config: '- **Plan directory:** docs/plans/\n' });
  const before = git(r, 'status', '--porcelain');
  const listing = fs.readdirSync(r).sort().join(',');
  probe(r);
  assert.equal(git(r, 'status', '--porcelain'), before);
  assert.equal(fs.readdirSync(r).sort().join(','), listing);
});

test('probe: reports not-a-git-repository as an error object, exit 1', () => {
  const bare = fs.mkdtempSync(path.join(tmp, 'nogit-'));
  let status = 0;
  let out = '';
  try {
    out = execFileSync('bash', [probeScript], { encoding: 'utf8', cwd: bare });
  } catch (e) {
    status = e.status;
    out = e.stdout;
  }
  assert.equal(status, 1);
  assert.equal(JSON.parse(out).error, 'not a git repository');
});

/**
 * A fake plugin tree containing a board artifact, and the env var that points
 * the probe at it. The real location is under ~/.claude/plugins/, which a test
 * must never depend on — so the probe accepts PLOT_PLUGIN_ROOT as an override.
 */
function fakePlugin({ withArtifact = true, cacheVersions = [] } = {}) {
  const root = fs.mkdtempSync(path.join(tmp, 'plugins-'));
  const dir = path.join(root, 'marketplaces', 'plot-marketplace',
    'skills', 'plot', 'scripts', 'board');
  if (withArtifact) {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'board-server.mjs'), '// live artifact\n');
  }
  // Historical cache copies, as a real machine accumulates them. Measured
  // 2026-08-18: three artifacts coexisted, one of them two weeks stale.
  for (const v of cacheVersions) {
    const c = path.join(root, 'cache', 'plot-marketplace', 'plot', v,
      'skills', 'plot', 'scripts', 'board');
    fs.mkdirSync(c, { recursive: true });
    fs.writeFileSync(path.join(c, 'board-server.mjs'), `// cached ${v}\n`);
  }
  return root;
}

test('probe: finds the plugin artifact and names its source', () => {
  const r = repoWith({}, { config: '- **Plan directory:** docs/plans/\n' });
  const plugins = fakePlugin();
  const p = probe(r, { env: { PLOT_PLUGIN_ROOT: plugins } });
  assert.equal(p.artifact_source, 'plugin');
  assert.ok(p.artifact.endsWith('board/board-server.mjs'));
  assert.ok(fs.existsSync(p.artifact));
});

test('probe: falls back to a checkout artifact when no plugin is present', () => {
  // A repo that IS a plot checkout: the artifact sits at its canonical path.
  const r = repoWith({
    'skills/plot/scripts/board/board-server.mjs': '// checkout artifact\n',
  }, { config: '- **Plan directory:** docs/plans/\n' });
  const empty = fakePlugin({ withArtifact: false });
  const p = probe(r, { env: { PLOT_PLUGIN_ROOT: empty } });
  assert.equal(p.artifact_source, 'checkout');
  assert.ok(p.artifact.endsWith('skills/plot/scripts/board/board-server.mjs'));
});

test('probe: reports none when no artifact exists anywhere', () => {
  const r = repoWith({}, { config: '- **Plan directory:** docs/plans/\n' });
  const empty = fakePlugin({ withArtifact: false });
  const p = probe(r, { env: { PLOT_PLUGIN_ROOT: empty, PLOT_NPM_BIN: '/nonexistent' } });
  assert.equal(p.artifact_source, 'none');
  assert.equal(p.artifact, '');
});

test('probe: prefers the plugin artifact over a checkout one', () => {
  const r = repoWith({
    'skills/plot/scripts/board/board-server.mjs': '// checkout artifact\n',
  }, { config: '- **Plan directory:** docs/plans/\n' });
  const plugins = fakePlugin();
  const p = probe(r, { env: { PLOT_PLUGIN_ROOT: plugins } });
  assert.equal(p.artifact_source, 'plugin');
});

test('probe: picks the live marketplaces copy over stale cached versions', () => {
  // The regression this test exists for. MEASURED 2026-08-18: a normal machine
  // carried three artifacts — the live marketplaces copy plus 2.0.0 and 2.5.0
  // cache copies. The first implementation used `sort | tail -1`, which picks
  // the lexically-last PATH; it returned the right file only because
  // "marketplaces" sorts after "cache", and would have returned a stale build
  // under any layout where it did not.
  const r = repoWith({}, { config: '- **Plan directory:** docs/plans/\n' });
  const plugins = fakePlugin({ cacheVersions: ['2.0.0', '2.5.0'] });
  const p = probe(r, { env: { PLOT_PLUGIN_ROOT: plugins } });
  assert.equal(p.artifact_source, 'plugin');
  assert.match(p.artifact, /marketplaces/);
  assert.equal(fs.readFileSync(p.artifact, 'utf8').trim(), '// live artifact');
});

test('probe: version directories are not compared lexically', () => {
  // `2.10.0` < `2.5.0` as strings. With no marketplaces copy present the
  // fallback is newest-mtime, so the NEWER 2.10.0 build must win regardless of
  // how the two version strings sort.
  const r = repoWith({}, { config: '- **Plan directory:** docs/plans/\n' });
  const plugins = fakePlugin({ withArtifact: false, cacheVersions: ['2.5.0', '2.10.0'] });
  const newer = path.join(plugins, 'cache', 'plot-marketplace', 'plot', '2.10.0',
    'skills', 'plot', 'scripts', 'board', 'board-server.mjs');
  const older = path.join(plugins, 'cache', 'plot-marketplace', 'plot', '2.5.0',
    'skills', 'plot', 'scripts', 'board', 'board-server.mjs');
  // Stamp mtimes explicitly — creation order must not be what the test relies on.
  fs.utimesSync(older, new Date('2026-08-01'), new Date('2026-08-01'));
  fs.utimesSync(newer, new Date('2026-08-18'), new Date('2026-08-18'));
  const p = probe(r, { env: { PLOT_PLUGIN_ROOT: plugins } });
  assert.equal(fs.readFileSync(p.artifact, 'utf8').trim(), '// cached 2.10.0');
});

test('probe: a host without a plugin directory falls through to checkout', () => {
  // Cursor has no ~/.claude/plugins. No host detection — the search finds
  // nothing and precedence carries on, which is why there is no branch to rot.
  const r = repoWith({
    'skills/plot/scripts/board/board-server.mjs': '// checkout artifact\n',
  }, { config: '- **Plan directory:** docs/plans/\n' });
  const p = probe(r, {
    env: { PLOT_PLUGIN_ROOT: path.join(tmp, 'does-not-exist'), PLOT_NPM_BIN: '/nonexistent' },
  });
  assert.equal(p.artifact_source, 'checkout');
});
