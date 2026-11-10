// Flow test: every worker's ending is born reported, and no desk runs a
// monitor process.
//
// The wrapper appends `gone`/`clear` to `.plot-worker.monitor.worker.jsonl`
// right after its agent ends. The AgentMonitor's findings come from fleetd's
// scan, and, with no live fleetd heartbeat, from the wrapper's own final pass
// once the agent ends. These sandboxes run no fleetd, so the final pass is the
// wrapper's.
//
// So the suite runs a real dispatch and reads what got written.
//
// THE MUTATION TEST covers the claim about absence: a copy of the scripts
// directory holds an executable `plot-agent-monitor.sh` that records its own
// start, and a dispatch from that copy must never start it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { makeSandbox, sh, REPO_ROOT, SCRIPTS, staffDesk } from './helpers.mjs';

const PLAN_CONFIG = '- **Plan directory:** docs/plans/\n- **Active index:** docs/plans/active/\n';

/** An approved single-branch plan on origin, so dispatch has something eligible. */
function dispatchablePlan(work, { slug = 'monitor-flow', date = '2026-08-30' } = {}) {
  const rel = `docs/plans/${date}-${slug}.md`;
  fs.mkdirSync(path.join(work, 'docs', 'plans', 'active'), { recursive: true });
  fs.mkdirSync(path.join(work, 'docs', 'plans', 'delivered'), { recursive: true });
  fs.writeFileSync(path.join(work, rel), `# Monitor flow

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
  // The brief gate refuses to START a briefless branch. These tests are about
  // what a started worker is born with, so they need one started.
  fs.mkdirSync(path.join(work, '.plot', 'briefs'), { recursive: true });
  fs.writeFileSync(path.join(work, '.plot', 'briefs', 'watched.md'),
    '# Brief: feature/watched\n\nSleep briefly. The monitors are the subject, not this.\n');
  sh(work, 'git add -A && git commit -qm plan && git push -q origin main');
  return rel;
}

/**
 * Dispatch one worker and return the paths its monitor and its wrapper's own
 * findings should have reached.
 *
 * `scripts` selects WHICH copy of the script directory to dispatch from, which
 * is what lets the mutation test run a sabotaged dispatcher through the exact
 * same flow as the honest one.
 *
 * The Worker command sleeps rather than exiting immediately where a test
 * needs the agent still alive; where it needs the agent GONE, it exits at
 * once and the wrapper's own `wait` reports it.
 */
function dispatchOne(name, {
  scripts = SCRIPTS,
  workerCommand = "sh -c 'sleep 5'",
} = {}) {
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
  const { worktree: wt } = staffDesk(sb.work, 'feature/watched', { scripts });
  return {
    sb,
    worktree: wt,
    // STILL ONE FILE, STILL THIS NAME. The wrapper's own `gone`/`clear` line
    // and (before this branch) the WorkerMonitor's findings share the path the
    // board's reader already knows — `attention.ts` and `findings.ts` see no
    // difference between a monitor-published line and a wrapper-published one.
    workerFindings: path.join(wt, '.plot-worker.monitor.worker.jsonl'),
    agentFindings: path.join(wt, '.plot-worker.monitor.agent.jsonl'),
    exitFile: path.join(wt, '.plot-worker.exit'),
  };
}

/** Poll for a file to appear — the worker is detached, so nothing is synchronous. */
function waitForFile(file, ms = 15000) {
  const deadline = Date.now() + ms;
  while (!fs.existsSync(file) && Date.now() < deadline) {
    execFileSync('sleep', ['0.2']);
  }
  return fs.existsSync(file);
}

/** Parse a findings file into records, so assertions read fields not substrings. */
function findings(file) {
  return fs.readFileSync(file, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
}

test('a dispatched worker\'s ending is reported by the wrapper, and its final pass names the desk\'s debt', () => {
  // The agent leaves an uncommitted file and exits 0. The wrapper writes
  // `clear` for the exit, and its final pass, with no fleetd heartbeat in the
  // sandbox, writes `holds unlanded work`: a filesystem read that needs no host.
  //
  // NO `$` IN THE COMMAND: this string is interpolated into a single-quoted
  // `sh -c` body inside plot-dispatch.sh, so a `$n` is expanded several shells
  // out.
  const run = dispatchOne('monitors-born', {
    workerCommand: "sh -c 'echo unlanded > owed.txt'",
  });
  try {
    assert.ok(waitForFile(run.workerFindings),
      'the wrapper published nothing about its agent exiting — a dispatched worker\'s exit was born unreported');
    assert.ok(waitForFile(run.agentFindings),
      'the final pass published nothing about a desk holding an uncommitted file');

    const worker = findings(run.workerFindings);
    const agent = findings(run.agentFindings);
    assert.equal(worker[0].monitor, 'WorkerMonitor');
    assert.equal(agent[0].monitor, 'AgentMonitor');
    assert.equal(agent[0].finding, 'holds unlanded work');
    assert.equal(worker[0].finding, 'clear',
      'an agent that exited 0 was reported gone');
    assert.equal(worker[0].branch, 'feature/watched',
      'the finding does not name the branch it is about');
  } finally {
    run.sb.cleanup();
  }
});

test('an agent that exits non-zero is reported gone by the wrapper', () => {
  // THE OTHER HALF OF THE MEANING CHANGE. A non-zero exit — 124, 137, or any
  // other code — is what the board should still read as "restart it", and the
  // wrapper is now the one source of that word.
  const run = dispatchOne('monitors-gone', {
    workerCommand: "sh -c 'exit 7'",
  });
  try {
    assert.ok(waitForFile(run.workerFindings),
      'the wrapper published nothing about an agent that exited non-zero');
    const worker = findings(run.workerFindings);
    assert.equal(worker[0].finding, 'gone',
      `an agent that exited 7 was reported '${worker[0]?.finding}', not gone`);
    assert.equal(worker[0].monitor, 'WorkerMonitor');
  } finally {
    run.sb.cleanup();
  }
});

test('MUTATION: an executable plot-agent-monitor.sh in the scripts directory is never started', () => {
  // The "no desk runs a monitor" claim, checked the only way a claim about
  // absence can be: a copy of the scripts directory gains an executable
  // `plot-agent-monitor.sh` that records its own start, and the dispatch from
  // that copy must leave no record.
  const mutantDir = fs.mkdtempSync(path.join(REPO_ROOT, '.plot-mutant-'));
  const run = { sb: null };
  try {
    execFileSync('cp', ['-R', `${SCRIPTS}/.`, mutantDir]);
    const marker = path.join(mutantDir, 'agent-monitor-started');
    const monitorFile = path.join(mutantDir, 'plot-agent-monitor.sh');
    fs.writeFileSync(monitorFile, `#!/bin/sh\necho started >> ${JSON.stringify(marker)}\n`, { mode: 0o755 });

    const mutantRun = dispatchOne('monitors-mutant', {
      scripts: mutantDir,
      workerCommand: "sh -c 'echo unlanded > owed.txt'",
    });
    run.sb = mutantRun.sb;

    assert.ok(waitForFile(mutantRun.exitFile), 'the agent never ended, so this proves nothing');
    assert.ok(waitForFile(mutantRun.agentFindings), 'the final pass wrote nothing, so the dispatch did not run to its end');
    assert.equal(fs.existsSync(marker), false,
      'a dispatch started plot-agent-monitor.sh from the scripts directory');
  } finally {
    if (run.sb) run.sb.cleanup();
    fs.rmSync(mutantDir, { recursive: true, force: true });
  }
});

