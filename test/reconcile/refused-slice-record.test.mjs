// `refused_slices_path` and `record_refused_slice` in
// `skills/plot/scripts/plot-worker-loop.sh` — the writer for the measured case
// `rules/queue.ts`'s `refused` reading now finds.
//
// Measured 2026-10-03: an agent handed `bug/the-queue-reads-the-scans-order`
// wrote `PLOT-BLOCKED.md` and stopped. The queue had no hold for a refused
// slice, so the next pass handed the branch to another free agent — 250 desks
// from one slice this way. `record_refused_slice` is what `blocked_on_held_checkout`
// now calls, and this file is the branch's own, per the scope guard in
// `.plot/briefs/a-refused-slice-is-held.md`: PR #1234 already touches
// `workerloop.test.mjs`, so a shell test here gets its own file.
//
// THE SUBJECT IS THE REAL FILE'S OWN FUNCTIONS, extracted with `awk` rather
// than retyped, so a later edit to the source cannot drift from what this
// test exercises unnoticed — a copy would pass forever on its own text.
//
// `.plot/state/` LIVES UNDER THE COMMON GIT DIR, NEVER A WORKTREE'S OWN.
// `plot-reap.sh` runs `git worktree remove --force` over a finished desk, so a
// record written to one is destroyed by the reap that measured it — the same
// reasoning `slice-spend-file.ts` states for `--git-common-dir` over
// `--show-toplevel`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(here, '..', '..');
const loopScript = path.join(repoRoot, 'skills', 'plot', 'scripts', 'plot-worker-loop.sh');

/** Extracts one function's source, by name, from the real script. */
const extractFunction = (name) => {
  const text = fs.readFileSync(loopScript, 'utf8');
  const lines = text.split('\n');
  const start = lines.findIndex((line) => line.startsWith(`${name}()`));
  assert.notEqual(start, -1, `${name} not found in plot-worker-loop.sh`);
  const out = [];
  for (let i = start; i < lines.length; i += 1) {
    out.push(lines[i]);
    if (lines[i] === '}') break;
  }
  return out.join('\n');
};

/** A throwaway main checkout with one linked worktree, for a real `--git-common-dir`. */
function withDesk(fn) {
  // REALPATH-RESOLVED UP FRONT. macOS resolves `/tmp` through a symlink, and
  // git's own answers are realpath-resolved too — comparing against the
  // unresolved `mkdtempSync` path would fail on a correct function.
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'plot-refused-')));
  const main = path.join(root, 'main');
  const wt = path.join(root, 'wt');
  try {
    const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8' });
    fs.mkdirSync(main);
    git(main, 'init', '-q');
    git(main, 'config', 'user.email', 'test@test.invalid');
    git(main, 'config', 'user.name', 'test');
    fs.writeFileSync(path.join(main, 'a.txt'), 'hi\n');
    git(main, 'add', 'a.txt');
    git(main, 'commit', '-qm', 'init');
    git(main, 'branch', 'dummy');
    git(main, 'worktree', 'add', '-q', wt, 'dummy');
    return fn({ main, wt });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

/** Runs a bash snippet with both functions defined, from a linked worktree. */
const runInDesk = (wt, script) =>
  execFileSync('bash', ['-c', `
    set -u
    ${extractFunction('refused_slices_path')}
    ${extractFunction('record_refused_slice')}
    ${script}
  `], { encoding: 'utf8', timeout: 10_000, env: { ...process.env, PLOT_WORKTREE: wt } });

test('refused_slices_path resolves under the main checkout, not the worktree', () => {
  withDesk(({ main, wt }) => {
    const out = runInDesk(wt, 'refused_slices_path');
    assert.equal(out.trim(), path.join(main, '.git', '.plot', 'state', 'refused-slices.tsv'));
  });
});

test('record_refused_slice appends the branch, once', () => {
  withDesk(({ main, wt }) => {
    runInDesk(wt, `
      record_refused_slice "bug/the-queue-reads-the-scans-order"
      record_refused_slice "bug/the-queue-reads-the-scans-order"
    `);
    const file = path.join(main, '.git', '.plot', 'state', 'refused-slices.tsv');
    const lines = fs.readFileSync(file, 'utf8').trim().split('\n');
    assert.deepEqual(lines, ['bug/the-queue-reads-the-scans-order']);
  });
});

test('record_refused_slice is a set, not a log, across two branches', () => {
  withDesk(({ main, wt }) => {
    runInDesk(wt, `
      record_refused_slice "bug/one"
      record_refused_slice "bug/two"
      record_refused_slice "bug/one"
    `);
    const file = path.join(main, '.git', '.plot', 'state', 'refused-slices.tsv');
    const lines = fs.readFileSync(file, 'utf8').trim().split('\n');
    assert.deepEqual(lines.sort(), ['bug/one', 'bug/two']);
  });
});

test('a cleared line stays clear until the branch is refused again', () => {
  // THE HOLD NEVER ENDS ON A TIMER. Removing the line is the repair, and the
  // next read of the file must not see the branch until it is refused again.
  withDesk(({ main, wt }) => {
    runInDesk(wt, 'record_refused_slice "bug/the-queue-reads-the-scans-order"');
    const file = path.join(main, '.git', '.plot', 'state', 'refused-slices.tsv');
    fs.writeFileSync(file, '');
    const text = fs.readFileSync(file, 'utf8');
    assert.equal(text.includes('bug/the-queue-reads-the-scans-order'), false);
  });
});

test('no branch, no write — the same refusal `seal_declaration` makes', () => {
  withDesk(({ main, wt }) => {
    runInDesk(wt, 'record_refused_slice ""');
    const file = path.join(main, '.git', '.plot', 'state', 'refused-slices.tsv');
    assert.equal(fs.existsSync(file), false);
  });
});
