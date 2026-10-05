// THE AGENT DECIDES CREATE-OR-RESET — the desk it holds is taken over for the
// next slice, or left exactly as it is and a new one cut.
//
// This is `an-agent-decides-create-or-reset`, wave 2 of
// docs/plans/2026-09-02-an-agent-holds-one-desk.md. Measured on that day: 2
// manifests, 11 worktrees, 8 loop processes, 5 desks whose branch had already
// merged. `plot-worker-loop.sh` created a worktree per branch and abandoned the
// one it left, so an identity issued once per agent was being issued once per
// slice.
//
// THE FUNCTIONS ARE EXERCISED DIRECTLY, sourced out of the loop rather than
// driven through a full hop. `declaration-hop.test.mjs` already runs a real
// worker through a real hop and asserts the desk was reused; what needs
// asserting HERE is the decision itself, and each of its three refusals needs
// its own tree in its own state. Driving a whole loop per case would spend a
// two-minute fixture to observe one `if`.
//
// SOURCING IS SAFE because the loop guards its own body: everything below the
// function definitions runs under `PLOT_WORKER_LOOP_SOURCED`, so a test can
// take the definitions without starting a worker.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const scripts = path.join(here, '..', '..', 'skills', 'plot', 'scripts');
const loop = path.join(scripts, 'plot-worker-loop.sh');

const git = (cwd, ...args) => execFileSync('git', args, { encoding: 'utf8', cwd });

/**
 * A bare origin, a clone, and a desk sitting on `feature/one`.
 *
 * The origin is real because the reset checks out `origin/<main>`, and a
 * fixture with no remote could not tell a base checkout from a no-op.
 */
function sandbox(label) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `plot-deskreset-${label}-`));
  const origin = path.join(root, 'origin.git');
  const work = path.join(root, 'work');
  git(root, 'init', '--bare', '-q', '-b', 'main', origin);
  git(root, 'clone', '-q', origin, work);
  git(work, 'config', 'user.email', 'test@example.invalid');
  git(work, 'config', 'user.name', 'Plot Test');
  git(work, 'config', 'commit.gpgsign', 'false');
  fs.writeFileSync(path.join(work, 'CLAUDE.md'), '# t\n\n## Plot Config\n\n- **Plan directory:** docs/plans/\n');
  git(work, 'add', '-A');
  git(work, 'commit', '-qm', 'init');
  git(work, 'push', '-q', 'origin', 'main');

  const wt = path.join(root, 'desk');
  git(work, 'worktree', 'add', '-q', '-b', 'feature/one', wt, 'origin/main');
  git(wt, 'commit', '-q', '--allow-empty', '-m', 'plot: claim feature/one');
  git(wt, 'push', '-qu', 'origin', 'feature/one');
  return { root, origin, work, wt };
}

/**
 * Run a snippet with the loop's functions in scope, in `cwd`.
 *
 * `$script_dir` and `$main_branch` are the two globals the desk functions read;
 * both are set here so the snippet exercises the same code the loop does.
 */
function withLoopFns(cwd, snippet) {
  return execFileSync('bash', ['-c', `
set -uo pipefail
export PLOT_WORKER_LOOP_SOURCED=1
script_dir=${JSON.stringify(scripts)}
main_branch=main
. ${JSON.stringify(loop)}
${snippet}
`], { encoding: 'utf8', cwd });
}

// -----------------------------------------------------------------------
// The guard — three measurements, never a judgement
// -----------------------------------------------------------------------

test('desk: a clean, pushed desk may be taken over', () => {
  const sb = sandbox('clean');
  try {
    const out = withLoopFns(sb.wt, 'desk_is_resettable "$PWD" && echo RESETTABLE || echo HELD');
    assert.match(out, /RESETTABLE/,
      'a desk with nothing on the floor is the normal case and must reset');
  } finally { fs.rmSync(sb.root, { recursive: true, force: true }); }
});

