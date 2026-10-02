// A WORKER-LESS CHECKOUT YIELDS ITS BRANCH — the loop takes a branch a clean,
// abandoned checkout held, and leaves one holding work exactly as it is.
//
// This is slice 2 of docs/plans/2026-10-01-a-start-step-leaves-no-claim-and-no-desk.md.
// Measured 2026-10-01 (#1151): agent `11945014` was handed
// `bug/the-merge-subject-is-one-rule` while `.worktrees/the-merge-subject-is-one-rule`
// held it. `reset_desk` ran `git checkout -b` and then `git checkout`; git
// refused both, and the board row read *held in a local worktree* until a
// person ran `git worktree remove`. That checkout was clean: no change, no
// commit, no `.plot-worker.*` file.
//
// THE REAL `reset_desk` IS DRIVEN, not a reimplementation of its steps. What
// needs asserting is the whole path — git refuses, the holder is found, the
// rule is asked, the removal happens, the checkout retries — because every one
// of those links failed in the measured incident.
//
// SOURCING IS SAFE because the loop guards its own body: everything below the
// function definitions runs under `PLOT_WORKER_LOOP_SOURCED`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.join(here, '..', '..');
const scripts = path.join(repo, 'skills', 'plot', 'scripts');
const loop = path.join(scripts, 'plot-worker-loop.sh');

const git = (cwd, ...args) => execFileSync('git', args, { encoding: 'utf8', cwd });

/**
 * A bare origin, a clone, an agent's desk, and a second worktree holding the
 * branch the agent is about to be handed.
 *
 * THE HOLDER IS A REAL WORKTREE, because the whole defect is git's refusal to
 * check one branch out twice. A fixture that merely created the branch would
 * let both checkouts succeed and assert nothing.
 */
function sandbox(label) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `plot-ckyield-${label}-`));
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

  // The agent's own desk, detached at the base — the state `--start` leaves a
  // free agent in.
  const desk = path.join(root, 'desk');
  git(work, 'worktree', 'add', '-q', '--detach', desk, 'origin/main');

  // The leftover checkout: `/plot-implement` cut it, pushed the claim, and
  // stopped. Nobody worked it.
  const holder = path.join(root, 'leftover');
  git(work, 'worktree', 'add', '-q', '-b', 'feature/handed', holder, 'origin/main');
  git(holder, 'commit', '-q', '--allow-empty', '-m', 'plot: claim feature/handed');
  git(holder, 'push', '-qu', 'origin', 'feature/handed');

  return { root, origin, work, desk, holder };
}

/**
 * The environment of an agent whose desk is `cwd`.
 *
 * `PLOT_WORKTREE` IS OVERRIDDEN RATHER THAN INHERITED, and that is the whole
 * reason this helper exists. The marker goes into the asking agent's OWN desk,
 * so a suite run by a live worker would inherit that worker's `PLOT_WORKTREE`
 * and write a marker about a sandbox branch into a real worktree — the foreign
 * marker the loop's own comments warn about, manufactured by the test.
 *
 * `PLOT_MANIFEST_FILE` is pointed into the sandbox for the same reason: it is
 * where `checkout_is_registered` looks for the registry directory, and the real
 * one names real desks.
 */
const agentEnv = (cwd, extra) => ({
  ...process.env,
  PLOT_WORKTREE: cwd,
  PLOT_MANIFEST_FILE: path.join(cwd, '.plot-agents', 'agent.json'),
  PLOT_BRANCH: 'feature/handed',
  ...extra,
});

/**
 * Run a snippet with the loop's functions in scope, in `cwd`.
 *
 * `$script_dir` points at the real scripts unless a case overrides it to stub
 * the bundle. stderr is folded in, because the removal sentence and the refusal
 * both go there.
 */
