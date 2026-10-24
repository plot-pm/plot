// Reproduction and fix for docs/plans/2026-10-23-recording-a-slice-pr-number-writes.md.
//
// main-checkout-writers.test.mjs's own last test named the gap: "The
// `#<number>` append to a plan's Branches section is a manual step this
// slice's own brief performs by hand on the main checkout after the PR
// exists — not something plot-open-pr.sh does." That manual step was prose in
// `.plot/worker-prompt.sh` — "append the PR number... check git branch
// --show-current is main" — with no concrete recipe. Measured 2026-10-23: a
// plan file's bytes were written directly into the main checkout's working
// tree while an identical change was separately committed and pushed from a
// different tree, leaving the main checkout permanently dirty with a HEAD
// that never advanced.
//
// `plot-record-pr.sh` replaces the prose with a disposable-worktree write —
// modeled on `write_started_record` in plot-dispatch.sh — so the file write
// and the commit happen in the SAME tree by construction. The first test
// below reproduces the OLD failure mode directly (a write into the main
// checkout with no commit there); the rest prove the new script's behaviour.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const scripts = path.join(here, '..', '..', 'skills', 'plot', 'scripts');
const recordPr = path.join(scripts, 'plot-record-pr.sh');

const git = (cwd, ...args) => execFileSync('git', args, { encoding: 'utf8', cwd });

const temps = [];
after(() => {
  for (const t of temps) fs.rmSync(t, { recursive: true, force: true, maxRetries: 3 });
});

const PLAN_NAME = '2099-01-01-smoke-test.md';
const PLAN_BODY = (branch) => `# Smoke Test\n\nStatus: Approved\n\n## Slices\n\n### Fix\n\n- \`${branch}\` — do the thing\n`;

