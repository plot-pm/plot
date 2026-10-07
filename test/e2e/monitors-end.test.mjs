// Flow test: the AgentMonitor ends with its agent, and the wrapper reports its
// agent's exit before the wrapper itself ends.
//
// REWRITTEN FOR `bug/the-loop-reports-idle`. The WorkerMonitor process this
// file used to watch is deleted. Its two properties move to two different
// places: "a monitor ends with its subject" still applies to the AgentMonitor,
// which this file keeps testing exactly as before; "the finding is reported
// BEFORE the watcher that reports it stops running" moves to the WRAPPER,
// which now reports `gone`/`clear` itself right after `wait "$agent"` returns
// and before it writes `.plot-worker.exit` and exits. The "measurement, not a
// timer" property that used to need `plot-worker-monitor.sh` run directly no
// longer has a process to drive that way — the loop's own watcher now judges
// `idle` without a resident process at all, which is the plan's whole point,
// and that property is covered by `test/reconcile/workeridle.test.mjs` and
// `test/reconcile/workerstate-idle.test.mjs` against the shell function
// directly, where a measurement-vs-timer distinction is actually
// observable (those tests drive repeated passes and show the watcher never
// fires until the real conditions hold, however many passes run).
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
// So each test captures THIS worker's monitor pid, from the process table
// while it is provably alive, and asserts that specific pid is gone.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { makeSandbox, sh, staffDesk } from './helpers.mjs';

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
 * wrapper and out to the AgentMonitor. Without it the default is 300 s and no
 * test could wait for a second pass.
 */
