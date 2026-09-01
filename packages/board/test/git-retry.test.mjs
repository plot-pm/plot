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
import { git, rmTree, makeStubScripts } from './helpers.mjs';

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
    rmTree(repo);
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

describe('the teardown helper outlasts a process still writing into the tree', () => {
  // INJECTED, not raced. A real writer cannot be made to lose the race
  // reliably — measured here, a child recreating the file every 1 ms still let
  // a plain `rmSync` succeed, so a test built that way would pass whether or
  // not the retry existed. That is the defect this branch removes, so the
  // failure is injected instead: the same reason the git test above counts
  // invocations rather than timing them.
  //
  // What is asserted is the retry CONTRACT — transient codes are absorbed,
  // everything else surfaces at once — which is the whole of what rmTree adds
  // over `fs.rmSync`.
  const withFailingRm = (times, code, body) => {
    const real = fs.rmSync;
    let calls = 0;
    fs.rmSync = (...args) => {
      calls++;
      if (calls <= times) {
        const err = new Error(`${code}: injected, '${args[0]}'`);
        err.code = code;
        throw err;
      }
      return real.apply(fs, args);
    };
    try {
      return { result: body(), calls };
    } finally {
      fs.rmSync = real;
    }
  };

  it('absorbs a transient ENOTEMPTY and still deletes the tree', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-rmtree-'));
    fs.mkdirSync(path.join(root, 'outer/.git'), { recursive: true });
    fs.writeFileSync(path.join(root, 'outer/.git/HEAD'), 'ref: refs/heads/main\n', 'utf8');

    // Three failures then success — the shape of a grandchild `git` that
    // outlives the SIGTERM sent to the server and writes a few more times.
    const { calls } = withFailingRm(3, 'ENOTEMPTY', () =>
      rmTree(root, { retries: 10, delayMs: 1 }),
    );

    assert.equal(calls, 4, 'it retried past each transient failure, then succeeded');
    assert.equal(fs.existsSync(root), false, 'the tree is actually gone, not merely attempted');
  });

  it('gives up on a code patience cannot fix, on the FIRST attempt', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-rmtree-'));
    // EACCES is not a dying writer, it is a wrong fixture. Retrying it would
    // spend the whole budget sleeping and then report the same error later —
    // slower, and no more informative.
    const { calls } = withFailingRm(99, 'EACCES', () => {
      assert.throws(() => rmTree(root, { retries: 10, delayMs: 1 }), /EACCES/);
    });
    assert.equal(calls, 1, 'a non-transient error must not be retried even once');
    rmTree(root);
  });

  it('exhausts a bounded budget rather than looping forever', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-rmtree-'));
    // A lock that never clears must fail the suite, not hang it.
    const { calls } = withFailingRm(99, 'ENOTEMPTY', () => {
      assert.throws(() => rmTree(root, { retries: 3, delayMs: 1 }), /ENOTEMPTY/);
    });
    assert.equal(calls, 4, 'retries + 1 attempts, then the real error');
    rmTree(root);
  });
});

/**
 * THE FIXTURE'S OWN TEARDOWN, which is the line that actually failed.
 *
 * `rmTree` was written on 2026-08-31 with the two tests above, and
 * `helpers.mjs` went on calling `fs.rmSync` directly in the one place every
 * server test tears down through — so the absorption existed and the failure
 * kept happening. Six `test:board` runs died there on 2026-08-31, in
 * `port.test.mjs` and `write-gate.test.mjs` alternately.
 *
 * A test on `rmTree` cannot catch that; only a test on the CALLER can. This
 * asserts the wiring rather than the retry: that `cleanup()` absorbs a
 * transient failure, which is only true if it goes through the helper.
 */
describe('the stub fixture tears down through the retry', () => {
  const withFailingRm = (times, code, body) => {
    const real = fs.rmSync;
    let calls = 0;
    fs.rmSync = (...args) => {
      calls++;
      if (calls <= times) {
        const err = new Error(`${code}: injected, '${args[0]}'`);
        err.code = code;
        throw err;
      }
      return real.apply(fs, args);
    };
    try {
      return { result: body(), calls };
    } finally {
      fs.rmSync = real;
    }
  };

  it("absorbs a transient ENOTEMPTY in the fixture's own cleanup", () => {
    const stub = makeStubScripts();
    // One injected failure: a plain `fs.rmSync` would throw it straight out of
    // the `after()` hook and fail a test that had already passed.
    const { calls } = withFailingRm(1, 'ENOTEMPTY', () => {
      stub.cleanup();
    });
    assert.equal(calls, 2, 'the first attempt failed and the second succeeded');
    assert.equal(fs.existsSync(stub.dir), false, 'and the tree is gone');
  });

  it('still surfaces an error patience cannot fix', () => {
    const stub = makeStubScripts();
    try {
      assert.throws(
        () => withFailingRm(1, 'EACCES', () => stub.cleanup()),
        /EACCES/,
        'a permission error is not transient and must not be retried away',
      );
    } finally {
      rmTree(stub.dir);
    }
  });
});
