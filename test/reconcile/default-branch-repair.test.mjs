// THE DEFAULT BRANCH REPAIRS ITSELF, and only when it is actually broken.
//
// This is `the-default-branch-repairs-itself`, slice 3 of
// docs/plans/2026-09-04-a-ref-is-not-a-claim.md. Measured twice on 2026-09-04,
// hours apart: `refs/remotes/origin/HEAD` pointed at `origin/plot-corpus-pin`,
// a branch that does not exist on the remote, and `plot-dispatch.sh` refused
// every dispatch. `git remote set-head origin --auto` fixed it both times.
//
// WHAT MAKES THIS WORTH A TEST RATHER THAN A ONE-LINER is the case that must
// NOT be repaired. `--auto` asks the remote and overwrites whatever it finds,
// so a clone whose `origin/HEAD` deliberately names a non-default branch would
// be silently overruled by a repair that fired on every read.
//
// THE FUNCTIONS ARE EXERCISED DIRECTLY, sourced out of the helper. It defines
// three functions and does nothing else on load, which is what makes sourcing
// it safe — the same shape as `plot-pr-merged.sh` and `plot-worker-state.sh`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const scripts = path.join(here, '..', '..', 'skills', 'plot', 'scripts');
const helper = path.join(scripts, 'plot-default-branch.sh');

const git = (cwd, ...args) => execFileSync('git', args, { encoding: 'utf8', cwd }).trim();

/**
 * A real origin and a clone of it, with a second branch on the remote.
 *
 * The origin is real because `set-head --auto` ASKS THE REMOTE — a fixture with
 * no remote could not tell a repair from a no-op. `other` exists so the
 * leave-alone case has a resolvable non-default branch to point at.
 */
const sandbox = (label) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `plot-defbranch-${label}-`));
  const origin = path.join(root, 'origin.git');
  const work = path.join(root, 'work');
  git(root, 'init', '--bare', '-q', '-b', 'main', origin);
  const seed = path.join(root, 'seed');
  git(root, 'clone', '-q', origin, seed);
  fs.writeFileSync(path.join(seed, 'README.md'), '# fixture\n');
  git(seed, 'add', '-A');
  git(seed, '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'init');
  git(seed, 'push', '-q', 'origin', 'main');
  git(seed, 'push', '-q', 'origin', 'main:other');
  git(root, 'clone', '-q', origin, work);
  git(work, 'fetch', '-q', 'origin');
  return { root, work };
};

const rmTree = (dir) => fs.rmSync(dir, { recursive: true, force: true });

/** Sources the helper and runs one expression, returning stdout and stderr. */
const call = (cwd, expr) =>
  spawnSync('bash', ['-c', `. "${helper}"; ${expr}`], { cwd, encoding: 'utf8' });

const symref = (cwd) => {
  const got = spawnSync('git', ['symbolic-ref', '--quiet', '--short', 'refs/remotes/origin/HEAD'],
    { cwd, encoding: 'utf8' });
  return got.status === 0 ? got.stdout.trim() : '';
};

test('default branch: an unresolvable origin/HEAD is repaired', () => {
  const { root, work } = sandbox('repair');
  // The measured state: the symref names a branch the remote does not have.
  git(work, 'symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/plot-corpus-pin');

  const got = call(work, 'default_branch');
  assert.equal(got.status, 0, got.stderr);
  assert.equal(got.stdout.trim(), 'main', `and answers the repaired branch:\n${got.stderr}`);
  assert.equal(symref(work), 'origin/main', 'the symref itself is repaired, not just the answer');

  rmTree(root);
});

test('default branch: the repair NAMES both refs', () => {
  // A recurring corruption that is silently fixed is one nobody investigates.
  // The line has to carry what it pointed at AND what it now points at, or a
  // second occurrence is invisible in a working system.
  const { root, work } = sandbox('names');
  git(work, 'symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/plot-corpus-pin');

  const got = call(work, 'default_branch');
  assert.match(got.stderr, /plot-corpus-pin/, `naming what it pointed at:\n${got.stderr}`);
  assert.match(got.stderr, /origin\/main/, `and what it now points at:\n${got.stderr}`);
  assert.match(got.stderr, /repaired origin\/HEAD/, `in words a log can be grepped for:\n${got.stderr}`);

  rmTree(root);
});