function withLoopFns(cwd, snippet, { scriptDir = scripts, env = {} } = {}) {
  return execFileSync('bash', ['-c', `
set -uo pipefail
export PLOT_WORKER_LOOP_SOURCED=1
script_dir=${JSON.stringify(scriptDir)}
main_branch=main
. ${JSON.stringify(loop)}
${snippet}
`], { encoding: 'utf8', cwd, env: agentEnv(cwd, env), stdio: ['pipe', 'pipe', 'pipe'] })
    .toString();
}

/**
 * The same, with the loop's stderr folded into stdout.
 *
 * THE REDIRECTION IS INSIDE BASH, not a read of `e.stderr`. `execFileSync`
 * returns stdout ALONE on success and the two streams separately only when the
 * command fails, so a helper that reads `e.stderr` captures the log of a
 * refusal and silently drops the log of a success. The removal sentence is
 * written on the success path, so that version asserted nothing about the case
 * it existed for — measured here, 2026-10-02.
 *
 * THE LOOP IS SOURCED FROM THE DIRECTORY UNDER TEST, never from a `script_dir`
 * set beforehand. `plot-worker-loop.sh:72` re-derives `script_dir` from
 * `BASH_SOURCE` and discards whatever the caller set, so a case that stubs a
 * bundle must reach it through the path it sources. Setting the variable alone
 * silently exercises the real bundle, which is how the exit-2 case first passed
 * for the wrong reason.
 */
function withLoopFnsAll(cwd, snippet, opts = {}) {
  const dir = opts.scriptDir ?? scripts;
  try {
    return execFileSync('bash', ['-c', `
exec 2>&1
set -uo pipefail
export PLOT_WORKER_LOOP_SOURCED=1
main_branch=main
. ${JSON.stringify(path.join(dir, 'plot-worker-loop.sh'))}
${snippet}
`], { encoding: 'utf8', cwd, env: agentEnv(cwd, opts.env ?? {}), stdio: ['pipe', 'pipe', 'pipe'] });
  } catch (e) {
    return `${e.stdout ?? ''}${e.stderr ?? ''}`;
  }
}

// -----------------------------------------------------------------------
// The clean leftover yields — the measured case
// -----------------------------------------------------------------------

test('checkout-yield: the loop takes a branch a clean worker-less checkout held', () => {
  const sb = sandbox('clean');
  try {
    // PRECONDITION: git refuses the plain checkout while the holder exists.
    // Without this the test would pass on a fixture that never reproduced the
    // defect.
    let refused = true;
    try {
      git(sb.desk, 'checkout', 'feature/handed');
      refused = false;
    } catch { /* expected */ }
    assert.ok(refused, 'precondition: git must refuse a branch a second worktree holds');
    git(sb.desk, 'checkout', '--detach', 'origin/main');

    const out = withLoopFnsAll(sb.desk,
      'reset_desk "$PWD" feature/handed && echo RESET_OK || echo RESET_FAILED');

    assert.match(out, /RESET_OK/, 'the desk must end up holding the slice’s branch');
    assert.equal(git(sb.desk, 'rev-parse', '--abbrev-ref', 'HEAD').trim(), 'feature/handed',
      'the agent must now hold the branch it was handed');
    assert.equal(fs.existsSync(sb.holder), false,
      'the worker-less checkout must be gone');
    assert.match(out, /removed the worker-less checkout at .*leftover that held feature\/handed/,
      'the log must say what was removed and which branch it held');
  } finally { fs.rmSync(sb.root, { recursive: true, force: true }); }
});

// -----------------------------------------------------------------------
// A checkout holding work is kept — and `--force` would have passed above
// -----------------------------------------------------------------------
//
// A LOOP THAT REMOVES WITH `--force` PASSES THE FIRST CASE AND FAILS THIS ONE.
// That is the whole point of the pair: the first proves the branch is taken,
// and only this one proves it was not taken by destroying something.

