// Contract test for scripts/check-sprint-members.sh: it takes an optional base
// ref, so a slice cut from a sprint branch counts only its own member lines.
// Each case copies the launcher and the built `plot-sprint-member.mjs` bundle
// into a throwaway repository, so the merge-base choice is the thing under test.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { copyFileSync, mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..', '..');
const launcher = path.join(root, 'scripts', 'check-sprint-members.sh');
const bundle = path.join(root, 'skills', 'plot', 'scripts', 'board', 'plot-sprint-member.mjs');

const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: 'pipe' });

const sprintText = (body) => `# Sprint: Demo\n\n## Status\n\n- **State:** Active\n- **Start:** 2026-11-01\n\n${body}\n`;
const planText = (field) => `# P\n\n## Status\n\n- **State:** Draft\n${field === null ? '' : `- **Sprint:** ${field}\n`}- **Type:** feature\n`;
const SPRINT = path.join('docs', 'sprints', '2026-W44-demo.md');
const member = (slug) => `- [ ] [${slug}] Item`;

const cleanEnv = () => {
  const env = { ...process.env };
  delete env.PLOT_UNATTENDED;
  delete env.PLOT_REPO_ROOT;
  return env;
};

/**
 * A repo holding the launcher, the bundle, an Active sprint and plans `a` and
 * `b`; `sprint` adds a hand-written member line for `a` (its plan names no
 * sprint, a disagreement), and `slice` is cut from `sprint`. `origin/main` and
 * `origin/sprint` point at `main` and `sprint`.
 */
const fixture = () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'plot-sprint-members-'));
  mkdirSync(path.join(dir, 'scripts'), { recursive: true });
  mkdirSync(path.join(dir, 'skills', 'plot', 'scripts', 'board'), { recursive: true });
  mkdirSync(path.join(dir, 'docs', 'plans'), { recursive: true });
  mkdirSync(path.join(dir, 'docs', 'sprints'), { recursive: true });
  copyFileSync(launcher, path.join(dir, 'scripts', 'check-sprint-members.sh'));
  copyFileSync(path.join(root, 'scripts', 'lib-default-ref.sh'), path.join(dir, 'scripts', 'lib-default-ref.sh'));
  copyFileSync(bundle, path.join(dir, 'skills', 'plot', 'scripts', 'board', 'plot-sprint-member.mjs'));
  git(dir, 'init', '-q', '-b', 'main');
  git(dir, 'config', 'user.email', 't@t');
  git(dir, 'config', 'user.name', 't');
  git(dir, 'config', 'commit.gpgsign', 'false');
  writeFileSync(path.join(dir, 'docs', 'plans', '2026-11-01-a.md'), planText(null));
  writeFileSync(path.join(dir, 'docs', 'plans', '2026-11-01-b.md'), planText('demo'));
  writeFileSync(path.join(dir, SPRINT), sprintText(`### Should Have\n\n${member('z')}`));
  git(dir, 'add', '-A');
  git(dir, 'commit', '-qm', 'init');
  git(dir, 'update-ref', 'refs/remotes/origin/main', 'main');
  git(dir, 'checkout', '-q', '-b', 'sprint');
  writeFileSync(path.join(dir, SPRINT), sprintText(`### Should Have\n\n${member('z')}\n${member('a')}`));
  git(dir, 'commit', '-qam', 'sprint adds a hand-written member');
  git(dir, 'update-ref', 'refs/remotes/origin/sprint', 'sprint');
  git(dir, 'checkout', '-q', '-b', 'slice');
  return dir;
};

const run = (dir, args) => {
  const r = spawnSync('bash', [path.join(dir, 'scripts', 'check-sprint-members.sh'), ...args], { cwd: dir, env: cleanEnv(), encoding: 'utf8' });
  return { status: r.status, out: r.stdout + r.stderr };
};

const withFixture = (fn) => () => {
  const dir = fixture();
  try {
    fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};

test('with a base argument a branch cut from a feature branch counts only its own member lines', withFixture((dir) => {
  writeFileSync(path.join(dir, SPRINT), sprintText(`### Should Have\n\n${member('z')}\n${member('a')}\n${member('b')}`));
  git(dir, 'commit', '-qam', 'slice adds an agreeing member');
  const r = run(dir, ['origin/sprint']);
  assert.equal(r.status, 0, r.out);
}));

test('with a base argument the slice\'s own disagreeing member line is refused', withFixture((dir) => {
  writeFileSync(path.join(dir, SPRINT), sprintText(`### Should Have\n\n${member('z')}\n${member('a')}\n${member('c')}`));
  writeFileSync(path.join(dir, 'docs', 'plans', '2026-11-01-c.md'), planText(null));
  git(dir, 'add', '-A');
  git(dir, 'commit', '-qm', 'slice adds a disagreeing member');
  const r = run(dir, ['origin/sprint']);
  assert.equal(r.status, 1, r.out);
  assert.match(r.out, /plot-sprint-member\.mjs add demo c --tier should/);
  assert.doesNotMatch(r.out, /add demo a /);
}));

test('with no argument the script compares with merge-base origin/main HEAD as before', withFixture((dir) => {
  const r = run(dir, []);
  assert.equal(r.status, 1, r.out);
  assert.match(r.out, /plot-sprint-member\.mjs add demo a --tier should/);
}));

test('with origin/main absent the gate names the ref and the explicit-refspec fetch', withFixture((dir) => {
  git(dir, 'update-ref', '-d', 'refs/remotes/origin/main');
  const r = run(dir, []);
  assert.equal(r.status, 1, r.out);
  assert.match(r.out, /::error::check-sprint-members: refs\/remotes\/origin\/main is absent/);
  assert.match(r.out, /Run: git fetch --no-tags origin main:refs\/remotes\/origin\/main/);
}));

test('with no argument the gate compares with the branch origin/HEAD names', withFixture((dir) => {
  git(dir, 'update-ref', 'refs/remotes/origin/trunk', 'sprint');
  git(dir, 'symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/trunk');
  const r = run(dir, []);
  assert.equal(r.status, 0, r.out);
  const explicit = run(dir, ['origin/main']);
  assert.equal(explicit.status, 1, explicit.out);
  assert.match(explicit.out, /plot-sprint-member\.mjs add demo a --tier should/);
}));

test('an unrelated history names no merge base', withFixture((dir) => {
  git(dir, 'checkout', '-q', '--orphan', 'lonely');
  git(dir, 'commit', '-q', '--allow-empty', '-m', 'unrelated');
  git(dir, 'update-ref', 'refs/remotes/origin/lonely', 'lonely');
  git(dir, 'checkout', '-q', 'slice');
  const r = run(dir, ['origin/lonely']);
  assert.equal(r.status, 1, r.out);
  assert.match(r.out, /::error::check-sprint-members: no merge base between HEAD and origin\/lonely/);
}));

test('an absent SHA argument is named with no fetch to run', withFixture((dir) => {
  const sha = 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef';
  const r = run(dir, [sha]);
  assert.equal(r.status, 1, r.out);
  assert.match(r.out, new RegExp(`${sha} is absent`));
  assert.doesNotMatch(r.out, /git fetch/);
  assert.match(r.out, /Pass a remote-tracking ref/);
}));

test('an absent local branch argument is named with no fetch to run', withFixture((dir) => {
  const r = run(dir, ['nosuch']);
  assert.equal(r.status, 1, r.out);
  assert.match(r.out, /nosuch is absent/);
  assert.doesNotMatch(r.out, /git fetch/);
  assert.match(r.out, /Pass a remote-tracking ref/);
}));
