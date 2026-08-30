// Flow test: a monitor ends with its agent.
//
// The companion to `monitors-attached.test.mjs`, which asks only whether
// monitors live LONG ENOUGH. Every done-when in the plan did, until this slice;
// none asked when they stop. The estate showed the gap — measured 2026-08-30,
// 34 of 40 monitor processes on the machine were `ppid=1`, and 100 forks cost
// 23.3 ms against 4.8 ms on a quiet one.
//
// ═══════════════════════════════════════════════════════════════════════════
// EVERY ASSERTION HERE IS BY PID
// ═══════════════════════════════════════════════════════════════════════════
//
// The plan says so outright, and the reason is that the obvious test is wrong:
// *"no monitors are running"* passes on a machine where someone else's run just
// ended, and fails on a developer's laptop with a real fleet on it. This repo
// runs its suites in worktrees beside live workers — the population a count
// would sweep up is exactly the population that is supposed to be there.
//
// So each test captures THIS worker's monitor pids, from the process table
// while they are provably alive, and asserts those specific pids are gone.
//
// ═══════════════════════════════════════════════════════════════════════════
// AND THE MECHANISM IS A MEASUREMENT, NOT A TIMER
// ═══════════════════════════════════════════════════════════════════════════
//
// The plan names this as the thing that would pass every visible assertion
// while destroying the property the design rests on: a monitor that exits after
// N seconds regardless satisfies "no monitor remains" and loses the meaning of
// a monitor that stops publishing.
//
// A test asserting only "they exited" cannot tell the two apart, so this suite
// also asserts the CONVERSE — a monitor whose agent is still alive is still
// running well past several of its own intervals. A timer fails that; a
// measurement passes it. The pair is what pins the mechanism.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawn } from 'node:child_process';
import { makeSandbox, sh, SCRIPTS } from './helpers.mjs';

const PLAN_CONFIG = '- **Plan directory:** docs/plans/\n- **Active index:** docs/plans/active/\n';

/** An approved single-branch plan on origin, so dispatch has something eligible. */
function dispatchablePlan(work, { slug = 'monitor-end', date = '2026-08-30' } = {}) {
  const rel = `docs/plans/${date}-${slug}.md`;
  fs.mkdirSync(path.join(work, 'docs', 'plans', 'active'), { recursive: true });
  fs.mkdirSync(path.join(work, 'docs', 'plans', 'delivered'), { recursive: true });
  fs.writeFileSync(path.join(work, rel), `# Monitor end

## Status

- **Phase:** Approved
- **Type:** feature
- **Review:** pr
- **Impl:** own branches
- **Approved:** ${date}, alice, in-session

## Branches

### Implementation
- \`feature/watched\` — the one branch a monitored worker is started on
`);
  fs.symlinkSync(`../${date}-${slug}.md`, path.join(work, 'docs', 'plans', 'active', `${slug}.md`));
  fs.mkdirSync(path.join(work, '.plot', 'briefs'), { recursive: true });
  fs.writeFileSync(path.join(work, '.plot', 'briefs', 'watched.md'),
    '# Brief: feature/watched\n\nSleep briefly. The monitors are the subject, not this.\n');
  sh(work, 'git add -A && git commit -qm plan && git push -q origin main');
  return rel;
}

/**
 * Dispatch one worker with a monitor interval short enough to test against.
 *
 * `PLOT_MONITOR_INTERVAL` travels through the dispatcher's environment into the
 * wrapper and out to both monitors. Without it the AgentMonitor's default is
 * 300 s and no test could wait for a second pass.
 */
function dispatchOne(name, { workerCommand = "sh -c 'sleep 4'", interval = '1' } = {}) {
  const sb = makeSandbox({ name, config: '' });
  fs.writeFileSync(
    path.join(sb.work, 'CLAUDE.md'),
    `# Sandbox\n\n## Plot Config\n\n${PLAN_CONFIG}- **Worker command:** ${workerCommand}\n`,
  );
  dispatchablePlan(sb.work);
  execFileSync('bash', [path.join(SCRIPTS, 'plot-dispatch.sh'), '--offline', '--max', '1', 'monitor-end'],
    { cwd: sb.work, encoding: 'utf8', env: { ...process.env, PLOT_MONITOR_INTERVAL: interval } });

  const wt = path.join(path.dirname(sb.work), 'plot-wt-feature-watched');
  return {
    sb,
    worktree: wt,
    pidFile: path.join(wt, '.plot-worker.pid'),
    exitFile: path.join(wt, '.plot-worker.exit'),
    workerFindings: path.join(wt, '.plot-worker.monitor.worker.jsonl'),
    agentFindings: path.join(wt, '.plot-worker.monitor.agent.jsonl'),
  };
}

