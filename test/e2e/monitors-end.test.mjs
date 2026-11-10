// Flow test: a dispatched desk runs no AgentMonitor process, and the wrapper
// reports its agent's exit before the wrapper itself ends.
//
// The AgentMonitor's findings come from fleetd's scan, and from the wrapper's
// final pass where no fleetd runs, so no monitor process lives beside an agent.
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
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { makeSandbox, sh, staffDesk } from './helpers.mjs';
import { record, signalOwn, signalRecorded } from '../reconcile/own-process.mjs';

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

/** Dispatch one worker onto a desk the fixture lays. */
function dispatchOne(name, { workerCommand = "sh -c 'sleep 4'" } = {}) {
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
  const { worktree: wt } = staffDesk(sb.work, 'feature/watched');
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
 * Waits for the pid file to hold a positive integer, and returns it parsed.
 *
 * `plot-dispatch.sh`'s wrapper writes this file with a plain shell redirect
 * (`printf "%s" "$agent" > "$PLOT_PID_FILE"`), not a temp-file-plus-rename. A
 * reader can observe the file between its creation and the `printf` landing
 * bytes, so `waitForFile` alone can hand back `''` — and `Number('')` is `0`,
 * a pid `alive()` then polls forever against. This waits past that empty read
 * until the file holds a parseable positive integer.
 */
function waitForPid(file, ms = 15000) {
  const deadline = Date.now() + ms;
  let pid = NaN;
  do {
    if (fs.existsSync(file)) pid = Number(fs.readFileSync(file, 'utf8').trim());
    if (Number.isInteger(pid) && pid > 0) return pid;
    execFileSync('sleep', ['0.2']);
  } while (Date.now() < deadline);
  return pid;
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

test('signalOwn and signalRecorded refuse a pid that was reused — raw process.kill would not', async () => {
  // Stands in for "the subject's pid was reused by another process": a real,
  // alive, unrelated process this file never recorded, or recorded with a
  // stamp far in the past. Needs none of the dispatch/sandbox machinery the
  // other tests in this file use — it exercises the same helper they call.
  const impostor = execFileSync('sh', ['-c', 'sleep 120 >/dev/null 2>&1 & echo $!'], { encoding: 'utf8' }).trim();
  const pid = Number(impostor);
  try {
    record(pid, Date.now() - 20_000);
    // The old code at this site was `process.kill(run.subject, 'SIGKILL')` —
    // unconditional.
    const sentByPid = signalOwn(pid, 'SIGKILL', { command: 'sleep' });
    assert.equal(sentByPid, false, 'signalOwn must not signal a pid whose start time disagrees with its stamp');
    assert.ok(alive(pid), 'the impostor must still be alive after signalOwn refused it');

    const pidFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'plot-monitors-end-')), 'subject.pid');
    fs.writeFileSync(pidFile, impostor);
    const past = new Date(Date.now() - 20_000);
    fs.utimesSync(pidFile, past, past);
    // The old code at this site was `process.kill(agentPid, 'SIGKILL')`, read
    // straight from the pid file — also unconditional.
    const sentByFile = signalRecorded(pidFile, 'SIGKILL', { command: 'sleep' });
    assert.equal(sentByFile, false, 'signalRecorded must not signal a pid whose file mtime disagrees');
    assert.ok(alive(pid), 'the impostor must still be alive after signalRecorded refused it');
  } finally {
    execFileSync('kill', ['-9', impostor]);
  }
});

test('a dispatched desk runs no AgentMonitor while its agent lives', () => {
  const run = dispatchOne('monitors-end-none', { workerCommand: 'sleep 30' });
  try {
    const agentPid = waitForPid(run.pidFile);
    assert.ok(agentPid > 0, 'the wrapper never recorded the agent pid');
    assert.ok(alive(agentPid), 'the agent was not alive, so this proves nothing');
    for (let i = 0; i < 6; i += 1) {
      assert.deepEqual(agentMonitorPids(run.worktree), [], 'a plot-agent-monitor.sh process runs for this desk');
      execFileSync('sleep', ['0.5']);
    }
  } finally {
    signalRecorded(run.pidFile, 'SIGKILL', { command: 'sleep' });
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
    const agentPid = waitForPid(run.pidFile);
    assert.ok(agentPid > 0, 'the wrapper never recorded the agent pid');

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
    assert.match(line.evidence, new RegExp(`\\b${String(agentPid)}\\b`),
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
    const agentPid = waitForPid(run.pidFile);
    assert.ok(agentPid > 0, 'the wrapper never recorded the agent pid');

    assert.ok(waitUntil(() => alive(agentPid)),
      'the agent was not alive long enough to kill it deliberately');
    signalRecorded(run.pidFile, 'SIGKILL', { command: 'sleep' });

    assert.ok(waitForFile(run.workerFindings, 10000),
      'the wrapper published nothing about an agent it never killed itself, but that died anyway');
    const line = findings(run.workerFindings)[0];
    assert.equal(line.finding, 'gone',
      `an agent killed with SIGKILL was reported '${line?.finding}', not gone`);
  } finally {
    run.sb.cleanup();
  }
});
