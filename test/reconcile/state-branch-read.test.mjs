// Contract test for the `State branch` read path of plot-dispatch.sh: where a
// key is declared the plan's records are read from the state ref united with
// origin/<default>, the state ref winning per path; with no key, or with a
// state ref the clone does not hold, origin/<default> alone answers.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const scripts = path.join(here, '..', '..', 'skills', 'plot', 'scripts');
const dispatch = path.join(scripts, 'plot-dispatch.sh');
const recordRef = path.join(scripts, 'board', 'plot-record-ref.mjs');

delete process.env.PLOT_REPO_ROOT;
delete process.env.PLOT_UNATTENDED;

let tmp;
const git = (cwd, ...args) => execFileSync('git', args, { encoding: 'utf8', cwd });
const plan = (phase) => `# Fan-out plan

## Status

- **Phase:** ${phase}
- **Type:** feature
- **Impl:** own branches

## Branches

### Implementation
- \`feature/one\` — first
`;

/** Builds a sandbox clone whose origin/main holds `mainPhase`, with the key `stateKey` declared. */
function sandbox(name, { mainPhase, stateKey }) {
  const origin = path.join(tmp, `${name}.git`);
  const repo = path.join(tmp, name);
  git(tmp, 'init', '--bare', '-q', '-b', 'main', origin);
  git(tmp, 'clone', '-q', origin, repo);
  git(repo, 'config', 'user.email', 'test@example.invalid');
  git(repo, 'config', 'user.name', 'Plot Test');
  git(repo, 'config', 'commit.gpgsign', 'false');
  const key = stateKey ? `- **State branch:** ${stateKey}\n` : '';
  fs.writeFileSync(path.join(repo, 'CLAUDE.md'), `## Plot Config\n\n- **Plan directory:** plans/\n- **Active index:** plans/active/\n${key}`);
  fs.mkdirSync(path.join(repo, 'plans', 'active'), { recursive: true });
  if (mainPhase) {
    fs.writeFileSync(path.join(repo, 'plans', '2026-01-01-fan.md'), plan(mainPhase));
    fs.symlinkSync('../2026-01-01-fan.md', path.join(repo, 'plans', 'active', 'fan.md'));
  } else {
    fs.writeFileSync(path.join(repo, 'plans', 'active', '.keep'), '');
  }
  fs.mkdirSync(path.join(repo, '.plot', 'briefs'), { recursive: true });
  fs.writeFileSync(path.join(repo, '.plot', 'briefs', 'one.md'), 'spec for one\n');
  git(repo, 'add', '-A');
  git(repo, 'commit', '-qm', 'base');
  git(repo, 'push', '-q', 'origin', 'main');
  return repo;
}

/** Puts an Approved plan on origin/plot/state and fetches it, so the clone holds the ref. */
function publishState(repo, phase) {
  git(repo, 'checkout', '-q', '-b', 'plot/state');
  fs.writeFileSync(path.join(repo, 'plans', '2026-01-01-fan.md'), plan(phase));
  fs.rmSync(path.join(repo, 'plans', 'active', 'fan.md'), { force: true });
  fs.symlinkSync('../2026-01-01-fan.md', path.join(repo, 'plans', 'active', 'fan.md'));
  git(repo, 'add', '-A');
  git(repo, 'commit', '-q', '--allow-empty', '-m', 'plot: state');
  git(repo, 'push', '-q', 'origin', 'plot/state');
  git(repo, 'checkout', '-q', 'main');
  git(repo, 'branch', '-q', '-D', 'plot/state');
  git(repo, 'fetch', '-q', 'origin');
}

const dry = (repo) =>
  spawnSync('bash', [dispatch, '--dry-run', '--offline', 'fan'], { encoding: 'utf8', cwd: repo });

before(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-state-read-'));
});
after(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('state-branch read: a plan only the state ref holds is dispatched', () => {
  const repo = sandbox('only-state', { mainPhase: null, stateKey: 'plot/state' });
  publishState(repo, 'Approved');
  const out = dry(repo);
  assert.equal(out.status, 0, out.stderr + out.stdout);
  assert.match(out.stdout, /feature\/one/);
});

test('state-branch read: the state ref wins where a path is on both refs', () => {
  const repo = sandbox('both', { mainPhase: 'Draft', stateKey: 'plot/state' });
  publishState(repo, 'Approved');
  const out = dry(repo);
  assert.equal(out.status, 0, out.stderr + out.stdout);
  assert.match(out.stdout, /feature\/one/);
});

test('state-branch read: a declared key with no state ref in the clone reads origin/main alone', () => {
  const repo = sandbox('absent', { mainPhase: 'Approved', stateKey: 'plot/state' });
  const out = dry(repo);
  assert.equal(out.status, 0, out.stderr + out.stdout);
  assert.match(out.stdout, /feature\/one/);
});

test('state-branch read: with no key a state ref is never read', () => {
  const repo = sandbox('nokey', { mainPhase: null, stateKey: '' });
  publishState(repo, 'Approved');
  const out = dry(repo);
  assert.notEqual(out.status, 0, 'a plan only the state ref holds must stay invisible with no key');
  assert.doesNotMatch(out.stdout, /feature\/one/);
});

test('state-branch read: the ref bundle names the state ref for a path it holds, and origin/main otherwise', () => {
  const repo = sandbox('bundle', { mainPhase: 'Draft', stateKey: 'plot/state' });
  publishState(repo, 'Approved');
  fs.writeFileSync(path.join(repo, '.plot', 'briefs', 'two.md'), 'spec for two\n');
  git(repo, 'add', '-A');
  git(repo, 'commit', '-qm', 'a brief only main holds');
  git(repo, 'push', '-q', 'origin', 'main');
  const ask = (...args) => execFileSync('node', [recordRef, ...args], { encoding: 'utf8', cwd: repo }).trim();
  assert.equal(ask('plot/state', 'main', 'plans/2026-01-01-fan.md'), 'refs/remotes/origin/plot/state');
  assert.equal(ask('plot/state', 'main', '.plot/briefs/two.md'), 'origin/main');
  assert.equal(ask('', 'main', 'plans/2026-01-01-fan.md'), 'origin/main');
  assert.equal(ask('--deref', 'refs/remotes/origin/plot/state', 'plans/active/fan.md'), 'plans/2026-01-01-fan.md');
});

test('state-branch read: reconcile reports a plot/state ahead of main once the key is removed', () => {
  const repo = sandbox('removed-key', { mainPhase: 'Approved', stateKey: '' });
  publishState(repo, 'Approved');
  const scan = spawnSync('bash', [path.join(scripts, 'plot-reconcile-scan.sh'), '--offline'], { encoding: 'utf8', cwd: repo });
  assert.equal(scan.status, 0, scan.stderr + scan.stdout);
  assert.match(scan.stdout, /== Removed State branch key ==/);
  assert.match(scan.stdout, /plot\/state is 1 ahead of main/);
  assert.ok(scan.stdout.indexOf('merge the sync PR') < scan.stdout.indexOf('then remove the State branch key'), 'the fix is in order');
});

test('state-branch read: reconcile stays silent with the key declared', () => {
  const repo = sandbox('kept-key', { mainPhase: 'Approved', stateKey: 'plot/state' });
  publishState(repo, 'Approved');
  const scan = spawnSync('bash', [path.join(scripts, 'plot-reconcile-scan.sh'), '--offline'], { encoding: 'utf8', cwd: repo });
  assert.equal(scan.status, 0, scan.stderr + scan.stdout);
  assert.doesNotMatch(scan.stdout, /Removed State branch key/);
});