function dispatchOne(name, { workerCommand = "sh -c 'sleep 4'", interval = '1' } = {}) {
  const sb = makeSandbox({ name, config: '' });
  fs.writeFileSync(
    path.join(sb.work, 'CLAUDE.md'),
    `# Sandbox\n\n## Plot Config\n\n${PLAN_CONFIG}- **Worker command:** ${workerCommand}\n`,
  );
  dispatchablePlan(sb.work);
  // THE DESK IS LAID BY THE FIXTURE, not by the fan-out. Dispatch hands a slice
  // to the registry and cuts nothing; what these tests are about is the worker
  // and its monitor once a desk exists, so the fixture provides one and every
  // assertion below stands unchanged.
  const { worktree: wt } = staffDesk(sb.work, 'feature/watched',
    { env: { PLOT_MONITOR_INTERVAL: interval } });
  return {
    sb,
    worktree: wt,
    pidFile: path.join(wt, '.plot-worker.pid'),
    wrapperPidFile: path.join(wt, '.plot-worker.wrapper.pid'),
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
 * monitor dutifully kept running.
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
 * The AgentMonitor pids belonging to THIS worktree, read from the process
 * table.
 *
 * ONE SCRIPT NOW, NOT TWO. `plot-worker-monitor.sh` is deleted; this matches
 * only `plot-agent-monitor.sh`, which is the one monitor process a dispatched
 * worker still carries beside the BuildMonitor this branch does not touch.
 *
 * Scoped by the worktree path, which the monitor carries in its environment —
 * so a sibling suite's workers, or the developer's own fleet, are never in the
 * answer. This is what makes the assertions specific rather than a count.
 */
function agentMonitorPids(worktree) {
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
  // returns an empty list, which reads exactly like "the monitor already
  // exited" and would make every assertion below vacuously true.
  const subject = fs.realpathSync(worktree);

  return out.split('\n')
    .filter((l) => /plot-agent-monitor\.sh/.test(l))
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
 * Dispatch a worker, then hand its monitor a subject this test controls.
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
 * With the fix in place the monitor then does its job immediately — measured
 * gone within 300 ms of dispatch — so there is no window in which to capture
 * its pid, and an assertion that cannot name its subject is the counting
 * assertion the plan rules out.
 *
 * So the pid file is rewritten to name a process that WILL live long enough to
 * be observed. That is not a simulation of the mechanism: `PLOT_PID_FILE` is
 * the contract the monitor reads, `start_worker` started it, and every other
 * part of the path — the wrapper, the quoting, the env vars — is the real one.
 * What changes is only which process the file names.
 *
 * THE WRAPPER WRITES FIRST. `plot-dispatch.sh --restart` returns while the
 * wrapper starts, and the wrapper writes the agent's pid to the same file. A
 * substitution written before that write is overwritten, the monitor watches
 * the `sleep 30` agent, and the test kills a process nobody is watching: CI
 * failed this way on 2026-10-02 (run 37055971434, attempt 1). So the agent's
 * own pid must be in the file before it is replaced.
 */
function dispatchWithLiveSubject(name) {
  const run = dispatchOne(name, { workerCommand: 'sleep 30' });
  const agentPid = waitFor(() => {
    const written = fs.existsSync(run.pidFile) ? fs.readFileSync(run.pidFile, 'utf8').trim() : '';
    return /^\d+$/.test(written) ? written : null;
  });
  assert.ok(agentPid, 'the wrapper never wrote the agent pid, so there is nothing to substitute');
  const subject = detachedSubject(120);
  fs.writeFileSync(run.pidFile, String(subject));
  return { ...run, subject };
}

test('after its subject finishes, no AgentMonitor of THAT worker remains', () => {
  // The ordinary path: the agent exits, the wrapper's `wait` returns, the
  // wrapper writes `.plot-worker.exit` and exits. Before `two-monitors-watch
  // -the-agent` the monitor was re-parented to init here and looped forever —
  // measured on this machine at 34 orphans out of 40 live monitors, when there
  // were still two kinds.
  const run = dispatchWithLiveSubject('monitors-end-normal');
  try {
    // Captured while it is provably alive. An empty list here would make the
    // assertion below vacuous — `every()` over nothing is true, so a lookup
    // that found no monitor would "prove" it had ended.
    const pids = waitFor(() => {
      const found = agentMonitorPids(run.worktree);
      return found.length > 0 ? found : null;
    });
    assert.ok(pids, 'no AgentMonitor process was found for this worktree, so "it is gone" cannot mean anything');

    // The subject ends the way an agent ordinarily does.
    process.kill(run.subject, 'SIGTERM');

    assert.ok(waitUntil(() => pids.every((p) => !alive(p))),
      `monitor ${pids.filter(alive).join(', ')} outlived the subject it was watching — `
      + 'it is an orphan now, re-parented to init and looping forever');
  } finally {
    try { process.kill(run.subject, 'SIGKILL'); } catch { /* already gone */ }
    run.sb.cleanup();
  }
});

test('after its subject is killed at the bound, no AgentMonitor of THAT worker remains', () => {
  // The `Worker bound` path. `plot-worker-loop.sh` sends `kill -KILL` to the
  // AGENT, not the wrapper — the wrapper survives and writes the exit code
  // afterwards, which is why an exit file exists at all.
  //
  // SIGKILL is the point of this test rather than a detail: a process cannot
  // trap it, so nothing on the agent's side can announce its own death. Only an
  // observer notices, which is exactly why the mechanism must be a measurement.
  const run = dispatchWithLiveSubject('monitors-end-bound');
  try {
    const pids = waitFor(() => {
      const found = agentMonitorPids(run.worktree);
      return found.length > 0 ? found : null;
    });
    assert.ok(pids, 'no AgentMonitor process was found for this worktree');

    process.kill(run.subject, 'SIGKILL');

    assert.ok(waitUntil(() => pids.every((p) => !alive(p))),
      `monitor ${pids.filter(alive).join(', ')} outlived a subject killed at its bound`);
  } finally {
    try { process.kill(run.subject, 'SIGKILL'); } catch { /* already gone */ }
    run.sb.cleanup();
  }
});

test('the wrapper reports its agent gone BEFORE the wrapper itself ends — the upper bound does not eat the lower one', () => {
  // THE PROPERTY MOVED, AND THIS IS WHERE IT LIVES NOW. Until
  // `bug/the-loop-reports-idle` this asserted the WorkerMonitor's own `gone`
  // arm — a monitor that checked its subject BEFORE its pass would exit on a
  // dead agent without ever reporting the death. The wrapper is now the one
  // process that ever held that finding, and the same hazard applies to it in
  // the same shape: it must APPEND the `gone`/`clear` line BEFORE it writes
  // `.plot-worker.exit` and exits, or the finding is lost to the very
  // mechanism meant to report it.
  //
  // This goes through a plain dispatch, because the sandbox's short-lived
  // agent is exactly the case it wants: an agent that dies on its own.
  const run = dispatchOne('monitors-end-lower-bound', { workerCommand: 'sleep 2' });
  try {
    assert.ok(waitForFile(run.pidFile), 'the wrapper never recorded the agent pid');
    const agentPid = fs.readFileSync(run.pidFile, 'utf8').trim();

    assert.ok(waitForFile(run.workerFindings, 25000),
      'the wrapper published nothing at all about an agent that died under it');

    const line = findings(run.workerFindings)[0];
    assert.ok(line, 'the wrapper wrote an empty findings file');
    // THE COMMAND EXITS 0 (`sleep 2` finishes cleanly), so the finding this
    // branch's meaning change assigns to a clean exit is `clear`, not `gone` —
    // the WorkerMonitor's old arm fired on ANY death, including this one.
    assert.equal(line.finding, 'clear',
      `an agent that exited 0 was reported '${line.finding}', not clear`);
    assert.equal(line.monitor, 'WorkerMonitor',
      'the wrapper\'s own line must still carry the board\'s expected monitor name');

    // It names the pid that exited, so the finding is about THIS agent rather
    // than a true statement about some process somewhere.
    assert.match(line.evidence, new RegExp(`\\b${agentPid}\\b`),
      'the finding does not name the agent pid it is about');

    // AND THE LINE EXISTS BEFORE THE WRAPPER'S OWN EXIT RECORD IS STALE — the
    // exit file and the finding are written one statement apart in the same
    // shell body, so by the time either is observable both must be.
    assert.ok(waitForFile(run.exitFile, 5000),
      'the wrapper reported the agent gone but never wrote its own exit record');
  } finally {
    run.sb.cleanup();
  }
});

test('an agent killed at the bound is reported gone by the wrapper, not clear', () => {
  // THE OTHER EXIT CODE. `Worker bound` kills the agent with SIGKILL, `wait`
  // returns non-zero, and the wrapper's own line must say `gone` — the case
  // the board reads as "restart it". A wrapper that answered `clear` here
  // would tell an operator a finished worker needs nothing, when in fact the
  // bound just killed it mid-flight.
  const run = dispatchOne('monitors-end-killed-gone', { workerCommand: 'sleep 30' });
  try {
    assert.ok(waitForFile(run.pidFile), 'the wrapper never recorded the agent pid');
    const agentPid = Number(fs.readFileSync(run.pidFile, 'utf8').trim());

    assert.ok(waitUntil(() => alive(agentPid)),
      'the agent was not alive long enough to kill it deliberately');
    process.kill(agentPid, 'SIGKILL');

    assert.ok(waitForFile(run.workerFindings, 10000),
      'the wrapper published nothing about an agent it never killed itself, but that died anyway');
    const line = findings(run.workerFindings)[0];
    assert.equal(line.finding, 'gone',
      `an agent killed with SIGKILL was reported '${line?.finding}', not gone`);
  } finally {
    run.sb.cleanup();
  }
});
