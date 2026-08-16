// Contract test for skills/plot/scripts/plot-push-main.sh — the direct-to-
// default-branch push and its outcome classification.
//
// Two halves, tested two ways, because one of the four outcomes cannot be
// produced locally at all:
//
//   clean / rejected  — real pushes against a local bare repo. A push behind
//                       its remote counterpart is a genuine non-fast-forward
//                       rejection, not a simulation.
//   bypassed / unknown — through `--classify`, fed the REAL recorded stderr.
//                       A true bypass needs a protected GitHub remote plus an
//                       actor entitled to step over it; CI has neither.
//
// The bypass fixture below is the verbatim output of a real push to this
// repository's main on 2026-08-16 — not a paraphrase. A fixture written from
// memory of what the message looks like would only test the matcher against
// its own author's recollection.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const helper = path.join(here, '..', '..', 'skills', 'plot', 'scripts', 'plot-push-main.sh');

/** Verbatim: GitHub's reply to a protected-but-not-enforced push (2026-08-16). */
const REAL_BYPASS_STDERR = [
  'remote: Bypassed rule violations for refs/heads/main:        ',
  'remote: ',
  'remote: - Changes must be made through a pull request.        ',
  'remote: ',
  'remote: - Required status check "validate" is expected.        ',
  'remote: ',
].join('\n');

const classify = (code, stderr) =>
  execFileSync('bash', [helper, '--classify', String(code)], {
    encoding: 'utf8',
    input: stderr,
  }).trim();

const git = (cwd, ...args) =>
  execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', ...args], {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });

/** A bare remote plus a working clone, both with `main` in place. */
function makeRepo() {
  const dir = mkdtempSync(path.join(tmpdir(), 'plot-pushmain-'));
  const bare = path.join(dir, 'b.git');
  const work = path.join(dir, 'w');
  execFileSync('git', ['init', '-q', '--bare', bare]);
  execFileSync('git', ['init', '-q', work]);
  git(work, 'commit', '-q', '--allow-empty', '-m', 'base');
  git(work, 'branch', '-M', 'main');
  git(work, 'remote', 'add', 'origin', bare);
  git(work, 'push', '-q', 'origin', 'main');
  return { dir, bare, work };
}

function push(work, branch, target) {
  try {
    return {
      code: 0,
      out: execFileSync('bash', [helper, branch, target], { cwd: work, encoding: 'utf8' }),
    };
  } catch (err) {
    return { code: err.status, out: `${err.stdout ?? ''}${err.stderr ?? ''}` };
  }
}

test('push-main: classify reads the real bypass notice', () => {
  assert.equal(classify(0, REAL_BYPASS_STDERR), 'bypassed');
});

test('push-main: classify calls silence clean', () => {
  assert.equal(classify(0, ''), 'clean');
});

// The outcome that keeps the helper honest when GitHub rewords its notice: any
// remote commentary we cannot read must be its own answer. Filing it under
// `clean` would make the check go quiet exactly when it stops working.
test('push-main: classify calls unrecognised remote output unknown, never clean', () => {
  assert.equal(classify(0, 'remote: Some future wording nobody anticipated'), 'unknown');
});

test('push-main: classify calls a non-zero exit rejected', () => {
  assert.equal(classify(1, 'remote: anything at all'), 'rejected');
});

// A loose pattern would file ordinary remote chatter as a protection bypass,
// and a false alarm trains people to ignore the real one.
test('push-main: the word "bypass" alone is not a bypass', () => {
  assert.equal(classify(0, 'remote: running bypass-cache hook'), 'unknown');
});

test('push-main: a clean push reports clean and exits 0', () => {
  const { work } = makeRepo();
  git(work, 'checkout', '-q', '-b', 'plot/tmp');
  git(work, 'commit', '-q', '--allow-empty', '-m', 'bookkeeping');

  const r = push(work, 'plot/tmp', 'main');
  assert.equal(r.code, 0);
  assert.match(r.out, /^push: clean/);
});

// THE point of the exit code: it answers "did the commit land?", nothing else.
// A push that landed must never read as failure at a call site.
test('push-main: a landed push leaves the commit on the default branch', () => {
  const { work, bare } = makeRepo();
  git(work, 'checkout', '-q', '-b', 'plot/tmp');
  git(work, 'commit', '-q', '--allow-empty', '-m', 'bookkeeping');
  push(work, 'plot/tmp', 'main');

  const log = execFileSync('git', ['log', '--oneline', 'main'], { cwd: bare, encoding: 'utf8' });
  assert.match(log, /bookkeeping/);
});

test('push-main: a real non-fast-forward is rejected and exits 1', () => {
  const { work } = makeRepo();
  // Advance the remote so the stale branch is genuinely behind.
  git(work, 'checkout', '-q', '-b', 'ahead');
  git(work, 'commit', '-q', '--allow-empty', '-m', 'remote moved on');
  git(work, 'push', '-q', 'origin', 'ahead:main');
  git(work, 'checkout', '-q', '-B', 'stale', 'main');

  const r = push(work, 'stale', 'main');
  assert.equal(r.code, 1);
  assert.match(r.out, /^push: rejected/m);
});

// `git push <branch>:<default>` never creates <branch> on the remote, which is
// why /plot-approve's `push --delete` line had been removing nothing for its
// whole existence. Pinned so nobody re-adds the cleanup.
test('push-main: pushing branch:default creates no remote branch', () => {
  const { work, bare } = makeRepo();
  git(work, 'checkout', '-q', '-b', 'plot/tmp');
  git(work, 'commit', '-q', '--allow-empty', '-m', 'bookkeeping');
  push(work, 'plot/tmp', 'main');

  const refs = execFileSync('git', ['for-each-ref', '--format=%(refname)', 'refs/heads/'], {
    cwd: bare,
    encoding: 'utf8',
  }).trim();
  assert.equal(refs, 'refs/heads/main');
});
