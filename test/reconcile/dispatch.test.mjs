// Contract test for skills/plot/scripts/plot-dispatch.sh — worktree fan-out.
//
// This is the one script in the fleet that WRITES: it creates worktrees, pushes
// claim refs, and starts workers. Everything it writes must therefore be either
// idempotent or refused, and `--dry-run` must show exactly what would happen
// without doing any of it. These tests hold that line.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const dispatch = path.join(here, '..', '..', 'skills', 'plot', 'scripts', 'plot-dispatch.sh');

let tmp, repo;

function git(cwd, ...args) {
  return execFileSync('git', args, { encoding: 'utf8', cwd });
}
function run(args, cwd = repo) {
  return execFileSync('bash', [dispatch, ...args], { encoding: 'utf8', cwd });
}

before(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-dispatch-'));
  const origin = path.join(tmp, 'origin.git');
  repo = path.join(tmp, 'repo');
  git(tmp, 'init', '--bare', '-q', '-b', 'main', origin);
  git(tmp, 'clone', '-q', origin, repo);
  git(repo, 'config', 'user.email', 'test@example.invalid');
  git(repo, 'config', 'user.name', 'Plot Test');
  git(repo, 'config', 'commit.gpgsign', 'false');

  fs.writeFileSync(path.join(repo, 'CLAUDE.md'),
    '## Plot Config\n\n- **Plan directory:** plans/\n- **Active index:** plans/active/\n');
  fs.mkdirSync(path.join(repo, 'plans', 'active'), { recursive: true });
  fs.writeFileSync(path.join(repo, 'plans', '2026-01-01-fan.md'), `# Fan-out plan

## Status

- **Phase:** Approved
- **Type:** feature
- **Impl:** own branches

## Branches

### Implementation
- \`feature/one\` — first
- \`feature/two\` — second
- \`feature/skipped\` — not needed <!-- deferred: folded in -->
`);
  fs.symlinkSync('../2026-01-01-fan.md', path.join(repo, 'plans', 'active', 'fan.md'));
  git(repo, 'add', '-A');
  git(repo, 'commit', '-qm', 'plan');
  git(repo, 'push', '-q', 'origin', 'main');
});

after(() => fs.rmSync(tmp, { recursive: true, force: true }));

test('dispatch: --dry-run lists eligible branches and creates nothing', () => {
  const out = run(['--dry-run', '--offline', 'fan']);
  assert.match(out, /feature\/one/);
  assert.match(out, /feature\/two/);
  // Deferred branches are never work.
  assert.doesNotMatch(out, /feature\/skipped/);

  // Nothing may exist yet: no worktrees, no refs, no working-tree changes.
  assert.equal(git(repo, 'worktree', 'list').trim().split('\n').length, 1);
  assert.equal(git(repo, 'ls-remote', '--heads', 'origin', 'feature/one').trim(), '');
  assert.equal(git(repo, 'status', '--porcelain').trim(), '');
});

test('dispatch: creates one worktree per eligible branch and claims each ref', () => {
  run(['--offline', '--no-start', 'fan']);

  const worktrees = git(repo, 'worktree', 'list');
  assert.match(worktrees, /plot-wt-feature-one/);
  assert.match(worktrees, /plot-wt-feature-two/);
  assert.doesNotMatch(worktrees, /plot-wt-feature-skipped/);

  // The claim is the pushed ref — it must be on the remote, not just local.
  assert.match(git(repo, 'ls-remote', '--heads', 'origin', 'feature/one'), /feature\/one/);
  assert.match(git(repo, 'ls-remote', '--heads', 'origin', 'feature/two'), /feature\/two/);
});

test('dispatch: is idempotent — a second run re-adopts, never duplicates', () => {
  // A dispatcher that dies mid-fan-out must be safe to re-run. Claimed
  // branches stay claimed; existing worktrees are reused, not recreated.
  const before = git(repo, 'worktree', 'list').trim().split('\n').length;
  const out = run(['--offline', '--no-start', 'fan']);
  const after = git(repo, 'worktree', 'list').trim().split('\n').length;
  assert.equal(after, before, 'worktree count must not grow on re-dispatch');
  assert.match(out, /(already|existing|reus)/i);
});

test('dispatch: a branch it cannot dispatch is skipped once, not forever', () => {
  // The loop re-asks --next after each claim (pull semantics). A branch that
  // CANNOT be dispatched is never claimed, so --next keeps returning it — the
  // first version span forever printing "skipped". Anything unskippable must
  // be remembered for the duration of the run.
  const blocked = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-blocked-'));
  const o = path.join(blocked, 'origin.git');
  const r = path.join(blocked, 'repo');
  git(blocked, 'init', '--bare', '-q', '-b', 'main', o);
  git(blocked, 'clone', '-q', o, r);
  git(r, 'config', 'user.email', 'test@example.invalid');
  git(r, 'config', 'user.name', 'Plot Test');
  git(r, 'config', 'commit.gpgsign', 'false');
  fs.mkdirSync(path.join(r, 'plans', 'active'), { recursive: true });
  fs.writeFileSync(path.join(r, 'CLAUDE.md'),
    '## Plot Config\n\n- **Plan directory:** plans/\n- **Active index:** plans/active/\n');
  fs.writeFileSync(path.join(r, 'plans', '2026-01-01-b.md'),
    '# B\n\n## Status\n\n- **Phase:** Approved\n\n## Branches\n\n- `feature/blocked` — one\n');
  fs.symlinkSync('../2026-01-01-b.md', path.join(r, 'plans', 'active', 'b.md'));
  git(r, 'add', '-A');
  git(r, 'commit', '-qm', 'plan');
  git(r, 'push', '-q', 'origin', 'main');

  // Occupy the worktree path with a non-worktree directory so creation fails.
  const wt = path.join(path.dirname(r), 'plot-wt-feature-blocked');
  fs.mkdirSync(wt, { recursive: true });
  fs.writeFileSync(path.join(wt, 'PREEXISTING'), 'not ours\n');

  const out = execFileSync('bash', [dispatch, '--offline', '--no-start', 'b'],
    { encoding: 'utf8', cwd: r, timeout: 20_000 });
  const skips = out.split('\n').filter((l) => /skipped feature\/blocked/.test(l));
  assert.equal(skips.length, 1, `must skip once, got ${skips.length}`);
  assert.match(out, /summary: /, 'must still reach the summary footer');

  // And it must not have touched the directory it did not create.
  assert.ok(fs.existsSync(path.join(wt, 'PREEXISTING')));
  fs.rmSync(blocked, { recursive: true, force: true });
  fs.rmSync(wt, { recursive: true, force: true });
});