test('checkout-yield: a checkout with an uncommitted file keeps the branch, and the file', () => {
  const sb = sandbox('dirty');
  try {
    fs.writeFileSync(path.join(sb.holder, 'unfinished.ts'), 'export const x = 1;\n');

    const out = withLoopFnsAll(sb.desk,
      'reset_desk "$PWD" feature/handed && echo RESET_OK || echo RESET_FAILED');

    assert.match(out, /RESET_FAILED/, 'the reset must fail rather than take the branch');
    assert.equal(fs.existsSync(sb.holder), true, 'the checkout must survive');
    assert.equal(fs.readFileSync(path.join(sb.holder, 'unfinished.ts'), 'utf8'),
      'export const x = 1;\n', 'the uncommitted file must be untouched');

    const marker = path.join(sb.desk, 'PLOT-BLOCKED.md');
    assert.equal(fs.existsSync(marker), true, 'the agent must ask a person');
    const text = fs.readFileSync(marker, 'utf8');
    assert.match(text, /uncommitted-changes/, 'the marker must name the condition');
    assert.match(text, /feature\/handed/, 'the marker must name the branch');
    assert.ok(text.includes(sb.holder), 'the marker must name the checkout’s path');
  } finally { fs.rmSync(sb.root, { recursive: true, force: true }); }
});

/**
 * A script directory that is the real one except for the yield bundle.
 *
 * Symlinks keep every other helper the loop sources — and the loop itself,
 * which `withLoopFnsAll` sources from here so that `script_dir` resolves to
 * this directory rather than the real one.
 *
 * @param body - the stub bundle's JavaScript, after the shebang.
 */
function stubbedScripts(root, body) {
  const dir = path.join(root, `stub-${Math.random().toString(36).slice(2)}`);
  fs.mkdirSync(path.join(dir, 'board'), { recursive: true });
  for (const entry of fs.readdirSync(scripts)) {
    if (entry === 'board') continue;
    fs.symlinkSync(path.join(scripts, entry), path.join(dir, entry));
  }
  for (const entry of fs.readdirSync(path.join(scripts, 'board'))) {
    if (entry === 'plot-checkout-yield.mjs') continue;
    fs.symlinkSync(path.join(scripts, 'board', entry), path.join(dir, 'board', entry));
  }
  const stub = path.join(dir, 'board', 'plot-checkout-yield.mjs');
  fs.writeFileSync(stub, `#!/usr/bin/env node\n${body}\n`);
  fs.chmodSync(stub, 0o755);
  return dir;
}

// -----------------------------------------------------------------------
// A bundle that cannot answer keeps the checkout
// -----------------------------------------------------------------------
//
// READ THE EXIT CODE, NOT THE OUTPUT'S EMPTINESS. A bundle exiting 2 prints
// nothing, and a loop reading stdout alone would take that for `yields` and
// remove a checkout nothing judged.

test('checkout-yield: a bundle that exits 2 keeps the checkout and names unaskable', () => {
  const sb = sandbox('unaskable');
  try {
    const stubDir = stubbedScripts(sb.root, 'process.exit(2);');

    const out = withLoopFnsAll(sb.desk,
      'reset_desk "$PWD" feature/handed && echo RESET_OK || echo RESET_FAILED',
      { scriptDir: stubDir });

    assert.match(out, /RESET_FAILED/, 'a rule that could not be asked must not license a removal');
    assert.equal(fs.existsSync(sb.holder), true, 'the checkout must survive');

    const marker = path.join(sb.desk, 'PLOT-BLOCKED.md');
    assert.equal(fs.existsSync(marker), true, 'the agent must ask a person');
    assert.match(fs.readFileSync(marker, 'utf8'), /unaskable/,
      'the marker must say the rule could not be asked, not invent a condition');
  } finally { fs.rmSync(sb.root, { recursive: true, force: true }); }
});

// -----------------------------------------------------------------------
// The holder is found by asking git, never by rebuilding a path
// -----------------------------------------------------------------------