test('desk: uncommitted changes hold the desk', () => {
  const sb = sandbox('dirty');
  try {
    fs.writeFileSync(path.join(sb.wt, 'unfinished.ts'), 'export const x = 1;\n');
    const out = withLoopFns(sb.wt, 'desk_is_resettable "$PWD" && echo RESETTABLE || echo HELD');
    assert.match(out, /HELD/, 'work on the floor must keep the desk');
    const why = withLoopFns(sb.wt, 'desk_hold_reason "$PWD"');
    assert.match(why, /uncommitted changes/, 'the log must name what held it');
  } finally { fs.rmSync(sb.root, { recursive: true, force: true }); }
});

test('desk: a PLOT-BLOCKED marker holds the desk, and is named', () => {
  const sb = sandbox('blocked');
  try {
    fs.writeFileSync(path.join(sb.wt, 'PLOT-BLOCKED.md'), 'PLOT-BLOCKED: which retry?\n');
    const out = withLoopFns(sb.wt, 'desk_is_resettable "$PWD" && echo RESETTABLE || echo HELD');
    assert.match(out, /HELD/, 'a person owes this desk an answer');
    const why = withLoopFns(sb.wt, 'desk_hold_reason "$PWD"');
    assert.match(why, /PLOT-BLOCKED\.md/,
      'the reason must name the marker file, so its reader knows where the question is');
  } finally { fs.rmSync(sb.root, { recursive: true, force: true }); }
});

test('desk: unpushed commits hold the desk', () => {
  const sb = sandbox('unpushed');
  try {
    fs.writeFileSync(path.join(sb.wt, 'landed.ts'), 'export const y = 2;\n');
    git(sb.wt, 'add', '-A');
    git(sb.wt, 'commit', '-qm', 'work nobody else can see');
    const out = withLoopFns(sb.wt, 'desk_is_resettable "$PWD" && echo RESETTABLE || echo HELD');
    assert.match(out, /HELD/, 'a commit that exists only here is work that would be lost');
    const why = withLoopFns(sb.wt, 'desk_hold_reason "$PWD"');
    assert.match(why, /not pushed/, 'the log must name what held it');
  } finally { fs.rmSync(sb.root, { recursive: true, force: true }); }
});

test('desk: Plot’s own records do not hold the desk', () => {
  const sb = sandbox('records');
  try {
    // A worker that exited tidily leaves exactly these behind. Counting them as
    // work would hold EVERY desk, which is the population the reset exists for.
    fs.writeFileSync(path.join(sb.wt, '.plot-worker.log'), 'ran\n');
    fs.writeFileSync(path.join(sb.wt, '.plot-worker.exit'), '0\n');
    fs.writeFileSync(path.join(sb.wt, '.plot-worker.envelope.json'), '{"branch":"feature/one","status":"ok"}\n');
    const out = withLoopFns(sb.wt, 'desk_is_resettable "$PWD" && echo RESETTABLE || echo HELD');
    assert.match(out, /RESETTABLE/,
      'the fleet’s own bookkeeping is not work an agent left on the floor');
  } finally { fs.rmSync(sb.root, { recursive: true, force: true }); }
});

// The loop writes `PLOT-CORRECTION.md` untracked at the desk root. That file
// does not hold the desk, so the reset must remove it: `git checkout` keeps
// untracked files, and the next slice's agent would read the last slice's
// correction.
test('desk: an untracked root correction does not hold the desk, and the reset removes it', () => {
  const sb = sandbox('correction');
  try {
    fs.writeFileSync(path.join(sb.wt, 'PLOT-CORRECTION.md'), '# Correction 1 of 2 for feature/one\n');
    const out = withLoopFns(sb.wt, 'desk_is_resettable "$PWD" && echo RESETTABLE || echo HELD');
    assert.match(out, /RESETTABLE/, 'the loop\u2019s own correction file is not work on the floor');

    withLoopFns(sb.wt, 'reset_desk "$PWD" feature/two || exit 1');

    assert.equal(git(sb.wt, 'rev-parse', '--abbrev-ref', 'HEAD').trim(), 'feature/two',
      'precondition: the desk must hold the new branch');
    assert.equal(fs.existsSync(path.join(sb.wt, 'PLOT-CORRECTION.md')), false,
      'the previous slice\u2019s correction must not reach the next slice');
  } finally { fs.rmSync(sb.root, { recursive: true, force: true }); }
});

