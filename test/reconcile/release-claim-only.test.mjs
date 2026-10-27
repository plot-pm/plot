// `plot-dispatch.sh --release <branch> --claim-only` releases a claim without
// asking the host about a PR, and every other refusal stays in force. The host
// is a stub that fails, which is the 429 the flag exists for.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

delete process.env.PLOT_REPO_ROOT;

const here = path.dirname(fileURLToPath(import.meta.url));
const scriptsSrc = path.join(here, '..', '..', 'skills', 'plot', 'scripts');

let tmp, scripts;

const git = (cwd, ...args) => execFileSync('git', args, { encoding: 'utf8', cwd });

before(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'release-claim-only-'));
  scripts = path.join(tmp, 'scripts');
  fs.cpSync(scriptsSrc, scripts, { recursive: true });
  fs.writeFileSync(path.join(scripts, 'plot-host.sh'), '#!/usr/bin/env bash\necho "HTTP 429" >&2\nexit 1\n', { mode: 0o755 });
});

after(() => fs.rmSync(tmp, { recursive: true, force: true }));

// A clone with `branch` pushed carrying one empty claim commit, and a second
// clone's view of origin so the first holds a tracking ref to prune.
const claimedRepo = (label, { withWork = false } = {}) => {
  const root = fs.mkdtempSync(path.join(tmp, `${label}-`));
  const origin = path.join(root, 'origin.git');
  const repo = path.join(root, 'repo');
  git(root, 'init', '-q', '--bare', '-b', 'main', origin);
  git(root, 'clone', '-q', origin, repo);
  git(repo, 'config', 'user.email', 't@t');
  git(repo, 'config', 'user.name', 't');
  fs.writeFileSync(path.join(repo, 'README.md'), 'x\n');
  git(repo, 'add', '-A');
  git(repo, 'commit', '-q', '-m', 'init');
  git(repo, 'push', '-q', 'origin', 'main');
  git(repo, 'remote', 'set-head', 'origin', 'main');
  git(repo, 'checkout', '-q', '-b', 'bug/claim-only');
  git(repo, 'commit', '-q', '--allow-empty', '-m', 'plot: claim bug/claim-only');
  if (withWork) {
    fs.writeFileSync(path.join(repo, 'work.txt'), 'work\n');
    git(repo, 'add', '-A');
    git(repo, 'commit', '-q', '-m', 'work');
  }
  git(repo, 'push', '-q', 'origin', 'bug/claim-only');
  git(repo, 'checkout', '-q', 'main');
  return repo;
};

const release = (repo, ...extra) =>
  spawnSync('bash', [path.join(scripts, 'plot-dispatch.sh'), '--release', 'bug/claim-only', ...extra], {
    cwd: repo,
    encoding: 'utf8',
  });

const trackingRef = (repo) =>
  spawnSync('git', ['rev-parse', '-q', '--verify', 'refs/remotes/origin/bug/claim-only'], { cwd: repo }).status === 0;

test('--release refuses when the host cannot be asked', () => {
  const repo = claimedRepo('plain');
  const out = release(repo);
  assert.equal(out.status, 1, out.stderr);
  assert.match(out.stderr, /host could not be asked/);
  assert.equal(trackingRef(repo), true);
});

test('--release --claim-only releases a claim-only branch with the host failing, and the tracking ref is gone', () => {
  const repo = claimedRepo('claim-only');
  assert.equal(trackingRef(repo), true);
  const out = release(repo, '--claim-only');
  assert.equal(out.status, 0, out.stderr);
  assert.match(out.stdout, /released bug\/claim-only/);
  assert.equal(trackingRef(repo), false);
  const remote = git(repo, 'ls-remote', '--heads', 'origin', 'bug/claim-only');
  assert.equal(remote.trim(), '');
});

test('--release --claim-only still refuses a branch carrying a file-changing commit', () => {
  const repo = claimedRepo('with-work', { withWork: true });
  const out = release(repo, '--claim-only');
  assert.equal(out.status, 1, out.stdout);
  assert.match(out.stderr, /carries 1 commit\(s\) that change files/);
  assert.equal(trackingRef(repo), true);
});