test('default branch: a RESOLVABLE origin/HEAD is left alone', () => {
  // `--auto` asks the remote and overwrites whatever it finds, so a repair that
  // fired on every read would silently overrule somebody's choice.
  const { root, work } = sandbox('leave');
  git(work, 'symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/other');

  const got = call(work, 'default_branch');
  assert.equal(got.stdout.trim(), 'other', 'the file’s own answer is kept');
  assert.equal(symref(work), 'origin/other', 'and the symref is untouched');
  assert.equal(got.stderr.trim(), '', `a repair that did not happen says nothing:\n${got.stderr}`);

  rmTree(root);
});

test('default branch: an ABSENT origin/HEAD is a fresh clone, not a corruption', () => {
  // Nothing to repair and nothing to report: the `main` fallback answers,
  // exactly as every caller's own fallback chain did before.
  const { root, work } = sandbox('absent');
  git(work, 'symbolic-ref', '--delete', 'refs/remotes/origin/HEAD');

  const got = call(work, 'default_branch');
  assert.equal(got.status, 0);
  assert.equal(got.stdout.trim(), 'main');
  assert.equal(got.stderr.trim(), '', `and nothing is reported:\n${got.stderr}`);

  rmTree(root);
});

test('default branch: a PARKED checkout does not become the default branch', () => {
  // THE DEFECT `dispatch.test.mjs` IS NAMED FOR — *"a shared approval is not
  // hidden by a parked checkout"* — measured when a concurrent agent's
  // `git checkout` blocked two correctly-approved plans in one session.
  //
  // `refs-git.ts:138` falls back to `rev-parse --abbrev-ref HEAD` and is right
  // to: it answers a question about THIS checkout. A shell caller is asking
  // which branch everyone SHARES, so the current branch is not an answer to it
  // — `main` is a guess about the repository, the current branch is a guess
  // about the operator's last command.
  const { root, work } = sandbox('parked');
  git(work, 'symbolic-ref', '--delete', 'refs/remotes/origin/HEAD');
  git(work, 'checkout', '-q', '-b', 'other-agent-branch');

  const got = call(work, 'default_branch');
  assert.equal(got.stdout.trim(), 'main',
    'the parked branch is not offered as the branch everyone shares');

  rmTree(root);
});

test('default branch: origin_head_resolves separates the three states', () => {
  const { root, work } = sandbox('resolves');

  git(work, 'symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/other');
  assert.equal(call(work, 'origin_head_resolves').status, 0, 'a resolvable symref resolves');

  git(work, 'symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/plot-corpus-pin');
  assert.notEqual(call(work, 'origin_head_resolves').status, 0, 'a dangling one does not');

  git(work, 'symbolic-ref', '--delete', 'refs/remotes/origin/HEAD');
  assert.equal(call(work, 'origin_head_resolves').status, 0,
    'and an ABSENT one resolves — there is nothing to repair, which is not the same as broken');

  rmTree(root);
});

test('default branch: an unreachable remote reports and does not stop', () => {
  // The repair sits on paths that already have their own refusal downstream, so
  // it must never become a second way to stop. With the origin gone,
  // `set-head --auto` fails and the caller still gets an answer.
  const { root, work } = sandbox('unreachable');
  git(work, 'symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/plot-corpus-pin');
  rmTree(path.join(root, 'origin.git'));

  const got = call(work, 'default_branch');
  assert.equal(got.status, 0, 'it does not stop the caller');
  assert.notEqual(got.stdout.trim(), '', 'and still answers');
  assert.match(got.stderr, /could not be asked/, `saying why it could not repair:\n${got.stderr}`);

  rmTree(root);
});

test('default branch: the helper defines functions and does nothing on load', () => {
  // What makes sourcing it safe, and the property `plot-pr-merged.sh` records
  // for the same shape: a file that parsed `$@` would run its caller's
  // arguments through its own parser.
  const { root, work } = sandbox('load');
  const got = spawnSync('bash', ['-c', `. "${helper}"`], { cwd: work, encoding: 'utf8' });
  assert.equal(got.status, 0);
  assert.equal(got.stdout.trim(), '', 'no stdout on load');
  assert.equal(got.stderr.trim(), '', 'no stderr on load');

  rmTree(root);
});
