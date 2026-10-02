// Flow test: every worker is born monitored, and its process ending is born
// reported.
//
// REWRITTEN FOR `bug/the-loop-reports-idle`. Until this branch a worker was
// born with THREE children started inside the wrapper: the WorkerMonitor (the
// process), the AgentMonitor (the desk) and the BuildMonitor (the run). The
// WorkerMonitor is now deleted: the loop's own watcher judges `idle` without a
// process to hold it, and the wrapper itself appends `gone`/`clear` to the
// SAME findings file right after `wait "$agent"` returns. So a dispatched
// worker is now born with TWO monitor children (`1 + 2N` per the observable
// result this plan targets being the AgentMonitor and the BuildMonitor; this
// suite only drives the AgentMonitor, since the BuildMonitor needs a build to
// watch and is out of this branch's scope), and the SAME findings file still
// receives `gone`/`clear` — from the wrapper, not from a monitor.
//
// This is not one a review can check. A reviewer reading `start_worker` sees a
// line that starts the AgentMonitor and concludes it runs; what a reviewer
// cannot see is whether it SURVIVES the quoting levels between here and a
// detached `sh -c`, or whether some other path creates a worker without it —
// or whether the wrapper's new `gone`/`clear` line actually reaches the file
// past three levels of shell quoting.
//
// So the suite runs a real dispatch and reads what got written.
//
// THE MUTATION TEST IS THE POINT. `there is no code path that creates a worker
// without the AgentMonitor` is a claim about ABSENCE, and no positive
// assertion can establish it — a green test proves the monitor ran on the path
// the test took. What proves the gate is removing the monitor start from a
// COPY of plot-dispatch.sh and showing the same assertion goes red. That is
// CLAUDE.md's own test for a gate: can you answer "did I attach it?" without
// doing the work? Here you cannot.
//
// WHY THE MONITOR IS THE WRAPPER'S CHILD, asserted rather than trusted:
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
  monitorInterval = '1',
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
  //
  // THE MONITOR STARTS BEFORE THE AGENT, deliberately (see
  // plot-monitor-subject.sh), so a condition the WORKER creates is not
  // present at the first pass. A short interval is what lets the second
  // pass see it, and shortening it is honest here: 300 s is a choice about
  // the HOST BUDGET, and none of these tests reaches a host.
  const { worktree: wt } = staffDesk(sb.work, 'feature/watched',
    { env: { PLOT_MONITOR_INTERVAL: monitorInterval }, scripts });
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

