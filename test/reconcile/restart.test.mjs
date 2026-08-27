// Contract test for `plot-dispatch.sh --restart <branch>` — handing a branch
// whose worker has stopped to a new worker, through Plot rather than beside it.
//
// THE ASYMMETRY IS THE FEATURE. `--stop` kills a worker; nothing started one on
// a branch that already holds a claim, because the dispatcher asks the scan for
// `--next` and `--next` offers only `open` branches — meaning no ref exists at
// all. A branch that has ever been claimed is `claimed` or `wip`, so it is
// never offered, and `plot-dispatch.sh <slug>` answered `dispatched=0`: not a
// refusal with a reason, an EMPTY SET.
//
// THE PR IS CHECKED FIRST, BEFORE THE STATE WORD. This is the ordering the plan
// was corrected to in round one, and it comes from a measurement: five of five
// `failed` worktrees in this estate held a PR — four open, one merged.
// `plot-worker-state.sh` refines `finished` by the tree but deliberately does
// NOT refine `failed`, because "a recorded non-zero exit is already a specific
// answer about the process" — true about the process, silent about the work. A
// gate written on the state word alone would restart all five and destroy
// exactly what the `finished` refusal protects.
//
// So the refusals below are ordered as the gate is: PR, then liveness, then the
// blocked marker. And a `failed` worker with NO PR restarts (the 5b half) —
// without it a gate that simply refuses `failed` passes the PR test and leaves
// the feature unable to do the one thing it exists for.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const scripts = path.join(here, '..', '..', 'skills', 'plot', 'scripts');
const dispatch = path.join(scripts, 'plot-dispatch.sh');

function git(cwd, ...args) {
  return execFileSync('git', args, { encoding: 'utf8', cwd });
}

const ctx = [];
after(() => { for (const t of ctx) fs.rmSync(t, { recursive: true, force: true }); });

// A repo with an origin, a plan, and a `Worker command` that records its launch
// instead of running an agent. The command writes a marker file so a test can
// prove a worker was STARTED without depending on any agent tooling — Plot
// hardcodes none (Principle 5).
//
// `sleep` keeps the process alive long enough for the fleet to see it running
// (item 1), and every fd is detached: a child inheriting node's test-runner
// pipe keeps it open and the runner then never exits.
function makeRepo({ workerCommand } = {}) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-restart-'));
  const origin = path.join(tmp, 'origin.git');
  const repo = path.join(tmp, 'repo');
  git(tmp, 'init', '--bare', '-q', '-b', 'main', origin);
  git(tmp, 'clone', '-q', origin, repo);
  git(repo, 'config', 'user.email', 'test@example.invalid');
  git(repo, 'config', 'user.name', 'Plot Test');
  git(repo, 'config', 'commit.gpgsign', 'false');

  const cmd = workerCommand
    ?? 'printf started > .plot-restart-marker; sleep 300 </dev/null >/dev/null 2>&1';
  fs.writeFileSync(path.join(repo, 'CLAUDE.md'),
    '## Plot Config\n\n'
    + '- **Plan directory:** plans/\n'
    + '- **Main branch:** main\n'
    + `- **Worker command:** ${cmd}\n`);
  fs.mkdirSync(path.join(repo, 'plans'), { recursive: true });
  fs.writeFileSync(path.join(repo, 'plans', '2026-08-27-restartable.md'),
    '# Restartable\n\n## Status\n\n- **Phase:** Approved\n- **Type:** feature\n\n'
    + '## Branches\n\n### Restarted\n\n- `feature/stopped` — the stopped work\n');
  git(repo, 'add', '-A');
  git(repo, 'commit', '-qm', 'init');
  git(repo, 'push', '-q', 'origin', 'main');
  ctx.push(tmp);
  return { tmp, repo };
}

