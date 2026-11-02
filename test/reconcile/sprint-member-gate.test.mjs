// Contract test for the sprint-member gate: replays real commits from this
// repository through the `plot-gate.mjs` bundle, and runs the `check` verb of
// `plot-sprint-member.mjs` over throwaway repos. The bundles are built by
// `pnpm build:board` (CI builds them before this test runs).
//
// A replay checks out the commit's parent, applies the commit's own changes to
// the index and asks the gate about `git commit`, the shape a hand edit takes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

function trackTemp(dir) {
  (trackTemp.paths ??= []).push(dir);
  return dir;
}
process.on('exit', () => {
  for (const dir of trackTemp.paths ?? []) rmSync(dir, { recursive: true, force: true });
});

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..', '..');
const bundles = path.join(root, 'skills', 'plot', 'scripts', 'board');
const gateBundle = path.join(bundles, 'plot-gate.mjs');
const writerBundle = path.join(bundles, 'plot-sprint-member.mjs');

const cleanEnv = () => {
  const env = { ...process.env };
  delete env.PLOT_UNATTENDED;
  delete env.PLOT_REPO_ROOT;
  return env;
};
const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: 'pipe' });
const askGate = (cwd) =>
  spawnSync('node', [gateBundle, 'sprint-member'], {
    cwd,
    env: cleanEnv(),
    input: JSON.stringify({ tool_input: { command: 'git commit -m x' } }),
    encoding: 'utf8',
  });

// A worktree on the commit's parent with the commit's own changes staged.
function replay(sha) {
  const tmp = trackTemp(mkdtempSync(path.join(tmpdir(), 'plot-sprint-gate-')));
  const dir = path.join(tmp, 'wt');
  git(root, 'worktree', 'add', '--detach', '-q', dir, `${sha}^`);
  try {
    const changes = git(root, 'diff-tree', '--no-commit-id', '--name-status', '-r', '--no-renames', sha)
      .split('\n')
      .filter(Boolean)
      .map((l) => l.split('\t'));
    for (const [status, file] of changes) {
      if (status === 'D') git(dir, 'rm', '-q', '--', file);
      else git(dir, 'checkout', sha, '--', file);
    }
    return askGate(dir);
  } finally {
    git(root, 'worktree', 'remove', '--force', dir);
  }
}

for (const sha of ['b1df72cf1', 'fc06f0678']) {
  test(`sprint-member gate refuses the real commit ${sha}`, () => {
    const r = replay(sha);
    assert.equal(r.status, 2, r.stderr);
    assert.match(r.stderr, /- \*\*Sprint:\*\* delivery-loop/);
    assert.match(r.stderr, /plot-sprint-member\.mjs add delivery-loop \S+ --tier/);
  });
}

for (const sha of ['ab0ab107b', 'd1c9e7eeb', 'f57425ec0']) {
  test(`sprint-member gate passes the real commit ${sha}`, () => {
    const r = replay(sha);
    assert.equal(r.status, 0, r.stderr);
  });
}

const sprintText = (state, body) => `# Sprint: Demo\n\n## Status\n\n- **State:** ${state}\n- **Start:** 2026-11-01\n\n${body}\n`;
const planText = (field) => `# A\n\n## Status\n\n- **State:** Draft\n${field === null ? '' : `- **Sprint:** ${field}\n`}- **Type:** feature\n`;

// A throwaway repo with one committed Active sprint and plan `a`.
function sandbox(field) {
  const tmp = trackTemp(mkdtempSync(path.join(tmpdir(), 'plot-sprint-gate-')));
  const dir = path.join(tmp, 'repo');
  mkdirSync(path.join(dir, 'docs', 'plans'), { recursive: true });
  mkdirSync(path.join(dir, 'docs', 'sprints'), { recursive: true });
  git(dir, 'init', '-q', '-b', 'main');
  git(dir, 'config', 'user.email', 't@t');
  git(dir, 'config', 'user.name', 't');
  git(dir, 'config', 'commit.gpgsign', 'false');
  writeFileSync(path.join(dir, 'docs', 'plans', '2026-11-01-a.md'), planText(field));
  writeFileSync(path.join(dir, 'docs', 'sprints', '2026-W44-demo.md'), sprintText('Active', '### Should Have\n\n- [ ] [b] Other'));
  git(dir, 'add', '-A');
  git(dir, 'commit', '-qm', 'init');
  return dir;
}

test('sprint-member gate: the writer\'s own commit passes', () => {
  const dir = sandbox(null);
  const w = spawnSync('node', [writerBundle, 'add', 'demo', 'a', '--tier', 'should', '--no-commit'], { cwd: dir, env: cleanEnv(), encoding: 'utf8' });
  assert.equal(w.status, 0, w.stderr);
  const r = askGate(dir);
  assert.equal(r.status, 0, r.stderr);
});

test('sprint-member gate: a hand-written member line with an empty field refuses', () => {
  const dir = sandbox(null);
  writeFileSync(path.join(dir, 'docs', 'sprints', '2026-W44-demo.md'), sprintText('Active', '### Should Have\n\n- [ ] [b] Other\n- [ ] [a] Added'));
  git(dir, 'add', '-A');
  assert.equal(askGate(dir).status, 2);
});

test('sprint-member gate: a Draft may name a sprint that does not list it yet', () => {
  const dir = sandbox(null);
  writeFileSync(path.join(dir, 'docs', 'plans', '2026-11-01-a.md'), planText('demo'));
  git(dir, 'add', '-A');
  const r = askGate(dir);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stderr, /plan 'a' names sprint 'demo'/);
});

test('sprint-member check: refuses a PR that adds a disagreeing member and notices a Draft field', () => {
  const dir = sandbox(null);
  const base = git(dir, 'rev-parse', 'HEAD').trim();
  writeFileSync(path.join(dir, 'docs', 'sprints', '2026-W44-demo.md'), sprintText('Active', '### Should Have\n\n- [ ] [b] Other\n- [ ] [a] Added'));
  git(dir, 'commit', '-qam', 'hand edit');
  const r = spawnSync('node', [writerBundle, 'check', '--base', base], { cwd: dir, env: { ...cleanEnv(), PLOT_UNATTENDED: '1' }, encoding: 'utf8' });
  assert.equal(r.status, 1, r.stderr);
  assert.match(r.stderr, /plot-sprint-member\.mjs add demo a --tier should/);

  const ok = sandbox('demo');
  const okBase = git(ok, 'rev-parse', 'HEAD').trim();
  writeFileSync(path.join(ok, 'docs', 'sprints', '2026-W44-demo.md'), sprintText('Active', '### Should Have\n\n- [ ] [b] Other\n- [ ] [a] Added'));
  git(ok, 'commit', '-qam', 'ok');
  const pass = spawnSync('node', [writerBundle, 'check', '--base', okBase], { cwd: ok, env: cleanEnv(), encoding: 'utf8' });
  assert.equal(pass.status, 0, pass.stderr);

  const draft = sandbox(null);
  const draftBase = git(draft, 'rev-parse', 'HEAD').trim();
  writeFileSync(path.join(draft, 'docs', 'plans', '2026-11-01-a.md'), planText('demo'));
  git(draft, 'commit', '-qam', 'draft');
  const notice = spawnSync('node', [writerBundle, 'check', '--base', draftBase], { cwd: draft, env: cleanEnv(), encoding: 'utf8' });
  assert.equal(notice.status, 0, notice.stderr);
  assert.match(notice.stderr, /::notice::sprint-member: plan 'a'/);
});