test('--stop kills the agent, and the exit record, the wrapper\'s own finding and its final pass survive it', () => {
  // The wrapper must outlive the agent to write `.plot-worker.exit`, its own
  // `gone` line, and the final pass. The agent leaves an uncommitted file and
  // sleeps, so the final pass has a debt to report once `--stop` ends it.
  const run = dispatchOne('monitors-survive-stop', {
    workerCommand: "sh -c 'echo unlanded > owed.txt; sleep 30'",
  });
  try {
    const pidFile = path.join(run.worktree, '.plot-worker.pid');
    assert.ok(waitForFile(pidFile), 'the wrapper never recorded the agent pid');

    execFileSync('bash', [path.join(SCRIPTS, 'plot-dispatch.sh'), '--stop', 'feature/watched'],
      { cwd: run.sb.work, encoding: 'utf8' });

    // The wrapper survived its agent: that is what an exit file IS.
    assert.ok(waitForFile(run.exitFile, 20000),
      '--stop killed the agent and no exit code was recorded — the wrapper did not survive it');

    // And the final pass ran after the agent ended.
    assert.ok(waitForFile(run.agentFindings, 5000) && findings(run.agentFindings).some((f) => f.finding === 'holds unlanded work'),
      'the wrapper wrote no final pass after --stop ended the agent');

    // THE WRAPPER'S OWN LINE, SINCE THIS BRANCH. `--stop` sends SIGTERM to the
    // whole group; the agent's child (`sleep`) dies non-zero, `wait` returns
    // non-zero, and the wrapper appends `gone` — exactly the case the old
    // WorkerMonitor's own `gone` arm existed for, now answered by the one
    // process that was always watching: the wrapper that started it.
    assert.ok(waitForFile(run.workerFindings, 5000),
      '--stop ended the agent but the wrapper never reported it');
    const worker = findings(run.workerFindings);
    assert.equal(worker[worker.length - 1].finding, 'gone',
      `--stop ended the agent and the wrapper's last line was '${worker[worker.length - 1]?.finding}', not gone`);
  } finally {
    run.sb.cleanup();
  }
});

