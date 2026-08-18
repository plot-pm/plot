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