test('checkout-yield: the holding worktree is read from git, whatever it is named', () => {
  const sb = sandbox('named');
  try {
    const out = withLoopFns(sb.desk, 'branch_holding_worktree feature/handed');
    assert.equal(fs.realpathSync(out.trim()), fs.realpathSync(sb.holder),
      'a leftover checkout follows no naming rule, so git is the only source');
    const none = withLoopFnsAll(sb.desk,
      'branch_holding_worktree feature/nobody && echo FOUND || echo NONE');
    assert.match(none, /NONE/, 'a branch no worktree holds must answer nothing');
  } finally { fs.rmSync(sb.root, { recursive: true, force: true }); }
});

// -----------------------------------------------------------------------
// The registry reading — an absent directory is not an unreadable one
// -----------------------------------------------------------------------
//
// A JUDGEMENT THE PLAN DID NOT SETTLE, recorded here because the two cases
// look alike and only one is a failure to observe.
//
// With no `PLOT_MANIFEST_FILE` there is no directory to look in: the reading
// was never taken, so it is `unknown` and the checkout keeps. A directory that
// does not exist HAS been read — it holds no manifest, so no manifest names
// this path, which is a measured `0`.
//
// READING THE SECOND AS `unknown` WOULD REFUSE EVERY REMOVAL in a repository
// that has not run the fleet, which is every repository the first time. The
// feature would never fire and nothing would say why.

test('checkout-yield: a registry with no manifest for the path answers 0', () => {
  const sb = sandbox('registry-empty');
  try {
    const dir = path.join(sb.desk, '.plot-agents');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'other.json'),
      JSON.stringify({ session: 's', branch: 'feature/other', worktree: path.join(sb.root, 'elsewhere') }));
    const out = withLoopFns(sb.desk, `checkout_is_registered ${JSON.stringify(sb.holder)}`,
      { env: { PLOT_MANIFEST_FILE: path.join(dir, 'me.json') } });
    assert.equal(out.trim(), '0', 'a manifest naming another desk does not claim this one');
  } finally { fs.rmSync(sb.root, { recursive: true, force: true }); }
});

test('checkout-yield: a manifest naming the checkout answers 1', () => {
  const sb = sandbox('registry-named');
  try {
    const dir = path.join(sb.desk, '.plot-agents');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'owner.json'),
      JSON.stringify({ session: 's', branch: 'feature/handed', worktree: sb.holder }));
    const out = withLoopFns(sb.desk, `checkout_is_registered ${JSON.stringify(sb.holder)}`,
      { env: { PLOT_MANIFEST_FILE: path.join(dir, 'me.json') } });
    assert.equal(out.trim(), '1', 'another agent owns that desk even with no live pid');
  } finally { fs.rmSync(sb.root, { recursive: true, force: true }); }
});

test('checkout-yield: no manifest file of our own answers unknown', () => {
  const sb = sandbox('registry-unset');
  try {
    // `env -u` rather than an empty value: the loop tests for a non-empty
    // variable, and an empty one is the same absence.
    const out = execFileSync('bash', ['-c', `
set -uo pipefail
export PLOT_WORKER_LOOP_SOURCED=1
script_dir=${JSON.stringify(scripts)}
main_branch=main
. ${JSON.stringify(loop)}
checkout_is_registered ${JSON.stringify(sb.holder)}
`], { encoding: 'utf8', cwd: sb.desk, env: { ...process.env, PLOT_MANIFEST_FILE: '' } });
    assert.equal(out.trim(), 'unknown',
      'with no directory to look in the reading was never taken, and unknown keeps the checkout');
  } finally { fs.rmSync(sb.root, { recursive: true, force: true }); }
});