function waitForFile(file, ms = 15000) {
  const deadline = Date.now() + ms;
  while (!fs.existsSync(file) && Date.now() < deadline) execFileSync('sleep', ['0.2']);
  return fs.existsSync(file);
}

/**
 * A long-lived process this test controls, and deliberately NOT its child.
 *
 * ZOMBIES ARE WHY. A `spawn`ed child that is killed stays in the process table
 * as `<defunct>` until node reaps it — and node cannot reap it while this test
 * sits inside a synchronous `execFileSync('sleep', …)`, because the SIGCHLD
 * handler needs an event-loop turn that never comes. `kill -0` succeeds on a
 * zombie, so a monitor watching one is CORRECT to stay alive, and the test
 * would be asserting against a subject that is not actually gone.
 *
 * Measured 2026-08-30: `ps -o state=` on the killed child printed `Z`, and the
 * monitors dutifully kept running.
 *
 * So the subject is double-forked into an orphan: `init` becomes its parent and
 * reaps it the instant it dies, which is exactly what happens to a real agent
 * under a wrapper that has already exited.
 */
function detachedSubject(seconds) {
  const pid = execFileSync('sh', ['-c', `sleep ${seconds} >/dev/null 2>&1 & echo $!`], { encoding: 'utf8' }).trim();
  return Number(pid);
}

/**
 * Is this specific pid still a live process? The assertion's whole basis.
 *
 * ZOMBIES ARE NOT ALIVE, and saying so is not pedantry here. A process this
 * test `spawn`ed stays in the table as `<defunct>` until node reaps it, so a
 * bare `ps -p` reports a monitor that has already exited as still running —
 * measured 2026-08-30, and it failed the one assertion that distinguishes a
 * measurement from a timer.
 *
 * The state column answers it: `Z` is exited-and-unreaped. Everything else that
 * `ps` will print for a pid — running, sleeping, stopped — is a process still
 * in existence.
 */
function alive(pid) {
  try {
    const state = execFileSync('ps', ['-p', String(pid), '-o', 'state='], { encoding: 'utf8' }).trim();
    return state.length > 0 && !state.startsWith('Z');
  } catch {
    return false;
  }
}

/**
 * The monitor pids belonging to THIS worktree, read from the process table.
 *
 * Scoped by the worktree path, which each monitor carries in its environment —
 * so a sibling suite's workers, or the developer's own fleet, are never in the
 * answer. This is what makes the assertions specific rather than a count.
 */
function monitorPids(worktree) {
  let out = '';
  try {
    out = execFileSync('ps', ['-eo', 'pid=,command='], { encoding: 'utf8' });
  } catch {
    return [];
  }

  // BOTH SIDES ARE RESOLVED, and on darwin that is not optional: the sandbox
  // sits under `/tmp`, which is a SYMLINK to `/private/tmp`. `lsof` reports the
  // resolved path and the test holds the unresolved one, so a raw string
  // comparison matches nothing and every pid is filtered out — a lookup that
  // returns an empty list, which reads exactly like "the monitors already
  // exited" and would make every assertion below vacuously true.
  const subject = fs.realpathSync(worktree);

  return out.split('\n')
    .filter((l) => /plot-(worker|agent)-monitor\.sh/.test(l))
    .map((l) => Number(l.trim().split(/\s+/)[0]))
    .filter((pid) => {
      // The command line names the SCRIPT, not the worktree it watches — every
      // monitor on the machine shares it — so the subject is confirmed from the
      // process's working directory, which `start_worker` sets to the worktree.
      // `ps -E` is not portable and `/proc` does not exist on darwin; `lsof`'s
      // cwd descriptor is the question both platforms answer.
      try {
        const cwd = execFileSync('lsof', ['-a', '-p', String(pid), '-d', 'cwd', '-Fn'],
          { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
        return cwd.includes(subject);
      } catch {
        return false;
      }
    });
}

/**
 * Poll until `fn()` returns something truthy, and return it; null on timeout.
 *
 * The counterpart to `waitUntil` for the cases that need the VALUE rather than
 * the fact — a pid list, a set of findings. Polling matters because the worker
 * is detached: nothing about a dispatch is synchronous with the test.
 */
function waitFor(fn, ms = 20000) {
  const deadline = Date.now() + ms;
  for (;;) {
    const got = fn();
    if (got) return got;
    if (Date.now() >= deadline) return null;
    execFileSync('sleep', ['0.25']);
  }
}

/** Poll until `fn()` holds, or the deadline passes. Returns whether it held. */
function waitUntil(fn, ms = 20000) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (fn()) return true;
    execFileSync('sleep', ['0.25']);
  }
  return fn();
}