test('desk: a staged correction holds the desk', () => {
  const sb = sandbox('correction-staged');
  try {
    fs.writeFileSync(path.join(sb.wt, 'PLOT-CORRECTION.md'), 'somebody staged this\n');
    git(sb.wt, 'add', 'PLOT-CORRECTION.md');
    const out = withLoopFns(sb.wt, 'desk_is_resettable "$PWD" && echo RESETTABLE || echo HELD');
    assert.match(out, /HELD/, 'the loop never stages the file, so a staged copy is somebody\u2019s decision');
  } finally { fs.rmSync(sb.root, { recursive: true, force: true }); }
});

// -----------------------------------------------------------------------
// The reset — base first, then the branch
// -----------------------------------------------------------------------

test('desk: the reset lands on the new branch', () => {
  const sb = sandbox('reset');
  try {
    withLoopFns(sb.wt, 'reset_desk "$PWD" feature/two || exit 1');
    const head = git(sb.wt, 'rev-parse', '--abbrev-ref', 'HEAD').trim();
    assert.equal(head, 'feature/two', 'the desk must now hold the slice’s branch');
    // AND THE PREVIOUS BRANCH IS UNTOUCHED — the reset moves the checkout, not
    // the ref. `-B` would have moved `feature/one` onto the base and taken its
    // claim commit with it.
    const one = git(sb.wt, 'rev-parse', 'feature/one').trim();
    const originOne = git(sb.wt, 'rev-parse', 'origin/feature/one').trim();
    assert.equal(one, originOne, 'the branch the desk left must still point where it did');
  } finally { fs.rmSync(sb.root, { recursive: true, force: true }); }
});

// THE ORDER IS THE DELIVERABLE, and this is the test that fails on the reverse.
//
// `.gitignore` IS PER-CHECKOUT. A worktree sees an ignore entry only once the
// branch it holds carries it, so a desk's ignore rules are those of the branch
// it is SITTING ON at the moment the question is asked. Measured 2026-09-02:
// 19 desks stranded, every one held back by a single untracked artifact the
// ignore list had gained after that desk was cut — the desk's own rules
// predated the rule that would have made it clean.
//
// THE FIXTURE REPRODUCES THAT DESK. `feature/one` was cut from a main that
// predates the ignore entry; main then gains it. An untracked `build.out` sits
// on the desk, visible under `feature/one`'s rules. The reset checks
// `origin/main` out FIRST, so the new branch is created from a base that
// carries the entry and the artifact is ignored the moment the desk arrives.
//
// REVERSE THE TWO CHECKOUTS and `git checkout -b feature/two` runs while the
// desk still holds `feature/one`: the new branch is cut from the STALE tip, the
// artifact stays visible, and this reads dirty. That is the 19 desks, one at a
// time.
test('desk: the reset checks out the base before the branch', () => {
  const sb = sandbox('ignore');
  try {
    // Main gains the ignore entry AFTER the desk's branch was cut from it.
    fs.writeFileSync(path.join(sb.work, '.gitignore'), 'build.out\n');
    git(sb.work, 'add', '-A');
    git(sb.work, 'commit', '-qm', 'ignore the build artifact');
    git(sb.work, 'push', '-q', 'origin', 'main');
    git(sb.wt, 'fetch', '-q', 'origin');

    // PRECONDITION: under the branch the desk holds, the artifact is visible.
    // Without this the test would pass on a desk that was never dirty.
    fs.writeFileSync(path.join(sb.wt, 'build.out'), 'generated\n');
    assert.equal(git(sb.wt, 'status', '--porcelain').trim(), '?? build.out',
      'precondition: the desk’s own branch must not ignore the artifact');

    withLoopFns(sb.wt, 'reset_desk "$PWD" feature/two || exit 1');

    assert.equal(git(sb.wt, 'rev-parse', '--abbrev-ref', 'HEAD').trim(), 'feature/two',
      'precondition: the desk must hold the new branch');
    assert.equal(git(sb.wt, 'status', '--porcelain').trim(), '',
      'the desk must be clean: the base is checked out first so the new branch carries its ignore rules');
  } finally { fs.rmSync(sb.root, { recursive: true, force: true }); }
});

