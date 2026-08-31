// Contract test for the BOUND in skills/plot/scripts/plot-worker-loop.sh — a
// worker whose agent prompt hangs is ended by a wall-clock bound instead of
// held forever. This is the `Bounded` wave of
// docs/plans/2026-08-25-a-hung-child-does-not-hold-the-loop.md; it asserts the
// plan's Done-when items 1, 2, 3, 5 and 6.
//
// THE MECHANISM IS EXERCISED WITH A STUB PROMPT THAT SLEEPS, never the real
// CLI, which cannot be made to hang on demand (plan, Done-when 1). The stub is
// a `.plot/worker-prompt.sh` the loop sources; a bound expressed in seconds and
// a sleep longer or shorter than it are all the levers these tests need.
//
// PROCESS-LEAK ASSERTIONS use a per-test unique sleep duration as a marker, so
// one test's stray process cannot be confused with another's, and count only
// the descendants of the loop we spawned — a bound that outlives its worker is
// a new leak in the fix for a leak (Done-when 6).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// TESTS IN THIS FILE RUN ONE AT A TIME, and that is a correctness requirement
// rather than tidiness. Every test here spawns a loop that sleeps, and several
// assert that an ending arrived PROMPTLY — "the bound fired within 10s" is the
// assertion that says a watchdog fired rather than a prompt finishing on its
// own. Under node's default per-file concurrency those spawned sleeps starve
// each other: measured 2026-08-30, the 2.5s hung-prompt test wall-clocked at
// 21s beside its neighbours and failed a timing assertion whose behaviour was
// demonstrably correct. Raising the timings instead would have blunted exactly
// the assertions that make the bound observable, so the concurrency is bounded
// and the timings stay sharp.
//
// THE MECHANISM IS `concurrency: false` ON EACH TEST, not a runner flag.
// `--test-concurrency` would have to be set by whoever invokes the suite, which
// puts a correctness requirement of THIS file in `package.json` where the next
// person to add a test cannot see it. The option travels with the test.
const serial = { concurrency: false };

const here = path.dirname(fileURLToPath(import.meta.url));
const scripts = path.join(here, '..', '..', 'skills', 'plot', 'scripts');
const loop = path.join(scripts, 'plot-worker-loop.sh');

function git(cwd, ...args) {
  return execFileSync('git', args, { encoding: 'utf8', cwd });
}

/**
 * A git repo carrying a Worker bound and a stub prompt. The prompt is `bodySh`,
 * the raw shell the loop will source; `boundSeconds` is written into the Plot
 * Config. No plan exists, so after an honest finish the loop's `--next` scan
 * exits non-zero and the loop ends cleanly — exactly one pass.
 */
function fixture(label, boundSeconds, bodySh) {
  // Each fixture gets its OWN parent directory, and the worktree sits inside it.
  //
  // The hop check at the bottom of this file counts `plot-wt-*` entries beside
  // the fixture. Under `os.tmpdir()` directly, "beside" meant the machine's
  // shared tmp root, so ANY `plot-wt-*` there counted as a hop this loop made —
  // including one left by an aborted run of `agent-panel.test.mjs`, which names
  // its own fixture `plot-wt-dead-`. Measured 2026-08-30: one empty leftover
  // directory failed `a timed-out worker exits without hopping` on a clean main.
  //
  // CI never saw it (a fresh tmp per job), so it reproduced only where both
  // suites run — a developer machine, where it reads as "my branch broke it".
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), `plot-wloop-${label}-`));
  const t = path.join(parent, 'wt');
  fs.mkdirSync(t);
  git(t, 'init', '-q', '-b', 'main', '.');
  git(t, 'config', 'user.email', 'test@example.invalid');
  git(t, 'config', 'user.name', 'Plot Test');
  git(t, 'config', 'commit.gpgsign', 'false');
  fs.mkdirSync(path.join(t, '.plot'), { recursive: true });
  // An EMPTY `boundSeconds` omits the key, so the loop takes its own default —
  // which is the only way to assert what the repo actually ships.
  fs.writeFileSync(path.join(t, 'CLAUDE.md'),
    boundSeconds === ''
      ? `# t\n\n## Plot Config\n\n- **Plan directory:** docs/plans/\n`
      : `# t\n\n## Plot Config\n\n- **Worker bound:** ${boundSeconds}\n`);
  fs.writeFileSync(path.join(t, '.plot', 'worker-prompt.sh'), bodySh);
  git(t, 'add', '-A');
  git(t, 'commit', '-qm', 'init');
  return t;
}