// A claimed branch with a worktree beside the repo — the shape dispatch creates:
// branch pushed (the claim), worktree checked out, no live worker.
function claimedWorktree(repo, branch = 'feature/stopped') {
  const wt = path.join(path.dirname(repo), 'plot-wt-' + branch.replace(/\//g, '-'));
  git(repo, 'branch', branch);
  git(repo, 'worktree', 'add', '-q', wt, branch);
  git(wt, 'push', '-q', '-u', 'origin', branch);
  return wt;
}

// A `gh` shim on PATH. plot-host.sh calls gh by bare name, so this controls the
// PR fact without copying any Plot script — the scripts under test stay the real
// ones. `pr` decides whether a PR exists; anything else answers "no PR", which
// is what an unrelated branch reports.
function ghShim({ state = null } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-restart-gh-'));
  ctx.push(dir);
  const body = state
    ? `{"number":77,"state":"${state}","isDraft":false,"url":"https://example.invalid/pr/77","mergeCommit":{"oid":"abc123"}}`
    : null;
  fs.writeFileSync(path.join(dir, 'gh'),
    '#!/usr/bin/env bash\n'
    + 'case "$1 $2" in\n'
    + (body
      ? `  "pr view") printf '%s' '${body}' ;;\n`
      : '  "pr view") echo "no pull requests found" >&2; exit 1 ;;\n')
    + '  *) echo "{}" ;;\n'
    + 'esac\n');
  fs.chmodSync(path.join(dir, 'gh'), 0o755);
  return dir;
}

function run(repo, args, { gh = null, expectFail = false } = {}) {
  const env = { ...process.env };
  if (gh) env.PATH = `${gh}:${env.PATH}`;
  try {
    const stdout = execFileSync('bash', [dispatch, ...args],
      { encoding: 'utf8', cwd: repo, env, stdio: ['ignore', 'pipe', 'pipe'] });
    if (expectFail) assert.fail(`expected a refusal, got:\n${stdout}`);
    return { stdout, status: 0 };
  } catch (e) {
    const out = (e.stdout ?? '') + (e.stderr ?? '');
    if (!expectFail) assert.fail(`unexpected failure:\n${out}`);
    return { stdout: out, status: e.status ?? 1 };
  }
}

// Record a worker exactly as dispatch does: a pid file plus a manifest whose
// `startedAt` is in the past, so plot_worker_state can validate the pid rather
// than mistake a reused one for the original.
function recordWorker(repo, wt, pid, { session = 'sess-old', branch = 'feature/stopped' } = {}) {
  fs.writeFileSync(path.join(wt, '.plot-worker.pid'), String(pid));
  const dir = path.join(repo, '.plot', 'agents');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${session}.json`),
    JSON.stringify({
      session, branch, worktree: fs.realpathSync(wt),
      command: 'sleep', pid: String(pid), startedAt: '2020-01-01T00:00:00Z',
    }, null, 2) + '\n');
}

function spawnLive() {
  return execFileSync('bash', ['-c', 'sleep 300 </dev/null >/dev/null 2>&1 & echo $!'],
    { encoding: 'utf8' }).trim();
}

// Every manifest in the registry, newest session first by file mtime.
function manifests(repo) {
  const dir = path.join(repo, '.plot', 'agents');
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((f) => f.endsWith('.json'))
    .map((f) => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')));
}

// ---------------------------------------------------------------------------
// Item 1 + 2: it starts a worker the fleet can see, and registers it
// ---------------------------------------------------------------------------

test('--restart starts a worker on a stalled branch, and the fleet sees it running', () => {
  const { repo } = makeRepo();
  const wt = claimedWorktree(repo);
  // A stall: work on the floor, no PR, no live process. This is what the plan
  // was written from — a worker stopped and left its tree behind.
  fs.writeFileSync(path.join(wt, 'half-done.txt'), 'unfinished work\n');

  const res = run(repo, ['--restart', 'feature/stopped'], { gh: ghShim() });
  try {
    assert.match(res.stdout, /restart(ed|ing)/i);
    assert.match(res.stdout, /feature\/stopped/);

    // ASSERTED THROUGH THE FLEET, NOT A PID. An unregistered worker is the
    // defect this closes, so a restart the fleet cannot see has not succeeded.
    const status = execFileSync('bash', [dispatch, '--status'], { encoding: 'utf8', cwd: repo });
    assert.match(status, /feature\/stopped — running/,
      `the fleet must report the restarted worker as running:\n${status}`);
    assert.match(status, /running=1/);

    // Item 2: a manifest carries the new worker's session and pid — read from
    // the registry, not merely present, since the measured failure was a row
    // synthesized BECAUSE no manifest was there.
    const fresh = manifests(repo).filter((m) => m.session !== 'sess-old');
    assert.equal(fresh.length, 1, 'exactly one manifest for the restarted worker');
    assert.equal(fresh[0].branch, 'feature/stopped');
    assert.ok(fresh[0].session, 'the manifest carries a session id');
    assert.match(String(fresh[0].pid), /^\d+$/, 'the manifest carries the agent pid');
    assert.equal(fresh[0].worktree, fs.realpathSync(wt), 'it names the existing worktree');
  } finally {
    for (const m of manifests(repo)) {
      if (m.pid) { try { process.kill(Number(m.pid)); } catch { /* gone */ } }
    }
  }
});

// ---------------------------------------------------------------------------
// Item 6: the tree survives, byte for byte
// ---------------------------------------------------------------------------

test('--restart preserves uncommitted work in the worktree, byte for byte', () => {
  const { repo } = makeRepo({ workerCommand: 'sleep 300 </dev/null >/dev/null 2>&1' });
  const wt = claimedWorktree(repo);
  // The measured case: a stalled worker in this repo left 324 finished lines
  // uncommitted. A restart that resets is worse than the missing affordance,
  // because it looks like a supported operation.
  const body = 'line one\nline two\n\ttabbed\n';
  fs.writeFileSync(path.join(wt, 'floor.txt'), body);
  fs.writeFileSync(path.join(wt, 'tracked.txt'), 'original\n');
  git(wt, 'add', 'tracked.txt');
  git(wt, 'commit', '-qm', 'tracked');
  fs.writeFileSync(path.join(wt, 'tracked.txt'), 'modified, uncommitted\n');

  run(repo, ['--restart', 'feature/stopped'], { gh: ghShim() });
  try {
    assert.equal(fs.readFileSync(path.join(wt, 'floor.txt'), 'utf8'), body,
      'untracked work survives unchanged');
    assert.equal(fs.readFileSync(path.join(wt, 'tracked.txt'), 'utf8'), 'modified, uncommitted\n',
      'a modified tracked file is not reset');
    assert.match(git(wt, 'status', '--porcelain'), /floor\.txt/);
  } finally {
    for (const m of manifests(repo)) {
      if (m.pid) { try { process.kill(Number(m.pid)); } catch { /* gone */ } }
    }
  }
});

// ---------------------------------------------------------------------------
// Item 3: the PR refuses FIRST — including on `failed`
// ---------------------------------------------------------------------------

for (const state of ['OPEN', 'MERGED']) {
  test(`--restart REFUSES when a ${state} PR exists, even though the worker reads failed`, () => {
    const { repo } = makeRepo();
    const wt = claimedWorktree(repo);
    // A worker that exited non-zero: `failed`, which plot-worker-state.sh
    // deliberately does not refine by the tree. The PR is the honest field.
    fs.writeFileSync(path.join(wt, '.plot-worker.exit'), '143\n');
    recordWorker(repo, wt, 999999);

    const res = run(repo, ['--restart', 'feature/stopped'],
      { gh: ghShim({ state }), expectFail: true });
    assert.match(res.stdout, /\b77\b/, 'the refusal NAMES the PR');
    assert.match(res.stdout, /pull request|PR\b/i);
    assert.ok(!fs.existsSync(path.join(wt, '.plot-restart-marker')),
      'no worker was started');
  });
}

// ---------------------------------------------------------------------------
// Item 5b: a failed worker with NO PR does restart
// ---------------------------------------------------------------------------

test('--restart DOES restart a failed worker that holds no PR', () => {
  const { repo } = makeRepo();
  const wt = claimedWorktree(repo);
  fs.writeFileSync(path.join(wt, '.plot-worker.exit'), '1\n');
  recordWorker(repo, wt, 999999);

  const res = run(repo, ['--restart', 'feature/stopped'], { gh: ghShim() });
  try {
    assert.match(res.stdout, /restart(ed|ing)/i);
    const status = execFileSync('bash', [dispatch, '--status'], { encoding: 'utf8', cwd: repo });
    assert.match(status, /feature\/stopped — running/,
      'the other half of item 3: without this the feature cannot do its job');
  } finally {
    for (const m of manifests(repo)) {
      if (m.pid) { try { process.kill(Number(m.pid)); } catch { /* gone */ } }
    }
  }
});

// ---------------------------------------------------------------------------
// Item 4: refuses on a live worker, naming the pid
// ---------------------------------------------------------------------------

test('--restart REFUSES a running worker and names the pid', () => {
  const { repo } = makeRepo();
  const wt = claimedWorktree(repo);
  const pid = spawnLive();
  try {
    recordWorker(repo, wt, pid);
    const res = run(repo, ['--restart', 'feature/stopped'],
      { gh: ghShim(), expectFail: true });
    assert.match(res.stdout, new RegExp(`\\b${pid}\\b`), 'the refusal names the live pid');
    assert.match(res.stdout, /running|alive/i);
    // The live worker is untouched — this is the refusal that prevents two
    // workers on one branch, and there is no --force to override it.
    assert.doesNotThrow(() => process.kill(Number(pid), 0), 'the live worker still runs');
  } finally {
    try { process.kill(Number(pid)); } catch { /* gone */ }
  }
});

test('--restart has no --force: an unknown flag is refused, not silently ignored', () => {
  // A flag overriding a liveness refusal is the flag typed reflexively, and what
  // it overrides is another agent's work. This pins its ABSENCE.
  const dispatchSrc = fs.readFileSync(dispatch, 'utf8');
  const restartRegion = dispatchSrc.slice(dispatchSrc.indexOf('mode" = "restart'));
  assert.ok(!/--force/.test(restartRegion.slice(0, 4000)),
    'the restart path must not honour a --force escape');
});

// ---------------------------------------------------------------------------
// Item 5: refuses on `waiting`, naming the marker
// ---------------------------------------------------------------------------

test('--restart REFUSES a waiting worker and names the marker file', () => {
  const { repo } = makeRepo();
  const wt = claimedWorktree(repo);
  // A blocked marker: a person owes this branch an answer. Restarting it asks
  // the same question again with nobody to answer it.
  fs.writeFileSync(path.join(wt, 'PLOT-BLOCKED.md'),
    'PLOT-BLOCKED: which format should the export use?\n');
  recordWorker(repo, wt, 999999);

  const res = run(repo, ['--restart', 'feature/stopped'],
    { gh: ghShim(), expectFail: true });
  assert.match(res.stdout, /PLOT-BLOCKED/, 'the refusal names the marker file');
  assert.ok(!fs.existsSync(path.join(wt, '.plot-restart-marker')), 'no worker was started');
});

// ---------------------------------------------------------------------------
// Item 7: explicit branch only — a slug dispatch never restarts
// ---------------------------------------------------------------------------

test('--restart requires an explicit branch, and refuses a bare slug', () => {
  const { repo } = makeRepo();
  claimedWorktree(repo);
  // A value with no "/" is a plan slug, not a branch. Guessing would restart
  // the wrong thing — or nothing — without saying so.
  const res = run(repo, ['--restart', 'restartable'], { expectFail: true });
  assert.match(res.stdout, /branch/i);
  assert.match(res.stdout, /feature\/|e\.g\./, 'it shows the shape it wants');
});

test('a plain slug dispatch still restarts nothing: dispatched=0 on a stalled branch', () => {
  const { repo } = makeRepo();
  const wt = claimedWorktree(repo);
  fs.writeFileSync(path.join(wt, 'half-done.txt'), 'unfinished\n');

  // The plan's only branch is claimed and stalled. Today's behaviour, and
  // deliberately unchanged: `plot-dispatch.sh <slug>` means "start what nobody
  // has started", never "adopt someone else's stopped work".
  const res = run(repo, ['--offline', 'restartable']);
  assert.match(res.stdout, /dispatched=0/);
  assert.ok(!fs.existsSync(path.join(wt, '.plot-restart-marker')),
    'a slug dispatch must never start a worker on a claimed branch');
});

// ---------------------------------------------------------------------------
// Item 8: --next is untouched
// ---------------------------------------------------------------------------

test('plot-fleet-scan.sh --next still offers only open branches', () => {
  // The `open`-only rule is Plot's lock: it is what stops two workers claiming
  // one branch. This plan adds a second question rather than widening the first.
  const scan = fs.readFileSync(path.join(scripts, 'plot-fleet-scan.sh'), 'utf8');
  assert.match(scan, /\[ "\$verdict" = "eligible" \] && \[ "\$st" = "open" \]/,
    'the claimable[] condition must still require st = open');
});

test('--restart refuses a branch with no worktree, naming the branch', () => {
  const { repo } = makeRepo();
  const res = run(repo, ['--restart', 'feature/never-dispatched'],
    { gh: ghShim(), expectFail: true });
  assert.match(res.stdout, /feature\/never-dispatched/);
  assert.match(res.stdout, /worktree/i);
});
