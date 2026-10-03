// Contract test for the desk lifecycle this slice adds: that reconcile
// section 21 reports `rules/desk-lifecycle.ts`'s state and exit per desk
// (rather than combining the reaper's kept-reasons itself), and that
// `plot-reap.sh --yes` reaps a `refused-empty` desk only after saving its
// marker's text to `.plot/state/refusals.tsv`.
//
// THE MEASURED CASE THIS SLICE EXISTS FOR: `free-50562867` held one claim
// commit (`plot: claim …`, changing no file), its worker was dead, and
// `origin/<branch>` was gone. That is `orphaned`. 250 markers were trashed by
// hand where a desk's sole uncommitted path was `PLOT-BLOCKED.md`, the marker
// named a gone branch, and no worker pid was live — `refused-empty`.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const scripts = path.join(here, '..', '..', 'skills', 'plot', 'scripts');
const scan = path.join(scripts, 'plot-reconcile-scan.sh');
const reap = path.join(scripts, 'plot-reap.sh');

const git = (cwd, ...args) => execFileSync('git', args, { encoding: 'utf8', cwd });

/** A fresh sandbox repository with an origin, `Worktree root` configured. */
const freshRepo = () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-desk-lifecycle-'));
  const origin = path.join(tmp, 'origin.git');
  const repo = path.join(tmp, 'repo');
  git(tmp, 'init', '--bare', '-q', '-b', 'main', origin);
  git(tmp, 'clone', '-q', origin, repo);
  git(repo, 'config', 'user.email', 'test@example.invalid');
  git(repo, 'config', 'user.name', 'Plot Test');
  git(repo, 'config', 'commit.gpgsign', 'false');
  fs.writeFileSync(
    path.join(repo, 'CLAUDE.md'),
    '## Plot Config\n\n- **Plan directory:** plans/\n- **Active index:** plans/active/\n' +
      '- **Delivered index:** plans/delivered/\n- **Worktree root:** .worktrees\n',
  );
  // Ignored so the marker the dispatcher writes at creation does not itself
  // read as an uncommitted path — every desk below carries one to be
  // recognised as a dispatch tree.
  fs.writeFileSync(path.join(repo, '.gitignore'), '.plot-worker.pid\n.worktrees/\n');
  fs.mkdirSync(path.join(repo, 'plans', 'active'), { recursive: true });
  fs.mkdirSync(path.join(repo, 'plans', 'delivered'), { recursive: true });
  git(repo, 'add', '-A');
  git(repo, 'commit', '-qm', 'config');
  git(repo, 'push', '-q', 'origin', 'main');
  return { tmp, repo };
};

let tmp, repo;

before(() => {
  ({ tmp, repo } = freshRepo());

  // ORPHANED: a claim-only commit, no claim ref, no worker, no marker, clean
  // tree. `free-50562867`'s own shape — cut the branch, push it so the claim
  // exists, then delete the remote ref the way a `--release` or a manual
  // cleanup would.
  // A dead pid, recognised as a dispatch tree by its PRESENCE but read as no
  // live worker: `plot_worker_pid` (and section 21's own `$d_pid` reading)
  // both check whether the recorded process actually runs.
  const DEAD_PID = '999999';
  const markDispatched = (wt) => fs.writeFileSync(path.join(wt, '.plot-worker.pid'), `${DEAD_PID}\n`);

  const orphanDesk = path.join(repo, '.worktrees', 'free-orphaned');
  git(repo, 'branch', 'bug/orphan-candidate', 'main');
  git(repo, 'push', '-q', 'origin', 'bug/orphan-candidate');
  git(repo, 'worktree', 'add', '-q', orphanDesk, 'bug/orphan-candidate');
  git(orphanDesk, 'commit', '-q', '--allow-empty', '-m', 'plot: claim free-orphaned');
  git(repo, 'push', '-q', 'origin', 'bug/orphan-candidate');
  git(repo, 'push', '-q', 'origin', '--delete', 'bug/orphan-candidate');
  markDispatched(orphanDesk);

  // REFUSED-EMPTY: only a marker, no worker, no file-changing commit, clean
  // tree otherwise. Detached at origin/main, matching the measured population.
  const emptyDesk = path.join(repo, '.worktrees', 'free-refused-empty');
  git(repo, 'worktree', 'add', '--detach', '-q', emptyDesk, 'origin/main');
  markDispatched(emptyDesk);
  fs.writeFileSync(path.join(emptyDesk, 'PLOT-BLOCKED.md'), 'PLOT-BLOCKED: which base?\n');

  // REFUSED-WITH-WORK: the same shape, with one extra dirty path.
  const withWorkDesk = path.join(repo, '.worktrees', 'free-refused-with-work');
  git(repo, 'worktree', 'add', '--detach', '-q', withWorkDesk, 'origin/main');
  markDispatched(withWorkDesk);
  fs.writeFileSync(path.join(withWorkDesk, 'PLOT-BLOCKED.md'), 'PLOT-BLOCKED: which base?\n');
  fs.writeFileSync(path.join(withWorkDesk, 'work.txt'), 'finished work\n');

  // HOLDING-WORK: a file-changing commit, no marker, no worker, detached so
  // merge reads purely from commits.
  const holdingDesk = path.join(repo, '.worktrees', 'free-holding-work');
  git(repo, 'worktree', 'add', '--detach', '-q', holdingDesk, 'origin/main');
  markDispatched(holdingDesk);
  fs.writeFileSync(path.join(holdingDesk, 'in-progress.txt'), 'partial\n');
  git(holdingDesk, 'add', '-A');
  git(holdingDesk, 'commit', '-q', '-m', 'partial work');
});

