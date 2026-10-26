// Reproduction and fix for docs/plans/implement-books-the-brief-in-a-worktree
// (`.plot/briefs/implement-books-the-brief-in-a-worktree.md`).
//
// A `--brief-only` implement run used to write the brief and the plan's
// `Started:` record directly into the OPERATOR'S MAIN checkout. Three runs on
// 2026-10-26 left byte-identical leftovers there that made
// `git merge --ff-only origin/main` refuse. `board/plot-brief-book.mjs`
// replaces that with the same disposable-worktree shape `plot-record-pr.mjs`
// already proved: cut a worktree from a freshly fetched `origin/<default>`,
// write, commit, push, remove — the main checkout is never opened.
//
// **No `.sh` launcher**: the plan this reproduces settles "no new shell"
// explicitly, so the bundle is called directly with `node`, the same way
// `plot-panel.mjs` and `plot-verify.mjs` are. These tests need a built board
// (`pnpm build:board`).
//
// `makeEstate`/`childEnv` below are adapted from record-pr.test.mjs's pattern,
// with two differences the brief's acceptance criteria call for specifically:
// the main checkout is left STALE (behind origin) and DIRTY (an untracked
// operator file) in most fixtures here, and the child runs WITH
// `PLOT_UNATTENDED=1` set (not deleted) and with no `PLOT_MAIN_CHECKOUT_WRITER`.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const scripts = path.join(here, '..', '..', 'skills', 'plot', 'scripts');
const briefBook = path.join(scripts, 'board', 'plot-brief-book.mjs');
const runBriefBook = (args, opts) => execFileSync('node', [briefBook, ...args], opts);

const git = (cwd, ...args) => execFileSync('git', args, { encoding: 'utf8', cwd });

const temps = [];
after(() => {
  for (const t of temps) fs.rmSync(t, { recursive: true, force: true, maxRetries: 3 });
});

const PLAN_NAME = '2099-01-01-smoke-test.md';
const PLAN_BODY = (branch) =>
  `# Smoke Test\n\n## Status\n\n- **State:** Approved\n- **Started:**\n\n## Slices\n\n### Fix\n\n- \`${branch}\` — do the thing\n`;

/**
 * A bare origin, a "main checkout" clone carrying one plan (the operator's
 * checkout this test protects), and a desk worktree on the branch the plan
 * names (where the agent's command actually runs — never `main`).
 */
const makeEstate = (label, branch) => {
  const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), `plot-briefbook-${label}-`)));
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

/** Pushes one more commit to `origin/main`, leaving `main` behind — the "stale checkout" fixture shape. */
const advanceOriginPast = (tmp, origin, planPath) => {
  const other = path.join(tmp, 'other-writer');
  git(tmp, 'clone', '-q', origin, other);
  git(other, 'config', 'user.email', 't@t');
  git(other, 'config', 'user.name', 't');
  git(other, 'config', 'commit.gpgsign', 'false');
  fs.writeFileSync(path.join(other, 'README.md'), 'unrelated change\n');
  git(other, 'add', '-A');
  git(other, 'commit', '-qm', 'unrelated: advance main');
  git(other, 'push', '-q', 'origin', 'main');
  void planPath;
};

/** Sets `PLOT_UNATTENDED=1`, clears `PLOT_REPO_ROOT` and `PLOT_MAIN_CHECKOUT_WRITER` — the brief's exact fixture env. */
const childEnv = () => {
  const env = { ...process.env, PLOT_UNATTENDED: '1' };
  delete env.PLOT_REPO_ROOT;
  delete env.PLOT_MAIN_CHECKOUT_WRITER;
  return env;
};

test('reproduction: writing the brief and Started line directly into the main checkout leaves it dirty and behind', () => {
  const branch = 'bug/old-behaviour';
  const { tmp, origin, main } = makeEstate('repro', branch);
  const planPath = path.join(main, 'docs', 'plans', PLAN_NAME);

  // The OLD behaviour: an agent resolves "the repo root" to the main checkout
  // and writes the brief and the Started: line there directly...
  fs.mkdirSync(path.join(main, '.plot', 'briefs'), { recursive: true });
  fs.writeFileSync(path.join(main, '.plot', 'briefs', 'old-behaviour.md'), 'the brief');
  const text = fs.readFileSync(planPath, 'utf8');
  fs.writeFileSync(planPath, text.replace('- **Started:**', '- **Started:** 2026-10-26, Plot Test, `bug/old-behaviour`'));

  // ... while origin moves on without that commit ever happening.
  advanceOriginPast(tmp, origin, planPath);

  const porcelain = git(main, 'status', '--porcelain');
  assert.notEqual(porcelain, '', 'expected the reproduction to leave the main checkout dirty');

  git(main, 'fetch', '-q', 'origin', 'main');
  const behind = git(main, 'rev-list', '--count', 'HEAD..origin/main').trim();
  assert.notEqual(behind, '0', 'expected the reproduction to leave the main checkout behind origin');
});

