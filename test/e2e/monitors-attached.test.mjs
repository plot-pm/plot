// Flow test: every worker is born monitored.
//
// This is the claim the slice exists to make, and it is not one a review can
// check. A reviewer reading `start_worker` sees two lines that start monitors
// and concludes they run; what a reviewer cannot see is whether they SURVIVE
// the quoting levels between here and a detached `sh -c`, or whether some other
// path creates a worker without them.
//
// So the suite runs a real dispatch and reads what the monitors wrote.
//
// THE MUTATION TEST IS THE POINT. `there is no code path that creates a worker
// without them` is a claim about ABSENCE, and no positive assertion can
// establish it — a green test proves the monitors ran on the path the test
// took. What proves the gate is removing the monitor start from a COPY of
// plot-dispatch.sh and showing the same assertion goes red. That is CLAUDE.md's
// own test for a gate: can you answer "did I attach it?" without doing the
// work? Here you cannot.
//
// WHY THE MONITORS ARE THE WRAPPER'S CHILDREN, asserted rather than trusted:
// `--stop` kills the AGENT and the wrapper must survive to record the exit
// code. A monitor started as a SIBLING of the wrapper would be independently
// mortal — killable with nothing noticing, which is the failure being fixed one
// level up. The `--stop` test below is that property checked against the one
// operation that would break it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { makeSandbox, sh, REPO_ROOT, SCRIPTS } from './helpers.mjs';

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
 * Dispatch one worker and return the paths its monitors should have written to.
 *
 * `scripts` selects WHICH copy of the script directory to dispatch from, which
 * is what lets the mutation test run a sabotaged dispatcher through the exact
 * same flow as the honest one.
 *
 * The Worker command sleeps rather than exiting immediately: a worker that is
 * already gone makes "the monitors outlived the agent" unfalsifiable.
 */