after(() => fs.rmSync(tmp, { recursive: true, force: true }));

test('desk lifecycle: an orphaned desk reads orphaned, detach-then-reap', () => {
  const report = execFileSync('bash', [scan, '--offline'], { encoding: 'utf8', cwd: repo });
  const section = report.slice(report.indexOf('== 21.'), report.indexOf('== 22.'));
  const line = section.split('\n').find((l) => l.includes('free-orphaned')) ?? '';
  assert.match(line, /orphaned/, `expected free-orphaned to read orphaned:\n${section}`);
});

test('desk lifecycle: a marker with nothing else reads refused-empty', () => {
  const report = execFileSync('bash', [scan, '--offline'], { encoding: 'utf8', cwd: repo });
  const section = report.slice(report.indexOf('== 21.'), report.indexOf('== 22.'));
  const line = section.split('\n').find((l) => l.includes('free-refused-empty')) ?? '';
  assert.match(line, /refused-empty/, `expected free-refused-empty:\n${section}`);
});

test('desk lifecycle: the same marker beside real work reads refused-with-work, a person resolves it', () => {
  const report = execFileSync('bash', [scan, '--offline'], { encoding: 'utf8', cwd: repo });
  const section = report.slice(report.indexOf('== 21.'), report.indexOf('== 22.'));
  const idx = section.indexOf('free-refused-with-work');
  const block = section.slice(idx, idx + 200);
  assert.match(block, /refused-with-work/, `expected free-refused-with-work:\n${block}`);
  assert.match(block, /only a person can resolve this one/, block);
});

test('desk lifecycle: an unlanded file-changing commit with no marker reads holding-work', () => {
  const report = execFileSync('bash', [scan, '--offline'], { encoding: 'utf8', cwd: repo });
  const section = report.slice(report.indexOf('== 21.'), report.indexOf('== 22.'));
  const idx = section.indexOf('free-holding-work');
  const block = section.slice(idx, idx + 200);
  assert.match(block, /holding-work/, `expected free-holding-work:\n${block}`);
  assert.match(block, /only a person can resolve this one/, block);
});

test('desk lifecycle: plot-reap.sh --yes reaps refused-empty and saves the marker text first', () => {
  const before = execFileSync('bash', [reap, '--dry-run'], { encoding: 'utf8', cwd: repo });
  assert.match(before, /would.*free-refused-empty/s, before);

  execFileSync('bash', [reap, '--yes'], { encoding: 'utf8', cwd: repo });

  assert.ok(
    !fs.existsSync(path.join(repo, '.worktrees', 'free-refused-empty')),
    'the refused-empty desk is removed',
  );
  const log = fs.readFileSync(path.join(repo, '.plot', 'state', 'refusals.tsv'), 'utf8');
  assert.match(log, /which base\?/, `expected the marker's text saved:\n${log}`);
  assert.match(log, /free-refused-empty/, log);

  // THE CONTROL: refused-with-work must survive the same run untouched.
  assert.ok(
    fs.existsSync(path.join(repo, '.worktrees', 'free-refused-with-work')),
    'a marker beside real work is never reaped',
  );
});
