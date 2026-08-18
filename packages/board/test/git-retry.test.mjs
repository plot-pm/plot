// The test helper's `git` retries a held `index.lock` — and ONLY that.
//
// Both properties are forced here rather than observed. The race this guards
// against is load-dependent: on 2026-08-17 the same commit failed in CI and
// passed 11/11 in isolation minutes later. A test that waits for the race to
// happen is a test that passes for the wrong reason, so both tests below
// CREATE the condition they assert on.
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { git } from './helpers.mjs';

/** A scratch repo with one commit, so `git` has something real to do. */
function makeGitRepo() {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-git-retry-'));
  const g = git(repo);
  g('init', '-b', 'main');
  g('config', 'user.email', 'test@example.com');
  g('config', 'user.name', 'Test');
  fs.writeFileSync(path.join(repo, 'file.txt'), 'one\n', 'utf8');
  g('add', 'file.txt');
  g('commit', '-m', 'initial');
  return repo;
}

/**
 * Hold `.git/index.lock` and release it after `ms` FROM ANOTHER PROCESS.
 *
 * Out-of-process is not a style choice. The retry sleeps via `Atomics.wait`,
 * which blocks this thread outright — a `setTimeout` releasing the lock here
 * could never fire while the helper is waiting, and the helper would exhaust
 * its retries against a lock nothing was ever going to remove. That failure
 * looks EXACTLY like a broken retry, so an in-process release would report a
 * working implementation as broken.
 *
 * Detached, with its own stdio, so it outlives any hiccup in the parent.
 */
function holdLockFor(repo, ms) {
  const lock = path.join(repo, '.git/index.lock');
  fs.writeFileSync(lock, '', 'utf8');
  const child = spawn(
    process.execPath,
    ['-e', `setTimeout(() => require('fs').unlinkSync(${JSON.stringify(lock)}), ${ms})`],
    { detached: true, stdio: 'ignore' },
  );
  child.unref();
  return lock;
}

describe('the test helper retries a held index.lock', () => {
  let repo;
  before(() => {
    repo = makeGitRepo();
  });
  after(() => {
    fs.rmSync(repo, { recursive: true, force: true });
  });

  it('survives a lock held by another process and released mid-flight', () => {
    const lock = holdLockFor(repo, 150);
    assert.equal(fs.existsSync(lock), true, 'the lock must be held before the call');

    // Patient enough for the 150 ms hold: 20 * 25 ms = 500 ms of headroom.
    const g = git(repo, { retries: 20, delayMs: 25 });
    fs.writeFileSync(path.join(repo, 'file.txt'), 'two\n', 'utf8');

    // Would throw `Unable to create '…/.git/index.lock': File exists` without
    // the retry — this is the CI failure, forced rather than waited for.
    g('add', 'file.txt');

    assert.equal(fs.existsSync(lock), false, 'the lock was released, not bypassed');
    assert.match(g('status', '--porcelain'), /file\.txt/, 'the add actually landed');
  });

  it('fails a non-lock error on the first attempt, and retries a lock one', () => {
    // Counted, not timed. The property is "how many times did git run", and
    // asserting that directly beats inferring it from elapsed wall-clock: a
    // timing threshold is itself load-dependent, which is the failure mode
    // this whole branch exists to remove. A test that could flake under load
    // would be the defect wearing the fix as a costume.
    //
    // Both directions come from one mechanism, so neither half can pass for
    // the wrong reason. Asserting only that a non-lock error runs once would
    // also hold for a helper that had stopped retrying anything at all.
    const budget = { retries: 3, delayMs: 1 };

    let nth = 0;
    const runsOf = (stderrLine) => {
      const tally = path.join(repo, `tally-${nth++}`);
      // A git alias runs arbitrary shell AS a git subcommand: it appends one
      // line per invocation and then fails with the stderr we choose. The
      // helper sees an ordinary execFileSync failure and cannot tell that the
      // command was built to be counted.
      const alias = `!f() { echo x >> ${JSON.stringify(tally)}; echo ${JSON.stringify(stderrLine)} >&2; exit 1; }; f`;
      assert.throws(() => git(repo, budget)('-c', `alias.boom=${alias}`, 'boom'));
      return fs.readFileSync(tally, 'utf8').trim().split('\n').length;
    };

    // No `index.lock` anywhere in this text, so the guard's regex must reject
    // it — one run, and the error surfaces immediately as git wrote it.
    assert.equal(
      runsOf("error: pathspec 'no-such-branch' did not match any file(s) known to git"),
      1,
      'a non-lock failure must not be retried even once',
    );

    // The same harness with the real lock message: the helper spends its whole
    // budget before giving up, proving the retry is conditional on the message
    // rather than absent.
    assert.equal(
      runsOf("fatal: Unable to create '/somewhere/.git/index.lock': File exists."),
      budget.retries + 1,
      'a lock failure must be retried up to the budget, then rethrown',
    );
  });
});