test('a hand-made worktree gets no monitor', () => {
  // Deliberate, and it falls out of the design rather than being enforced:
  // start_worker is the only thing that starts a wrapper, and a worktree nobody
  // dispatched has no wrapper for a monitor to be a child of, and no wrapper to
  // report an exit either. Attaching to everything would mean watching
  // worktrees carrying no claim and following no naming — the population
  // plot-dispatch.sh already refuses to reason about.
  const sb = makeSandbox({ name: 'monitors-handmade', config: PLAN_CONFIG });
  try {
    const wt = path.join(sb.root, 'hand-made');
    sh(sb.work, `git worktree add -q -b feature/by-hand ${wt}`);

    assert.equal(fs.existsSync(path.join(wt, '.plot-worker.monitor.worker.jsonl')), false,
      'a worktree nobody dispatched acquired a wrapper-reported finding');
    assert.equal(fs.existsSync(path.join(wt, '.plot-worker.monitor.agent.jsonl')), false,
      'a worktree nobody dispatched acquired an AgentMonitor');
  } finally {
    sb.cleanup();
  }
});

test('--dry-run names no monitor, and --monitors is gone', () => {
  const sb = makeSandbox({ name: 'monitors-dry-run', config: '' });
  try {
    fs.writeFileSync(
      path.join(sb.work, 'CLAUDE.md'),
      `# Sandbox\n\n## Plot Config\n\n${PLAN_CONFIG}- **Worker command:** ${"sh -c 'true'"}\n`,
    );
    dispatchablePlan(sb.work);

    const dry = execFileSync('bash',
      [path.join(SCRIPTS, 'plot-dispatch.sh'), '--dry-run', '--offline', 'monitor-flow'],
      { cwd: sb.work, encoding: 'utf8' });
    assert.doesNotMatch(dry, /would attach|monitor\.sh/);
    assert.throws(() => execFileSync('bash',
      [path.join(SCRIPTS, 'plot-dispatch.sh'), '--dry-run', '--monitors', '--offline', 'monitor-flow'],
      { cwd: sb.work, encoding: 'utf8', stdio: 'pipe' }));
  } finally {
    sb.cleanup();
  }
});
