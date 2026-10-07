// THE CORPUS NEVER WRITES A REF THE SHARED REPOSITORY OWNS.
//
// This is slice 1 of docs/plans/2026-10-07-the-tests-and-sweeps-leave-no-trace.md.
// Measured 2026-09-04 and again 2026-10-03: `refs.corpus.test.ts`'s old
// `beforeAll` wrote `refs/remotes/origin/HEAD` IN THE SHARED REPOSITORY and
// relied on `afterAll` to restore it. A run killed before `afterAll` — SIGINT,
// a CI cancel, a crashed worker — left the corruption behind; #1259 is three
// lifecycle pushes that went to `plot-corpus-pin` because of it.
//
// "RESTORING HARDER" WAS REJECTED AS THE FIX. Any design whose safety rests on
// a cleanup hook running leaves the same window open. The fix pins a
// DISPOSABLE CLONE instead — `pin.mjs` below is the extracted sequence
// `refs.corpus.test.ts`'s `beforeAll` now runs: clone, branch the pin inside
// the clone, write `Main branch:` into the clone's own `CLAUDE.md`. None of it
// opens the shared repository's `.git` for writing, so there is no ref in it
// to corrupt — killing the sequence at ANY point proves that by leaving the
// shared repo's `origin/HEAD` untouched, not by restoring it afterward.
//
// A FIXTURE REPO, NOT THIS CHECKOUT. Killing a clone of the real `plot` repo
// mid-flight is slow (the real repo is large) and running it against a tiny
// fixture is enough: the property under test is "nothing opens `ROOT`'s own
// `.git` for a write", which does not depend on `ROOT`'s size.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const pinScript = path.join(here, 'fixtures', 'corpus-pin.mjs');

const git = (cwd, ...args) => execFileSync('git', args, { encoding: 'utf8', cwd }).trim();
const rmTree = (dir) => fs.rmSync(dir, { recursive: true, force: true });

/** A real origin plus a checkout with `origin/HEAD` set, standing in for `ROOT`. */
const sharedRepo = (label) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `plot-corpus-shared-${label}-`));
  const origin = path.join(root, 'origin.git');
  const work = path.join(root, 'work');
  git(root, 'init', '--bare', '-q', '-b', 'main', origin);
  const seed = path.join(root, 'seed');
  git(root, 'clone', '-q', origin, seed);
  fs.writeFileSync(path.join(seed, 'CLAUDE.md'), '# fixture\n\n## Plot Config\n\nnothing yet.\n');
  fs.writeFileSync(path.join(seed, 'README.md'), '# fixture\n');
  git(seed, 'add', '-A');
  git(seed, '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'init');
  git(seed, 'push', '-q', 'origin', 'main');
  git(root, 'clone', '-q', origin, work);
  git(work, 'fetch', '-q', 'origin');
  return { root, work };
};

const symref = (cwd) => {
  const got = execFileSync('git', ['symbolic-ref', '--quiet', '--short', 'refs/remotes/origin/HEAD'],
    { cwd, encoding: 'utf8' }).trim();
  return got;
};

/**
 * Runs `fixtures/corpus-pin.mjs` against `repoRoot`, optionally killed
 * mid-flight.
 *
 * `killAfterCloneMs` is timed from the `cloned` marker the fixture prints
 * right after its `git clone`, not from process spawn — node's spawn-to
 * -first-line latency on this machine varies by over 100ms, which made a
 * kill timed from spawn race the clone instead of landing inside the
 * sequence (confirmed: a 100ms-from-spawn kill passed even when the fixture
 * was mutated to write into the shared repo immediately after cloning,
 * because the kill kept landing before that line ran).
 */
function runPin(repoRoot, { killAfterCloneMs = 0 } = {}) {
  return new Promise((resolve) => {
    const cloneDir = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-corpus-pintest-'));
    const child = spawn('node', [pinScript, repoRoot, cloneDir], { encoding: 'utf8' });
    let stdout = '';
    let stderr = '';
    let timer;
    child.stdout.on('data', (d) => {
      stdout += d;
      if (killAfterCloneMs > 0 && !timer && stdout.includes('cloned')) {
        timer = setTimeout(() => { try { child.kill('SIGKILL'); } catch { /* already gone */ } }, killAfterCloneMs);
      }
    });
    child.stderr.on('data', (d) => { stderr += d; });
    const HANG_BACKSTOP_MS = 20_000;
    const backstop = setTimeout(() => {
      try { child.kill('SIGKILL'); } catch { /* already gone */ }
    }, HANG_BACKSTOP_MS);
    child.on('exit', (code, signal) => {
      if (timer) clearTimeout(timer);
      clearTimeout(backstop);
      rmTree(cloneDir);
      resolve({ code, signal, stdout, stderr, cloneDir });
    });
  });
}

test('corpus pin: killed mid-sequence leaves the shared repo\'s origin/HEAD untouched', async () => {
  const { root, work } = sharedRepo('killed');
  const before = symref(work);

  // Timed from the fixture's `cloned` marker rather than from process spawn
  // (see `runPin`) — 50ms after the clone is done still sits well inside the
  // fixture's 300ms post-clone sleep, so the kill reliably lands mid-sequence
  // rather than racing variable node startup time.
  const result = await runPin(work, { killAfterCloneMs: 50 });
  assert.equal(result.signal, 'SIGKILL', `expected the process to actually be killed:\n${result.stderr}`);

  const after = symref(work);
  assert.equal(after, before, 'the shared repo\'s origin/HEAD symref is byte-identical before and after a killed run');
  assert.equal(before, 'origin/main', 'sanity: the fixture started with a real symref to check against');

  rmTree(root);
});

test('corpus pin: a completed run also leaves the shared repo untouched', async () => {
  const { root, work } = sharedRepo('completed');
  const before = symref(work);

  const result = await runPin(work, {});
  assert.equal(result.code, 0, `expected the pin sequence to finish:\n${result.stderr}`);

  const after = symref(work);
  assert.equal(after, before, 'a successful run writes no shared ref either');

  rmTree(root);
});

test('corpus pin: two parallel runs do not collide (#1319)', async () => {
  const { root, work } = sharedRepo('parallel');

  const [first, second] = await Promise.all([runPin(work, {}), runPin(work, {})]);
  assert.equal(first.code, 0, `first run failed:\n${first.stderr}`);
  assert.equal(second.code, 0, `second run failed:\n${second.stderr}`);

  // Each run pins its OWN clone; neither clone's ref list can contain the
  // other's clone directory, because each is a disposable temp dir no other
  // process was told about.
  assert.notEqual(first.cloneDir, second.cloneDir, 'sanity: the two runs used different clones');
  assert.doesNotMatch(first.stdout, new RegExp(second.cloneDir.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
    'the first run never names the second run\'s clone');
  assert.doesNotMatch(second.stdout, new RegExp(first.cloneDir.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
    'the second run never names the first run\'s clone');

  // And the shared repo itself is still untouched by either.
  assert.equal(symref(work), 'origin/main', 'two concurrent pins still leave the shared origin/HEAD alone');

  rmTree(root);
});