/** A bare origin plus a `main` checkout clone carrying one plan, and a desk worktree for the branch the plan names. */
const makeEstate = (label, branch) => {
  const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), `plot-recordpr-${label}-`)));
  temps.push(tmp);
  const origin = path.join(tmp, 'origin.git');
  const main = path.join(tmp, 'main-checkout');
  git(tmp, 'init', '--bare', '-q', '-b', 'main', origin);
  git(tmp, 'clone', '-q', origin, main);
  git(main, 'config', 'user.email', 'test@example.invalid');
  git(main, 'config', 'user.name', 'Plot Test');
  git(main, 'config', 'commit.gpgsign', 'false');
  fs.mkdirSync(path.join(main, 'docs', 'plans'), { recursive: true });
  fs.writeFileSync(path.join(main, 'docs', 'plans', PLAN_NAME), PLAN_BODY(branch));
  git(main, 'add', '-A');
  git(main, 'commit', '-qm', 'init');
  git(main, 'push', '-q', 'origin', 'main');
  git(main, 'remote', 'set-head', 'origin', 'main');

  const desk = path.join(tmp, 'desks', branch.replace(/\//g, '-'));
  git(main, 'worktree', 'add', '-q', '-b', branch, desk, 'origin/main');

  return { tmp, origin, main, desk };
};

/** Clears the two env vars the brief requires a sandboxed child to run without. */
const childEnv = () => {
  const env = { ...process.env };
  delete env.PLOT_UNATTENDED;
  delete env.PLOT_REPO_ROOT;
  return env;
};

test('reproduction: writing the plan file directly into the main checkout and committing from elsewhere leaves it permanently dirty', () => {
  const { main } = makeEstate('repro', 'bug/old-behaviour');
  const planPath = path.join(main, 'docs', 'plans', PLAN_NAME);

  // The OLD behaviour: an agent edits the plan file's bytes directly in the
  // main checkout's working tree (e.g. by resolving "the repo root" and
  // writing there) ...
  const text = fs.readFileSync(planPath, 'utf8');
  fs.writeFileSync(planPath, text.replace('do the thing', 'do the thing → #4242'));

  // ... and separately, from another tree entirely, commits and pushes the
  // identical content — exactly the booking-branch shape, but landing on a
  // DIFFERENT file write than the one just made.
  const booker = path.join(main, '..', 'booker');
  git(main, 'worktree', 'add', '-q', '-B', 'book', booker, 'origin/main');
  fs.writeFileSync(path.join(booker, 'docs', 'plans', PLAN_NAME), text.replace('do the thing', 'do the thing → #4242'));
  git(booker, 'add', '-A');
  git(booker, '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'plot: record PR #4242 for old-behaviour');
  git(booker, 'push', '-q', 'origin', 'HEAD:main');

  // The bug: the main checkout's working tree now holds an uncommitted
  // change identical to a commit already on origin, and `git status
  // --porcelain` is NOT clean even though nothing is lost.
  const porcelain = git(main, 'status', '--porcelain');
  assert.notEqual(porcelain, '', 'expected the reproduction to leave the main checkout dirty');
});

test('plot-record-pr.sh: appends the PR number and leaves the main checkout clean', () => {
  const branch = 'bug/record-pr-ok';
  const { main, desk } = makeEstate('ok', branch);

  const out = execFileSync('bash', [recordPr, branch, '4242'], { cwd: desk, encoding: 'utf8', env: childEnv() });
  assert.match(out, /push: clean/);

  git(main, 'fetch', '-q', 'origin', 'main');
  git(main, 'merge', '-q', '--ff-only', 'origin/main');

  const porcelain = git(main, 'status', '--porcelain');
  assert.equal(porcelain, '', `main checkout must stay clean:\n${porcelain}`);

  const text = fs.readFileSync(path.join(main, 'docs', 'plans', PLAN_NAME), 'utf8');
  assert.match(text, new RegExp('`' + branch + '` — do the thing → #4242'));
});

test('plot-record-pr.sh: the write and the commit are the same tree — no desk-local uncommitted change is left behind', () => {
  const branch = 'bug/record-pr-same-tree';
  const { desk } = makeEstate('sametree', branch);

  execFileSync('bash', [recordPr, branch, '7'], { cwd: desk, encoding: 'utf8', env: childEnv() });

  // The desk itself — the tree the agent actually runs in — must show no
  // trace of the plan edit: the write happened in a disposable worktree that
  // was torn down, never here.
  const porcelain = git(desk, 'status', '--porcelain');
  assert.equal(porcelain, '', `the desk running plot-record-pr.sh must be untouched:\n${porcelain}`);
});

test('plot-record-pr.sh: refuses to double-annotate a line that already carries a PR number', () => {
  const branch = 'bug/record-pr-twice';
  const { desk } = makeEstate('twice', branch);

  execFileSync('bash', [recordPr, branch, '1'], { cwd: desk, encoding: 'utf8', env: childEnv() });

  assert.throws(() => {
    execFileSync('bash', [recordPr, branch, '2'], { cwd: desk, encoding: 'utf8', env: childEnv(), stdio: 'pipe' });
  }, /already carries a PR annotation on the .* line/);
});

test('plot-record-pr.sh: refuses when no plan names the given branch', () => {
  const branch = 'bug/unnamed-anywhere';
  const { desk } = makeEstate('unnamed', 'bug/record-pr-ok2');

  assert.throws(() => {
    execFileSync('bash', [recordPr, branch, '1'], { cwd: desk, encoding: 'utf8', env: childEnv(), stdio: 'pipe' });
  }, /no plan in .* names branch/);
});

test('plot-record-pr.sh: the booking worktree is distinct from the repo root, mirroring write_started_record', () => {
  const text = fs.readFileSync(recordPr, 'utf8');
  assert.match(text, /tmpwt="\$wt_root\/\.plot-record-pr-\$slug_part\.\$\$"/, 'the booking worktree must be a path distinct from the repo root');
  assert.match(text, /git -C "\$tmpwt"/, 'the plan edit must be committed against the booking worktree, not the main checkout');
  assert.doesNotMatch(text, /git -C "\$repo_root" (add|commit|reset)/, 'plot-record-pr.sh must never write or commit directly in the main checkout');
});
