// Contract test: the reaper reaches a DETACHED desk.
//
// `plot-dispatch.sh --start` cuts a free agent's desk detached at
// `origin/<main>`, because a free agent holds no slice and so has no branch to
// check out. Both cleanup paths read the worktree list through one awk block,
// and that block emitted a record only where a `branch ` line was seen —
// `git worktree list --porcelain` prints `detached` instead. Measured
// 2026-09-22 on the plot estate: 4 rows for 19 worktrees, and thirteen desks
// that were neither reaped, kept, counted nor named.
//
// The assertions here are the ones a naive fix passes without:
//
//   * THE ROW COUNT, not the content. A fix that handles detached trees but
//     still drops, say, prunable ones satisfies every verdict test while
//     leaving a population invisible. This is what catches "fixed the symptom
//     I measured".
//   * A DETACHED DESK WITH A LIVE PID IS KEPT. Without it the change is a
//     data-loss bug on exactly the population `--start` creates.
//   * A DESK IS JUDGED BY DETACHMENT, NEVER BY ITS NAME. Three `free-*` desks
//     on the estate hold a branch and two carry live workers, so a
//     prefix-keyed implementation reaps a running agent.
//   * A DETACHED DESK CARRYING COMMITS IS KEPT. The "nothing to land" reading
//     must not become "detached means disposable".
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const reap = path.join(here, '..', '..', 'skills', 'plot', 'scripts', 'plot-reap.sh');

/** The unit separator the worktree pipeline uses, as a value rather than a literal. */
const US = String.fromCharCode(31);

let tmp, repo, report;

const git = (cwd, ...args) => execFileSync('git', args, { encoding: 'utf8', cwd });

before(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-detached-'));
  const origin = path.join(tmp, 'origin.git');
  repo = path.join(tmp, 'repo');
  git(tmp, 'init', '--bare', '-q', '-b', 'main', origin);
  git(tmp, 'clone', '-q', origin, repo);
  git(repo, 'config', 'user.email', 'test@example.invalid');
  git(repo, 'config', 'user.name', 'Plot Test');
  git(repo, 'config', 'commit.gpgsign', 'false');

  fs.writeFileSync(
    path.join(repo, 'CLAUDE.md'),
    '## Plot Config\n\n- **Plan directory:** plans/\n- **Worktree root:** .worktrees\n',
  );
  // THE PID FILE MUST BE IGNORED, as it is in any repository Plot adopts
  // (`.gitignore:60` here). It is machine-local state the dispatcher writes,
  // and a sandbox without this rule reads every desk as carrying an
  // uncommitted change — so `uncommitted-changes` refuses before the reading
  // under test is ever reached. Measured in CI 2026-09-22: `free-idle` was
  // kept for `?? .plot-worker.pid` while the same test passed locally, where
  // the outer repository's own ignore rule happened to cover it.
  fs.writeFileSync(path.join(repo, '.gitignore'), '.plot-worker.pid\n');
  fs.mkdirSync(path.join(repo, 'plans'), { recursive: true });
  git(repo, 'add', '-A');
  git(repo, 'commit', '-qm', 'config');
  git(repo, 'push', '-q', 'origin', 'main');

  const wt = (name) => path.join(repo, '.worktrees', name);

  // A free desk: detached at origin/main, a dispatch tree by its pid file,
  // carrying no commits. Nothing to land.
  git(repo, 'worktree', 'add', '--detach', '-q', wt('free-idle'), 'origin/main');
  fs.writeFileSync(path.join(wt('free-idle'), '.plot-worker.pid'), '999999\n');

  // A free desk whose worker is ALIVE. `process.pid` is this test runner,
  // which is alive by construction — no sleep, no race.
  git(repo, 'worktree', 'add', '--detach', '-q', wt('free-live'), 'origin/main');
  fs.writeFileSync(path.join(wt('free-live'), '.plot-worker.pid'), `${process.pid}\n`);

  // A free desk carrying a commit. Detached, but somebody worked there.
  git(repo, 'worktree', 'add', '--detach', '-q', wt('free-busy'), 'origin/main');
  fs.writeFileSync(path.join(wt('free-busy'), '.plot-worker.pid'), '999998\n');
  fs.writeFileSync(path.join(wt('free-busy'), 'work.txt'), 'unlanded\n');
  git(wt('free-busy'), 'add', '-A');
  git(wt('free-busy'), 'commit', '-qm', 'work nobody has landed');

  // A desk NAMED like a free one that HOLDS A BRANCH with unlanded work.
  // A prefix-keyed implementation reaps this; a detachment-keyed one keeps it.
  git(repo, 'branch', 'feature/held', 'origin/main');
  git(repo, 'worktree', 'add', '-q', wt('free-holder'), 'feature/held');
  fs.writeFileSync(path.join(wt('free-holder'), '.plot-worker.pid'), '999997\n');
  fs.writeFileSync(path.join(wt('free-holder'), 'held.txt'), 'held\n');
  git(wt('free-holder'), 'add', '-A');
  git(wt('free-holder'), 'commit', '-qm', 'work on a real branch');

  const run = spawnSync('bash', [reap, '--dry-run'], {
    encoding: 'utf8',
    cwd: repo,
    env: { ...process.env, PLOT_UNATTENDED: '1' },
  });
  report = `${run.stdout}${run.stderr}`;
});