test('plot-brief-book.mjs: books the brief and Started line, leaving a stale, dirty main checkout untouched', () => {
  const branch = 'bug/brief-book-ok';
  const { tmp, origin, main, desk } = makeEstate('ok', branch);
  const planPath = path.join(main, 'docs', 'plans', PLAN_NAME);

  // The main checkout is BEHIND origin...
  advanceOriginPast(tmp, origin, planPath);
  // ...and DIRTY, with an untracked file of the operator's own.
  fs.writeFileSync(path.join(main, 'operator-scratch.txt'), 'not plot\'s business\n');

  const beforeHead = git(main, 'rev-parse', 'HEAD').trim();
  const beforeBranch = git(main, 'branch', '--show-current').trim();
  const beforePorcelain = git(main, 'status', '--porcelain');

  const briefFile = path.join(tmp, 'brief.md');
  fs.writeFileSync(briefFile, 'the hand-off brief');

  const out = runBriefBook(['brief-book-ok', branch, briefFile], { cwd: desk, encoding: 'utf8', env: childEnv() });
  assert.match(out, /push: clean/);

  // The main checkout is byte-for-byte unchanged: same HEAD, same branch, same porcelain.
  assert.equal(git(main, 'rev-parse', 'HEAD').trim(), beforeHead, 'main checkout HEAD must not move');
  assert.equal(git(main, 'branch', '--show-current').trim(), beforeBranch, 'main checkout branch must not move');
  assert.equal(git(main, 'status', '--porcelain'), beforePorcelain, 'main checkout working tree must be unchanged');

  // The desk the agent actually ran the command in is also left clean — the
  // write happened only in the disposable booking worktree, never here.
  assert.equal(git(desk, 'status', '--porcelain'), '', 'the desk running plot-brief-book.mjs must be untouched');

  // origin/main holds the brief and the Started: record.
  const check = path.join(tmp, 'check');
  git(tmp, 'clone', '-q', origin, check);
  assert.equal(fs.readFileSync(path.join(check, '.plot', 'briefs', 'brief-book-ok.md'), 'utf8'), 'the hand-off brief');
  const plan = fs.readFileSync(path.join(check, 'docs', 'plans', PLAN_NAME), 'utf8');
  assert.match(plan, new RegExp('\\*\\*Started:\\*\\* \\d{4}-\\d{2}-\\d{2}, .*, `' + branch.replace('/', '\\/') + '`'));
});

test('plot-brief-book.mjs: a clean, current main checkout also books cleanly', () => {
  const branch = 'bug/brief-book-clean';
  const { main, desk, tmp } = makeEstate('clean', branch);
  const planPath = path.join(main, 'docs', 'plans', PLAN_NAME);
  void planPath;

  const beforeHead = git(main, 'rev-parse', 'HEAD').trim();
  const beforePorcelain = git(main, 'status', '--porcelain');

  const briefFile = path.join(tmp, 'brief.md');
  fs.writeFileSync(briefFile, 'the hand-off brief');
  const out = runBriefBook(['brief-book-clean', branch, briefFile], { cwd: desk, encoding: 'utf8', env: childEnv() });
  assert.match(out, /push: clean/);

  assert.equal(git(main, 'rev-parse', 'HEAD').trim(), beforeHead, 'main checkout HEAD must not move');
  assert.equal(git(main, 'status', '--porcelain'), beforePorcelain, 'main checkout working tree must be unchanged');
});

test('plot-brief-book.mjs: a second call for an already-booked brief writes no second commit', () => {
  const branch = 'bug/brief-book-twice';
  const { main, desk, tmp } = makeEstate('twice', branch);

  const briefFile = path.join(tmp, 'brief.md');
  fs.writeFileSync(briefFile, 'the hand-off brief');
  runBriefBook(['brief-book-twice', branch, briefFile], { cwd: desk, encoding: 'utf8', env: childEnv() });

  git(main, 'fetch', '-q', 'origin', 'main');
  const beforeLog = git(main, 'log', '--oneline', 'origin/main');

  const out2 = runBriefBook(['brief-book-twice', branch, briefFile], { cwd: desk, encoding: 'utf8', env: childEnv() });
  assert.match(out2, /nothing to commit/);

  git(main, 'fetch', '-q', 'origin', 'main');
  const afterLog = git(main, 'log', '--oneline', 'origin/main');
  assert.equal(afterLog, beforeLog, 'a second call for an already-booked brief must add no second commit');
});

test('plot-brief-book.mjs: the booking worktree is removed on success', () => {
  const branch = 'bug/brief-book-removed';
  const { main, desk, tmp } = makeEstate('removed', branch);

  const briefFile = path.join(tmp, 'brief.md');
  fs.writeFileSync(briefFile, 'the hand-off brief');
  runBriefBook(['brief-book-removed', branch, briefFile], { cwd: desk, encoding: 'utf8', env: childEnv() });

  const worktrees = git(main, 'worktree', 'list', '--porcelain');
  assert.doesNotMatch(worktrees, /plot-brief-book-removed/, 'the disposable booking worktree must be removed on success');
});

test('plot-brief-book.mjs: refuses when no plan names the given branch, and still removes the booking worktree', () => {
  const branch = 'bug/unnamed-anywhere';
  const { main, desk } = makeEstate('unnamed', 'bug/brief-book-ok2');
  const briefFile = path.join(path.dirname(desk), 'brief.md');
  fs.writeFileSync(briefFile, 'x');

  assert.throws(() => {
    runBriefBook(['unnamed', branch, briefFile], { cwd: desk, encoding: 'utf8', env: childEnv(), stdio: 'pipe' });
  }, /no plan in .* names branch/);

  const worktrees = git(main, 'worktree', 'list', '--porcelain');
  assert.doesNotMatch(worktrees, /plot-brief-book-unnamed/, 'the booking worktree must be removed on refusal too');
});
