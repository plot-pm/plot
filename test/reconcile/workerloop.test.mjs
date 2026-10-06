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
import { testWorkerLoop, workerLoopLine } from './loop-switch.mjs';

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
// Most tests here hand the loop its branch through `PLOT_BRANCH` with no
// manifest and no remote. The JS loop takes its assignment from the registry's
// manifest, so those run on the shell loop only. The two checks-wait tests that
// read a failed build run on both loops: their fixture has a manifest and an
// origin, and the JS loop reads the build through a `BuildPort` fixture.
const serial = { concurrency: false, skip: testWorkerLoop() === 'js' && 'the JS loop takes its branch from the manifest, not PLOT_BRANCH' };

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
      ? `# t\n\n## Plot Config\n\n- **Plan directory:** docs/plans/\n${workerLoopLine()}`
      : `# t\n\n## Plot Config\n\n- **Worker bound:** ${boundSeconds}\n${workerLoopLine()}`);
  fs.writeFileSync(path.join(t, '.plot', 'worker-prompt.sh'), bodySh);
  // A fixture prompt proves it ran by touching a `*.marker` file in the desk.
  // The file is ignored, so that proof is not unlanded work: an uncommitted
  // file ends the loop with `holding-work`, which these tests do not measure.
  fs.writeFileSync(path.join(t, '.gitignore'), '*.marker\n');
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
 * Make a fixture's desk one the real watcher can judge `idle` on: an
 * `origin/main` ref `plot_worker_has_commits` can count against, and a REAL
 * file-touching commit beyond it.
 *
 * `fixture()`'s own commit is the ONLY one on the branch until this runs, and
 * `plot_worker_has_commits` excludes it on purpose — `plot-dispatch.sh`'s own
 * claim commit is `--allow-empty`, and the `-- .` pathspec this fixture's
 * commit is counted under is the same guard `workeridle.test.mjs` exercises.
 * Without a SEPARATE commit that touches a file, every idle-aimed test here
 * would be testing the no-commits refusal instead of the finding it names.
 */
