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
  const t = fs.mkdtempSync(path.join(os.tmpdir(), `plot-wloop-${label}-`));
  git(t, 'init', '-q', '-b', 'main', '.');
  git(t, 'config', 'user.email', 'test@example.invalid');
  git(t, 'config', 'user.name', 'Plot Test');
  git(t, 'config', 'commit.gpgsign', 'false');
  fs.mkdirSync(path.join(t, '.plot'), { recursive: true });
  fs.writeFileSync(path.join(t, 'CLAUDE.md'),
    `# t\n\n## Plot Config\n\n- **Worker bound:** ${boundSeconds}\n`);
  fs.writeFileSync(path.join(t, '.plot', 'worker-prompt.sh'), bodySh);
  git(t, 'add', '-A');
  git(t, 'commit', '-qm', 'init');
  return t;
}

/**
 * Run the loop to completion (or until `killAfterMs`, when set, sends `signal`
 * to the loop process). Resolves with { code, signal, stdout, stderr, pid }.
 */
function runLoop(cwd, { env = {}, killAfterMs = 0, signal = 'SIGTERM' } = {}) {
  return new Promise((resolve) => {
    const child = spawn('bash', [loop], {
      cwd,
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
      timer = setTimeout(() => child.kill(signal), killAfterMs);
    }
    child.on('exit', (code, sig) => {
      if (timer) clearTimeout(timer);
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
test('worker-loop: a hung prompt is ended by the bound and logged', async () => {
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
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// Item 2 — a prompt finishing UNDER the bound is never truncated. The stub
// sleeps 1s under a 60s bound and writes a marker; the marker must exist and
// the loop must not report a timeout. This is the assertion a naive
// implementation fails: a bound that fires on slow-but-honest work trades a
// visible hang for silent data loss.
test('worker-loop: an honest prompt under the bound is not truncated', async () => {
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
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// Item 3 — a timed-out worker does NOT hop to a next wave. After the timeout
// the loop must exit rather than reach the `plot-fleet-scan.sh --next` /
// `git worktree add` machinery. We prove it by observing that no second
// worktree was created (a hop's first act) and the loop exited 124.
test('worker-loop: a timed-out worker exits without hopping', async () => {
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
    fs.rmSync(dir, { recursive: true, force: true });
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
test('worker-loop: the bound fires with timeout(1)/gtimeout absent from PATH', async () => {
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
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(shim, { recursive: true, force: true });
  }
});

// Item 6 — the watchdog leaves nothing behind, on THREE exit paths:
//   (a) a normal finish, (b) a timeout, (c) a kill of the loop itself.
// Each is asserted separately, with its own marker sleep, because they are
// distinct code paths and a trap on only one of them would pass a single case.
test('worker-loop: no stray sleep after a normal finish', async () => {
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
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('worker-loop: no stray sleep after a timeout', async () => {
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
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('worker-loop: no stray sleep after the loop itself is killed', async () => {
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
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