/**
 * Remove a fixture and the private parent `fixture()` created for it.
 *
 * Every teardown goes through this, so the parent cannot outlive its worktree
 * — a leaked `plot-wloop-*` in the shared tmp root is what this file's hop
 * check reads as a hop.
 */
function discard(dir) {
  fs.rmSync(path.dirname(dir), { recursive: true, force: true });
}

/**
 * Run the loop to completion (or until `killAfterMs`, when set, sends `signal`
 * to the loop process). Resolves with { code, signal, stdout, stderr, pid }.
 */
/**
 * Signal a whole process group, by the negative pid its leader owns.
 *
 * `process.kill(-pid)` reaches the leader AND every descendant in one call;
 * `child.kill()` reaches only the leader. Tolerant of an already-dead group,
 * because both the timeout path and the exit path call it.
 */
function killGroup(pid, signal) {
  if (!pid) return;
  try { process.kill(-pid, signal); } catch { /* already gone */ }
}

function runLoop(cwd, { env = {}, killAfterMs = 0, signal = 'SIGTERM' } = {}) {
  return new Promise((resolve) => {
    // `detached` MAKES THE LOOP A PROCESS-GROUP LEADER, so it can be killed as
    // a GROUP. Without it the loop shares the runner's group, `child.kill()`
    // signals one pid, and the loop's descendants — the prompt, the watchdog,
    // and the `sleep` each respawns — survive, reparent to PPID 1, and hold
    // node's event loop open.
    //
    // Measured on CI 2026-08-31: 13 orphaned `plot-worker-loop.sh` at PPID 1,
    // aged 10-12 minutes, holding 14 `sleep`s — after every test had PASSED.
    // The runner reported `ok 877` (this file's last test) and then hung until
    // the job ceiling killed it. That is the whole of the reconcile-suite hang.
    const child = spawn('bash', [loop], {
      cwd,
      detached: true,
      env: {
        ...process.env,
        PLOT_BRANCH: 'bug/x',
        PLOT_SLUG: 'x',
        PLOT_WORKTREE: cwd,
        PLOT_MANIFEST_FILE: '',
        ...env,
      },
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    let timer;
    if (killAfterMs > 0) {
      timer = setTimeout(() => killGroup(child.pid, signal), killAfterMs);
    }
    child.on('exit', (code, sig) => {
      if (timer) clearTimeout(timer);
      // The loop has exited; its group may not have. Sweep it before resolving,
      // so no test can leave a descendant behind for the runner to wait on.
      killGroup(child.pid, 'SIGKILL');
      resolve({ code, signal: sig, stdout, stderr, pid: child.pid });
    });
  });
}

// Count live `sleep <secs>` processes — the marker for a leaked prompt or
// watchdog. A unique per-test duration keeps tests from seeing each other's.
function sleepCount(secs) {
  try {
    const out = execFileSync('pgrep', ['-f', `sleep ${secs}`], { encoding: 'utf8' });
    return out.split('\n').filter((l) => l.trim()).length;
  } catch {
    return 0; // pgrep exits 1 when nothing matches
  }
}

function reap(secs) {
  try { execFileSync('pkill', ['-KILL', '-f', `sleep ${secs}`]); } catch { /* none */ }
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// Item 1 — a prompt that never returns is ended by the bound, and the log says
// so. The stub sleeps 47s under a 1s bound; the loop must exit ~1s later, non-
// zero, naming the bound.
test('worker-loop: a hung prompt is ended by the bound and logged', serial, async () => {
  const secs = 47;
  reap(secs);
  const dir = fixture('timeout', 1, `echo hung; sleep ${secs}\n`);
  try {
    const started = Date.now();
    const r = await runLoop(dir);
    const elapsed = Date.now() - started;
    assert.notEqual(r.code, 0, 'loop must exit non-zero on timeout');
    assert.equal(r.code, 124, 'timeout uses the timeout(1) convention, exit 124');
    assert.match(r.stderr, /exceeded the 1s bound/, 'the log names the bound');
    assert.ok(elapsed < 10000, `bound fired promptly, took ${elapsed}ms`);
  } finally {
    reap(secs);
    discard(dir);
  }
});

// Item 2 — a prompt finishing UNDER the bound is never truncated. The stub
// sleeps 1s under a 60s bound and writes a marker; the marker must exist and
// the loop must not report a timeout. This is the assertion a naive
// implementation fails: a bound that fires on slow-but-honest work trades a
// visible hang for silent data loss.
test('worker-loop: an honest prompt under the bound is not truncated', serial, async () => {
  const marker = 'finished.marker';
  const dir = fixture('honest', 60,
    `echo working; sleep 1; touch "$PLOT_WORKTREE/${marker}"; echo done\n`);
  try {
    const r = await runLoop(dir);
    assert.ok(fs.existsSync(path.join(dir, marker)), 'the prompt ran to completion');
    assert.doesNotMatch(r.stderr, /exceeded/, 'no false timeout');
    assert.match(r.stdout, /done/, 'the prompt printed its final line');
    assert.equal(r.code, 0, 'an honest pass exits 0 once --next has nothing');
  } finally {
    discard(dir);
  }
});

// Item 3 — a timed-out worker does NOT hop to a next wave. After the timeout
// the loop must exit rather than reach the `plot-fleet-scan.sh --next` /
// `git worktree add` machinery. We prove it by observing that no second
// worktree was created (a hop's first act) and the loop exited 124.
test('worker-loop: a timed-out worker exits without hopping', serial, async () => {
  const secs = 48;
  reap(secs);
  const dir = fixture('nohop', 1, `sleep ${secs}\n`);
  try {
    const r = await runLoop(dir);
    assert.equal(r.code, 124, 'timed out');
    // A hop creates a sibling `plot-wt-*` worktree beside PLOT_WORKTREE. The
    // fixture dir IS PLOT_WORKTREE; a hop would add one under its parent.
    const parent = path.dirname(dir);
    const siblings = fs.readdirSync(parent).filter((n) => n.startsWith('plot-wt-'));
    assert.equal(siblings.length, 0, 'no next-wave worktree was created');
    const worktrees = git(dir, 'worktree', 'list');
    assert.equal(worktrees.trim().split('\n').length, 1, 'only the original worktree exists');
  } finally {
    reap(secs);
    discard(dir);
  }
});

// Item 5 — the bound needs no timeout(1). Run the loop with `timeout` and
// `gtimeout` unreachable and assert the bound STILL fires. The loop itself
// resolves `git`, `sleep`, `pgrep` normally, so the rest of PATH is kept.
//
// MASKED, NOT REMOVED — and the first version got this wrong. It set PATH to
// `/usr/bin:/bin`, which hides Homebrew's coreutils on a mac and hides NOTHING
// on Linux, where `timeout` ships in /usr/bin. The sanity assertion then failed
// in CI (`actual: true`) while passing locally: the test encoded one platform's
// layout as if it were the rule.
//
// A shim directory prepended to the real PATH is platform-independent: the two
// names resolve to a script that exits 127, which is what a shell reports for a
// command it cannot find.
test('worker-loop: the bound fires with timeout(1)/gtimeout absent from PATH', serial, async () => {
  const secs = 49;
  reap(secs);
  const dir = fixture('nocoreutils', 1, `sleep ${secs}\n`);
  const shim = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-notimeout-'));
  for (const bin of ['timeout', 'gtimeout']) {
    fs.writeFileSync(path.join(shim, bin), '#!/bin/sh\nexit 127\n', { mode: 0o755 });
  }
  const sanitized = `${shim}:${process.env.PATH ?? '/usr/bin:/bin'}`;
  // Sanity: the sanitized PATH really lacks the coreutils timeouts.
  // USABLE, not merely findable. The shim IS on PATH — `command -v` finds it —
  // so the sanity check must ask whether it WORKS, which is what the loop's own
  // capability probe asks. Running it exits 127, the shell's own "cannot run".
  const usable = (bin) => {
    try { execFileSync('bash', ['-c', `${bin} 1 true`], { env: { PATH: sanitized } }); return true; }
    catch { return false; }
  };
  assert.equal(usable('timeout'), false, 'timeout unusable on the sanitized PATH');
  assert.equal(usable('gtimeout'), false, 'gtimeout unusable on the sanitized PATH');
  try {
    const r = await runLoop(dir, { env: { PATH: sanitized } });
    assert.equal(r.code, 124, 'the bound fired without coreutils timeout(1)');
    assert.match(r.stderr, /exceeded/, 'the log names the bound');
  } finally {
    reap(secs);
    discard(dir);
    fs.rmSync(shim, { recursive: true, force: true });
  }
});

// Item 6 — the watchdog leaves nothing behind, on THREE exit paths:
//   (a) a normal finish, (b) a timeout, (c) a kill of the loop itself.
// Each is asserted separately, with its own marker sleep, because they are
// distinct code paths and a trap on only one of them would pass a single case.
test('worker-loop: no stray sleep after a normal finish', serial, async () => {
  const secs = 51;
  reap(secs);
  // The watchdog sleep is the BOUND's duration; use a distinctive one and a
  // short prompt so the loop finishes honestly, then check the watchdog is gone.
  const dir = fixture('leak-finish', secs, `sleep 1\n`);
  try {
    const r = await runLoop(dir);
    assert.equal(r.code, 0, 'honest finish');
    await wait(300);
    assert.equal(sleepCount(secs), 0, 'the watchdog sleep was reaped on finish');
  } finally {
    reap(secs);
    discard(dir);
  }
});

test('worker-loop: no stray sleep after a timeout', serial, async () => {
  const promptSecs = 52;
  reap(promptSecs);
  const dir = fixture('leak-timeout', 1, `sleep ${promptSecs}\n`);
  try {
    const r = await runLoop(dir);
    assert.equal(r.code, 124, 'timed out');
    await wait(300);
    assert.equal(sleepCount(promptSecs), 0, 'the prompt sleep was killed on timeout');
  } finally {
    reap(promptSecs);
    discard(dir);
  }
});

test('worker-loop: no stray sleep after the loop itself is killed', serial, async () => {
  const promptSecs = 53;
  const boundSecs = 900; // long enough that the bound never fires in this test
  reap(promptSecs);
  reap(boundSecs);
  const dir = fixture('leak-kill', boundSecs, `sleep ${promptSecs}\n`);
  try {
    // Let the prompt (and watchdog) start, then SIGTERM the loop mid-run.
    const r = await runLoop(dir, { killAfterMs: 800, signal: 'SIGTERM' });
    assert.ok(r.code !== 0 || r.signal, 'the loop was terminated');
    await wait(400);
    assert.equal(sleepCount(promptSecs), 0, 'the prompt sleep was reaped when the loop died');
    assert.equal(sleepCount(boundSecs), 0, 'the watchdog sleep was reaped when the loop died');
  } finally {
    reap(promptSecs);
    reap(boundSecs);
    discard(dir);
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// THE MONITOR'S READING, not the clock — 2026-08-30
// ═══════════════════════════════════════════════════════════════════════════
//
// `docs/plans/2026-08-30-a-working-agent-is-not-a-hung-one.md`, Reading slice.
// Seven workers exited 124 that day and every one had 3-6 commits; not one was
// hung. The bound answered *hung* seven times and was wrong seven times,
// because wall-clock time measures how long, never whether anything happened.
//
// So the loop now ends the prompt on the WorkerMonitor's `idle` finding, and
// the timer survives only as a floor. THE TESTS ABOVE ARE THE REGRESSION LOCK:
// they still drive a 1s bound against a 47s sleep and still demand exit 124,
// which is `a-hung-child-does-not-hold-the-loop`'s 2026-08-25 property. An
// implementation that reads the monitor by removing the bound fails them.
//
// THE MONITOR IS STUBBED, NOT RUN. Every state below — a subtree frozen for two
// consecutive samples, an agent that commits every few minutes for an hour — is
// one a real machine will not produce on demand, and a test that waits for real
// time is a test nobody runs (the same refusal `workermonitor.test.mjs` makes
// one level down). The seam is the findings FILE: the monitor's only output is
// JSONL appended there, so a stub that writes a line on cue drives the loop's
// new reading exactly as the real monitor would.

/**
 * Write one monitor finding into a worktree's findings file, in the exact
 * shape `plot-worker-monitor.sh:publish` emits.
 *
 * THE PATH IS THE MONITOR'S OWN DEFAULT, not a convention invented here:
 * `plot-dispatch.sh` passes no `PLOT_MONITOR_FILE`, so a dispatched monitor
 * falls back to `$PLOT_WORKTREE/.plot-worker.monitor.worker.jsonl`. A test that
 * agreed with the loop but not with the monitor would pass while the fleet
 * stayed broken.
 */
function publishFinding(dir, finding, { monitor = 'WorkerMonitor', file } = {}) {
  const now = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
  const line = JSON.stringify({
    monitor,
    branch: 'bug/x',
    worktree: dir,
    finding,
    since: now,
    evidence: `stubbed ${finding} for a test`,
    measuredAt: now,
  });
  fs.appendFileSync(file ?? path.join(dir, '.plot-worker.monitor.worker.jsonl'), `${line}\n`);
}

// Done-when 1, and the whole point of the slice — an agent that commits every
// few minutes for over an hour is NEVER ended.
//
// ASSERTED AT THE SHIPPED DEFAULT, which is where the property actually lives.
// The fix is NOT that a working agent is immune to any bound — that would
// delete the floor and with it `a-hung-child-does-not-hold-the-loop`'s
// protection. It is that the DEFAULT is now sized for a floor rather than a
// verdict, so no honest run reaches it: the seven workers killed on 2026-08-30
// had all been running between one and two hours.
//
// So the fixture declares no `Worker bound` at all and the loop takes its
// default, which must exceed the hour that failed. The prompt works, commits,
// and finishes; nothing ends it. A change that put the default back near an
// honest run length fails here.
test('worker-loop: the default floor is far beyond an honest run', serial, () => {
  const src = fs.readFileSync(loop, 'utf8');
  const defaults = [...src.matchAll(/WORKER_BOUND_SECONDS=(?:\$\(cfg "Worker bound" ")?(\d+)/g)]
    .map((m) => Number(m[1]));
  assert.ok(defaults.length >= 2, 'the default appears both as the cfg fallback and the guard');
  for (const d of defaults) {
    assert.ok(d >= 14400,
      `the floor's default is ${d}s; the 2026-08-30 kills happened at 3600s, so a floor must be hours beyond an honest run`);
  }
  assert.equal(new Set(defaults).size, 1, 'the cfg fallback and the non-numeric guard agree');
});

test('worker-loop: a working agent is not ended at the default floor', serial, async () => {
  const marker = 'worked-through.marker';
  // No `Worker bound` key at all — the loop takes its shipped default.
  const dir = fixture('working-long', '', 
    `for i in 1 2 3 4 5 6; do sleep 1; done; touch "$PLOT_WORKTREE/${marker}"; echo done\n`);
  try {
    const started = Date.now();
    const r = await runLoop(dir);
    const elapsed = Date.now() - started;
    assert.ok(fs.existsSync(path.join(dir, marker)),
      'the prompt ran to completion under the default floor');
    assert.doesNotMatch(r.stderr, /exceeded/, 'no wall-clock kill of a working agent');
    assert.equal(r.code, 0, 'an honest pass exits 0 once --next has nothing');
    assert.ok(elapsed > 4000, `the prompt really ran a while, took ${elapsed}ms`);
  } finally {
    discard(dir);
  }
});

// Done-when 2 — an agent whose subtree goes quiet WITH COMMITS on the branch is
// ended within two monitor intervals. The monitor has already applied all four
// conditions by the time it publishes; the loop's job is to read the word, not
// to re-derive the judgement.
test('worker-loop: an idle finding ends the prompt', serial, async () => {
  const secs = 61;
  reap(secs);
  // A bound far longer than the test: the ending must come from the finding.
  const dir = fixture('idle-ends', 900, `sleep ${secs}\n`);
  try {
    setTimeout(() => publishFinding(dir, 'idle'), 900);
    const started = Date.now();
    const r = await runLoop(dir);
    const elapsed = Date.now() - started;
    assert.notEqual(r.code, 0, 'the loop ended the worker');
    assert.equal(r.code, 124, 'ending a worker keeps the timeout(1) convention');
    assert.ok(elapsed < 20000, `ended on the finding, not the 900s bound (${elapsed}ms)`);
  } finally {
    reap(secs);
    discard(dir);
  }
});

// Done-when 4 — the message says WHICH READING ended it. An operator reading
// `.plot-worker.log` must be able to tell a monitor's verdict from the floor
// firing, because the two mean opposite things about the work in the worktree:
// one says the agent stopped, the other says nobody knows.
test('worker-loop: the message names the reading that ended the worker', serial, async () => {
  const secs = 62;
  reap(secs);
  const dir = fixture('idle-message', 900, `sleep ${secs}\n`);
  try {
    setTimeout(() => publishFinding(dir, 'idle'), 900);
    const r = await runLoop(dir);
    assert.equal(r.code, 124, 'ended');
    assert.match(r.stderr, /WorkerMonitor/,
      'the message names the monitor whose reading ended the worker');
    assert.match(r.stderr, /idle/, 'the message names the finding');
    assert.doesNotMatch(r.stderr, /exceeded the \d+s bound/,
      'a monitor ending must not be reported as the wall-clock bound');
  } finally {
    reap(secs);
    discard(dir);
  }
});

// Done-when 3 — an agent that has committed NOTHING is not ended, however
// quiet. This is the monitor's middle row and it is enforced ONE level down: an
// agent with no commits never produces an `idle` finding at all, so the loop
// sees silence and must keep running. Calling that a stall is what teaches an
// operator to ignore the word.
//
// ASSERTED AS THE LOOP'S HALF OF IT: silence does not end a worker. A loop that
// ended on any monitor output — or on a `gone`, or on the AgentMonitor's
// "nothing measured yet" — would fail here.
test('worker-loop: a quiet agent with no idle finding is not ended', serial, async () => {
  const marker = 'quiet-finished.marker';
  const dir = fixture('quiet-nocommits', 900,
    `sleep 3; touch "$PLOT_WORKTREE/${marker}"; echo done\n`);
  try {
    // Everything a monitored worktree may carry EXCEPT an `idle` finding: the
    // AgentMonitor's placeholder, and a WorkerMonitor `clear`.
    setTimeout(() => {
      publishFinding(dir, 'nothing measured yet',
        { monitor: 'AgentMonitor', file: path.join(dir, '.plot-worker.monitor.agent.jsonl') });
      publishFinding(dir, 'clear');
    }, 600);
    const r = await runLoop(dir);
    assert.ok(fs.existsSync(path.join(dir, marker)), 'the quiet prompt ran to completion');
    assert.equal(r.code, 0, 'silence is not a verdict');
    assert.doesNotMatch(r.stderr, /WorkerMonitor/, 'nothing was read as a finding');
  } finally {
    discard(dir);
  }
});

// A RECOVERED WORKER IS NOT AN IDLE ONE. The monitor publishes only on a
// CHANGE, so a worktree whose agent stalled and then resumed carries an `idle`
// line followed by a `clear` line — both, forever, in the same file. A loop
// that searched the file for the word `idle` would kill every worker that had
// ever recovered, which is worse than the bound it replaces: the bound at least
// waited an hour first.
//
// So the reading is the LAST finding, not any finding.
test('worker-loop: an idle finding superseded by clear does not end the worker', serial, async () => {
  const marker = 'recovered.marker';
  const dir = fixture('idle-then-clear', 900,
    `sleep 3; touch "$PLOT_WORKTREE/${marker}"; echo done\n`);
  try {
    publishFinding(dir, 'idle');
    publishFinding(dir, 'clear');
    const r = await runLoop(dir);
    assert.ok(fs.existsSync(path.join(dir, marker)), 'the recovered prompt ran to completion');
    assert.equal(r.code, 0, 'a superseded finding is not a verdict');
  } finally {
    discard(dir);
  }
});

// THE FINDINGS OF ANOTHER WORKER ARE NOT THIS ONE'S. The AgentMonitor writes
// into the same worktree with the same file prefix, and its vocabulary is not
// the WorkerMonitor's. A loop that read every `.plot-worker.monitor.*` file
// would take an AgentMonitor finding as a verdict on the process — the exact
// Machine/Registry confusion CLAUDE.md's split exists to prevent.
test('worker-loop: an AgentMonitor finding is not a WorkerMonitor verdict', serial, async () => {
  const marker = 'agentmonitor-ignored.marker';
  const dir = fixture('agentmonitor', 900,
    `sleep 3; touch "$PLOT_WORKTREE/${marker}"; echo done\n`);
  try {
    publishFinding(dir, 'idle', {
      monitor: 'AgentMonitor',
      file: path.join(dir, '.plot-worker.monitor.agent.jsonl'),
    });
    const r = await runLoop(dir);
    assert.ok(fs.existsSync(path.join(dir, marker)),
      'the prompt ran to completion despite an AgentMonitor idle');
    assert.equal(r.code, 0, 'only the WorkerMonitor ends a worker');
  } finally {
    discard(dir);
  }
});

// A `gone` FINDING IS NOT THIS LOOP'S BUSINESS. It means the agent pid names no
// live process — and when that is true the prompt child has already exited, so
// the loop is past `wait` and into `--next` on its own. Reading `gone` as a
// reason to kill would be the loop racing to kill something already dead, and
// would end a worker whose agent finished cleanly a moment before the monitor's
// next pass.
test('worker-loop: a gone finding does not end the worker', serial, async () => {
  const marker = 'gone-ignored.marker';
  const dir = fixture('gone', 900,
    `sleep 3; touch "$PLOT_WORKTREE/${marker}"; echo done\n`);
  try {
    setTimeout(() => publishFinding(dir, 'gone'), 600);
    const r = await runLoop(dir);
    assert.ok(fs.existsSync(path.join(dir, marker)), 'the prompt ran to completion');
    assert.equal(r.code, 0, 'gone is the monitor reporting, not the loop killing');
  } finally {
    discard(dir);
  }
});

// THE FLOOR STILL EXISTS AND STILL FIRES — the regression the brief names as
// "the assertion most likely to be quietly weakened by the very edit that makes
// the other three pass". A genuinely hung agent, with a MONITOR ATTACHED AND
// SAYING NOTHING (the case where the monitor itself has died, which
// `two-monitors-watch-the-agent` records as real), must still end.
//
// This is distinct from the bound tests above: those have no findings file at
// all. This one has a live, silent monitor — the exact configuration in which
// removing the timer would trade a wrong answer for no answer.
test('worker-loop: a hung agent still ends when its monitor says nothing', serial, async () => {
  const secs = 63;
  reap(secs);
  const dir = fixture('floor-holds', 1, `sleep ${secs}\n`);
  try {
    // A findings file that exists and stays empty: a monitor attached and mute.
    fs.writeFileSync(path.join(dir, '.plot-worker.monitor.worker.jsonl'), '');
    const started = Date.now();
    const r = await runLoop(dir);
    const elapsed = Date.now() - started;
    assert.equal(r.code, 124, 'the floor still ends a hung agent');
    assert.match(r.stderr, /exceeded the 1s bound/, 'and says it was the bound');
    assert.ok(elapsed < 10000, `the floor fired promptly, took ${elapsed}ms`);
  } finally {
    reap(secs);
    discard(dir);
  }
});

// `Worker bound: 0` DISABLES THE FLOOR AND NOT THE MONITOR. The escape already
// existed (`plot-worker-loop.sh`), and this slice must not quietly take it away
// or quietly widen it: a project that disabled the watchdog asked for no
// wall-clock kill, not for an unwatchable worker.
test('worker-loop: a zero bound keeps the monitor reading', serial, async () => {
  const secs = 64;
  reap(secs);
  const dir = fixture('zero-bound', 0, `sleep ${secs}\n`);
  try {
    setTimeout(() => publishFinding(dir, 'idle'), 900);
    const started = Date.now();
    const r = await runLoop(dir);
    const elapsed = Date.now() - started;
    assert.equal(r.code, 124, 'the monitor ended it though the floor was disabled');
    assert.match(r.stderr, /WorkerMonitor/, 'and named the reading');
    assert.ok(elapsed < 20000, `ended on the finding (${elapsed}ms)`);
  } finally {
    reap(secs);
    discard(dir);
  }
});

// NOTHING IS LEFT BEHIND BY THE NEW WATCHER EITHER. The bound's own leak tests
// above count `sleep <bound>`; the monitor watcher polls on its own cadence, so
// it gets its own marker and its own assertion. A watcher that outlived its
// worker would be a new leak inside the fix for a leak — the same sentence the
// bound's cleanup was written under.
//
// THE MARKER CANNOT BE THE POLL INTERVAL, and the first version of this test
// made that mistake: it set the poll to 66s so `sleep 66` would identify the
// watcher, which also meant the watcher slept 66s before its first read and
// never saw the finding. The interval a test slows down to observe is the same
// interval the behaviour needs to be fast.
//
// So the marker is the BOUND's sleep instead — a distinctive floor value the
// watchdog sleeps on — and the poll stays fast. That covers the same leak: on
// an idle ending the floor's watchdog has NOT fired, so its sleep is exactly
// the process that would be orphaned if the new ending path skipped the
// cleanup the timeout path already had.
test('worker-loop: no stray sleeps after an idle ending', serial, async () => {
  const promptSecs = 65;
  const boundSecs = 967; // distinctive; long enough never to fire here
  reap(promptSecs);
  reap(boundSecs);
  const dir = fixture('watcher-leak', boundSecs, `sleep ${promptSecs}\n`);
  try {
    setTimeout(() => publishFinding(dir, 'idle'), 900);
    const r = await runLoop(dir);
    assert.equal(r.code, 124, 'ended on the finding');
    await wait(500);
    assert.equal(sleepCount(promptSecs), 0, 'the prompt sleep was killed');
    assert.equal(sleepCount(boundSecs), 0,
      'the floor watchdog was reaped though the MONITOR ended the worker');
  } finally {
    reap(promptSecs);
    reap(boundSecs);
    discard(dir);
  }
});