function findings(file) {
  return fs.readFileSync(file, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
}

/**
 * Dispatch a worker, then hand its monitors a subject this test controls.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * WHY THE SUBJECT IS SUBSTITUTED, AND WHY THAT IS STILL THE REAL MECHANISM
 * ─────────────────────────────────────────────────────────────────────────
 *
 * A dispatched agent in this sandbox does not stay alive. Measured 2026-08-30,
 * and measured again against a pristine `origin/main` checkout with identical
 * results: a `Worker command` of `touch /tmp/x && sleep 120` leaves the `touch`
 * done, the `sleep` never started, and `.plot-worker.exit` holding `0` within a
 * second. It reproduces without any of this branch's code.
 *
 * With the fix in place the monitors then do their job immediately — measured
 * gone within 300 ms of dispatch — so there is no window in which to capture
 * their pids, and an assertion that cannot name its subjects is the counting
 * assertion the plan rules out.
 *
 * So the pid file is rewritten to name a process that WILL live long enough to
 * be observed. That is not a simulation of the mechanism: `PLOT_PID_FILE` is
 * the contract the monitors read, `start_worker` started these monitors, and
 * every other part of the path — the wrapper, the quoting, the env vars — is
 * the real one. What changes is only which process the file names.
 */
function dispatchWithLiveSubject(name) {
  const run = dispatchOne(name, { workerCommand: 'sleep 30' });
  const subject = detachedSubject(120);
  fs.writeFileSync(run.pidFile, String(subject));
  return { ...run, subject };
}

test('after its subject finishes, no monitor of THAT worker remains', () => {
  // The ordinary path: the agent exits, the wrapper's `wait` returns, the
  // wrapper writes `.plot-worker.exit` and exits. Before this slice both
  // monitors were re-parented to init here and looped forever — measured on
  // this machine at 34 orphans out of 40 live monitors.
  const run = dispatchWithLiveSubject('monitors-end-normal');
  try {
    // Captured while they are provably alive. An empty list here would make the
    // assertion below vacuous — `every()` over nothing is true, so a lookup that
    // found no monitors would "prove" they had ended.
    const pids = waitFor(() => {
      const found = monitorPids(run.worktree);
      return found.length > 0 ? found : null;
    });
    assert.ok(pids, 'no monitor process was found for this worktree, so "they are gone" cannot mean anything');

    // The subject ends the way an agent ordinarily does.
    process.kill(run.subject, 'SIGTERM');

    assert.ok(waitUntil(() => pids.every((p) => !alive(p))),
      `monitors ${pids.filter(alive).join(', ')} outlived the subject they were watching — `
      + 'they are orphans now, re-parented to init and looping forever');
  } finally {
    try { process.kill(run.subject, 'SIGKILL'); } catch { /* already gone */ }
    run.sb.cleanup();
  }
});

test('after its subject is killed at the bound, no monitor of THAT worker remains', () => {
  // The `Worker bound` path. `plot-worker-loop.sh:172` sends `kill -KILL` to the
  // AGENT, not the wrapper — the wrapper survives and writes the exit code
  // afterwards, which is why an exit file exists at all and why the plan's
  // earlier claim that the bound killed the wrapper was withdrawn.
  //
  // SIGKILL is the point of this test rather than a detail: a process cannot
  // trap it, so nothing on the agent's side can announce its own death. Only an
  // observer notices, which is exactly why the mechanism must be a measurement.
  const run = dispatchWithLiveSubject('monitors-end-bound');
  try {
    const pids = waitFor(() => {
      const found = monitorPids(run.worktree);
      return found.length > 0 ? found : null;
    });
    assert.ok(pids, 'no monitor process was found for this worktree');

    process.kill(run.subject, 'SIGKILL');

    assert.ok(waitUntil(() => pids.every((p) => !alive(p))),
      `monitors ${pids.filter(alive).join(', ')} outlived a subject killed at its bound`);
  } finally {
    try { process.kill(run.subject, 'SIGKILL'); } catch { /* already gone */ }
    run.sb.cleanup();
  }
});

test('the monitor reports its agent gone BEFORE it ends — the upper bound does not eat the lower one', () => {
  // The Attaching slice's property, which this slice must not eat, and for the
  // WorkerMonitor it is not an abstraction: `gone` is one of its two findings.
  //
  // A monitor that checked its subject BEFORE its pass would exit on a dead
  // agent without ever reporting the death — losing the loudest finding it has
  // to the mechanism meant to bound it. And it would still pass both tests
  // above, because "no monitor remains" is equally true of a monitor that
  // reported and left and one that left silently.
  //
  // This one goes through a plain dispatch, because the sandbox's short-lived
  // agent is exactly the case it wants: an agent that dies on its own.
  const run = dispatchOne('monitors-end-lower-bound', { workerCommand: 'sleep 2' });
  try {
    assert.ok(waitForFile(run.pidFile), 'the wrapper never recorded the agent pid');
    const agentPid = fs.readFileSync(run.pidFile, 'utf8').trim();

    assert.ok(waitForFile(run.workerFindings, 25000),
      'the WorkerMonitor published nothing at all about an agent that died under it');

    const gone = waitFor(() => {
      const g = findings(run.workerFindings).filter((f) => f.finding === 'gone');
      return g.length > 0 ? g : null;
    });
    assert.ok(gone,
      'the WorkerMonitor ended without ever publishing `gone` — the upper bound ate the finding it exists to make, '
      + 'which is the lower bound the Attaching slice owns');

    // It names the pid that died, so the finding is about THIS agent rather
    // than a true statement about some process somewhere.
    assert.match(gone[gone.length - 1].evidence, new RegExp(`\\b${agentPid}\\b`),
      'the `gone` finding does not name the agent pid it is about');
  } finally {
    run.sb.cleanup();
  }
});

test('MEASUREMENT NOT TIMER: a monitor whose subject lives outlasts many of its own intervals', () => {
  // The converse, and the test that tells the two mechanisms apart. Everything
  // above is satisfied by a monitor that exits after N seconds regardless — and
  // the plan names that as the change that would pass the visible assertions
  // while destroying the property the whole design rests on.
  //
  // So the monitor is run against a subject that STAYS ALIVE, on a one-second
  // interval, for many multiples of it. A timer with any bound short enough to
  // have fixed the leak ends here; a measurement of a living process cannot.
  //
  // ─────────────────────────────────────────────────────────────────────────
  // WHY THIS ONE DOES NOT GO THROUGH `plot-dispatch.sh`
  // ─────────────────────────────────────────────────────────────────────────
  //
  // It needs a LIVE agent, and a dispatched one in this sandbox is not. Measured
  // 2026-08-30 while writing this suite, and measured again against a pristine
  // `origin/main` checkout with byte-identical results: a `Worker command` of
  // `touch /tmp/x && sleep 120` leaves the `touch` done and the `sleep` never
  // started, and `.plot-worker.exit` holds `0` within a second. The command
  // begins and its process is gone between one statement and the next.
  //
  // That is a property of the harness, not of this slice — it reproduces
  // unchanged without any of this branch's code — and it is why the suite's
  // other tests assert on ENDING, which the sandbox does faithfully, and why
  // `monitors-attached.test.mjs` never asserts on a live agent either.
  //
  // So the subject here is a real process this test owns and controls. The
  // monitor is the SAME script `start_worker` runs, reading the same
  // `PLOT_PID_FILE` contract, so what is exercised is the mechanism under test
  // rather than a re-implementation of it.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-monitor-timer-'));
  let subject;
  let monitor;
  try {
    // A subject that will outlive the observation window by a wide margin, and
    // one this process does not parent — see `detachedSubject` for why a
    // `spawn`ed child would be a zombie here and read as alive.
    subject = detachedSubject(120);
    fs.writeFileSync(path.join(dir, '.plot-worker.pid'), String(subject));

    monitor = spawn('bash', [path.join(SCRIPTS, 'plot-worker-monitor.sh')], {
      cwd: dir,
      stdio: 'ignore',
      env: {
        ...process.env,
        PLOT_BRANCH: 'feature/watched',
        PLOT_WORKTREE: dir,
        PLOT_PID_FILE: path.join(dir, '.plot-worker.pid'),
        PLOT_MONITOR_INTERVAL: '1',
      },
    });

    // Ten intervals. A timer that ended the leak would have to fire well inside
    // this window to be worth anything, so passing it is the discriminating
    // result.
    execFileSync('sleep', ['10']);

    assert.ok(alive(monitor.pid),
      'the monitor exited while its subject was still running — after ten of its own intervals against a live pid, '
      + 'which is what a timer does and what a measurement cannot');

    // And now the converse of the converse, in the same test so the two cannot
    // drift apart: the SAME monitor, against the SAME subject, ends promptly
    // once that subject does. Without this, "it stayed alive" would be equally
    // true of a monitor that never checks anything at all.
    process.kill(subject, 'SIGKILL');
    assert.ok(waitUntil(() => !alive(monitor.pid), 15000),
      'the subject died and the monitor kept running — it is not watching the pid it was given');
  } finally {
    try { if (subject) process.kill(subject, 'SIGKILL'); } catch { /* already gone */ }
    try { if (monitor && alive(monitor.pid)) monitor.kill('SIGKILL'); } catch { /* already gone */ }
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