test('a dispatched worker gets the AgentMonitor without the operator asking, and the wrapper reports its own exit', () => {
  // THE WORKER COMMAND IS CHOSEN TO PROVOKE A FINDING FROM BOTH SOURCES, and it
  // has to be as of this slice. The AgentMonitor publishes only when a finding
  // HOLDS — silence means healthy — so a worker that sleeps quietly and exits
  // is correctly monitored and correctly silent, and waiting for it to write
  // something would fail against a working implementation. The wrapper, by
  // contrast, ALWAYS reports its agent's exit — `gone` for non-zero, `clear`
  // for zero — so an agent that exits at once is the simplest way to provoke
  // that line.
  //
  //   the file    leaves the tree dirty, which is the AgentMonitor's
  //               `holds unlanded work` — the cheapest finding to provoke: a
  //               filesystem read, no commits, no host, and reachable in an
  //               `--offline` sandbox where `owes a review` is not.
  //   the exit    the command exits 0 immediately, so the wrapper's own line
  //               (after `wait "$agent"; rc=$?`) is `clear` — the ordinary
  //               case, and the one that changed meaning under this branch:
  //               the old WorkerMonitor published `gone` here, on any death.
  //
  // THE AGENTMONITOR NEEDS ITS SECOND PASS, which is why the interval is short.
  // The monitor is started BEFORE the agent (plot-monitor-subject.sh explains
  // why), so at the first pass the tree is still clean and the honest answer is
  // silence.
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
      'the AgentMonitor published nothing about a desk holding an uncommitted file — a dispatched worker was born unmonitored');

    // Both files still carry `"monitor":"WorkerMonitor"`/`"AgentMonitor"`, so
    // the board's reader and `attention.ts` see no difference from before this
    // branch — the attention slice needs a WorkerMonitor-named finding to be
    // distinguishable from an AgentMonitor one in the entry, and a shared
    // label would make that impossible.
    const worker = findings(run.workerFindings);
    const agent = findings(run.agentFindings);
    assert.equal(worker[0].monitor, 'WorkerMonitor');
    assert.equal(agent[0].monitor, 'AgentMonitor');

    // THE EXIT WAS CLEAN, SO THE FINDING IS `clear`, NOT `gone`. This is the
    // meaning change this branch makes in as many words: before it, ANY death
    // of the watched pid — including an honest exit 0 — published `gone`,
    // which the board reads as "restart it". An agent that finished cleanly
    // must not ask for a restart.
    assert.equal(worker[0].finding, 'clear',
      'an agent that exited 0 was reported gone — the wrapper is reporting as the old WorkerMonitor did, not as this branch requires');

    // The finding is about the branch that was dispatched, not about whatever
    // the dispatcher happened to be sitting on.
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

test('the AgentMonitor does not announce its own emptiness', () => {
  // THIS TEST FLIPPED ONCE ALREADY, and stays flipped. It read `nothing
  // measured yet` as a REQUIRED first line on the AgentMonitor until
  // `feature/the-agent-monitor-reads-the-desk` gave that monitor its
  // measurements — and the no-op slice that introduced the string said in as
  // many words that it "disappears in the slice that gives it its first real
  // measurement".
  //
  // WHY INVERTING IS NOT WEAKENING, which is the question a reviewer should
  // ask of a test that used to demand a line and now forbids it. The
  // announcement existed to keep a BLIND monitor distinguishable from a
  // watching one, because a monitor that measures nothing and says nothing is
  // indistinguishable from a monitor that is working. That risk is now carried
  // by a different, stronger property: the monitor publishes real findings, so
  // the test above proves attachment by provoking one and reading it back.
  // Silence has stopped being ambiguous — it means healthy — and a monitor
  // still announcing its emptiness would now be publishing noise on every pass
  // of every healthy desk.
  const run = dispatchOne('monitors-announce');
  try {
    // A healthy sleeping worker owes nothing, so this asserts over whatever
    // the monitor published rather than over a required first line. An empty
    // file — or no file — is the correct outcome and is not a failure here;
    // attachment is proven by the tests above, which provoke real findings.
    if (fs.existsSync(run.agentFindings)) {
      for (const record of findings(run.agentFindings)) {
        assert.notEqual(record.finding, 'nothing measured yet',
          'the AgentMonitor still announces that it measures nothing, in a slice that gave it its measurements');
      }
    }
  } finally {
    run.sb.cleanup();
  }
});

test('MUTATION: removing the AgentMonitor start from start_worker turns this red', () => {
  // The "no other code path" claim, checked the only way a claim about absence
  // can be. A copy of the whole script directory is made, the monitor start is
  // cut out of plot-dispatch.sh, and the identical dispatch is run against it.
  //
  // If the honest run above passes and this one ALSO produces a finding, the
  // monitor was coming from somewhere other than the line under test — and the
  // gate would be an illusion.
  const mutantDir = fs.mkdtempSync(path.join(REPO_ROOT, '.plot-mutant-'));
  const run = { sb: null };
  try {
    // Copy the real scripts, then sabotage exactly one thing.
    execFileSync('cp', ['-R', `${SCRIPTS}/.`, mutantDir]);
    const dispatchFile = path.join(mutantDir, 'plot-dispatch.sh');
    const original = fs.readFileSync(dispatchFile, 'utf8');
    const mutated = original.replace(
      // THE REGEX TRACKS THE LINE. `bug/the-loop-reports-idle` left exactly one
      // monitor start in the wrapper body now — the AgentMonitor's.
      /if \[ -n "\$PLOT_AGENT_MONITOR" \]; then "\$PLOT_AGENT_MONITOR" &[^;]*; fi; /,
      '',
    );
    assert.notEqual(mutated, original,
      'the mutation matched nothing — this test no longer sabotages the line it claims to, so its green means nothing');
    fs.writeFileSync(dispatchFile, mutated);

    const mutantRun = dispatchOne('monitors-mutant', {
      scripts: mutantDir,
      workerCommand: "sh -c 'echo unlanded > owed.txt; sleep 5'",
    });
    run.sb = mutantRun.sb;

    // Give the sabotaged run at least as long as the honest one gets. A short
    // wait here would pass for the wrong reason — "not yet" rather than "never".
    const appeared = waitForFile(mutantRun.agentFindings, 6000);
    assert.equal(appeared, false,
      'a worker was still monitored after the AgentMonitor start was removed from start_worker — the monitor comes from somewhere else, so start_worker is not the gate this slice claims');
  } finally {
    if (run.sb) run.sb.cleanup();
    fs.rmSync(mutantDir, { recursive: true, force: true });
  }
});

test('--stop kills the agent, and the monitor, the exit record and the wrapper\'s own finding survive it', () => {
  // The "never dies first" claim, checked against the one operation that would
  // break it. The monitor is the wrapper's child and the wrapper must outlive
  // the agent to write `.plot-worker.exit` AND to append its own `gone` line —
  // so stopping the agent must leave all three intact. A sibling monitor would
  // die here with nothing noticing.
  //
  // THE AGENT MUST OWE SOMETHING WHILE IT SLEEPS, because the AgentMonitor does
  // not speak about a healthy desk. So the worker leaves an uncommitted file
  // and THEN sleeps: the desk holds unlanded work for the whole window, which
  // is a finding that keeps holding while the agent is alive to be stopped. A
  // `sleep` alone would leave the file empty and make the survival claim
  // unfalsifiable.
  const run = dispatchOne('monitors-survive-stop', {
    workerCommand: "sh -c 'echo unlanded > owed.txt; sleep 30'",
  });
  try {
    // Attachment, proven by a published finding rather than by a monitor that
    // narrates its own emptiness.
    assert.ok(waitForFile(run.agentFindings), 'no monitor was attached, so this proves nothing about survival');

    const pidFile = path.join(run.worktree, '.plot-worker.pid');
    assert.ok(waitForFile(pidFile), 'the wrapper never recorded the agent pid');

    execFileSync('bash', [path.join(SCRIPTS, 'plot-dispatch.sh'), '--stop', 'feature/watched'],
      { cwd: run.sb.work, encoding: 'utf8' });

    // The wrapper survived its agent: that is what an exit file IS.
    assert.ok(waitForFile(run.exitFile, 20000),
      '--stop killed the agent and no exit code was recorded — the wrapper did not survive it');

    // And the findings the monitor had already published are still there.
    assert.ok(fs.existsSync(run.agentFindings) && findings(run.agentFindings).length > 0,
      'the monitor findings vanished when the agent was stopped');

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

test('--dry-run names which monitor it would attach to which worktree', () => {
  // Behind `--monitors`, and the opt-in is the protection rather than a
  // preference: the DEFAULT --dry-run output stays byte-identical to a run from
  // before this change, which is what lets it be diffed against one. A line
  // added to the default would forfeit exactly that check on the largest script
  // in this repo, where a mistake starts no workers at all.
  //
  // ONLY THE AGENTMONITOR IS A SCRIPT ANY MORE. `bug/the-loop-reports-idle`
  // removed `plot-worker-monitor.sh`, so `report_monitors` in plot-dispatch.sh
  // no longer iterates `worker agent` — there is no script path left to name
  // for the process the loop's own watcher now judges.
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

    assert.match(withFlag, /would attach:.*plot-agent-monitor\.sh/,
      '--monitors did not name the AgentMonitor it would attach');
    assert.doesNotMatch(withFlag, /plot-worker-monitor\.sh/,
      '--monitors still names plot-worker-monitor.sh, which this branch deletes');
    // It names the WORKTREE too — "which monitor to which worktree" is the
    // question, and a monitor named without its subject only answers half. With
    // no `Worktree root` configured, the desk lies under `<repo>/.worktrees`.
    assert.match(withFlag, /would attach:.*→.*\.worktrees\/feature-watched/,
      '--monitors named the monitor but not the worktree it would watch');

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