// A BRANCH THAT ALREADY EXISTS KEEPS ITS OWN RULES, and that is not the case
// above failing — it is the desk holding what the agent must work on. An
// earlier attempt's branch carries its own `.gitignore`, and the reset attaches
// to it rather than moving it: `checkout -b` fails, `checkout` succeeds, and no
// `-B` anywhere moves the ref onto the base and drops the attempt's commits.
test('desk: an existing branch is attached, never moved onto the base', () => {
  const sb = sandbox('existing');
  try {
    git(sb.work, 'branch', 'feature/two', 'origin/main');
    git(sb.wt, 'fetch', '-q', 'origin');
    const before = git(sb.work, 'rev-parse', 'feature/two').trim();
    // A commit the earlier attempt left on that branch, which a `-B` reset
    // would silently discard.
    git(sb.work, 'worktree', 'add', '-q', path.join(sb.root, 'other'), 'feature/two');
    fs.writeFileSync(path.join(sb.root, 'other', 'attempt.ts'), 'export const z = 3;\n');
    git(path.join(sb.root, 'other'), 'add', '-A');
    git(path.join(sb.root, 'other'), 'commit', '-qm', 'earlier attempt');
    const after = git(sb.work, 'rev-parse', 'feature/two').trim();
    assert.notEqual(before, after, 'precondition: the branch must carry a commit worth losing');
    git(sb.work, 'worktree', 'remove', '--force', path.join(sb.root, 'other'));

    withLoopFns(sb.wt, 'reset_desk "$PWD" feature/two || exit 1');

    assert.equal(git(sb.wt, 'rev-parse', '--abbrev-ref', 'HEAD').trim(), 'feature/two');
    assert.equal(git(sb.wt, 'rev-parse', 'feature/two').trim(), after,
      'the earlier attempt’s commit must survive the reset');
  } finally { fs.rmSync(sb.root, { recursive: true, force: true }); }
});

// -----------------------------------------------------------------------
// The generated bundles — restored before the detach, never discarded whole
// -----------------------------------------------------------------------
//
// `main` rebuilds and pushes its own bundles after every merge
// (`bug/main-builds-its-bundles`, #1249). A desk that rebuilt one locally to
// test it holds a local MODIFICATION to a tracked path that the checkout
// below refuses to overwrite — exactly the refusal these two tests reproduce
// by moving `origin/main`'s own bundle forward past the desk's copy.

/** Declares one bundle in `build.mjs` and commits it, with `body` as content. */
function withBundle(work, body) {
  fs.mkdirSync(path.join(work, 'packages', 'board'), { recursive: true });
  fs.mkdirSync(path.join(work, 'skills', 'plot', 'scripts', 'board'), { recursive: true });
  fs.writeFileSync(
    path.join(work, 'packages', 'board', 'build.mjs'),
    "const shippedArtifact = path.join(here, '../../skills/plot/scripts/board/board-server.mjs');\n",
  );
  fs.writeFileSync(path.join(work, 'skills', 'plot', 'scripts', 'board', 'board-server.mjs'), body);
}

const BUNDLE_REL = path.join('skills', 'plot', 'scripts', 'board', 'board-server.mjs');