// A plan in a given phase, in its own throwaway repo. Returns { repo, run }.
function repoWithPlan(statusBlock, label) {
  const t = fs.mkdtempSync(path.join(os.tmpdir(), `plot-gate-${label}-`));
  const o = path.join(t, 'origin.git');
  const r = path.join(t, 'repo');
  git(t, 'init', '--bare', '-q', '-b', 'main', o);
  git(t, 'clone', '-q', o, r);
  git(r, 'config', 'user.email', 'test@example.invalid');
  git(r, 'config', 'user.name', 'Plot Test');
  git(r, 'config', 'commit.gpgsign', 'false');
  fs.mkdirSync(path.join(r, 'plans', 'active'), { recursive: true });
  fs.writeFileSync(path.join(r, 'CLAUDE.md'),
    '## Plot Config\n\n- **Plan directory:** plans/\n- **Active index:** plans/active/\n');
  fs.writeFileSync(path.join(r, 'plans', '2026-01-01-g.md'),
    `# G\n\n## Status\n\n${statusBlock}\n\n## Branches\n\n- \`feature/g\` — one\n`);
  fs.symlinkSync('../2026-01-01-g.md', path.join(r, 'plans', 'active', 'g.md'));
  git(r, 'add', '-A');
  git(r, 'commit', '-qm', 'plan');
  git(r, 'push', '-q', 'origin', 'main');
  return { tmp: t, repo: r };
}

