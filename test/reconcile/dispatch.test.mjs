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