function dispatchOne(name, { scripts = SCRIPTS, workerCommand = "sh -c 'sleep 5'" } = {}) {
  const sb = makeSandbox({ name, config: '' });
  fs.writeFileSync(
    path.join(sb.work, 'CLAUDE.md'),
    `# Sandbox\n\n## Plot Config\n\n${PLAN_CONFIG}- **Worker command:** ${workerCommand}\n`,
  );
  dispatchablePlan(sb.work);
  execFileSync('bash', [path.join(scripts, 'plot-dispatch.sh'), '--offline', '--max', '1', 'monitor-flow'],
    { cwd: sb.work, encoding: 'utf8' });

  const wt = path.join(path.dirname(sb.work), 'plot-wt-feature-watched');
  return {
    sb,
    worktree: wt,
    workerFindings: path.join(wt, '.plot-worker.monitor.worker.jsonl'),
    agentFindings: path.join(wt, '.plot-worker.monitor.agent.jsonl'),
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

test('a dispatched worker gets both monitors without the operator asking', () => {
  const run = dispatchOne('monitors-born');
  try {
    assert.ok(waitForFile(run.workerFindings),
      'the WorkerMonitor published nothing — a dispatched worker was born unmonitored');
    assert.ok(waitForFile(run.agentFindings),
      'the AgentMonitor published nothing — a dispatched worker was born half-monitored');

    // Both, and each identifying ITSELF. The attention slice needs a
    // WorkerMonitor finding to be distinguishable from an AgentMonitor one in
    // the entry, which a shared label would make impossible.
    const worker = findings(run.workerFindings);
    const agent = findings(run.agentFindings);
    assert.equal(worker[0].monitor, 'WorkerMonitor');
    assert.equal(agent[0].monitor, 'AgentMonitor');

    // The finding is about the branch that was dispatched, not about whatever
    // the dispatcher happened to be sitting on.
    assert.equal(worker[0].branch, 'feature/watched',
      'the finding does not name the branch it is about');
  } finally {
    run.sb.cleanup();
  }
});

test('each no-op monitor publishes that it measures nothing yet', () => {
  // The risk this slice accepts, stated in the plan: a no-op monitor looks
  // exactly like a working one. An operator seeing a monitor attached could
  // reasonably assume it is watching. The announcement is what stops that, so
  // it is asserted rather than left to the implementation's good intentions.
  //
  // This test is EXPECTED TO CHANGE in the slice that gives each monitor its
  // first real measurement — that is the point of pinning the string.
  const run = dispatchOne('monitors-announce');
  try {
    assert.ok(waitForFile(run.workerFindings) && waitForFile(run.agentFindings));

    for (const [label, file] of [['WorkerMonitor', run.workerFindings], ['AgentMonitor', run.agentFindings]]) {
      const [first] = findings(file);
      assert.equal(first.finding, 'nothing measured yet',
        `the ${label} is attached but does not say it measures nothing — indistinguishable from one that is watching and has nothing to report`);

      // `measuredAt` is REQUIRED by the plan, for a reason that outlives the
      // no-op: a reading without one cannot be judged stale.
      assert.match(first.measuredAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/,
        `the ${label} published a finding with no usable measuredAt`);
      assert.ok(first.evidence && first.evidence.length > 0,
        `the ${label} published a finding with no evidence — the word alone is a claim someone has to re-derive`);
    }
  } finally {
    run.sb.cleanup();
  }
});

test('MUTATION: removing the monitor start from start_worker turns this red', () => {
  // The "no other code path" claim, checked the only way a claim about absence
  // can be. A copy of the whole script directory is made, the monitor start is
  // cut out of plot-dispatch.sh, and the identical dispatch is run against it.
  //
  // If the honest run above passes and this one ALSO produces findings, the
  // monitors were coming from somewhere other than the line under test — and
  // the gate would be an illusion.
  const mutantDir = fs.mkdtempSync(path.join(REPO_ROOT, '.plot-mutant-'));
  const run = { sb: null };
  try {
    // Copy the real scripts, then sabotage exactly one thing.
    execFileSync('cp', ['-R', `${SCRIPTS}/.`, mutantDir]);
    const dispatchFile = path.join(mutantDir, 'plot-dispatch.sh');
    const original = fs.readFileSync(dispatchFile, 'utf8');
    const mutated = original.replace(
      /if \[ -n "\$PLOT_WORKER_MONITOR" \]; then "\$PLOT_WORKER_MONITOR" & fi; if \[ -n "\$PLOT_AGENT_MONITOR" \]; then "\$PLOT_AGENT_MONITOR" & fi; /,
      '',
    );
    assert.notEqual(mutated, original,
      'the mutation matched nothing — this test no longer sabotages the line it claims to, so its green means nothing');
    fs.writeFileSync(dispatchFile, mutated);

    const mutantRun = dispatchOne('monitors-mutant', { scripts: mutantDir });
    run.sb = mutantRun.sb;

    // Give the sabotaged run at least as long as the honest one gets. A short
    // wait here would pass for the wrong reason — "not yet" rather than "never".
    const appeared = waitForFile(mutantRun.workerFindings, 6000)
      || waitForFile(mutantRun.agentFindings, 1000);
    assert.equal(appeared, false,
      'a worker was still monitored after the monitor start was removed from start_worker — the monitors come from somewhere else, so start_worker is not the gate this slice claims');
  } finally {
    if (run.sb) run.sb.cleanup();
    fs.rmSync(mutantDir, { recursive: true, force: true });
  }
});

test('--stop kills the agent, and the monitors and the exit record survive it', () => {
  // The "never dies first" claim, checked against the one operation that would
  // break it. The monitors are the wrapper's children and the wrapper must
  // outlive the agent to write `.plot-worker.exit` — so stopping the agent must
  // leave both intact. A sibling monitor would die here with nothing noticing.
  const run = dispatchOne('monitors-survive-stop', { workerCommand: "sh -c 'sleep 30'" });
  try {
    assert.ok(waitForFile(run.workerFindings), 'no monitor was attached, so this proves nothing about survival');

    const pidFile = path.join(run.worktree, '.plot-worker.pid');
    assert.ok(waitForFile(pidFile), 'the wrapper never recorded the agent pid');

    execFileSync('bash', [path.join(SCRIPTS, 'plot-dispatch.sh'), '--stop', 'feature/watched'],
      { cwd: run.sb.work, encoding: 'utf8' });

    // The wrapper survived its agent: that is what an exit file IS.
    const exitFile = path.join(run.worktree, '.plot-worker.exit');
    assert.ok(waitForFile(exitFile, 20000),
      '--stop killed the agent and no exit code was recorded — the wrapper did not survive it');

    // And the findings the monitors had already published are still there.
    assert.ok(fs.existsSync(run.workerFindings) && findings(run.workerFindings).length > 0,
      'the WorkerMonitor findings vanished when the agent was stopped');
  } finally {
    run.sb.cleanup();
  }
});

test('a hand-made worktree gets neither monitor', () => {
  // Deliberate, and it falls out of the design rather than being enforced:
  // start_worker is the only thing that starts a wrapper, and a worktree nobody
  // dispatched has no wrapper for a monitor to be a child of. Attaching to
  // everything would mean watching worktrees carrying no claim and following no
  // naming — the population plot-dispatch.sh already refuses to reason about.
  const sb = makeSandbox({ name: 'monitors-handmade', config: PLAN_CONFIG });
  try {
    const wt = path.join(sb.root, 'hand-made');
    sh(sb.work, `git worktree add -q -b feature/by-hand ${wt}`);

    assert.equal(fs.existsSync(path.join(wt, '.plot-worker.monitor.worker.jsonl')), false,
      'a worktree nobody dispatched acquired a WorkerMonitor');
    assert.equal(fs.existsSync(path.join(wt, '.plot-worker.monitor.agent.jsonl')), false,
      'a worktree nobody dispatched acquired an AgentMonitor');
  } finally {
    sb.cleanup();
  }
});

test('--dry-run names which monitors it would attach to which worktree', () => {
  // Behind `--monitors`, and the opt-in is the protection rather than a
  // preference: the DEFAULT --dry-run output stays byte-identical to a run from
  // before this change, which is what lets it be diffed against one. A line
  // added to the default would forfeit exactly that check on the largest script
  // in this repo, where a mistake starts no workers at all.
  const sb = makeSandbox({ name: 'monitors-dry-run', config: '' });
  try {
    fs.writeFileSync(
      path.join(sb.work, 'CLAUDE.md'),
      `# Sandbox\n\n## Plot Config\n\n${PLAN_CONFIG}- **Worker command:** ${"sh -c 'true'"}\n`,
    );
    dispatchablePlan(sb.work);

    const withFlag = execFileSync('bash',
      [path.join(SCRIPTS, 'plot-dispatch.sh'), '--dry-run', '--monitors', '--offline', 'monitor-flow'],
      { cwd: sb.work, encoding: 'utf8' });

    assert.match(withFlag, /would attach:.*plot-worker-monitor\.sh/,
      '--monitors did not name the WorkerMonitor it would attach');
    assert.match(withFlag, /would attach:.*plot-agent-monitor\.sh/,
      '--monitors did not name the AgentMonitor it would attach');
    // It names the WORKTREE too — "which monitors to which worktree" is the
    // question, and a monitor named without its subject only answers half.
    assert.match(withFlag, /would attach:.*→.*plot-wt-feature-watched/,
      '--monitors named the monitors but not the worktree they would watch');

    // The control: without the flag, none of it appears. This is what makes the
    // byte-identity claim testable rather than merely asserted in a comment.
    const withoutFlag = execFileSync('bash',
      [path.join(SCRIPTS, 'plot-dispatch.sh'), '--dry-run', '--offline', 'monitor-flow'],
      { cwd: sb.work, encoding: 'utf8' });

    assert.doesNotMatch(withoutFlag, /would attach/,
      'the default --dry-run output gained a line, so it can no longer be diffed against a run from before this change');
  } finally {
    sb.cleanup();
  }
});