/**
 * A sandbox whose base already carries a committed bundle before the desk's
 * branch is cut from it — so the desk's own HEAD tracks the bundle too, and
 * only `origin/main`'s LATER rebuild is what the desk never saw.
 */
function sandboxWithBundle(label) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `plot-deskreset-${label}-`));
  const origin = path.join(root, 'origin.git');
  const work = path.join(root, 'work');
  git(root, 'init', '--bare', '-q', '-b', 'main', origin);
  git(root, 'clone', '-q', origin, work);
  git(work, 'config', 'user.email', 'test@example.invalid');
  git(work, 'config', 'user.name', 'Plot Test');
  git(work, 'config', 'commit.gpgsign', 'false');
  fs.writeFileSync(path.join(work, 'CLAUDE.md'), '# t\n\n## Plot Config\n\n- **Plan directory:** docs/plans/\n');
  withBundle(work, 'v1 bundle\n');
  git(work, 'add', '-A');
  git(work, 'commit', '-qm', 'init + board build + bundle');
  git(work, 'push', '-q', 'origin', 'main');

  const wt = path.join(root, 'desk');
  git(work, 'worktree', 'add', '-q', '-b', 'feature/one', wt, 'origin/main');
  git(wt, 'commit', '-q', '--allow-empty', '-m', 'plot: claim feature/one');
  git(wt, 'push', '-qu', 'origin', 'feature/one');
  return { root, origin, work, wt };
}

test('desk: a rebuilt bundle no longer refuses the reset, once main has moved its own build', () => {
  const sb = sandboxWithBundle('bundle');
  try {
    // main rebuilds its own bundle AFTER this desk's branch was cut from it.
    fs.writeFileSync(path.join(sb.work, BUNDLE_REL), 'v2 bundle from main\n');
    git(sb.work, 'add', '-A');
    git(sb.work, 'commit', '-qm', 'plot: build the board artifact');
    git(sb.work, 'push', '-q', 'origin', 'main');
    git(sb.wt, 'fetch', '-q', 'origin');

    // The desk rebuilt its OWN copy locally, to test — a plain local
    // modification to a tracked path, never committed.
    fs.writeFileSync(path.join(sb.wt, BUNDLE_REL), 'rebuilt locally to test\n');

    // PRECONDITION: proves the premise. Without this fix, the plain checkout
    // this reproduces is refused.
    assert.throws(() => git(sb.wt, 'checkout', '--detach', 'origin/main'),
      'precondition: the checkout must be refused before the fix runs');

    withLoopFns(sb.wt, 'reset_desk "$PWD" feature/two || exit 1');

    assert.equal(git(sb.wt, 'rev-parse', '--abbrev-ref', 'HEAD').trim(), 'feature/two',
      'the reset must complete despite the stale local bundle');
  } finally { fs.rmSync(sb.root, { recursive: true, force: true }); }
});

test('desk: a hand-written file beside the rebuilt bundle survives the reset', () => {
  const sb = sandboxWithBundle('bundle-plus-source');
  try {
    fs.writeFileSync(path.join(sb.work, BUNDLE_REL), 'v2 bundle from main\n');
    git(sb.work, 'add', '-A');
    git(sb.work, 'commit', '-qm', 'plot: build the board artifact');
    git(sb.work, 'push', '-q', 'origin', 'main');
    git(sb.wt, 'fetch', '-q', 'origin');

    fs.writeFileSync(path.join(sb.wt, BUNDLE_REL), 'rebuilt locally to test\n');
    // THE HAND-WRITTEN FILE: real, uncommitted work beside the bundle. The
    // bundle restore must touch only the generated path and leave this one
    // exactly as the agent left it — not silently discarded.
    fs.writeFileSync(path.join(sb.wt, 'my-source.ts'), 'uncommitted real work\n');

    withLoopFns(sb.wt, 'reset_desk "$PWD" feature/two || exit 1');

    assert.equal(
      fs.readFileSync(path.join(sb.wt, 'my-source.ts'), 'utf8'),
      'uncommitted real work\n',
      'the hand-written file must survive the reset untouched',
    );
  } finally { fs.rmSync(sb.root, { recursive: true, force: true }); }
});