// THE EXIT CODE IS THE ANSWER, AND THIS IS THE CASE THAT PROVES IT.
//
// The case above is NOT discriminating on its own: a bundle exiting 2 prints
// nothing, and an empty answer is also caught by the loop's "neither yields nor
// keep" arm, which writes the same marker. Measured 2026-10-02 by mutation — a
// loop rewritten to ignore the exit code entirely still passed it.
//
// So this stub exits 2 while printing `yields` on stdout. A loop reading the
// exit code refuses; a loop reading stdout removes the checkout. Only this
// separates them.
test('checkout-yield: exit 2 refuses even when stdout says yields', () => {
  const sb = sandbox('exit2-says-yields');
  try {
    const stubDir = stubbedScripts(sb.root, "process.stdout.write('yields\\n'); process.exit(2);");

    const out = withLoopFnsAll(sb.desk,
      'reset_desk "$PWD" feature/handed && echo RESET_OK || echo RESET_FAILED',
      { scriptDir: stubDir });

    assert.match(out, /RESET_FAILED/,
      'a bundle that could not answer must not license a removal, whatever it printed');
    assert.equal(fs.existsSync(sb.holder), true,
      'the checkout must survive a rule that exited non-zero');
    assert.match(fs.readFileSync(path.join(sb.desk, 'PLOT-BLOCKED.md'), 'utf8'), /unaskable/,
      'the marker must say the rule could not be asked');
  } finally { fs.rmSync(sb.root, { recursive: true, force: true }); }
});

// -----------------------------------------------------------------------
// `--force` is absent, and git's refusal is the second line of defence
// -----------------------------------------------------------------------
//
// THE CASE WHERE `--force` ACTUALLY DESTROYS SOMETHING is not a tree the rule
// already refuses: there the removal is never reached, so `--force` changes
// nothing and a mutation adding it survives (measured 2026-10-02).
//
// It is a tree whose contents the READING MISSES and git still sees.
// `plot_worker_dirty` drops editor leftovers by design — `PLOT_EDITOR_LEFTOVER`
// is `.(tmp[0-9]*|swp|orig|rej|bak)$` — because a stray `.tmp1` once restarted
// a branch that was making progress. So a holder carrying only a `.bak` reads
// CLEAN, the rule yields, and git refuses the plain removal.
//
// THAT REFUSAL IS THE DELIVERABLE. `reset_desk` says a guard that misjudges
// must leave a desk the sweep reports, not deleted work. With `--force` the
// file is gone and the branch is taken; without it the tree survives and a
// person is told. This is the only case that separates the two.
test('checkout-yield: a leftover the reading drops is still not force-removed', () => {
  const sb = sandbox('force-guard');
  try {
    // PRECONDITION: the reading must call this tree clean, or the test would
    // be asserting the `uncommitted-changes` refusal all over again.
    fs.writeFileSync(path.join(sb.holder, 'notes.bak'), 'an editor left this\n');
    const dirty = withLoopFns(sb.desk, `plot_worker_dirty ${JSON.stringify(sb.holder)}`);
    assert.equal(dirty.trim(), '',
      'precondition: the reading must drop the leftover, so the rule yields');

    const out = withLoopFnsAll(sb.desk,
      'reset_desk "$PWD" feature/handed && echo RESET_OK || echo RESET_FAILED');

    assert.match(out, /RESET_FAILED/,
      'git refuses the plain removal, and the loop must not route around it');
    assert.equal(fs.existsSync(sb.holder), true, 'the checkout must survive');
    assert.equal(fs.readFileSync(path.join(sb.holder, 'notes.bak'), 'utf8'),
      'an editor left this\n', 'the file the reading missed must still be there');

    // AND A PERSON IS TOLD, naming git's refusal rather than a condition the
    // rule never reached.
    const marker = fs.readFileSync(path.join(sb.desk, 'PLOT-BLOCKED.md'), 'utf8');
    assert.match(marker, /git-refused/,
      'the marker must say the rule allowed it and git did not');
  } finally { fs.rmSync(sb.root, { recursive: true, force: true }); }
});