test('dispatch: refuses to fan out a Draft plan', () => {
  // The phase check must live in the SCRIPT, not only in the skill's prose.
  // Prose is a rule an agent can rationalise around, and calling the script
  // directly bypasses it entirely — this is the one place a user can do real
  // damage (branches and workers for an unapproved plan).
  const { tmp, repo: r } = repoWithPlan('- **Phase:** Draft', 'draft');
  let failed = false, stderr = '';
  try {
    execFileSync('bash', [dispatch, '--offline', '--no-start', 'g'],
      { encoding: 'utf8', cwd: r, timeout: 20_000 });
  } catch (e) {
    failed = true;
    stderr = String(e.stderr ?? '');
  }
  assert.ok(failed, 'must exit non-zero on a Draft plan');
  assert.match(stderr, /draft/i);
  assert.match(stderr, /plot-approve/, 'must say how to fix it, not just refuse');
  assert.equal(git(r, 'ls-remote', '--heads', 'origin', 'feature/g').trim(), '',
    'nothing may be claimed');
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('dispatch: fans out an Approved plan', () => {
  const { tmp, repo: r } = repoWithPlan('- **Phase:** Approved', 'approved');
  const out = execFileSync('bash', [dispatch, '--offline', '--no-start', 'g'],
    { encoding: 'utf8', cwd: r, timeout: 20_000 });
  assert.match(out, /dispatched feature\/g/);
  fs.rmSync(tmp, { recursive: true, force: true });
  fs.rmSync(path.join(path.dirname(r), 'plot-wt-feature-g'), { recursive: true, force: true });
});

test('dispatch: fails closed when the phase cannot be read', () => {
  // Unlike plot-phase-gate.sh (a PreToolUse hook, which must fail OPEN so a
  // broken gate never locks the repo), this is a command the user invoked.
  // If the phase is unreadable, starting several agents is the costly mistake
  // — so refuse. The damage is asymmetric, and so is the default.
  const { tmp, repo: r } = repoWithPlan('- **Type:** feature', 'nophase');
  let failed = false, stderr = '';
  try {
    execFileSync('bash', [dispatch, '--offline', '--no-start', 'g'],
      { encoding: 'utf8', cwd: r, timeout: 20_000 });
  } catch (e) {
    failed = true;
    stderr = String(e.stderr ?? '');
  }
  assert.ok(failed, 'must refuse rather than guess');
  assert.match(stderr, /phase/i);
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('dispatch: --dry-run is also gated', () => {
  // A dry run creates nothing, but reporting "would dispatch 6 branches" for a
  // Draft plan is itself misleading — it reads as permission.
  const { tmp, repo: r } = repoWithPlan('- **Phase:** Draft', 'dryrun');
  let failed = false;
  try {
    execFileSync('bash', [dispatch, '--offline', '--dry-run', 'g'],
      { encoding: 'utf8', cwd: r, timeout: 20_000 });
  } catch {
    failed = true;
  }
  assert.ok(failed, '--dry-run must respect the phase gate too');
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('dispatch: refuses a plan whose work is not on its own branches', () => {
  // Fan-out is meaningless for same-branch / other-repo / none. The message
  // must name the recorded answer, so the user learns why rather than just
  // being blocked.
  for (const [impl, expect] of [
    ['same branch', /same branch/i],
    ['other repo', /other repo/i],
    ['none', /nothing to implement/i],
  ]) {
    const { tmp, repo: r } = repoWithPlan(
      `- **Phase:** Approved\n- **Impl:** ${impl}`, `impl-${impl.replace(/\W/g, '')}`);
    let failed = false, stderr = '';
    try {
      execFileSync('bash', [dispatch, '--offline', '--no-start', 'g'],
        { encoding: 'utf8', cwd: r, timeout: 20_000 });
    } catch (e) {
      failed = true;
      stderr = String(e.stderr ?? '');
    }
    assert.ok(failed, `Impl: ${impl} must be refused`);
    assert.match(stderr, expect);
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('dispatch: a pre-Plot-2 plan with no Impl answer still dispatches', () => {
  // Plans predating the ceremony questions never recorded an answer. Refusing
  // them would break existing repos on upgrade.
  const { tmp, repo: r } = repoWithPlan('- **Phase:** Approved', 'noimpl');
  const out = execFileSync('bash', [dispatch, '--offline', '--no-start', 'g'],
    { encoding: 'utf8', cwd: r, timeout: 20_000 });
  assert.match(out, /dispatched feature\/g/);
  fs.rmSync(tmp, { recursive: true, force: true });
  fs.rmSync(path.join(path.dirname(r), 'plot-wt-feature-g'), { recursive: true, force: true });
});

test('dispatch: refuses to run outside a git repository', () => {
  const notRepo = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-not-repo-'));
  let failed = false;
  try {
    run(['--dry-run', 'fan'], notRepo);
  } catch (e) {
    failed = true;
    assert.match(String(e.stderr ?? ''), /not a git repository/i);
  }
  assert.ok(failed, 'must exit non-zero outside a repo');
  fs.rmSync(notRepo, { recursive: true, force: true });
});

test('dispatch: --status reports each worktree, its pid, and whether it lives', () => {
  // Detached workers are invisible without this: a user could otherwise only
  // read .plot-worker.log and the pid file by hand, and could not tell a
  // working worker from a dead one at all.
  const { tmp, repo: r } = repoWithPlan('- **Phase:** Approved', 'status');
  execFileSync('bash', [dispatch, '--offline', '--no-start', 'g'],
    { encoding: 'utf8', cwd: r, timeout: 20_000 });

  const out = execFileSync('bash', [dispatch, '--status', 'g'],
    { encoding: 'utf8', cwd: r, timeout: 20_000 });
  assert.match(out, /feature\/g/);
  assert.match(out, /plot-wt-feature-g/);
  // --no-start means no worker was started; that must read as "no worker",
  // not as a dead one — the difference matters when deciding to reap.
  assert.match(out, /no worker/i);
  assert.match(out, /summary: /);

  fs.rmSync(tmp, { recursive: true, force: true });
  fs.rmSync(path.join(path.dirname(r), 'plot-wt-feature-g'), { recursive: true, force: true });
});

test('dispatch: --status distinguishes a live worker from a dead one', () => {
  const { tmp, repo: r } = repoWithPlan('- **Phase:** Approved', 'alive');
  execFileSync('bash', [dispatch, '--offline', '--no-start', 'g'],
    { encoding: 'utf8', cwd: r, timeout: 20_000 });
  const wt = path.join(path.dirname(r), 'plot-wt-feature-g');

  // An impossible-but-well-formed pid. Not 0: `kill -0 0` signals the caller's
  // whole process group and succeeds, so 0 reads as running.
  fs.writeFileSync(path.join(wt, '.plot-worker.pid'), '2147483646\n');
  fs.writeFileSync(path.join(wt, '.plot-worker.log'), 'started\nlast line here\n');
  const dead = execFileSync('bash', [dispatch, '--status', 'g'],
    { encoding: 'utf8', cwd: r, timeout: 20_000 });
  // No exit file, process gone: "ended (status unknown)". Deliberately not
  // "dead" — that reads as a crash, and a completed worker looked crashed.
  assert.match(dead, /ended|not running/i);
  assert.doesNotMatch(dead, /running \d/, 'a gone process must not read as running');
  assert.match(dead, /last line here/, 'must surface the last log line for triage');

  // Our own pid is certainly alive.
  fs.writeFileSync(path.join(wt, '.plot-worker.pid'), `${process.pid}\n`);
  const live = execFileSync('bash', [dispatch, '--status', 'g'],
    { encoding: 'utf8', cwd: r, timeout: 20_000 });
  assert.match(live, /running/i);

  fs.rmSync(tmp, { recursive: true, force: true });
  fs.rmSync(wt, { recursive: true, force: true });
});

test('dispatch: --stop refuses without a branch and never kills everything', () => {
  // A --stop that could take no argument and mean "all" is one fat-finger away
  // from killing a whole fleet.
  const { tmp, repo: r } = repoWithPlan('- **Phase:** Approved', 'stop');
  let failed = false, stderr = '';
  try {
    execFileSync('bash', [dispatch, '--stop', 'g'], { encoding: 'utf8', cwd: r, timeout: 20_000 });
  } catch (e) {
    failed = true;
    stderr = String(e.stderr ?? '');
  }
  assert.ok(failed, '--stop must require an explicit branch');
  assert.match(stderr, /branch/i);
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('dispatch: branches sharing a last segment get distinct worktrees', () => {
  // `feature/api` and `bug/api` both end in "api", so a worktree named after
  // the last segment alone collides: the second branch adopts the FIRST one's
  // worktree, and `--stop bug/api` would stop the wrong worker.
  const t = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-suffix-'));
  const o = path.join(t, 'origin.git');
  const r = path.join(t, 'repo');
  git(t, 'init', '--bare', '-q', '-b', 'main', o);
  git(t, 'clone', '-q', o, 'repo');
  git(r, 'config', 'user.email', 'test@example.invalid');
  git(r, 'config', 'user.name', 'Plot Test');
  git(r, 'config', 'commit.gpgsign', 'false');
  fs.mkdirSync(path.join(r, 'plans', 'active'), { recursive: true });
  fs.writeFileSync(path.join(r, 'CLAUDE.md'),
    '## Plot Config\n\n- **Plan directory:** plans/\n- **Active index:** plans/active/\n');
  fs.writeFileSync(path.join(r, 'plans', '2026-01-01-s.md'),
    '# S\n\n## Status\n\n- **Phase:** Approved\n- **Impl:** own branches\n\n## Branches\n\n- `feature/api` — one\n- `bug/api` — a different thing entirely\n');
  fs.symlinkSync('../2026-01-01-s.md', path.join(r, 'plans', 'active', 's.md'));
  git(r, 'add', '-A');
  git(r, 'commit', '-qm', 'plan');
  git(r, 'push', '-q', 'origin', 'main');

  const out = execFileSync('bash', [dispatch, '--offline', '--no-start', 's'],
    { encoding: 'utf8', cwd: r, timeout: 30_000 });
  assert.match(out, /dispatched feature\/api/);
  assert.match(out, /dispatched bug\/api/, 'the second branch must get its own worktree');

  const worktrees = git(r, 'worktree', 'list');
  const paths = worktrees.trim().split('\n').slice(1).map((l) => l.split(' ')[0]);
  assert.equal(new Set(paths).size, paths.length, 'worktree paths must be unique');

  for (const p of paths) fs.rmSync(p, { recursive: true, force: true });
  fs.rmSync(t, { recursive: true, force: true });
});

test('dispatch: --max rejects a non-numeric value', () => {
  // Reverting this guard left the suite fully green, so nothing pinned it.
  // Without validation `--max abc` reaches arithmetic on a string.
  const { tmp: t, repo: r } = repoWithPlan('- **Phase:** Approved', 'maxguard');
  let failed = false, stderr = '';
  try {
    execFileSync('bash', [dispatch, '--offline', '--no-start', '--max', 'abc', 'g'],
      { encoding: 'utf8', cwd: r, timeout: 20_000 });
  } catch (e) {
    failed = true;
    stderr = String(e.stderr ?? '');
  }
  assert.ok(failed, '--max must reject a non-number');
  assert.match(stderr, /--max needs a number/);
  fs.rmSync(t, { recursive: true, force: true });
});

test('dispatch: --status tells a finished worker from a crashed one', () => {
  // Found by actually running a worker rather than testing with --no-start:
  // a worker that completed its job was reported as "dead", which reads as a
  // crash. `kill -0` can only distinguish running from not-running, so the
  // exit status has to be recorded when the process ends or the information
  // is gone.
  const { tmp: t, repo: r } = repoWithPlan('- **Phase:** Approved', 'exit');
  execFileSync('bash', [dispatch, '--offline', '--no-start', 'g'],
    { encoding: 'utf8', cwd: r, timeout: 20_000 });
  const wt = path.join(path.dirname(r), 'plot-wt-feature-g');

  // Assert on the branch's OWN line. The summary footer contains every state
  // word ("finished=0 failed=0 …"), so a regex over the whole report matches
  // the counter rather than the verdict.
  const status = () => {
    const out = execFileSync('bash', [dispatch, '--status', 'g'],
      { encoding: 'utf8', cwd: r, timeout: 20_000 });
    return out.split('\n').find((l) => l.includes('feature/g')) ?? '';
  };

  // Finished cleanly: exit code 0 recorded, process gone.
  fs.writeFileSync(path.join(wt, '.plot-worker.pid'), '2147483646\n');
  fs.writeFileSync(path.join(wt, '.plot-worker.exit'), '0\n');
  const done = status();
  assert.match(done, /finished/i, 'a clean exit must not read as a crash');
  assert.doesNotMatch(done, /dead|crash/i);

  // Failed: non-zero exit recorded.
  fs.writeFileSync(path.join(wt, '.plot-worker.exit'), '3\n');
  assert.match(status(), /failed.*3|exit 3/i, 'a non-zero exit must say so, with the code');

  // No exit file at all — a worker from before this existed, or one killed
  // outright. Unknown is its own state; do not guess "finished".
  fs.rmSync(path.join(wt, '.plot-worker.exit'));
  const unknown = status();
  assert.doesNotMatch(unknown, /finished/i);

  // Still running.
  fs.writeFileSync(path.join(wt, '.plot-worker.pid'), `${process.pid}\n`);
  assert.match(status(), /running/i);

  fs.rmSync(t, { recursive: true, force: true });
  fs.rmSync(wt, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// The `Started:` booking
// ---------------------------------------------------------------------------
//
// Dispatch starts real work, so it must record that it did — and record it
// WHERE THE BOARD LOOKS. The board reads the plan from the DEFAULT BRANCH,
// while plot-dispatch.sh finds the plan in its local working tree on whatever
// branch the dispatcher is standing on. Appending to the local file would book
// the start somewhere nobody reads, which is why every assertion below reads
// the plan back out of `origin/main` rather than off disk.
//
// Tested against a LOCAL BARE REMOTE, never a real host: a push has to
// genuinely succeed and genuinely fail for any of this to mean anything, and
// CI cannot reach a host.

/** A repo whose bare remote refuses (or accepts) pushes to main. */
function repoForBooking(label, { refuseMain = false } = {}) {
  const t = fs.mkdtempSync(path.join(os.tmpdir(), `plot-started-${label}-`));
  const o = path.join(t, 'origin.git');
  const r = path.join(t, 'repo');
  git(t, 'init', '--bare', '-q', '-b', 'main', o);
  git(t, 'clone', '-q', o, r);
  git(r, 'config', 'user.email', 'test@example.invalid');
  git(r, 'config', 'user.name', 'Plot Test');
  git(r, 'config', 'commit.gpgsign', 'false');
  fs.mkdirSync(path.join(r, 'plans', 'active'), { recursive: true });
  fs.writeFileSync(path.join(r, 'CLAUDE.md'),
    '## Plot Config\n\n- **Plan directory:** plans/\n- **Active index:** plans/active/\n');
  fs.writeFileSync(path.join(r, 'plans', '2026-01-01-s.md'),
    '# S\n\n## Status\n\n- **Phase:** Approved\n- **Impl:** own branches\n'
    + '- **Approved:** 2026-01-01, alice, in-session\n\n## Branches\n\n- `feature/s` — one\n');
  fs.symlinkSync('../2026-01-01-s.md', path.join(r, 'plans', 'active', 's.md'));
  git(r, 'add', '-A');
  git(r, 'commit', '-qm', 'plan');
  git(r, 'push', '-q', 'origin', 'main');

  if (refuseMain) {
    // Refuse only main. Claim pushes go to feature refs and must still pass —
    // otherwise this would test "nothing works", not "the booking failed".
    const hook = path.join(o, 'hooks', 'pre-receive');
    fs.writeFileSync(hook,
      '#!/bin/sh\nwhile read old new ref; do\n'
      + '  case "$ref" in refs/heads/main) echo "refusing main" >&2; exit 1 ;; esac\n'
      + 'done\nexit 0\n');
    fs.chmodSync(hook, 0o755);
  }
  return { tmp: t, repo: r, planOnMain: () => {
    git(r, 'fetch', '-q', 'origin', 'main');
    return git(r, 'show', 'origin/main:plans/2026-01-01-s.md');
  } };
}

test('dispatch: records Started: on the default branch, not the local tree', () => {
  // The naive implementation appends to the plan file in the working tree.
  // That commits the record to whatever branch the dispatcher stands on, and
  // the board — which reads the default branch — never sees it. This had to be
  // back-filled by hand twice on this repo on 2026-08-16.
  const { tmp: t, repo: r, planOnMain } = repoForBooking('lands');
  const out = execFileSync('bash', [dispatch, '--offline', '--no-start', 's'],
    { encoding: 'utf8', cwd: r, timeout: 30_000 });
  assert.match(out, /dispatched feature\/s/);

  const onMain = planOnMain();
  assert.match(onMain, /- \*\*Started:\*\* \d{4}-\d{2}-\d{2}, .+, `feature\/s`/,
    `the record must be on the default branch, in /plot-implement's shape:\n${onMain}`);

  // It must land inside `## Status` — plot-plan-meta.sh reads the records from
  // there, so a line appended at the end of the document parses as nothing.
  const status = onMain.split(/^## /m).find((s) => s.startsWith('Status')) ?? '';
  assert.match(status, /Started:/, `Started: must be inside ## Status:\n${onMain}`);

  // And the dispatcher's own checkout must be untouched: it may hold the
  // user's uncommitted work, and switching it out to save a note would be the
  // kind of write this script otherwise refuses.
  assert.equal(git(r, 'status', '--porcelain').trim(), '');
  assert.doesNotMatch(fs.readFileSync(path.join(r, 'plans', '2026-01-01-s.md'), 'utf8'),
    /Started:/, 'the local working-tree copy must not be edited');

  // The disposable booking branch is disposable: gone locally and remotely.
  assert.doesNotMatch(git(r, 'branch', '-a'), /plot\/start-/);
  assert.equal(git(r, 'ls-remote', '--heads', 'origin', 'plot/start-s').trim(), '');

  fs.rmSync(t, { recursive: true, force: true });
  fs.rmSync(path.join(path.dirname(r), 'plot-wt-feature-s'), { recursive: true, force: true });
});

test('dispatch: a failed booking leaves the fan-out standing', () => {
  // THE ASSERTION THAT MATTERS. By the time the booking runs, the worktree
  // exists and the claim is pushed — those are the real state, and the record
  // is only a report about them. Rolling back real work because a note could
  // not be saved is the larger damage, and aborting mid-fan-out leaves exactly
  // the inconsistency the record exists to prevent. Every other test here can
  // pass while this damage happens.
  const { tmp: t, repo: r, planOnMain } = repoForBooking('refused', { refuseMain: true });

  // Must not throw: a refused booking is not a failed dispatch.
  const out = execFileSync('bash', [dispatch, '--offline', '--no-start', 's'],
    { encoding: 'utf8', cwd: r, timeout: 30_000, stdio: ['ignore', 'pipe', 'pipe'] });

  assert.match(out, /dispatched feature\/s/, 'the fan-out must still be reported');
  assert.match(out, /summary: dispatched=1/, 'the summary must still report what it dispatched');

  // The claim is on the remote and the worktree is on disk — the real state.
  assert.match(git(r, 'ls-remote', '--heads', 'origin', 'feature/s'), /feature\/s/,
    'the claim must survive a failed booking');
  assert.match(git(r, 'worktree', 'list'), /plot-wt-feature-s/,
    'the worktree must survive a failed booking');

  // And it must say so rather than failing silently.
  assert.match(out, /Started:.*(not|could not)/i,
    `the failure must be reported, not swallowed:\n${out}`);

  // No half-written record on main.
  assert.doesNotMatch(planOnMain(), /Started:/);

  fs.rmSync(t, { recursive: true, force: true });
  fs.rmSync(path.join(path.dirname(r), 'plot-wt-feature-s'), { recursive: true, force: true });
});

test('dispatch: --dry-run writes no branch, no commit and no push', () => {
  // This is the first write --dry-run has had to suppress that LEAVES THE
  // REPOSITORY, so it is pinned with a test rather than a comment. An earlier
  // dry-run test covers worktrees and claims; this one covers the booking.
  const { tmp: t, repo: r, planOnMain } = repoForBooking('dryrun');
  const head = git(r, 'rev-parse', 'origin/main').trim();

  const out = execFileSync('bash', [dispatch, '--offline', '--dry-run', 's'],
    { encoding: 'utf8', cwd: r, timeout: 30_000 });
  assert.match(out, /would dispatch feature\/s/);

  git(r, 'fetch', '-q', 'origin', 'main');
  assert.equal(git(r, 'rev-parse', 'origin/main').trim(), head,
    'the default branch must not have moved');
  assert.doesNotMatch(planOnMain(), /Started:/, 'no record may be written');
  assert.doesNotMatch(git(r, 'branch', '-a'), /plot\/start-/, 'no booking branch');
  assert.equal(git(r, 'ls-remote', '--heads', 'origin', 'plot/start-s').trim(), '',
    'nothing may be pushed');
  assert.equal(git(r, 'status', '--porcelain').trim(), '', 'no working-tree change');

  fs.rmSync(t, { recursive: true, force: true });
});

test('dispatch: re-dispatch does not re-record a branch it only re-adopted', () => {
  // Re-running a dispatch is safe by design (worktrees are adopted, claims
  // stay claimed). The record must inherit that: a second run books nothing,
  // or a plan re-dispatched three times would read as started three times and
  // the count would drift from the refs it is supposed to describe.
  const { tmp: t, repo: r, planOnMain } = repoForBooking('idempotent');
  execFileSync('bash', [dispatch, '--offline', '--no-start', 's'],
    { encoding: 'utf8', cwd: r, timeout: 30_000 });
  const first = (planOnMain().match(/Started:/g) ?? []).length;
  assert.equal(first, 1, 'the first run records exactly one start');

  execFileSync('bash', [dispatch, '--offline', '--no-start', 's'],
    { encoding: 'utf8', cwd: r, timeout: 30_000 });
  const second = (planOnMain().match(/Started:/g) ?? []).length;
  assert.equal(second, 1, `a re-adopted branch must not be recorded again:\n${planOnMain()}`);

  fs.rmSync(t, { recursive: true, force: true });
  fs.rmSync(path.join(path.dirname(r), 'plot-wt-feature-s'), { recursive: true, force: true });
});

test('dispatch: a plan with no ## Status section is refused, not appended to', () => {
  // plot-plan-meta.sh reads Started: records out of `## Status`. A line placed
  // anywhere else parses as nothing — a record that exists on disk and not in
  // the data, which is worse than no record because it looks written. So a
  // malformed plan is a refusal with a reason, not a best-effort append.
  //
  // Reachable in practice: the phase gate reads the phase from front matter
  // too, so a front-matter plan passes the gate with no `## Status` heading.
  const t = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-nostatus-'));
  const o = path.join(t, 'origin.git');
  const r = path.join(t, 'repo');
  git(t, 'init', '--bare', '-q', '-b', 'main', o);
  git(t, 'clone', '-q', o, r);
  git(r, 'config', 'user.email', 'test@example.invalid');
  git(r, 'config', 'user.name', 'Plot Test');
  git(r, 'config', 'commit.gpgsign', 'false');
  fs.mkdirSync(path.join(r, 'plans', 'active'), { recursive: true });
  fs.writeFileSync(path.join(r, 'CLAUDE.md'),
    '## Plot Config\n\n- **Plan directory:** plans/\n- **Active index:** plans/active/\n');
  fs.writeFileSync(path.join(r, 'plans', '2026-01-01-n.md'),
    '---\nphase: Approved\nimpl: own branches\n---\n\n# N\n\n## Branches\n\n- `feature/n` — one\n');
  fs.symlinkSync('../2026-01-01-n.md', path.join(r, 'plans', 'active', 'n.md'));
  git(r, 'add', '-A');
  git(r, 'commit', '-qm', 'plan');
  git(r, 'push', '-q', 'origin', 'main');

  const out = execFileSync('bash', [dispatch, '--offline', '--no-start', 'n'],
    { encoding: 'utf8', cwd: r, timeout: 30_000 });

  // The fan-out still stands — a malformed plan is not a reason to unwind work.
  assert.match(out, /dispatched feature\/n/);
  assert.match(out, /Started:.*(not|could not)/i, `must report the missing record:\n${out}`);

  // And nothing may have been smuggled onto main outside `## Status`.
  git(r, 'fetch', '-q', 'origin', 'main');
  assert.doesNotMatch(git(r, 'show', 'origin/main:plans/2026-01-01-n.md'), /Started:/);

  fs.rmSync(t, { recursive: true, force: true });
  fs.rmSync(path.join(path.dirname(r), 'plot-wt-feature-n'), { recursive: true, force: true });
});

test('dispatch: a real worker that exits records its status', () => {
  // Every other test uses --no-start, which is exactly why the original bug
  // survived: with no worker ever run, nothing exercised the exit-recording
  // wrapper. This one starts a real process.
  //
  // Two traps this pins: a `Worker command` ending in `exit N` would kill the
  // wrapper shell before the code was written (hence the subshell), and the
  // exit-file path travels as an env var so no quoting level mangles it.
  const t = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-realworker-'));
  const o = path.join(t, 'origin.git');
  const r = path.join(t, 'repo');
  git(t, 'init', '--bare', '-q', '-b', 'main', o);
  git(t, 'clone', '-q', o, 'repo');
  git(r, 'config', 'user.email', 'test@example.invalid');
  git(r, 'config', 'user.name', 'Plot Test');
  git(r, 'config', 'commit.gpgsign', 'false');
  fs.mkdirSync(path.join(r, 'plans', 'active'), { recursive: true });
  fs.writeFileSync(path.join(r, 'CLAUDE.md'),
    '## Plot Config\n\n- **Plan directory:** plans/\n- **Active index:** plans/active/\n'
    + '- **Worker command:** echo ran; exit 0\n');
  fs.writeFileSync(path.join(r, 'plans', '2026-01-01-w.md'),
    '# W\n\n## Status\n\n- **Phase:** Approved\n- **Impl:** own branches\n\n## Branches\n\n- `feature/real` — one\n');
  fs.symlinkSync('../2026-01-01-w.md', path.join(r, 'plans', 'active', 'w.md'));
  git(r, 'add', '-A');
  git(r, 'commit', '-qm', 'plan');
  git(r, 'push', '-q', 'origin', 'main');

  execFileSync('bash', [dispatch, '--offline', 'w'],
    { encoding: 'utf8', cwd: r, timeout: 30_000 });

  const wt = path.join(path.dirname(r), 'plot-wt-feature-real');
  // Give the detached worker a moment; it only echoes and exits.
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline && !fs.existsSync(path.join(wt, '.plot-worker.exit'))) {
    execFileSync('sleep', ['0.2']);
  }
  assert.ok(fs.existsSync(path.join(wt, '.plot-worker.exit')),
    'the wrapper must record an exit code even when the command calls exit');
  assert.equal(fs.readFileSync(path.join(wt, '.plot-worker.exit'), 'utf8').trim(), '0');

  const line = execFileSync('bash', [dispatch, '--status', 'w'], { encoding: 'utf8', cwd: r })
    .split('\n').find((l) => l.includes('feature/real')) ?? '';
  assert.match(line, /finished/, `a clean exit must read as finished, got: ${line}`);

  fs.rmSync(t, { recursive: true, force: true });
  fs.rmSync(wt, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// The work-in-flight report
// ---------------------------------------------------------------------------
//
// Waves are a WITHIN-PLAN ordering. A correctly eligible branch can still name
// a file an agent has open on a different plan's branch, and nothing in the
// wave model represents that. Dispatch therefore reports which branches already
// hold which files — measured from LOCAL refs and worktrees, because the
// collision that blocked a dispatch on 2026-08-16 lived in an unpushed commit
// and uncommitted work is invisible to refs entirely.
//
// It REPORTS and refuses nothing: nothing on the candidate side is predicted,
// so there is no prediction worth acting on. Every assertion below exists
// because a weaker implementation passes without it.

/**
 * A repo with a two-branch plan, plus a helper to plant work in flight on a
 * branch of any name (including one from a different plan entirely).
 */
function repoWithInFlight(label) {
  const t = fs.mkdtempSync(path.join(os.tmpdir(), `plot-inflight-${label}-`));
  const o = path.join(t, 'origin.git');
  const r = path.join(t, 'repo');
  git(t, 'init', '--bare', '-q', '-b', 'main', o);
  git(t, 'clone', '-q', o, r);
  git(r, 'config', 'user.email', 'test@example.invalid');
  git(r, 'config', 'user.name', 'Plot Test');
  git(r, 'config', 'commit.gpgsign', 'false');
  fs.mkdirSync(path.join(r, 'plans', 'active'), { recursive: true });
  fs.writeFileSync(path.join(r, 'CLAUDE.md'),
    '## Plot Config\n\n- **Plan directory:** plans/\n- **Active index:** plans/active/\n');
  fs.writeFileSync(path.join(r, 'plans', '2026-01-01-f.md'),
    '# F\n\n## Status\n\n- **Phase:** Approved\n- **Impl:** own branches\n'
    + '\n## Branches\n\n- `feature/candidate` — the one being dispatched\n');
  fs.symlinkSync('../2026-01-01-f.md', path.join(r, 'plans', 'active', 'f.md'));
  git(r, 'add', '-A');
  git(r, 'commit', '-qm', 'plan');
  git(r, 'push', '-q', 'origin', 'main');

  const worktrees = [];

  /** A branch with a worktree, holding `files` in a COMMIT that is never pushed. */
  function committedWork(branch, files) {
    const wt = path.join(path.dirname(r), `plot-wt-${branch.replace(/\//g, '-')}`);
    git(r, 'worktree', 'add', '-q', '-b', branch, wt, 'origin/main');
    git(wt, 'config', 'user.email', 'test@example.invalid');
    git(wt, 'config', 'user.name', 'Plot Test');
    git(wt, 'config', 'commit.gpgsign', 'false');
    for (const [f, body] of Object.entries(files)) {
      fs.mkdirSync(path.dirname(path.join(wt, f)), { recursive: true });
      fs.writeFileSync(path.join(wt, f), body);
    }
    git(wt, 'add', '-A');
    git(wt, 'commit', '-qm', `work on ${branch}`);
    worktrees.push(wt);
    return wt;
  }

  /** A branch with a worktree holding `files` UNCOMMITTED — no ref carries these. */
  function uncommittedWork(branch, files) {
    const wt = path.join(path.dirname(r), `plot-wt-${branch.replace(/\//g, '-')}`);
    git(r, 'worktree', 'add', '-q', '-b', branch, wt, 'origin/main');
    for (const [f, body] of Object.entries(files)) {
      fs.mkdirSync(path.dirname(path.join(wt, f)), { recursive: true });
      fs.writeFileSync(path.join(wt, f), body);
    }
    worktrees.push(wt);
    return wt;
  }

  /** A branch claimed but holding nothing: an EMPTY commit, like a real claim. */
  function bareClaim(branch) {
    const wt = path.join(path.dirname(r), `plot-wt-${branch.replace(/\//g, '-')}`);
    git(r, 'worktree', 'add', '-q', '-b', branch, wt, 'origin/main');
    git(wt, 'config', 'user.email', 'test@example.invalid');
    git(wt, 'config', 'user.name', 'Plot Test');
    git(wt, 'config', 'commit.gpgsign', 'false');
    git(wt, 'commit', '-q', '--allow-empty', '-m', `plot: claim ${branch}`);
    worktrees.push(wt);
    return wt;
  }

  function cleanup() {
    for (const wt of worktrees) fs.rmSync(wt, { recursive: true, force: true });
    fs.rmSync(path.join(path.dirname(r), 'plot-wt-feature-candidate'),
      { recursive: true, force: true });
    fs.rmSync(t, { recursive: true, force: true });
  }

  return { tmp: t, repo: r, committedWork, uncommittedWork, bareClaim, cleanup };
}

test('dispatch: reports files held in an UNPUSHED commit', () => {
  // THE EXACT CASE FROM 2026-08-16: committed, clean worktree, the remote ref
  // holding only the claim. An implementation reading `origin/*` reports
  // nothing here and passes every looser test in this file.
  const f = repoWithInFlight('unpushed');
  f.committedWork('bug/other-plan', { 'App.tsx': 'x\n', 'AgentList.tsx': 'y\n' });

  // Prove the premise: the work exists on no remote ref.
  assert.equal(git(f.repo, 'ls-remote', '--heads', 'origin', 'bug/other-plan').trim(), '',
    'the fixture must keep the work unpushed, or this tests nothing');

  const out = execFileSync('bash', [dispatch, '--offline', '--dry-run', 'f'],
    { encoding: 'utf8', cwd: f.repo, timeout: 30_000 });

  assert.match(out, /in flight: bug\/other-plan holds/,
    `unpushed work must be reported:\n${out}`);
  assert.match(out, /App\.tsx/, `the held file must be named:\n${out}`);
  assert.match(out, /AgentList\.tsx/, `every held file must be named:\n${out}`);
  f.cleanup();
});

test('dispatch: reports files held UNCOMMITTED in a worktree', () => {
  // No ref holds these at all, so this fails against any implementation built
  // on refs alone — including one that correctly reads LOCAL refs.
  const f = repoWithInFlight('uncommitted');
  f.uncommittedWork('bug/editing-now', { 'Sidebar.tsx': 'in progress\n' });

  // Prove the premise: the branch carries no commit of its own.
  assert.equal(
    git(f.repo, 'rev-list', '--count', 'origin/main..bug/editing-now').trim(), '0',
    'the fixture must keep the work uncommitted, or this tests nothing');

  const out = execFileSync('bash', [dispatch, '--offline', '--dry-run', 'f'],
    { encoding: 'utf8', cwd: f.repo, timeout: 30_000 });

  assert.match(out, /in flight: bug\/editing-now holds/,
    `uncommitted work must be reported:\n${out}`);
  assert.match(out, /Sidebar\.tsx/, `the held file must be named:\n${out}`);
  f.cleanup();
});

test('dispatch: reports nothing when nothing is in flight', () => {
  // A report that always prints something teaches the reader to skip it, and
  // then it is worth nothing on the day it matters.
  //
  // The fixture carries a branch that EXISTS and holds nothing — a bare claim,
  // which is an empty commit. Without it the loop has no branch to reach the
  // empty-files check at all and this passes for the wrong reason: an
  // implementation printing "holds (nothing)" for every claimed branch would
  // still go green, and that is the exact noise being guarded against.
  const f = repoWithInFlight('quiet');
  f.bareClaim('bug/just-claimed');

  const out = execFileSync('bash', [dispatch, '--offline', '--dry-run', 'f'],
    { encoding: 'utf8', cwd: f.repo, timeout: 30_000 });

  assert.match(out, /would dispatch feature\/candidate/, 'the candidate is still listed');
  assert.doesNotMatch(out, /in flight/,
    `nothing is held, so nothing may be reported:\n${out}`);
  assert.doesNotMatch(out, /just-claimed/,
    `an empty claim holds no files and must stay silent:\n${out}`);
  f.cleanup();
});

test('dispatch: still starts everything — the report refuses nothing', () => {
  // An earlier draft of this plan had dispatch SKIP a colliding candidate.
  // That only makes sense with a prediction worth trusting, and there is none:
  // a skip built on this measurement alone would block the pairs that ran fine.
  const f = repoWithInFlight('refusenothing');
  f.committedWork('bug/other-plan', { 'App.tsx': 'x\n' });

  const out = execFileSync('bash', [dispatch, '--offline', '--no-start', 'f'],
    { encoding: 'utf8', cwd: f.repo, timeout: 30_000 });

  assert.match(out, /in flight: bug\/other-plan holds/, 'it must still report');
  assert.match(out, /^dispatched feature\/candidate/m,
    `and it must still dispatch:\n${out}`);
  assert.match(out, /summary: dispatched=1/, 'the summary must count it as dispatched');
  assert.doesNotMatch(out, /skipped feature\/candidate/, 'nothing may be refused');

  // The real state, not just the words: the claim is pushed and the worktree exists.
  assert.match(git(f.repo, 'ls-remote', '--heads', 'origin', 'feature/candidate'),
    /feature\/candidate/, 'the branch must be claimed despite the report');
  assert.match(git(f.repo, 'worktree', 'list'), /plot-wt-feature-candidate/);
  f.cleanup();
});

test('dispatch: consults no candidate-side prediction', () => {
  // The two rejected drafts — a `merge-tree` comparison against a branch that
  // does not yet exist, and a `Touches:` self-declaration in the plan — both
  // pass a loose test. This one fails against either: the report must be
  // byte-identical whether or not the plan describes the candidate's files.
  const bare = repoWithInFlight('nopredict-bare');
  bare.committedWork('bug/other-plan', { 'App.tsx': 'x\n' });
  const withoutDecl = execFileSync('bash', [dispatch, '--offline', '--dry-run', 'f'],
    { encoding: 'utf8', cwd: bare.repo, timeout: 30_000 });

  const declared = repoWithInFlight('nopredict-declared');
  declared.committedWork('bug/other-plan', { 'App.tsx': 'x\n' });
  // Describe the candidate's files as loudly as any rejected design would have:
  // a Touches: field, a scope-guard glob, and the colliding path spelled out.
  const plan = path.join(declared.repo, 'plans', '2026-01-01-f.md');
  fs.writeFileSync(plan, fs.readFileSync(plan, 'utf8').replace(
    '- `feature/candidate` — the one being dispatched\n',
    '- `feature/candidate` — the one being dispatched\n'
    + '  - Touches: `App.tsx`, `AgentList.tsx`\n'
    + '  - Scope guard: `**`\n'));
  git(declared.repo, 'add', '-A');
  git(declared.repo, 'commit', '-qm', 'declare the candidate files');
  git(declared.repo, 'push', '-q', 'origin', 'main');
  const withDecl = execFileSync('bash', [dispatch, '--offline', '--dry-run', 'f'],
    { encoding: 'utf8', cwd: declared.repo, timeout: 30_000 });

  // Compare only the in-flight lines: the worktree paths differ between the
  // two throwaway repos, so the full output cannot be equal by construction.
  const inFlight = (s) => s.split('\n').filter((l) => l.includes('in flight')).join('\n');
  assert.equal(inFlight(withDecl), inFlight(withoutDecl),
    `a candidate-side declaration must change nothing:\n${withDecl}\n---\n${withoutDecl}`);
  // And it must not have started predicting a collision from the declaration.
  assert.doesNotMatch(withDecl, /collid|conflict|would clash/i,
    'nothing may be predicted about the candidate');

  bare.cleanup();
  declared.cleanup();
});

test('dispatch: the generated board artifact is never reported', () => {
  // Every board branch rebuilds it, so including it would make every board
  // pair look like a collision — exactly the noise `.gitattributes -merge`
  // exists to remove. Its conflicts are settled by rebuilding, never by reading.
  const f = repoWithInFlight('artifact');
  f.committedWork('bug/board-work', {
    'skills/plot/scripts/board/board-server.mjs': 'generated\n',
    'packages/board/src/App.tsx': 'source\n',
  });

  const out = execFileSync('bash', [dispatch, '--offline', '--dry-run', 'f'],
    { encoding: 'utf8', cwd: f.repo, timeout: 30_000 });

  assert.match(out, /in flight: bug\/board-work holds/, 'the real source is still reported');
  assert.match(out, /packages\/board\/src\/App\.tsx/);
  assert.doesNotMatch(out, /board-server\.mjs/,
    `the generated bundle must be excluded:\n${out}`);
  f.cleanup();
});

test('dispatch: a rebased branch reports only its own files', () => {
  // Diffing against origin/main instead of the branch's OWN merge-base
  // attributes every commit the branch picked up from main to the branch
  // itself. On a busy day that is the whole repo, and the report is noise on
  // its first use. Here: main moves after the branch was cut.
  const f = repoWithInFlight('rebased');
  f.committedWork('bug/older-branch', { 'Mine.tsx': 'mine\n' });

  // main gains a file the branch never touched.
  fs.writeFileSync(path.join(f.repo, 'SomeoneElse.tsx'), 'theirs\n');
  git(f.repo, 'add', '-A');
  git(f.repo, 'commit', '-qm', 'unrelated work on main');
  git(f.repo, 'push', '-q', 'origin', 'main');

  const out = execFileSync('bash', [dispatch, '--offline', '--dry-run', 'f'],
    { encoding: 'utf8', cwd: f.repo, timeout: 30_000 });

  assert.match(out, /Mine\.tsx/, `the branch's own file must be reported:\n${out}`);
  assert.doesNotMatch(out, /SomeoneElse\.tsx/,
    `a file that only moved on main is not this branch's work:\n${out}`);
  f.cleanup();
});

test('dispatch: the candidate is never reported as blocking itself', () => {
  // A candidate can already have a local branch holding work — an earlier
  // session that prepared it, or a worktree adopted rather than created. A
  // report that did not exclude the candidate would name it as work in flight
  // against its own dispatch, which reads as a collision with itself.
  //
  // The branch is prepared LOCALLY and never claimed on the remote: a claimed
  // branch is not eligible, so `--next` would return nothing, the loop would
  // never run, and the assertion would pass without the report being reached.
  const f = repoWithInFlight('selfexclude');
  f.committedWork('feature/candidate', { 'Own.tsx': 'my own work\n' });
  assert.equal(git(f.repo, 'ls-remote', '--heads', 'origin', 'feature/candidate').trim(), '',
    'the candidate must stay unclaimed, or dispatch never reaches the report');

  const out = execFileSync('bash', [dispatch, '--offline', '--dry-run', 'f'],
    { encoding: 'utf8', cwd: f.repo, timeout: 30_000 });
  assert.match(out, /would dispatch feature\/candidate/,
    `the candidate must still be offered, or this tests nothing:\n${out}`);
  assert.doesNotMatch(out, /in flight: feature\/candidate/,
    `a branch must not block its own dispatch:\n${out}`);
  assert.doesNotMatch(out, /Own\.tsx/,
    `the candidate's own files are not work in flight against it:\n${out}`);
  f.cleanup();
});

test('dispatch: the real run reports too, not only --dry-run', () => {
  // The dry run is where an operator looks first, but the real run is where
  // the decision is actually taken — and where a fan-out of several branches
  // makes the report worth the most.
  const f = repoWithInFlight('realrun');
  f.committedWork('bug/other-plan', { 'App.tsx': 'x\n' });

  const out = execFileSync('bash', [dispatch, '--offline', '--no-start', 'f'],
    { encoding: 'utf8', cwd: f.repo, timeout: 30_000 });
  const lines = out.split('\n');
  const at = lines.findIndex((l) => l.startsWith('dispatched feature/candidate'));
  assert.ok(at >= 0, `must have dispatched:\n${out}`);
  assert.match(lines[at + 1] ?? '', /in flight: bug\/other-plan holds App\.tsx/,
    `the report belongs directly under the branch it qualifies:\n${out}`);
  f.cleanup();
});