test('desk: the reset drops the previous slice’s declaration', () => {
  const sb = sandbox('decl');
  try {
    const decl = path.join(sb.wt, '.plot-worker.envelope.json');
    fs.writeFileSync(decl, '{"branch":"feature/one","status":"ok","pr":"#123"}\n');
    withLoopFns(sb.wt, 'reset_desk "$PWD" feature/two || exit 1');
    assert.equal(fs.existsSync(decl), false,
      'a merged seal would hand the next branch this branch’s PR number');
  } finally { fs.rmSync(sb.root, { recursive: true, force: true }); }
});

// -----------------------------------------------------------------------
// What the path must never do
// -----------------------------------------------------------------------

// NO `reset --hard` AND NO `clean -fdx` ANYWHERE ON THIS PATH.
//
// Those destroy whatever `desk_is_resettable` failed to notice, and the guard
// being wrong is precisely the case where the destruction cannot be undone. A
// guard that misjudges must leave a desk the sweep reports, not deleted work —
// a leftover desk costs a sweep, lost work costs the work.
//
// A GREP, BECAUSE THE PROPERTY IS AN ABSENCE. There is no tree state that
// demonstrates a command was not run; the only way to assert "never" is to read
// the source for it. That makes this the one structural test in this file, and
// it is worth its brittleness: the commands it forbids are two strings.
test('desk: the loop runs no destructive git command', () => {
  const src = fs.readFileSync(loop, 'utf8');
  const code = src
    .split('\n')
    .filter((l) => !/^\s*#/.test(l))
    .join('\n');
  assert.equal(/reset\s+--hard/.test(code), false,
    'reset --hard destroys the work the guard exists to protect');
  assert.equal(/clean\s+-[a-z]*f/.test(code), false,
    'clean -fdx destroys the work the guard exists to protect');
});

// A REJECTED CLAIM PUSH IS A BUG REPORTING ITSELF, and it used to be swallowed.
//
// The line read *"another worker won the race"* and removed the worktree in
// silence. Under this plan the registry is the assignment lock and the push is
// only its backstop, so a rejection means two agents were handed one branch —
// the estate is already broken at the moment this line runs, and a silent
// `continue` guarantees nobody learns it.
test('desk: a rejected claim push is named as a registry-lock violation when the ref is present', () => {
  // `a-hand-over-is-checked-before-it-is-made` taught this block a second
  // message: a ref ABSENT from origin is a stale hand-over, named rather than
  // folded into the violation line. The violation line itself is unchanged —
  // this test now finds it rather than assuming it is the only one.
  const src = fs.readFileSync(loop, 'utf8');
  const rejection = src.slice(src.indexOf('if ! push_err=$(git -C "$hop_wt" push'));
  const lines = rejection.split('\n').filter((l) => l.includes('plot-worker-loop:'));
  const line = lines.find((l) => l.includes('REGISTRY LOCK VIOLATION'));
  assert.ok(line, 'the rejection must still print a lock-violation line for a present ref');
  assert.match(line, /2>&1|>&2/, 'it must reach the log, not stdout');
  const absent = lines.find((l) => l.includes('origin has no such branch'));
  assert.ok(absent, 'the rejection must also print the absent-ref message, for the other case');
  assert.match(absent, /2>&1|>&2/, 'it must reach the log, not stdout');
  // AND IT MUST NOT REMOVE THE DESK. On the reset path `$hop_wt` IS the desk
  // the agent is standing in, so the old removal would destroy its own checkout.
  const beforeContinue = rejection.slice(0, rejection.indexOf('continue'));
  assert.equal(/worktree remove/.test(beforeContinue), false,
    'the rejection must not remove a desk it may be sitting at');
});