after(() => {
  if (tmp) fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 3 });
});

test('the awk emits one row per worktree, detached included', () => {
  // THE COUNT IS THE ASSERTION. Read through the same pipeline the scripts
  // use, so a regression in the guard fails here rather than in a verdict.
  const porcelain = git(repo, 'worktree', 'list', '--porcelain');
  const program = [
    '/^worktree /{ if (p != "") print p, br, pr; p=$2; br=""; pr="no"; next }',
    '/^branch /  { br=$2; next }',
    '/^prunable/ { pr="yes"; next }',
    'END         { if (p != "") print p, br, pr }',
  ].join('\n');
  const out = spawnSync('awk', ['-v', `OFS=${US}`, program], {
    input: porcelain,
    encoding: 'utf8',
  }).stdout.trim();
  const rows = out === '' ? [] : out.split('\n');

  const trees = git(repo, 'worktree', 'list').trim().split('\n').length;
  assert.equal(rows.length, trees, `awk emitted ${rows.length} rows for ${trees} worktrees`);
  assert.equal(trees, 5, 'the fixture builds the main checkout plus four desks');

  // Every row carries three fields even when the branch is empty — the bug
  // that made a detached desk read its `prunable` value as its branch name.
  for (const row of rows) {
    assert.equal(row.split(US).length, 3, `row lost a field: ${JSON.stringify(row)}`);
  }
});

test('a detached desk with nothing to land is reapable', () => {
  assert.match(report, /would.*free-idle/, `free-idle should be reapable\n${report}`);
});

test('a detached desk with a live worker is kept', () => {
  const line = report.split('\n').find((l) => l.includes('free-live'));
  assert.ok(line, `free-live must appear in the report\n${report}`);
  assert.match(line, /^keep/, `a live worker outranks every other reading: ${line}`);
  assert.match(line, /worker alive/);
});

test('a detached desk carrying commits is kept', () => {
  const line = report.split('\n').find((l) => l.includes('free-busy'));
  assert.ok(line, `free-busy must appear in the report\n${report}`);
  assert.match(line, /^keep/, `detached is not disposable: ${line}`);
});

test('a free-named desk holding a branch is judged by the branch', () => {
  // The prefix is not the test. This desk is named `free-*` and holds
  // `feature/held` with an unlanded commit, so it is kept for having no
  // merged PR — never reaped for being called free.
  const line = report.split('\n').find((l) => l.includes('feature/held'));
  assert.ok(line, `the holder must be named by its BRANCH\n${report}`);
  assert.match(line, /^keep/, `a prefix-keyed fix reaps a live branch: ${line}`);
  assert.doesNotMatch(
    report,
    /would.*free-holder/,
    'a desk holding unlanded work on a branch must never be reaped',
  );
});

test('a detached desk is labelled by its directory, not a blank column', () => {
  // The verdict was right and the column was empty, which names none of
  // thirteen for an operator reading the report.
  const line = report.split('\n').find((l) => l.includes('free-idle'));
  assert.match(line, /\(detached\)\s+free-idle/, `a detached desk needs a readable label: ${line}`);
});