function makeIdleDeskReady(dir) {
  // `origin/main` stands in for a real remote, exactly as `workeridle.test.mjs`
  // does it — `plot_worker_has_commits` only needs the ref to exist.
  git(dir, 'update-ref', 'refs/remotes/origin/main', 'HEAD');
  fs.writeFileSync(path.join(dir, 'work.txt'), 'the agent did something\n');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-qm', 'work the agent did');
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

function runLoop(cwd, { env = {}, killAfterMs = 0, signal = 'SIGTERM', script = loop } = {}) {
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
    const child = spawn('bash', [script], {
      cwd,
      detached: true,
      env: {
        ...process.env,
        PLOT_BRANCH: 'bug/x',
        PLOT_SLUG: 'x',
        PLOT_WORKTREE: cwd,
        PLOT_MANIFEST_FILE: '',
        // THE WAIT IS BOUNDED TO NOTHING HERE, because this fixture's loop has
        // no second slice to hop to and the property under test is about the
        // run it already made. Since `an-agent-waits-for-work` a silent
        // `--next` makes the agent WAIT rather than exit — correct in
        // production, and in a test it means the loop never returns. One poll
        // then the budget: the agent reports itself free, asks once, and ends
        // on the bound exactly as a real one does after `Worker bound`.
        PLOT_WAIT_POLL_SECONDS: '1',
        PLOT_WAIT_BUDGET_SECONDS: '1',
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

    // A BACKSTOP, because `exit` is the ONLY thing that resolves this promise —
    // so a loop that never exits hangs the test for the full `--test-timeout`,
    // and node's timeout kills the TEST without reaping the loop's group.
    //
    // Measured on CI 2026-08-31, across two runs of this file: `a timed-out
    // worker exits without hopping` (862) and `the bound fires with
    // timeout(1)/gtimeout absent from PATH` (863) each hung 300 002 ms in one
    // run and passed in ~1.1 s in the other. They are near-identical — bound 1s,
    // prompt 48/49s, same helper — so the flake is in `run_bounded`'s reaping,
    // not in either test, and it MOVES between adjacent tests.
    //
    // The witness caught what survives: one `plot-worker-loop.sh` holding a
    // `sleep 5` (the monitor watcher), parented to a dead test process, still
    // there ten minutes later.
    //
    // 60s is ~50x the honest duration of every test in this file and well under
    // the 300s test timeout, so it converts a five-minute wedge into a named
    // failure while never firing on a healthy run. It resolves rather than
    // rejects: the assertions then report what the loop actually did, which is
    // more useful than a timeout message.
    const HANG_BACKSTOP_MS = 60_000;
    const backstop = setTimeout(() => {
      // WHAT THE LOOP WAS DOING, captured BEFORE the kill — the one question
      // every previous occurrence left unanswered. `ps` output is the only
      // evidence available here: whether the watchdog subshell, the prompt
      // child, or neither still exists says which half of `run_bounded` is
      // stuck, and the CI witness runs 5+ minutes later when they are gone.
      let snapshot = '';
      try {
        snapshot = execFileSync('ps', ['-eo', 'pid,ppid,stat,args'], { encoding: 'utf8' })
          .split('\n')
          .filter((l) => /plot-worker-loop|sleep |worker-prompt/.test(l))
          .join('\n');
      } catch { snapshot = '(ps unavailable)'; }
      killGroup(child.pid, 'SIGKILL');
      stderr += `\nrunLoop: the loop did not exit within ${HANG_BACKSTOP_MS}ms;`
        + ` killed its process group. Live at that moment:\n${snapshot}`;
    }, HANG_BACKSTOP_MS);

    child.on('exit', (code, sig) => {
      if (timer) clearTimeout(timer);
      clearTimeout(backstop);
      // The loop has exited; its group may not have. Sweep it before resolving,
      // so no test can leave a descendant behind for the runner to wait on.
      killGroup(child.pid, 'SIGKILL');
      resolve({ code, signal: sig, stdout, stderr, pid: child.pid });
    });
  });
}

/**
 * The prompt ran to its own end — nothing truncated it.
 *
 * THIS USED TO BE `assert.equal(r.code, 0)`, and the exit code stopped
 * answering it on 2026-09-03. `an-agent-waits-for-work` replaced the loop's
 * `|| break` on a silent `--next`: an agent with nothing to take now waits and
 * ends on `Worker bound` rather than exiting, so every fixture here — a
 * one-slice sandbox with no second slice to hop to — ends 124 whether or not
 * its prompt was cut short. Exit 0 had become unreachable, which is why 11
 * tests in this file failed at once on a change none of them is about.
 *
 * SO THE QUESTION IS ASKED OF THE MESSAGE INSTEAD, and the message is the
 * better witness anyway: it was written to tell the three endings apart. A
 * truncated prompt says the bound expired or the monitor reported idle, ABOUT
 * THE PROMPT; a prompt that finished and left its agent with nothing to do says
 * the agent was free first. The one thing no healthy run may say is that
 * something ended the prompt.
 *
 * @param r the resolved `runLoop` result
 * @param why what the caller is really asserting, for the failure message
 */
function assertRanToItsOwnEnd(r, why) {
  assert.match(r.stderr, /free on /,
    `${why} — the agent must have reported itself free, meaning its prompt finished: ${r.stderr}`);
  assert.doesNotMatch(r.stderr, /the agent went quiet on /,
    `${why} — the monitor ended the prompt: ${r.stderr}`);
  assert.doesNotMatch(r.stderr, /the bound expired on \S+ — the prompt exceeded/,
    `${why} — the bound ended the prompt: ${r.stderr}`);
  assert.doesNotMatch(r.stderr, /nobody could tell on /,
    `${why} — the bound ended the prompt with no reading available: ${r.stderr}`);
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
    assert.equal(r.code, 124,
      `timeout uses the timeout(1) convention, exit 124\n--- loop stderr ---\n${r.stderr}`);
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
    assertRanToItsOwnEnd(r, 'an honest pass');
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
    assert.equal(r.code, 124, `timed out\n--- loop stderr ---\n${r.stderr}`);
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
    assert.equal(r.code, 124,
      `the bound fired without coreutils timeout(1)\n--- loop stderr ---\n${r.stderr}`);
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
    assertRanToItsOwnEnd(r, 'honest finish');
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
    assert.equal(r.code, 124, `timed out\n--- loop stderr ---\n${r.stderr}`);
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
// REPOINTED AT THE LOOP'S OWN WATCHER (`bug/the-loop-reports-idle`). The
// separate WorkerMonitor PROCESS this section's tests used to stub is gone;
// the loop's own watcher subshell takes the six readings itself, every
// `PLOT_MONITOR_INTERVAL`, by calling `plot_worker_idle_watch_pass`
// (`plot-worker-state.sh`). Most tests below now drive that REAL watcher over
// a REAL desk — a file-touching commit, an `origin/main` ref, and an aged
// transcript built by `makeIdleDeskReady`/`agedTranscriptHome` — with a short
// `PLOT_MONITOR_QUIET_SECONDS`/`PLOT_MONITOR_INTERVAL` so the real six-reading
// pass judges idle in seconds rather than the shipped 900s/30s. `publishFinding`
// below survives for the two cases where hand-writing a line into the findings
// file is still the right seam: a finding from a DIFFERENT monitor (the
// AgentMonitor, a separate file this loop never reads) and a finding this
// loop's watcher has no code path for at all (`gone`) — proving the loop
// ignores content it did not itself measure, not simulating a judgement it now
// makes itself.

/**
 * Write one monitor finding into a worktree's findings file, in the exact
 * shape `plot_worker_publish_finding` (`plot-worker-state.sh`) emits.
 *
 * THE PATH IS THE WATCHER'S OWN DEFAULT, not a convention invented here:
 * `monitor_findings_file` (`plot-worker-loop.sh`) falls back to
 * `$PLOT_WORKTREE/.plot-worker.monitor.worker.jsonl` when no
 * `PLOT_MONITOR_FILE` is given, exactly as a dispatched agent's loop does. A
 * test that agreed with the loop but not with that default would pass while
 * the fleet stayed broken.
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
    assertRanToItsOwnEnd(r, 'an honest pass');
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
  // A bound far longer than the test: the ending must come from the finding,
  // not the floor.
  const dir = fixture('idle-ends', 900, `sleep ${secs}\n`);
  makeIdleDeskReady(dir);
  // Aged well past the (shortened) window, so the FIRST watcher pass judges
  // idle rather than waiting out the window from a fresh transcript.
  const home = agedTranscriptHome(dir, 4000, 'idle-ends');
  try {
    const started = Date.now();
    const r = await runLoop(dir, {
      env: {
        PLOT_TRANSCRIPT_HOME: home,
        PLOT_SESSION_ID: 'idle-ends',
        PLOT_MANIFEST_FILE: '',
        PLOT_MONITOR_QUIET_SECONDS: '2',
        PLOT_MONITOR_INTERVAL: '1',
      },
    });
    const elapsed = Date.now() - started;
    assert.notEqual(r.code, 0, 'the loop ended the worker');
    assert.equal(r.code, 124, `ending a worker keeps the timeout(1) convention\n--- stderr ---\n${r.stderr}`);
    assert.ok(elapsed < 40000, `ended on the finding, not the 900s bound (${elapsed}ms)`);
  } finally {
    reap(secs);
    fs.rmSync(home, { recursive: true, force: true });
    discard(dir);
  }
});

// THE READING MAY BE PUBLISHED WITHOUT ENDING THE WORKER, and this is the arm
// that proves the seam. `idle` means the subtree burned no CPU across a 0.4s
// sample (`plot-worker-state.sh:493`) taken twice ~30s apart, and an agent
// waiting on a model response burns no CPU in its subtree — so a false zero is
// the common reading, not the rare one.
//
// Measured 2026-09-01: seven desks on this estate carry `reported idle on`,
// every one holding real commits, and `the-gates-read-what-was-left-behind` was
// ended 11s after dispatch with 2 commits and an unwritten changeset.
//
// `PLOT_MONITOR_ENDS_WORKER=0` leaves ending a worker to `Worker bound` alone.
// The pair of tests is the point: the same fixture and the same published
// finding, differing only in the variable, so neither arm can pass by accident.
test('worker-loop: PLOT_MONITOR_ENDS_WORKER=0 publishes idle and does not end', serial, async () => {
  const secs = 20;
  reap(secs);
  // A bound LONGER than the body, so anything that ends this run early ended it
  // on the finding. The body outlives several watcher polls and then exits
  // cleanly — long enough for the REAL watcher to judge idle at least once
  // while `PLOT_MONITOR_ENDS_WORKER=0` keeps it from acting on that judgement.
  const dir = fixture('idle-not-ends', 900, `sleep ${secs}\n`);
  makeIdleDeskReady(dir);
  const home = agedTranscriptHome(dir, 4000, 'idle-not-ends');
  try {
    const started = Date.now();
    const r = await runLoop(dir, {
      env: {
        PLOT_MONITOR_ENDS_WORKER: '0',
        PLOT_TRANSCRIPT_HOME: home,
        PLOT_SESSION_ID: 'idle-not-ends',
        PLOT_MANIFEST_FILE: '',
        PLOT_MONITOR_QUIET_SECONDS: '2',
        PLOT_MONITOR_INTERVAL: '1',
      },
    });
    const elapsed = Date.now() - started;
    assertRanToItsOwnEnd(r, 'the worker ran to its own end');
    // The watcher now ALWAYS publishes regardless of the flag — only the
    // `kill -USR1` is gated — so the finding should still reach the file even
    // though it must not end the worker.
    const findings = path.join(dir, '.plot-worker.monitor.worker.jsonl');
    const published = fs.existsSync(findings)
      ? fs.readFileSync(findings, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l))
      : [];
    assert.ok(published.some((f) => f.finding === 'idle'),
      `the watcher must still publish idle with the flag off: ${JSON.stringify(published)}`);
    assert.ok(elapsed >= secs * 1000 - 1500,
      `ran its full body rather than being cut short (${elapsed}ms for a ${secs}s body)`);
  } finally {
    reap(secs);
    fs.rmSync(home, { recursive: true, force: true });
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
  makeIdleDeskReady(dir);
  const home = agedTranscriptHome(dir, 4000, 'idle-message');
  try {
    const r = await runLoop(dir, {
      env: {
        PLOT_TRANSCRIPT_HOME: home,
        PLOT_SESSION_ID: 'idle-message',
        PLOT_MANIFEST_FILE: '',
        PLOT_MONITOR_QUIET_SECONDS: '2',
        PLOT_MONITOR_INTERVAL: '1',
      },
    });
    assert.equal(r.code, 124, `ended\n--- stderr ---\n${r.stderr}`);
    // "WorkerMonitor" is the PUBLISHED FINDING's own field
    // (`plot_worker_publish_finding`'s `"monitor":"WorkerMonitor"`), which the
    // watcher subshell prints to STDOUT via its `plot-watch …` line — never to
    // stderr, where the loop's own ending message lives.
    assert.match(r.stdout, /WorkerMonitor/,
      'the published finding names the monitor whose reading ended the worker');
    assert.match(r.stderr, /idle/, 'the message names the finding');
    assert.doesNotMatch(r.stderr, /exceeded the \d+s bound/,
      'a monitor ending must not be reported as the wall-clock bound');
  } finally {
    reap(secs);
    fs.rmSync(home, { recursive: true, force: true });
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
// REWRITTEN FOR THE REAL WATCHER. The old fixture published every finding
// EXCEPT `idle` by hand (an AgentMonitor placeholder, a bare WorkerMonitor
// `clear`) to prove the loop reacts to none of them — but with the publisher
// gone, nothing injects those by hand anymore, and the AgentMonitor case is
// already covered on its own below. What the brief's "no commits" property
// still needs is a desk the real watcher would call `idle` on EXCEPT for one
// thing: no real commit beyond the fixture's own init. `plot_worker_has_commits`
// must then refuse (unanswerable/no), withholding the finding regardless of how
// quiet everything else reads.
test('worker-loop: a quiet agent with no idle finding is not ended', serial, async () => {
  const marker = 'quiet-finished.marker';
  const secs = 9;
  const dir = fixture('quiet-nocommits', 900,
    `sleep ${secs}; touch "$PLOT_WORKTREE/${marker}"; echo done\n`);
  // Deliberately NOT calling makeIdleDeskReady: no `origin/main` ref and no
  // extra commit, so `plot_worker_has_commits` answers `unanswerable` and
  // `idle` can never fire no matter how old the transcript reads.
  const home = agedTranscriptHome(dir, 4000, 'quiet-nocommits');
  try {
    const r = await runLoop(dir, {
      env: {
        PLOT_TRANSCRIPT_HOME: home,
        PLOT_SESSION_ID: 'quiet-nocommits',
        PLOT_MANIFEST_FILE: '',
        PLOT_MONITOR_QUIET_SECONDS: '2',
        PLOT_MONITOR_INTERVAL: '1',
      },
    });
    assert.ok(fs.existsSync(path.join(dir, marker)), 'the quiet prompt ran to completion');
    assertRanToItsOwnEnd(r, 'silence with no commits is not a verdict');
    // The published finding's `"monitor":"WorkerMonitor"` line goes to stdout
    // (the watcher's own `plot-watch …` line), so that is where a stray
    // publish would show up.
    assert.doesNotMatch(r.stdout, /WorkerMonitor/, 'nothing was read as a finding');
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
    discard(dir);
  }
});

// DROPPED (`bug/the-loop-reports-idle`). The property this guarded — "the
// reading is the LAST finding, not any finding" — was about a SEPARATE
// process's file carrying a stale `idle` line a second reader might grep for
// instead of the newest one. With the WorkerMonitor process gone, the loop's
// own watcher subshell is the ONLY writer of this file, and it holds its own
// in-process `PLOT_WATCH_PUBLISHED` state rather than re-reading the file —
// there is no longer a "some OTHER line in the file" for a recovered worker to
// be confused with, because nothing outside the watcher's own pass writes
// here at all. Forcing a real recovery (idle, then genuinely busy again) would
// test the SAME `plot_worker_idle_now` logic `workeridle.test.mjs` already
// covers over a real desk, not a loop-specific concern.

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
    assertRanToItsOwnEnd(r, 'only the WorkerMonitor ends a worker');
  } finally {
    discard(dir);
  }
});

// A `gone` FINDING IS NOT THIS LOOP'S BUSINESS. `gone` is no longer published
// by anything the loop's own watcher reads or reacts to — `plot_worker_idle_now`
// has no `gone` arm at all (`plot-worker-state.sh`'s own comment: "a dead pid
// answers `silent`"), and `gone` is now the DISPATCHER WRAPPER's own finding,
// written after `wait "$agent"` returns, which this test's harness never runs.
//
// STILL WORTH KEEPING: a stray `gone` line sitting in the findings file —
// however it got there — must be inert to the loop, which only ever reads
// what its OWN watcher pass measures on its own schedule, never the file's
// prior content. Pre-seeded rather than timed, since there is no longer a
// separate monitor process to race against; the loop's watcher may read this
// file's content on its own schedule but has no code path that acts on this
// finding regardless of when it sees it.
test('worker-loop: a gone finding does not end the worker', serial, async () => {
  const marker = 'gone-ignored.marker';
  const dir = fixture('gone', 900,
    `sleep 3; touch "$PLOT_WORKTREE/${marker}"; echo done\n`);
  try {
    publishFinding(dir, 'gone');
    const r = await runLoop(dir);
    assert.ok(fs.existsSync(path.join(dir, marker)), 'the prompt ran to completion');
    assertRanToItsOwnEnd(r, 'gone is the wrapper reporting, not the loop killing');
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
  makeIdleDeskReady(dir);
  const home = agedTranscriptHome(dir, 4000, 'zero-bound');
  try {
    const started = Date.now();
    const r = await runLoop(dir, {
      env: {
        PLOT_TRANSCRIPT_HOME: home,
        PLOT_SESSION_ID: 'zero-bound',
        PLOT_MANIFEST_FILE: '',
        PLOT_MONITOR_QUIET_SECONDS: '2',
        PLOT_MONITOR_INTERVAL: '1',
      },
    });
    const elapsed = Date.now() - started;
    assert.equal(r.code, 124, `the monitor ended it though the floor was disabled\n--- stderr ---\n${r.stderr}`);
    // The published finding's `"monitor":"WorkerMonitor"` field is printed to
    // stdout (the watcher's `plot-watch …` line), not stderr.
    assert.match(r.stdout, /WorkerMonitor/, 'and named the reading');
    assert.ok(elapsed < 40000, `ended on the finding (${elapsed}ms)`);
  } finally {
    reap(secs);
    fs.rmSync(home, { recursive: true, force: true });
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
  makeIdleDeskReady(dir);
  const home = agedTranscriptHome(dir, 4000, 'watcher-leak');
  try {
    const r = await runLoop(dir, {
      env: {
        PLOT_TRANSCRIPT_HOME: home,
        PLOT_SESSION_ID: 'watcher-leak',
        PLOT_MANIFEST_FILE: '',
        PLOT_MONITOR_QUIET_SECONDS: '2',
        PLOT_MONITOR_INTERVAL: '1',
      },
    });
    assert.equal(r.code, 124, `ended on the finding\n--- stderr ---\n${r.stderr}`);
    await wait(500);
    assert.equal(sleepCount(promptSecs), 0, 'the prompt sleep was killed');
    assert.equal(sleepCount(boundSecs), 0,
      'the floor watchdog was reaped though the MONITOR ended the worker');
  } finally {
    reap(promptSecs);
    reap(boundSecs);
    fs.rmSync(home, { recursive: true, force: true });
    discard(dir);
  }
});

// ───────────────────────────────────────────────────────────────────────────
// THE DECLARATION — `.plot-worker.envelope.json`, written when a BRANCH
// finishes rather than when the worker exits.
//
// Measured 2026-08-31: three dispatched workers hit the 8 h `Worker bound`,
// died at `exit 124`, and had committed and pushed real work with no PR.
// Nothing reported it, because every worker exits 0 and Plot inferred
// completion from a process ending. `plot-worker-state.sh:46` states the
// defect; these tests state the replacement.
//
// ASSERTED FROM THE FILE ON DISK, never from the loop's source. A test that
// greps the script for a call it hopes fires is what a green suite over a dead
// path looks like — the shape this repo already shipped once.
// ───────────────────────────────────────────────────────────────────────────

const DECLARATION = '.plot-worker.envelope.json';

/** Read a desk's declaration, or null when it has none. */
function declarationOf(dir) {
  const file = path.join(dir, DECLARATION);
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

test('worker-loop: a finished branch leaves a declaration naming it', serial, async () => {
  // The bare minimum the contract promises: the agent's prompt returned on its
  // own, so the branch is finished and the desk says so.
  const dir = fixture('declare-ok', 60, 'echo working\n');
  try {
    const r = await runLoop(dir, { env: { PLOT_BRANCH: 'feature/declared' } });
    assertRanToItsOwnEnd(r, 'an honest pass');
    const declared = declarationOf(dir);
    assert.ok(declared, 'a finished branch must leave a declaration');
    assert.equal(declared.branch, 'feature/declared',
      'the declaration names the branch the loop knows it finished');
    assert.equal(declared.status, 'ok', 'a branch that finished is ok by default');
  } finally {
    discard(dir);
  }
});

test('worker-loop: a killed worker leaves NO declaration', serial, async () => {
  // ABSENCE IS THE LOAD-BEARING CASE. A worker killed by the bound never
  // reaches the write, so its desk is silent — and silence means incomplete,
  // whatever the exit code says.
  const secs = 53;
  reap(secs);
  const dir = fixture('declare-killed', 1, `sleep ${secs}\n`);
  try {
    const r = await runLoop(dir, { env: { PLOT_BRANCH: 'feature/killed' } });
    assert.equal(r.code, 124, 'the bound fired');
    assert.equal(declarationOf(dir), null,
      'a worker the bound killed must leave no declaration');
  } finally {
    reap(secs);
    discard(dir);
  }
});

test('worker-loop: the same desk declares when the prompt returns and not when it is killed',
  serial, async () => {
    // THE DISCRIMINATING FORM, and the reason both halves are asserted in ONE
    // test. A write that never fired would pass the absence test above while
    // proving nothing. Here the SAME fixture body runs twice — once fast enough
    // to finish, once not — and the verdict must differ.
    const secs = 59;
    reap(secs);
    const finished = fixture('declare-both-ok', 60, 'echo done\n');
    const killed = fixture('declare-both-killed', 1, `sleep ${secs}\n`);
    try {
      await runLoop(finished, { env: { PLOT_BRANCH: 'feature/same' } });
      await runLoop(killed, { env: { PLOT_BRANCH: 'feature/same' } });
      assert.notEqual(declarationOf(finished), null, 'the finished desk declares');
      assert.equal(declarationOf(killed), null, 'the killed desk does not');
    } finally {
      reap(secs);
      discard(finished);
      discard(killed);
    }
  });

test('worker-loop: the agent’s own account survives, and the branch is the loop’s', serial, async () => {
  // PLOT DOES NOT OWN THE PROMPT. `.plot/worker-prompt.sh` belongs to the
  // adopting project, and the agent is the only party that knows what it
  // produced — so `artifacts`, `pr` and `summary` are kept verbatim. `branch`
  // is not: the loop knows which branch it ran, and an agent may misname it.
  const body = `cat > "$PLOT_WORKTREE/${DECLARATION}" <<'JSON'
{ "branch": "feature/wrong", "status": "ok",
  "artifacts": ["packages/domain/src/rules/reap.ts"],
  "pr": 571, "summary": "one sentence" }
JSON
`;
  const dir = fixture('declare-agent', 60, body);
  try {
    await runLoop(dir, { env: { PLOT_BRANCH: 'feature/right' } });
    const declared = declarationOf(dir);
    assert.equal(declared.branch, 'feature/right', 'the loop’s branch wins');
    assert.deepEqual(declared.artifacts, ['packages/domain/src/rules/reap.ts'],
      'the agent’s artifacts survive');
    assert.equal(declared.pr, 571, 'the agent’s PR number survives');
    assert.equal(declared.summary, 'one sentence', 'the agent’s summary survives');
  } finally {
    discard(dir);
  }
});

test('worker-loop: a blocked declaration is not rewritten to ok', serial, async () => {
  // An agent reporting that it CANNOT proceed is information, and different
  // from silence. Overwriting it would turn a report into a completion.
  const body = `printf '%s' '{"branch":"feature/b","status":"blocked","summary":"needs a person"}' \\
  > "$PLOT_WORKTREE/${DECLARATION}"
`;
  const dir = fixture('declare-blocked', 60, body);
  try {
    await runLoop(dir, { env: { PLOT_BRANCH: 'feature/b' } });
    const declared = declarationOf(dir);
    assert.equal(declared.status, 'blocked', 'a declared block stays blocked');
    assert.equal(declared.summary, 'needs a person');
  } finally {
    discard(dir);
  }
});

test('worker-loop: a half-written declaration is left exactly as it is', serial, async () => {
  // OVERWRITING IT WOULD LAUNDER bytes nobody can believe into a declaration
  // that says the branch finished. The domain's parse keeps *unreadable* apart
  // from *complete* for that reason, and this is the write side of the same
  // rule: a file that does not parse stays a file that does not parse.
  const half = '{ "branch": "feature/half", "status": "o';
  const body = `printf '%s' '${half}' > "$PLOT_WORKTREE/${DECLARATION}"\n`;
  const dir = fixture('declare-half', 60, body);
  try {
    await runLoop(dir, { env: { PLOT_BRANCH: 'feature/half' } });
    assert.equal(fs.readFileSync(path.join(dir, DECLARATION), 'utf8'), half,
      'the loop must not rewrite a declaration it could not read');
  } finally {
    discard(dir);
  }
});

test('worker-loop: no declaration is written for a branch the loop cannot name', serial, async () => {
  // A declaration is ABOUT a branch. One that names none cannot be attributed
  // to anything, and an unattributable file is worse than the absence it
  // replaces — a reader would count it and learn nothing.
  const dir = fixture('declare-nobranch', 60, 'echo working\n');
  try {
    await runLoop(dir, { env: { PLOT_BRANCH: '' } });
    assert.equal(declarationOf(dir), null,
      'no branch means no declaration, not a declaration with an empty branch');
  } finally {
    discard(dir);
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// THREE ENDINGS, THREE SENTENCES
// `docs/plans/2026-09-01-an-idle-agent-is-not-a-stalled-one.md`, wave
// `Saying what happened`.
// ═══════════════════════════════════════════════════════════════════════════
//
// A worker can stop for three reasons that need three different moves, and two
// of them reached the floor by different roads and printed one sentence:
//
//   the agent went quiet   a monitor verdict. The desk holds finished-looking
//                          work worth rescuing.
//   the bound expired      the reading WAS available and said nothing. Nobody
//                          knows what state the desk is in.
//   nobody could tell      no transcript can be read for this worktree, so no
//                          reading distinguishes thinking from stuck. The
//                          reason is an ABSENCE, and it is the ADOPTER'S
//                          `.plot/worker-prompt.sh` to fix rather than the
//                          agent's work to inspect.
//
// THE THIRD IS WAVE 2's OWN FALLBACK REPORTING ITSELF. `sample_verdict` turns
// `unavailable` into `unknown`, publishes nothing, and lets `Worker bound` end
// the worker — deliberately, and this slice does not touch it. What it changes
// is that the log then said *"no monitor finding said why"*, which is literally
// true and hides that the monitor could never have said anything on that desk.
//
// THE TRANSCRIPT HOME IS THE LEVER, and it is the honest one. The reading joins
// a worktree to `$HOME/.claude/projects/<slug>` by path
// (`plot-transcript-quiet.sh`), and `PLOT_TRANSCRIPT_HOME` overrides the root.
// Pointing it at a directory holding the right slug is a desk WITH a readable
// transcript; pointing it at an empty one is a desk without — which is the
// configuration Plot cannot control and the plan's Done-when names.

/**
 * A transcript home for `dir`, holding `hasTranscript` sessions for it.
 *
 * The slug is the worktree path with `/` and `.` replaced by `-`, which is the
 * runtime's own derivation and is duplicated in three places on purpose
 * (`plot-transcript-quiet.sh` says why). Spelling it a fourth time here rather
 * than sourcing the shell keeps the test independent of the thing under test:
 * a loop that read the WRONG slug would still pass a test that asked the loop
 * for the slug.
 *
 * Returns the home path; the caller discards it.
 */
function transcriptHome(dir, { hasTranscript }) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-tqhome-'));
  if (hasTranscript) {
    const slug = dir.replace(/[/.]/g, '-');
    const d = path.join(home, '.claude', 'projects', slug);
    fs.mkdirSync(d, { recursive: true });
    // Content is never parsed — the mtime IS the reading — so one line of
    // anything is a transcript for this purpose.
    fs.writeFileSync(path.join(d, 'session.jsonl'), '{"type":"user"}\n');
  }
  return home;
}

/**
 * A transcript home for `dir`, holding ONE session file aged `ageSeconds` in
 * the past, named for `sessionId`.
 *
 * `transcriptHome` above always writes a FRESH-mtime file named `session.jsonl`
 * — right for the floor's two arms, which only ask `ended_reading_available`
 * whether ANY file exists in the directory. The real watcher's `idle` finding
 * instead goes through `plot_worker_conversation_spoken`, which calls
 * `plot_transcript_exists "$wt" "$handle"` — and that checks for
 * `$dir/$id.jsonl` BY NAME, where `$id` is `session_handle`'s answer
 * (`PLOT_SESSION_ID` here, since the fixture's `PLOT_MANIFEST_FILE` is blanked).
 * A file named anything else reads as `spoken=0` (unspoken), which
 * `plot_worker_idle_now` treats exactly like a live, chatty agent — never
 * idle — so a mismatched filename silently withholds the finding forever.
 * Measured while writing this: `session.jsonl` against `PLOT_SESSION_ID`
 * `idle-ends` never found the file and the watcher reported `spoken=0` on
 * every one of 16 passes across a 16s run.
 *
 * ALSO AGED, unlike `transcriptHome`. The real watcher's `idle` finding reads
 * `plot_transcript_quiet_seconds`, which measures from the file's mtime, so a
 * test that wants the watcher to judge `idle` quickly needs a transcript that
 * is ALREADY old on disk — a fresh one would make the watcher wait out the
 * full quiet window from scratch, same as a real desk would. `touch -t` sets
 * the mtime directly, following `workeridle.test.mjs`'s own `touchStamp`
 * pattern.
 *
 * Returns the home path; the caller discards it.
 */
function agedTranscriptHome(dir, ageSeconds, sessionId) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-tqhome-aged-'));
  const slug = dir.replace(/[/.]/g, '-');
  const d = path.join(home, '.claude', 'projects', slug);
  fs.mkdirSync(d, { recursive: true });
  const transcript = path.join(d, `${sessionId}.jsonl`);
  fs.writeFileSync(transcript, '{"type":"user"}\n');
  const past = new Date(Date.now() - ageSeconds * 1000);
  const p2 = (n) => String(n).padStart(2, '0');
  const stamp = `${past.getFullYear()}${p2(past.getMonth() + 1)}${p2(past.getDate())}` +
    `${p2(past.getHours())}${p2(past.getMinutes())}.${p2(past.getSeconds())}`;
  execFileSync('touch', ['-t', stamp, transcript]);
  return home;
}

// The floor's FIRST arm — the reading was there and stayed silent.
test('worker-loop: a readable transcript makes the floor say the bound expired', serial, async () => {
  const secs = 71;
  reap(secs);
  const dir = fixture('floor-readable', 1, `sleep ${secs}\n`);
  const home = transcriptHome(dir, { hasTranscript: true });
  try {
    const r = await runLoop(dir, { env: { PLOT_TRANSCRIPT_HOME: home } });
    assert.equal(r.code, 124, `the floor ended it\n--- stderr ---\n${r.stderr}`);
    assert.match(r.stderr, /the bound expired/,
      'the floor names its own reading rather than borrowing another');
    assert.match(r.stderr, /exceeded the 1s bound/,
      'and still carries the phrase a reader greps for');
    assert.doesNotMatch(r.stderr, /nobody could tell/,
      'a desk whose transcript CAN be read is not an unmeasurable one');
  } finally {
    reap(secs);
    fs.rmSync(home, { recursive: true, force: true });
    discard(dir);
  }
});

// The floor's SECOND arm — the plan's Done-when, asserted against the
// configuration Plot cannot control: an adopter's prompt that passes no
// `--session-id`, so no transcript exists for the desk at all.
test('worker-loop: with no readable transcript the floor says nobody could tell', serial, async () => {
  const secs = 72;
  reap(secs);
  const dir = fixture('floor-unreadable', 1, `sleep ${secs}\n`);
  // A home that exists and holds NOTHING for this worktree. Not a missing
  // directory: the runtime creates the project directory on first open, so
  // "exists but empty" is the shape a real unconfigured desk has, and
  // `plot_transcript_quiet_seconds` answers `unavailable` for both.
  const home = transcriptHome(dir, { hasTranscript: false });
  try {
    const r = await runLoop(dir, { env: { PLOT_TRANSCRIPT_HOME: home } });
    assert.equal(r.code, 124, `the bound is still what ends it\n--- stderr ---\n${r.stderr}`);
    assert.match(r.stderr, /nobody could tell/, 'the third reading has its own sentence');
    assert.match(r.stderr, /no transcript could be read/,
      'and the sentence says WHAT was missing');
    assert.doesNotMatch(r.stderr, /no monitor finding said why/,
      'the unavailable case must not borrow the bound arm, which claims a '
      + 'measurement was made and came back empty');
    assert.match(r.stderr, /exceeded the 1s bound/,
      'the bound is still the fallback and still what a reader greps for');
  } finally {
    reap(secs);
    fs.rmSync(home, { recursive: true, force: true });
    discard(dir);
  }
});

// THE FALLBACK IS THE BOUND AND NOTHING ELSE. The plan prices this deliberately
// — "a genuinely stuck agent then holds a desk for up to 8 hours, which is
// smaller than the measured cost of the rule this replaces". An unreadable
// transcript must therefore change the SENTENCE and never the timing: a slice
// that added a kill for the unavailable case would pass both message tests
// above and reintroduce the defect the plan exists to remove.
test('worker-loop: an unreadable transcript does not end a worker early', serial, async () => {
  const marker = 'unreadable-finished.marker';
  // A bound far beyond the body, so anything ending this run early ended it on
  // the unavailable reading rather than on the floor.
  const dir = fixture('unreadable-noend', 900,
    `sleep 3; touch "$PLOT_WORKTREE/${marker}"; echo done\n`);
  const home = transcriptHome(dir, { hasTranscript: false });
  try {
    const r = await runLoop(dir, { env: { PLOT_TRANSCRIPT_HOME: home } });
    assert.ok(fs.existsSync(path.join(dir, marker)),
      'the prompt ran to completion though its transcript could not be read');
    assertRanToItsOwnEnd(r, 'an unreadable reading is not an ending');
    assert.doesNotMatch(r.stderr, /nobody could tell/,
      'the third sentence belongs to an ENDING, not to every quiet desk');
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
    discard(dir);
  }
});

// The MONITOR arm, and the half of it this slice owns: the sentence must
// describe wave 2's reading rather than the one wave 2 rejected. Until this
// slice it read "burned no CPU and changed nothing across two passes", which is
// how the OLD rule reached its verdict — a 0.4s subtree CPU sample that ended
// eleven dispatched workers. The verdict is now transcript silence past the
// window, with the CPU consulted only to prove a child is on a core.
test('worker-loop: the monitor sentence describes the transcript reading', serial, async () => {
  const secs = 73;
  reap(secs);
  const dir = fixture('monitor-sentence', 900, `sleep ${secs}\n`);
  makeIdleDeskReady(dir);
  const home = agedTranscriptHome(dir, 4000, 'monitor-sentence');
  try {
    const r = await runLoop(dir, {
      env: {
        PLOT_TRANSCRIPT_HOME: home,
        PLOT_SESSION_ID: 'monitor-sentence',
        PLOT_MANIFEST_FILE: '',
        PLOT_MONITOR_QUIET_SECONDS: '2',
        PLOT_MONITOR_INTERVAL: '1',
      },
    });
    assert.equal(r.code, 124, `the finding ended it\n--- stderr ---\n${r.stderr}`);
    assert.match(r.stderr, /the agent went quiet/,
      'the monitor ending names its own reading');
    assert.match(r.stderr, /transcript/,
      'and the evidence it names is the transcript, which is what wave 2 reads');
    assert.doesNotMatch(r.stderr, /burned no CPU/,
      'the rejected rule must not be described as the reading that fired: a 0.4s '
      + 'CPU sample is not how this verdict is reached');
    assert.doesNotMatch(r.stderr, /the bound expired|nobody could tell/,
      'a monitor verdict is neither floor arm');
  } finally {
    reap(secs);
    fs.rmSync(home, { recursive: true, force: true });
    discard(dir);
  }
});

// THE THREE SENTENCES ARE MUTUALLY EXCLUSIVE, asserted over the SOURCE rather
// than over three runs. Each of the tests above proves its own arm prints; none
// of them proves a FOURTH arm was not added, or that two arms cannot both
// match. The leading clauses are the operator's index into the three, so they
// must partition the endings exactly.
test('worker-loop: exactly three endings are spelled, one per reading', serial, () => {
  const src = fs.readFileSync(loop, 'utf8');
  // Only the lines the loop PRINTS, so the prose above them cannot satisfy this.
  const printed = src.split('\n').filter((l) => /^\s*echo "plot-worker-loop: /.test(l));
  const leads = ['the agent went quiet', 'the bound expired', 'nobody could tell'];
  for (const lead of leads) {
    const hits = printed.filter((l) => l.includes(lead));
    assert.equal(hits.length, 1,
      `exactly one printed line leads with "${lead}", found ${hits.length}`);
  }
  const endings = printed.filter((l) => l.includes('ending worker without hopping'));
  assert.equal(endings.length, leads.length,
    `every ending message is one of the three readings; found ${endings.length}`);
  for (const e of endings) {
    assert.equal(leads.filter((l) => e.includes(l)).length, 1,
      `each ending names exactly one reading: ${e.trim()}`);
  }

  // THE WAIT'S ENDING IS A FOURTH, AND IT IS HELD OUTSIDE THE THREE.
  // `an-agent-waits-for-work` added an ending that is not about a prompt: an
  // agent that finished, found nothing to take and waited out its bound. It
  // must not borrow any of the three leading clauses, because those are the
  // operator's index into *what happened to the work in the worktree* and this
  // ending's answer is "nothing was running". Nor may it carry
  // `ending worker without hopping`, which is the phrase that marks a
  // truncated prompt — the assertion above counts on that.
  const waitEndings = printed.filter((l) => l.includes('the wait ran out'));
  assert.equal(waitEndings.length, 1,
    `exactly one printed line ends a wait, found ${waitEndings.length}`);
  assert.equal(leads.filter((l) => waitEndings[0].includes(l)).length, 0,
    `the wait's ending borrows none of the prompt readings: ${waitEndings[0].trim()}`);
  assert.doesNotMatch(waitEndings[0], /ending worker without hopping/,
    'the wait\'s ending is not one of the three, so it does not carry their phrase');
});

// ---------------------------------------------------------------------------
// A BRANCHLESS AGENT WAITS — the guard `an-agent-is-started-by-a-command` added
// ---------------------------------------------------------------------------
//
// `plot-dispatch.sh --start` brings agents into existence with NO slice
// assigned: free, registered, and waiting for the registry to hand one over.
// The loop opened `while true; do ... run_bounded` with no guard on
// `PLOT_BRANCH` anywhere above it, so such an agent ran the project's worker
// prompt — which begins *"You are implementing the branch $PLOT_BRANCH"* —
// against an empty variable, and reached the hand-over having already spent its
// bound on a sentence with a hole in it. Measured 2026-09-05.
//
// THE PROMPT ITSELF IS THE WITNESS. Every test here uses a stub prompt that
// prints a marker; the assertion is that the marker is absent, which is the one
// thing no reading of the loop's own log can fake.

test('worker-loop: a branchless agent waits and never runs the prompt', serial, async () => {
  const t = fixture('branchless-waits', 5, 'echo "PROMPT-RAN branch=[$PLOT_BRANCH]" >&2\n');
  const { stderr } = await runLoop(t, { env: { PLOT_BRANCH: '', PLOT_SLUG: '' } });
  discard(t);

  assert.doesNotMatch(stderr, /PROMPT-RAN/,
    'a loop started with no branch must not run the worker prompt');
  assert.match(stderr, /nothing handed over yet/,
    'it enters the wait instead, and the wait says what it is waiting for');
});

test('worker-loop: a branchless agent ends on the WAIT bound, not a prompt reading',
  serial, async () => {
  // The fourth ending, and it is the right one: no prompt was running, nothing
  // was cut short, and the desk is clean by construction. An agent that had run
  // the prompt would end with one of the three prompt readings instead.
  const t = fixture('branchless-ending', 5, 'echo "PROMPT-RAN" >&2\n');
  const { stderr } = await runLoop(t, { env: { PLOT_BRANCH: '', PLOT_SLUG: '' } });
  discard(t);

  assert.match(stderr, /the wait ran out/,
    'the branchless agent ends on the wait bound');
  assert.doesNotMatch(stderr, /ending worker without hopping/,
    'which is not one of the three prompt endings, so it does not carry their phrase');
});

test('worker-loop: a branchless agent takes the branch its manifest names', serial, async () => {
  // THE HAND-OVER IS REACHED, which is the other half of the guard: skipping the
  // prompt block must not skip the wait's exit. The manifest already names a
  // branch, so the wait returns at once and the loop goes on to take it — here
  // it fails to cut a desk (no remote in the fixture) and says so, which is
  // proof it got past the wait rather than proof of anything about desks.
  const t = fixture('branchless-takes', 5, 'echo "PROMPT-RAN" >&2\n');
  fs.mkdirSync(path.join(t, '.plot', 'agents'), { recursive: true });
  const manifest = path.join(t, '.plot', 'agents', 'free.json');
  fs.writeFileSync(manifest, JSON.stringify({
    session: 'free', branch: 'feature/handed-over', worktree: t,
  }));
  const { stderr } = await runLoop(t, {
    env: { PLOT_BRANCH: '', PLOT_SLUG: '', PLOT_MANIFEST_FILE: manifest },
  });
  discard(t);

  assert.doesNotMatch(stderr, /PROMPT-RAN/,
    'the prompt is still not run: this agent held no branch when it started');
  assert.match(stderr, /feature\/handed-over/,
    'the loop reached the hand-over and read the branch the registry wrote');
});

test('worker-loop: an agent WITH a branch still runs its prompt', serial, async () => {
  // THE GUARD IS A GUARD AND NOT A REMOVAL. Every existing path must be
  // unchanged, which is what this asserts from the other side: the same fixture,
  // the same stub, one variable different.
  const t = fixture('branch-still-runs', 5, 'echo "PROMPT-RAN branch=[$PLOT_BRANCH]" >&2\n');
  const { stderr } = await runLoop(t, { env: { PLOT_BRANCH: 'feature/held' } });
  discard(t);

  assert.match(stderr, /PROMPT-RAN branch=\[feature\/held\]/,
    'an agent holding a branch runs the prompt with it, exactly as before');
});

test('worker-loop: the prompt does not inherit PLOT_REPO_ROOT', serial, async () => {
  // The loop runs with the variable set, as the supervisor's unit sets it; the
  // prompt, and every test an agent starts from it, must not see it.
  const t = fixture('no-repo-root', 5, 'echo "PROMPT-ROOT=[${PLOT_REPO_ROOT-unset}]" >&2\n');
  const { stderr } = await runLoop(t, { env: { PLOT_BRANCH: 'feature/held', PLOT_REPO_ROOT: t } });
  discard(t);

  assert.match(stderr, /PROMPT-ROOT=\[unset\]/,
    'the prompt runs without PLOT_REPO_ROOT, so a sandbox it builds reads its own config');
});

// ═══════════════════════════════════════════════════════════════════════════
// THE WATCHER FOLLOWS A HOP TAKEN ON THE CREATE PATH — locks in #1218
// ═══════════════════════════════════════════════════════════════════════════
//
// `bug/the-loop-reports-idle` already made the loop's own watcher subshell
// read `${PLOT_WORKTREE:-$PWD}` fresh every pass, and the hop block re-exports
// `PLOT_WORKTREE` to the new desk (`plot-worker-loop.sh:2994`) before the next
// iteration. This is the regression lock for that property, on the CREATE
// path specifically — #1085's third row: `desk_reset_refusal` finds
// `uncommitted-changes` on the launch desk, so the loop leaves it exactly as
// it is and cuts a brand-new `plot-wt-<suffix>` for the next branch, rather
// than resetting in place. `bug/the-monitor-follows-the-hop` touches the two
// remaining monitors and the wrapper's `gone`/`clear` line; it does not touch
// this file.
test('worker-loop: a hop on the create path moves the watcher to the new desk', serial, async () => {
  const secs = 61;
  reap(secs);
  // A REAL ORIGIN, unlike `fixture()`'s bare local repo: `desk_reset_refusal`
  // forcing the create path means the hop block runs `git push -u origin
  // <branch>` for real (`plot-worker-loop.sh:2956`), and that push needs a
  // remote that exists and accepts it — `fixture()`'s repo has none, so this
  // test builds its own, the same shape `dispatch.test.mjs`'s fixtures use.
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-wloop-hop-create-'));
  const origin = path.join(parent, 'origin.git');
  const dir = path.join(parent, 'wt');
  git(parent, 'init', '--bare', '-q', '-b', 'main', origin);
  git(parent, 'clone', '-q', origin, 'wt');
  git(dir, 'config', 'user.email', 'test@example.invalid');
  git(dir, 'config', 'user.name', 'Plot Test');
  git(dir, 'config', 'commit.gpgsign', 'false');
  fs.mkdirSync(path.join(dir, '.plot'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'CLAUDE.md'), `# t\n\n## Plot Config\n\n- **Worker bound:** 900\n${workerLoopLine()}`);
  // `bug/x` finishes AT ONCE, which is what makes `clear_manifest_branch` run
  // promptly and open the hand-over window. `bug/y` — the hop target — makes a
  // REAL file-touching commit, the same shape `makeIdleDeskReady` gives every
  // other idle-aimed fixture (`plot_worker_has_commits` excludes the empty
  // `plot: claim` commit via its `-- .` pathspec), and then sleeps: the
  // watcher needs a live, quiet subtree with a real commit behind it to judge
  // `idle` against.
  fs.writeFileSync(path.join(dir, '.plot', 'worker-prompt.sh'),
    `if [ "$PLOT_BRANCH" = "bug/y" ]; then echo work > "$PLOT_WORKTREE/work.txt"; git -C "$PLOT_WORKTREE" add -A; git -C "$PLOT_WORKTREE" commit -qm work; sleep ${secs}; else exit 0; fi\n`);
  git(dir, 'add', '-A');
  git(dir, 'commit', '-qm', 'init');
  git(dir, 'push', '-q', 'origin', 'main');

  // The prompt does nothing: `run_bounded` returns promptly, the loop seals
  // the declaration for `bug/x`, and `clear_manifest_branch` empties the
  // manifest's `branch` field before the wait begins — exactly as production
  // does for an agent between slices. A test harness racing a WRITE of the
  // next branch into THAT WINDOW is what hands over a slice; writing it
  // up front would be erased by that same clear before the wait ever reads it.
  const manifest = path.join(dir, 'manifest.json');
  fs.writeFileSync(manifest, JSON.stringify({ branch: 'bug/x' }));
  // THE REFUSAL: an uncommitted file on the launch desk is `uncommitted-changes`
  // in `desk_reset_refusal`, which forces the CREATE path rather than a reset
  // in place — the shape this test is pinned to, not the reset path #1218
  // already covers via its own fixture.
  // An agent-written marker holds the desk, so taking up `bug/y` cuts a new
  // desk. Unlanded work would end the loop with `holding-work` before the hop.
  fs.writeFileSync(path.join(dir, 'PLOT-BLOCKED.md'), 'PLOT-BLOCKED: a question for a person\n');

  // THE TRANSCRIPT IS FOUND BY WORKTREE PATH, NOT BY SESSION ID
  // (`plot-transcript-quiet.sh`'s own header). After the hop the watcher asks
  // about the NEW desk's path, so the aged transcript must be keyed on
  // `hopWt`, not the launch desk — `wt_root=$(dirname "$PLOT_WORKTREE")` and
  // `suffix=$(… tr '/' '-')` (`plot-worker-loop.sh:2885-2886`) make the hop
  // path for `bug/y` fully predictable ahead of the run.
  const hopWt = path.join(parent, 'plot-wt-bug-y');
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-tqhome-aged-'));

  // THE HAND-OVER: poll for the manifest's `branch` to go empty (the loop's own
  // `clear_manifest_branch`, run once the first slice is declared finished),
  // then write the NEXT branch in — the shape the registry's hand-over takes
  // in production, reproduced here without a registry. ONCE THE HOP LANDS, the
  // manifest's `resumeId` is a FRESH id `update_manifest_on_hop` mints via
  // `plot_session_id` for any genuine branch change (`plot-worker-loop.sh:316`)
  // — `PLOT_SESSION_ID` stops being the join key the instant the branch
  // changes, so the aged transcript must be named after THAT id, read back
  // from the manifest, not guessed ahead of time.
  const handOver = (async () => {
    const deadline = Date.now() + 15_000;
    while (Date.now() < deadline) {
      let branch;
      try { branch = JSON.parse(fs.readFileSync(manifest, 'utf8')).branch; } catch { branch = undefined; }
      if (branch === '') { fs.writeFileSync(manifest, JSON.stringify({ branch: 'bug/y' })); break; }
      await new Promise((res) => setTimeout(res, 100));
    }
    if (Date.now() >= deadline) {
      throw new Error('the manifest branch was never cleared — run_bounded did not finish the first slice');
    }
    const resumeDeadline = Date.now() + 15_000;
    while (Date.now() < resumeDeadline) {
      let resumeId;
      try { resumeId = JSON.parse(fs.readFileSync(manifest, 'utf8')).resumeId; } catch { resumeId = undefined; }
      if (typeof resumeId === 'string' && resumeId !== '') {
        const slug = hopWt.replace(/[/.]/g, '-');
        const d = path.join(home, '.claude', 'projects', slug);
        fs.mkdirSync(d, { recursive: true });
        const transcript = path.join(d, `${resumeId}.jsonl`);
        fs.writeFileSync(transcript, '{"type":"user"}\n');
        const past = new Date(Date.now() - 4000 * 1000);
        const p2 = (n) => String(n).padStart(2, '0');
        const stamp = `${past.getFullYear()}${p2(past.getMonth() + 1)}${p2(past.getDate())}` +
          `${p2(past.getHours())}${p2(past.getMinutes())}.${p2(past.getSeconds())}`;
        execFileSync('touch', ['-t', stamp, transcript]);
        return;
      }
      await new Promise((res) => setTimeout(res, 100));
    }
    throw new Error('the manifest never carried a resumeId after the hop');
  })();

  try {
    const [r] = await Promise.all([
      runLoop(dir, {
        env: {
          PLOT_MANIFEST_FILE: manifest,
          PLOT_TRANSCRIPT_HOME: home,
          PLOT_SESSION_ID: 'hop-create',
          PLOT_MONITOR_QUIET_SECONDS: '2',
          PLOT_MONITOR_INTERVAL: '1',
          PLOT_WAIT_POLL_SECONDS: '1',
          PLOT_WAIT_BUDGET_SECONDS: '10',
        },
      }),
      handOver,
    ]);
    assert.equal(r.code, 124, `the new desk's idle finding must still end the loop\n--- stderr ---\n${r.stderr}`);

    assert.ok(fs.existsSync(hopWt), 'the create path must cut a new desk beside the launch one');

    const launchFindings = path.join(dir, '.plot-worker.monitor.worker.jsonl');
    const hopFindings = path.join(hopWt, '.plot-worker.monitor.worker.jsonl');
    assert.ok(fs.existsSync(hopFindings),
      `the watcher must publish into the NEW desk after the hop, not the launch one: ${r.stderr}`);
    const published = fs.readFileSync(hopFindings, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
    assert.ok(published.some((f) => f.finding === 'idle' && f.worktree === hopWt),
      `the idle finding must name the new desk: ${JSON.stringify(published)}`);
    assert.equal(fs.existsSync(launchFindings), false,
      'the launch desk must receive no finding once the agent has hopped off it');
  } finally {
    reap(secs);
    fs.rmSync(home, { recursive: true, force: true });
    discard(dir);
  }
});

test('worker-loop: a branchless wait asks no fleet scan', serial, () => {
  // THE OUTLOOK COSTS 18.3 s AND HAS NOTHING TO SAY HERE. `--why-nothing` over
  // an empty slug walks the whole estate to name branches belonging to plans
  // this agent was never given, so the loop asks it only where a slug exists.
  //
  // COUNTED OVER THE LINES THE LOOP RUNS, never over the file: this script is
  // two-thirds prose, and a grep that read its own comments would pass on a
  // paragraph and fail on a rename. `--why-nothing` appears in several of them.
  const src = fs.readFileSync(loop, 'utf8');
  const code = src.split('\n').filter((l) => !/^\s*#/.test(l));
  const asks = code.filter((l) => l.includes('--why-nothing'));
  assert.equal(asks.length, 1, `the outlook is asked in exactly one place, found ${asks.length}`);
  assert.match(asks[0], /wait_for_work "\$\(/,
    'the one ask is the wait\'s outlook argument');

  // THE GUARD, read from the line before it: a slug-less agent takes the other
  // arm and hands the wait a bare `none`.
  const where = code.indexOf(asks[0]);
  assert.match(code[where - 1] ?? '', /PLOT_SLUG/,
    'and it sits behind a test on the agent holding a slug');
  assert.ok(code.slice(where, where + 4).some((l) => /wait_for_work none/.test(l)),
    'with a `none` outlook for the agent that holds none');
});

// ═══════════════════════════════════════════════════════════════════════════
// A CONTINUED LOOP CARRIES ITS MANIFEST — #1101
// ═══════════════════════════════════════════════════════════════════════════
//
// `/api/continue` used to spawn a loop with no `PLOT_MANIFEST_FILE` at all,
// which is `unset` and keeps waiting forever — the registry can never hand it
// a branch because `assigned_branch` always returns 1, and the wait holds the
// desk for the full `Worker bound`, logging `free on ?`. This slice gives the
// OTHER shape — a NAME whose manifest has since vanished — an honest ending
// instead of the same silent hold.

test('worker-loop: a free loop ends when its manifest vanishes mid-wait', serial, async () => {
  const t = fixture('manifest-gone', 5, 'echo "PROMPT-RAN" >&2\n');
  fs.mkdirSync(path.join(t, '.plot', 'agents'), { recursive: true });
  const manifest = path.join(t, '.plot', 'agents', 'free.json');
  fs.writeFileSync(manifest, JSON.stringify({ session: 'free', branch: '', worktree: t }));

  // Delete the manifest DURING the wait, not before it: the loop must reach
  // `wait_for_work`, poll once seeing `registered`, and only then find it gone.
  const deleteDuringWait = (async () => {
    await new Promise((r) => setTimeout(r, 800));
    fs.rmSync(manifest, { force: true });
  })();

  const [r] = await Promise.all([
    runLoop(t, {
      env: {
        PLOT_BRANCH: '',
        PLOT_SLUG: '',
        PLOT_MANIFEST_FILE: manifest,
        PLOT_WAIT_POLL_SECONDS: '1',
        PLOT_WAIT_BUDGET_SECONDS: '30',
      },
    }),
    deleteDuringWait,
  ]);

  // ASSERTED BEFORE `discard`, which removes the whole fixture tree (the
  // ending record lives IN `t`) — a pattern this file's hop test already
  // follows for the same reason.
  assert.equal(r.code, 124, `the vanished manifest must end the loop\n--- stderr ---\n${r.stderr}`);
  assert.doesNotMatch(r.stderr, /PROMPT-RAN/,
    'this agent held no branch when it started, so its prompt never ran');
  assert.match(r.stderr, new RegExp(manifest.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
    'the log names the manifest path that went missing');
  assert.doesNotMatch(r.stderr, /the wait ran out/,
    'the manifest going missing is a different ending from the wait bound expiring');

  const endingPath = path.join(t, '.plot-worker.ending.json');
  assert.ok(fs.existsSync(endingPath), 'an ending record must be written');
  const ending = JSON.parse(fs.readFileSync(endingPath, 'utf8'));
  assert.equal(ending.reason, 'unregistered');
  assert.equal(ending.actor, 'agent');
  assert.ok(ending.detail.includes(manifest), 'the detail names the manifest path');

  discard(t);
});

test('worker-loop: a hand-started loop with no manifest at all keeps waiting', serial, async () => {
  // THE REGRESSION LOCK for `unset` staying apart from `gone`. Without
  // `loop_registration` reading `[ -z ]` before `[ -f ]`, an empty
  // `PLOT_MANIFEST_FILE` could be misread as "gone" and end every hand-started
  // loop at once — the seven workerloop fixtures above that blank the variable
  // must stay on the wait bound, not on `unregistered`.
  const t = fixture('manifest-unset', 5, 'echo "PROMPT-RAN" >&2\n');
  const { stderr, code } = await runLoop(t, {
    env: {
      PLOT_BRANCH: '',
      PLOT_SLUG: '',
      PLOT_MANIFEST_FILE: '',
      PLOT_WAIT_POLL_SECONDS: '1',
      PLOT_WAIT_BUDGET_SECONDS: '1',
    },
  });
  discard(t);

  assert.equal(code, 124, 'the wait still ends on its own bound');
  assert.match(stderr, /the wait ran out/,
    `an unset manifest must take the ordinary wait-bound ending, not 'unregistered': ${stderr}`);
  assert.doesNotMatch(stderr, /is gone — ending worker/,
    'an unset manifest must never be read as a gone one');
  assert.equal(fs.existsSync(path.join(t, '.plot-worker.ending.json')), false,
    'the ordinary wait-bound ending writes no ending record');
});

// ═══════════════════════════════════════════════════════════════════════════
// THE LOOP HOLDS UNLANDED WORK RATHER THAN HOPPING — #1246
// ═══════════════════════════════════════════════════════════════════════════
//
// Measured 2026-10-03 and 2026-10-04: an agent ended its prompt turn while it
// waited on a background job. The loop found the desk dirty, cut a new desk
// for the next slice and went on, leaving 14 files behind — twice, each time
// found by a person on a desk no agent and no manifest named.
//
// THE CHECK RUNS BEFORE `seal_declaration`, `record_slice_spend` AND
// `clear_manifest_branch` — before the agent gives up the desk, the claim and
// the branch. These fixtures assert the declaration is NOT sealed and the
// manifest KEEPS its branch, which is the assertion a naive implementation —
// one that checked only after the hop — would pass without.

const manifestFixture = (t, branch) => {
  const manifest = path.join(t, 'manifest.json');
  fs.writeFileSync(manifest, JSON.stringify({ branch, worktree: t }));
  return manifest;
};

/**
 * A transcript home holding one assistant turn on `branch` for the desk `dir`,
 * and an empty slice-spend home beside it.
 *
 * `record_slice_spend` writes `slice-spend.jsonl` into the spend home only when
 * the transcript has a turn on the branch, so with these homes an absent record
 * means the loop never reached `record_slice_spend`.
 */
const spendHomes = (dir, branch) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-wloop-spend-'));
  const projects = path.join(root, 'transcripts', '.claude', 'projects', dir.replace(/[/.]/g, '-'));
  fs.mkdirSync(projects, { recursive: true });
  fs.writeFileSync(path.join(projects, 'session.jsonl'), `${JSON.stringify({
    type: 'assistant', gitBranch: branch, message: { model: 'claude-opus-5', usage: { input_tokens: 1, output_tokens: 1 } },
  })}\n`);
  const spend = path.join(root, 'spend');
  fs.mkdirSync(spend);
  return {
    root,
    env: { PLOT_TRANSCRIPT_HOME: path.join(root, 'transcripts'), PLOT_SLICE_SPEND_HOME: spend },
    record: path.join(spend, 'slice-spend.jsonl'),
  };
};

test('worker-loop: uncommitted changes after a ran prompt end holding-work, exit 0', serial, async () => {
  const t = fixture('holding-dirty', 30,
    'echo ran >&2; echo leftover > "$PLOT_WORKTREE/leftover.txt"\n');
  const manifest = manifestFixture(t, 'bug/x');
  const spend = spendHomes(t, 'bug/x');

  const r = await runLoop(t, { env: { PLOT_MANIFEST_FILE: manifest, ...spend.env } });

  assert.equal(r.code, 0, `an intentional stop reports 0, not a timeout\n--- stderr ---\n${r.stderr}`);
  assert.match(r.stderr, /held by uncommitted-changes/,
    `the log names the condition: ${r.stderr}`);

  const endingPath = path.join(t, '.plot-worker.ending.json');
  assert.ok(fs.existsSync(endingPath), 'an ending record must be written');
  const ending = JSON.parse(fs.readFileSync(endingPath, 'utf8'));
  assert.equal(ending.reason, 'holding-work');
  assert.equal(ending.actor, 'agent');
  assert.match(ending.detail, /uncommitted changes/);

  // NO HOP. The desk keeps its files and no sibling `plot-wt-*` worktree is
  // cut for a next slice — the assertion `a-timed-out-worker-exits-without-
  // hopping` already makes for the bound, applied here to this ending.
  const parent = path.dirname(t);
  const siblings = fs.readdirSync(parent).filter((n) => n.startsWith('plot-wt-'));
  assert.equal(siblings.length, 0, 'no next-slice worktree was created');
  assert.ok(fs.existsSync(path.join(t, 'leftover.txt')), 'the original desk keeps its files');

  // THE DECLARATION IS NOT SEALED. A loop that wrote the ending and exited 0
  // AFTER `seal_declaration` would pass every assertion above; this is what
  // catches it. `clear_manifest_branch` is never called either — but
  // `_cleanup_on_exit` (pre-existing, unconditional on every ending this loop
  // has ever written) removes `PLOT_MANIFEST_FILE` on every exit path, so the
  // file itself does not survive to be asserted on. See the PR body.
  assert.equal(fs.existsSync(path.join(t, '.plot-worker.envelope.json')), false,
    'no declaration exists for this branch');
  assert.equal(fs.existsSync(spend.record), false, 'no slice-spend record is written');

  fs.rmSync(spend.root, { recursive: true, force: true });
  discard(t);
});

test('worker-loop: unpushed commits after a ran prompt end holding-work, exit 0', serial, async () => {
  // A REAL ORIGIN, unlike `fixture()`'s bare local repo: `@{upstream}` must
  // exist for `desk_reset_refusal` to count commits ahead of it, the same
  // reason the hop-on-create-path test above builds its own remote.
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-wloop-holding-unpushed-'));
  const origin = path.join(parent, 'origin.git');
  const t = path.join(parent, 'wt');
  git(parent, 'init', '--bare', '-q', '-b', 'main', origin);
  git(parent, 'clone', '-q', origin, 'wt');
  git(t, 'config', 'user.email', 'test@example.invalid');
  git(t, 'config', 'user.name', 'Plot Test');
  git(t, 'config', 'commit.gpgsign', 'false');
  fs.mkdirSync(path.join(t, '.plot'), { recursive: true });
  fs.writeFileSync(path.join(t, 'CLAUDE.md'), `# t\n\n## Plot Config\n\n- **Worker bound:** 30\n${workerLoopLine()}`);
  fs.writeFileSync(path.join(t, '.plot', 'worker-prompt.sh'),
    'echo ran >&2; echo committed > "$PLOT_WORKTREE/committed.txt"; ' +
    'git -C "$PLOT_WORKTREE" add -A; git -C "$PLOT_WORKTREE" commit -qm work\n');
  git(t, 'add', '-A');
  git(t, 'commit', '-qm', 'init');
  git(t, 'push', '-q', '-u', 'origin', 'main');
  const manifest = manifestFixture(t, 'bug/y');
  const spend = spendHomes(t, 'bug/y');

  const r = await runLoop(t, { env: { PLOT_MANIFEST_FILE: manifest, ...spend.env } });

  assert.equal(r.code, 0, `an intentional stop reports 0, not a timeout\n--- stderr ---\n${r.stderr}`);
  assert.match(r.stderr, /held by unpushed-commits/,
    `the log names the condition: ${r.stderr}`);

  const endingPath = path.join(t, '.plot-worker.ending.json');
  assert.ok(fs.existsSync(endingPath), 'an ending record must be written');
  const ending = JSON.parse(fs.readFileSync(endingPath, 'utf8'));
  assert.equal(ending.reason, 'holding-work');
  assert.equal(ending.actor, 'agent');
  assert.match(ending.detail, /not pushed/);

  const siblings = fs.readdirSync(parent).filter((n) => n.startsWith('plot-wt-'));
  assert.equal(siblings.length, 0, 'no next-slice worktree was created');
  assert.equal(fs.existsSync(path.join(t, '.plot-worker.envelope.json')), false,
    'no declaration exists for this branch');
  assert.equal(fs.existsSync(spend.record), false, 'no slice-spend record is written');

  fs.rmSync(spend.root, { recursive: true, force: true });
  fs.rmSync(parent, { recursive: true, force: true });
});

test('worker-loop: an agent-written marker on a dirty desk keeps today\'s path', serial, async () => {
  // `desk_reset_refusal` reads `blocked-marker` BEFORE `uncommitted-changes` —
  // `resetRefusals`'s own order. A status-only check would read this desk as
  // holding-work; this asserts the WORD is read instead, and the marker's own
  // path (write a blocked marker, then exit) continues unchanged.
  const t = fixture('holding-marker', 30,
    'echo leftover > "$PLOT_WORKTREE/leftover.txt"; ' +
    'echo "PLOT-BLOCKED: a question" > "$PLOT_WORKTREE/PLOT-BLOCKED.md"\n');
  const manifest = manifestFixture(t, 'bug/x');

  const r = await runLoop(t, { env: { PLOT_MANIFEST_FILE: manifest } });

  // TODAY'S PATH: the slice finishes, the agent waits for work, and the wait
  // bound ends it with 124 — `assertRanToItsOwnEnd` says why the code is 124.
  assert.equal(r.code, 124, `today's path ends on the wait bound\n--- stderr ---\n${r.stderr}`);
  assertRanToItsOwnEnd(r, 'a marked desk');
  assert.doesNotMatch(r.stderr, /held by uncommitted-changes/,
    `a marked desk must not be read as holding-work: ${r.stderr}`);
  assert.equal(fs.existsSync(path.join(t, '.plot-worker.ending.json')), false,
    'a marker on the desk writes no ending, holding-work or other');
  // TODAY'S PATH SEALS THE SLICE, which the holding-work path never reaches.
  assert.equal(declarationOf(t)?.branch, 'bug/x', 'the declaration names the branch that finished');

  discard(t);
});

test('worker-loop: each holding-work ending adds one line to endings.jsonl', serial, async () => {
  const t = fixture('holding-jsonl', 30,
    'echo leftover > "$PLOT_WORKTREE/leftover.txt"\n');
  const manifest = manifestFixture(t, 'bug/x');

  const r = await runLoop(t, { env: { PLOT_MANIFEST_FILE: manifest } });
  assert.equal(r.code, 0, `--- stderr ---\n${r.stderr}`);

  // `t` IS BOTH THE MAIN CHECKOUT AND THE DESK HERE — `fixture()` builds one
  // bare worktree with no `git worktree add` — so `main_checkout_path` resolves
  // to `t` itself and the append lands in `t/.plot/state/endings.jsonl`.
  const endingsPath = path.join(t, '.plot', 'state', 'endings.jsonl');
  assert.ok(fs.existsSync(endingsPath), 'endings.jsonl must be written');
  const lines = fs.readFileSync(endingsPath, 'utf8').trim().split('\n');
  assert.equal(lines.length, 1);
  assert.equal(JSON.parse(lines[0]).reason, 'holding-work');

  discard(t);
});

// ═══════════════════════════════════════════════════════════════════════════
// THE HOLD CHECK AROUND A CORRECTION AND THE CHECKS WAIT
// ═══════════════════════════════════════════════════════════════════════════
//
// These run the whole loop against a real origin with a pushed `bug/x`, and a
// copy of the scripts directory whose `plot-host.sh` answers `pr-state` with an
// open PR — the one host question the loop asks, in `pr_is_open` — and touches
// `pr-asked` beside the desk when asked. With a pushed head and an open PR,
// `wait_for_checks` waits for a BuildMonitor line about that head, so the
// fixture prompt writes the BuildMonitor's lines itself into the desk's
// `.plot-worker.monitor.build.jsonl`.

/**
 * A desk on `bug/x` pushed to a bare origin, a scripts copy whose host reports
 * an open PR, and `prompt` as the worker prompt.
 *
 * Returns `{ parent, t, script }`; `discard(t)` removes all of it.
 */
const checksFixture = (label, prompt) => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), `plot-wloop-${label}-`));
  const origin = path.join(parent, 'origin.git');
  const t = path.join(parent, 'wt');
  git(parent, 'init', '--bare', '-q', '-b', 'main', origin);
  git(parent, 'clone', '-q', origin, 'wt');
  git(t, 'config', 'user.email', 'test@example.invalid');
  git(t, 'config', 'user.name', 'Plot Test');
  git(t, 'config', 'commit.gpgsign', 'false');
  git(t, 'checkout', '-q', '-b', 'bug/x');
  fs.mkdirSync(path.join(t, '.plot'), { recursive: true });
  // THE JS LOOP ASKS `BuildPort.runForSha`, which `CI: github-actions` routes
  // to `plot-host.sh run-for-sha`; the shell loop reads the BuildMonitor line.
  const ci = testWorkerLoop() === 'js' ? '- **CI:** github-actions\n' : '';
  fs.writeFileSync(path.join(t, 'CLAUDE.md'), `# t\n\n## Plot Config\n\n- **Worker bound:** 120\n${ci}${workerLoopLine()}`);
  fs.writeFileSync(path.join(t, '.plot', 'worker-prompt.sh'), prompt);
  git(t, 'add', '-A');
  git(t, 'commit', '-qm', 'init');
  git(t, 'push', '-q', '-u', 'origin', 'bug/x');
  // The JS loop's take-up resets the desk onto `origin/main`, which a real desk's origin holds.
  if (testWorkerLoop() === 'js') git(t, 'push', '-q', 'origin', 'bug/x:main');
  const dir = path.join(parent, 'scripts');
  fs.cpSync(scripts, dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'plot-host.sh'),
    `#!/usr/bin/env bash\ncase "$1" in pr-state) touch ${JSON.stringify(path.join(parent, 'pr-asked'))}; printf '{"state":"OPEN"}\\n' ;; run-for-sha) f=${JSON.stringify(path.join(parent, 'runs'))}/"$3"; [ -f "$f" ] && cat "$f"; exit 0 ;; *) exit 1 ;; esac\n`,
    { mode: 0o755 });
  return { parent, t, script: path.join(dir, 'plot-worker-loop.sh') };
};

/** The env every checks-wait run shares: a short wait and no fleet outlook. */
const checksEnv = (manifest, extra = {}) => ({
  PLOT_MANIFEST_FILE: manifest,
  PLOT_SLUG: '',
  PLOT_CHECKS_WAIT_SECONDS: '3',
  PLOT_CHECKS_POLL_SECONDS: '1',
  ...extra,
});

/** Shell that appends one BuildMonitor line saying the build failed for the desk's HEAD. */
const failedBuildLine = [
  'sha=$(git -C "$PLOT_WORKTREE" rev-parse HEAD)',
  'printf \'{"monitor":"BuildMonitor","branch":"bug/x","worktree":"/x","finding":"build failed","since":"2026-10-05T00:00:00Z","evidence":"the run at https://ci/run/1 for %s concluded failure","measuredAt":"2026-10-05T00:00:00Z"}\\n\' "$sha" >> "$PLOT_WORKTREE/.plot-worker.monitor.build.jsonl"',
].join('\n');

/**
 * Shell that records the build's run for the desk's HEAD where the fixture's
 * `plot-host.sh run-for-sha` answers from — the `BuildPort` fixture the JS
 * loop reads in place of a BuildMonitor line.
 */
const buildRunLine = (conclusion) => [
  'sha=$(git -C "$PLOT_WORKTREE" rev-parse HEAD)',
  'mkdir -p "$PLOT_WORKTREE/../runs"',
  `printf '{"sha":"%s","status":"completed","conclusion":"${conclusion}","url":"https://ci/run/1"}\\n' "$sha" > "$PLOT_WORKTREE/../runs/$sha"`,
].join('\n');

/** The failed build, as the loop under test reads it. */
const failedBuild = () => (testWorkerLoop() === 'js' ? buildRunLine('failure') : failedBuildLine);

/**
 * The manifest for a checks fixture, named by its session as dispatch names
 * it: the JS loop clears a sealed slice's assignment in `<session>.json`.
 */
const checksManifest = (parent, t) => {
  const manifest = path.join(parent, 'checks-session.json');
  fs.writeFileSync(manifest, JSON.stringify({ session: 'checks-session', branch: 'bug/x', worktree: t }));
  return manifest;
};

/** These two run on both loops: the JS loop reads the build through the `BuildPort` fixture. */
const bothLoops = { concurrency: false };

test('worker-loop: a corrected prompt that pushes its fix reaches the checks wait, not holding-work', bothLoops, async () => {
  // PASS 1 commits and pushes, and the build fails for that head: the loop
  // writes `PLOT-CORRECTION.md` untracked into the desk and runs the prompt
  // again. PASS 2 commits and pushes a fix and leaves the correction file
  // where the loop put it. The desk then holds nothing but the loop's own file,
  // so the loop must wait for the checks on the new head and seal the slice.
  const passes = (p) => path.join(p, 'passes');
  const prompt = (parent) => [
    `n=$(( $(cat ${JSON.stringify(passes(parent))} 2>/dev/null || echo 0) + 1 )); echo "$n" > ${JSON.stringify(passes(parent))}`,
    `[ -f "$PLOT_WORKTREE/PLOT-CORRECTION.md" ] && cp "$PLOT_WORKTREE/PLOT-CORRECTION.md" ${JSON.stringify(parent)}/correction-seen-$n.md`,
    'echo "pass $n" > "$PLOT_WORKTREE/work.txt"',
    'git -C "$PLOT_WORKTREE" add work.txt && git -C "$PLOT_WORKTREE" commit -qm "pass $n" && git -C "$PLOT_WORKTREE" push -q origin bug/x',
    `if [ "$n" = 1 ]; then\n${failedBuild()}\nfi`,
    // The JS loop seals on a passing run; the shell loop seals once the wait expires.
    testWorkerLoop() === 'js' ? `if [ "$n" = 2 ]; then\n${buildRunLine('success')}\nfi` : '',
    '',
  ].join('\n');
  // The prompt names the fixture's own parent, which exists only once the
  // fixture is built — so it is written in after.
  const { parent, t, script } = checksFixture('corrected', '');
  fs.writeFileSync(path.join(t, '.plot', 'worker-prompt.sh'), prompt(parent));
  git(t, 'commit', '-qam', 'the prompt');
  git(t, 'push', '-q', 'origin', 'bug/x');
  const manifest = checksManifest(parent, t);
  const spend = spendHomes(t, 'bug/x');

  try {
    const r = await runLoop(t, { script, env: checksEnv(manifest, spend.env) });

    assert.equal(fs.readFileSync(passes(parent), 'utf8').trim(), '2', `two prompts ran\n--- stderr ---\n${r.stderr}`);
    assert.match(fs.readFileSync(path.join(parent, 'correction-seen-2.md'), 'utf8'), /Correction 1 of 2/,
      'the corrected prompt found the correction in its desk');
    assert.doesNotMatch(r.stderr, /held by /, `the correction file is not unlanded work: ${r.stderr}`);
    if (testWorkerLoop() === 'js') {
      assert.match(fs.readFileSync(path.join(parent, 'correction-seen-2.md'), 'utf8'),
        /the run at https:\/\/ci\/run\/1 for [0-9a-f]+ concluded failure/, 'the correction names the failed run');
    } else {
      assert.equal(fs.existsSync(path.join(t, '.plot-worker.ending.json')), false, 'no ending is written');
      assert.match(r.stderr, /waiting for the checks on bug\/x/, `the loop waits for the fix's checks: ${r.stderr}`);
    }
    assert.equal(declarationOf(t)?.branch, 'bug/x', 'the slice is sealed after the wait');
    assert.ok(fs.existsSync(spend.record), 'the slice-spend record is written on this path');
  } finally {
    fs.rmSync(spend.root, { recursive: true, force: true });
    discard(t);
  }
});

test('worker-loop: a spent correction budget ends corrections-spent, not unstarted, and leaves the marker', bothLoops, async () => {
  // A BUDGET OF 0 SPENDS ON THE FIRST FAILURE, so one pass reaches the arm: the
  // prompt pushes, the build fails for that head, and the loop ends. The
  // ending's reason is what `freshAgentAfterCorrections` reads; `unstarted`
  // means the prompt never ran, and a reversion to it would hide this desk
  // from the supervisor's fresh-session step.
  const { parent, t, script } = checksFixture('spent',
    [
      'echo work > "$PLOT_WORKTREE/work.txt"',
      'git -C "$PLOT_WORKTREE" add work.txt && git -C "$PLOT_WORKTREE" commit -qm work && git -C "$PLOT_WORKTREE" push -q origin bug/x',
      failedBuild(),
      '',
    ].join('\n'));
  const manifest = checksManifest(parent, t);
  const spend = spendHomes(t, 'bug/x');

  try {
    const r = await runLoop(t, {
      script,
      env: checksEnv(manifest, { ...spend.env, PLOT_CORRECTION_BUDGET: '0' }),
    });

    // THE JS LOOP ENDS A SPENT BUDGET WITH EXIT 0, a contract change the plan
    // makes on purpose (#1250): the wrapper reads 0 as `clear`, not `gone`.
    const spentCode = testWorkerLoop() === 'js' ? 0 : 1;
    assert.equal(r.code, spentCode, `a spent budget exits ${spentCode}\n--- stderr ---\n${r.stderr}`);
    const ending = JSON.parse(fs.readFileSync(path.join(t, '.plot-worker.ending.json'), 'utf8'));
    assert.equal(ending.reason, 'corrections-spent', 'the reason names the spent budget, not a prompt that never started');
    assert.equal(ending.actor, 'agent');
    if (testWorkerLoop() === 'shell') {
      assert.match(ending.detail, /the run at https:\/\/ci\/run\/1 for [0-9a-f]+ concluded failure/);
    }
    assert.match(fs.readFileSync(path.join(t, 'PLOT-BLOCKED.md'), 'utf8'), /failed after 0 corrections/);
  } finally {
    fs.rmSync(spend.root, { recursive: true, force: true });
    discard(t);
  }
});

test('worker-loop: a write that lands during the checks wait ends holding-work before the seal', serial, async () => {
  // The prompt commits and pushes, then leaves a background job that writes a
  // file once `wait_for_checks` asks the host whether the PR is open — after
  // the first hold check, and before the wait expires. The first hold check
  // sees a clean desk; the second, before `seal_declaration`, sees the file.
  const { parent, t, script } = checksFixture('late-write',
    'echo work > "$PLOT_WORKTREE/work.txt"\n' +
    'git -C "$PLOT_WORKTREE" add work.txt && git -C "$PLOT_WORKTREE" commit -qm work && git -C "$PLOT_WORKTREE" push -q origin bug/x\n' +
    '( i=0; while [ ! -f "$PLOT_WORKTREE/../pr-asked" ] && [ "$i" -lt 600 ]; do sleep 0.1; i=$((i + 1)); done; ' +
    'echo late > "$PLOT_WORKTREE/late.txt" ) </dev/null >/dev/null 2>&1 &\n');
  const manifest = path.join(parent, 'manifest.json');
  fs.writeFileSync(manifest, JSON.stringify({ branch: 'bug/x', worktree: t }));
  const spend = spendHomes(t, 'bug/x');

  try {
    const r = await runLoop(t, { script, env: checksEnv(manifest, spend.env) });

    assert.equal(r.code, 0, `an intentional stop reports 0\n--- stderr ---\n${r.stderr}`);
    assert.match(r.stderr, /waiting for the checks on bug\/x/, `the first check let the loop wait: ${r.stderr}`);
    assert.match(r.stderr, /held by uncommitted-changes/, `the second check names the late file: ${r.stderr}`);
    assert.equal(JSON.parse(fs.readFileSync(path.join(t, '.plot-worker.ending.json'), 'utf8')).reason, 'holding-work');
    assert.equal(declarationOf(t), null, 'the slice is not sealed');
    assert.equal(fs.existsSync(spend.record), false, 'no slice-spend record is written');
  } finally {
    fs.rmSync(spend.root, { recursive: true, force: true });
    discard(t);
  }
});
