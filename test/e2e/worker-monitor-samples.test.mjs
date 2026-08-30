// Flow test: the WorkerMonitor's sampling, across the process boundary.
//
// ONE TEST FILE, AND IT IS ABOUT THE BOUNDARY RATHER THAN THE LOGIC. Every
// branch of the sampling — the three rows of the truth table, the two-sample
// rule, the startup window, the clearing case — is covered in
// `test/reconcile/workermonitor.test.mjs` against mocked ports, because those
// are states a real machine will not produce on demand and a test that waits
// for one flakes.
//
// What a mocked-port test CANNOT establish is that the whole thing survives the
// journey it actually makes: a real `plot-dispatch.sh` fan-out, a real detached
// `sh -c` wrapper with its single-quoted body and its env-var-per-path
// convention, a real monitor process sourcing a real `plot-worker-state.sh`,
// a real append to a real file, and a real reader parsing it. Every one of
// those is a place a working implementation can be broken by a quoting level,
// and none of them is visible to a unit test.
//
// So this file runs the real thing once and reads what came out.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { makeSandbox, sh, SCRIPTS } from './helpers.mjs';

const PLAN_CONFIG = '- **Plan directory:** docs/plans/\n- **Active index:** docs/plans/active/\n';

/** An approved single-branch plan on origin, so dispatch has something eligible. */
function dispatchablePlan(work, { slug = 'monitor-sampling', date = '2026-08-30' } = {}) {
  const rel = `docs/plans/${date}-${slug}.md`;
  fs.mkdirSync(path.join(work, 'docs', 'plans', 'active'), { recursive: true });
  fs.mkdirSync(path.join(work, 'docs', 'plans', 'delivered'), { recursive: true });
  fs.writeFileSync(path.join(work, rel), `# Monitor sampling

## Status

- **Phase:** Approved
- **Type:** feature
- **Review:** pr
- **Impl:** own branches
- **Approved:** ${date}, alice, in-session

## Branches

### Implementation
- \`feature/sampled\` — the branch whose worker is really sampled
`);
  fs.symlinkSync(`../${date}-${slug}.md`, path.join(work, 'docs', 'plans', 'active', `${slug}.md`));
  fs.mkdirSync(path.join(work, '.plot', 'briefs'), { recursive: true });
  fs.writeFileSync(path.join(work, '.plot', 'briefs', 'sampled.md'),
    '# Brief: feature/sampled\n\nThe monitor is the subject, not this.\n');
  sh(work, 'git add -A && git commit -qm plan && git push -q origin main');
  return rel;
}

/**
 * Dispatch one real worker and hand back where its WorkerMonitor publishes.
 *
 * `monitorInterval` is short so the loop's SECOND pass — the one that makes the
 * two-sample rule reachable — lands inside a test's patience. Shortening it is
 * the honest way to test a cadence: the production default (30) is a choice
 * about load, not a property of the logic, and it is overridable precisely so
 * that a test need not wait a minute to observe two passes.
 */
function dispatchOne(name, { workerCommand, monitorInterval = '1' } = {}) {
  const sb = makeSandbox({ name, config: '' });
  fs.writeFileSync(
    path.join(sb.work, 'CLAUDE.md'),
    `# Sandbox\n\n## Plot Config\n\n${PLAN_CONFIG}- **Worker command:** ${workerCommand}\n`,
  );
  dispatchablePlan(sb.work);
  execFileSync('bash', [path.join(SCRIPTS, 'plot-dispatch.sh'), '--offline', '--max', '1', 'monitor-sampling'],
    { cwd: sb.work, encoding: 'utf8', env: { ...process.env, PLOT_MONITOR_INTERVAL: monitorInterval } });

  const wt = path.join(path.dirname(sb.work), 'plot-wt-feature-sampled');
  return { sb, worktree: wt, findingsFile: path.join(wt, '.plot-worker.monitor.worker.jsonl') };
}

/** Poll until a predicate over the published findings holds, or time runs out. */
function waitFor(file, predicate, ms = 30_000) {
  const deadline = Date.now() + ms;
  for (;;) {
    if (fs.existsSync(file)) {
      const records = fs.readFileSync(file, 'utf8').trim().split('\n').filter(Boolean)
        .map((l) => { try { return JSON.parse(l); } catch { return null; } })
        .filter(Boolean);
      if (predicate(records)) return records;
      if (Date.now() >= deadline) return records;
    } else if (Date.now() >= deadline) {
      return [];
    }
    execFileSync('sleep', ['0.2']);
  }
}

test('a real dispatched worker whose agent dies is reported gone, through the real wrapper', () => {
  // THE PROCESS BOUNDARY, end to end. The worker command exits at once, so by
  // the monitor's first pass the agent pid names no live process — the one
  // finding a single sample can make, and therefore the one that proves the
  // path without depending on the loop's cadence at all.
  //
  // WHAT THIS ESTABLISHES THAT A UNIT TEST CANNOT: that `PLOT_PID_FILE` reaches
  // the monitor intact through a single-quoted `sh -c` body; that the monitor
  // finds and sources `plot-worker-state.sh` from its own directory in a
  // detached process with a different cwd; that the append lands in the file
  // the fleet's `PLOT_WORKER_RECORD` pattern already ignores; and that what
  // comes out is parseable JSON.
  const run = dispatchOne('monitor-gone', { workerCommand: "sh -c 'true'" });
  try {
    const records = waitFor(run.findingsFile, (r) => r.some((x) => x.finding === 'gone'));
    const gone = records.find((x) => x.finding === 'gone');
    assert.ok(gone,
      `the WorkerMonitor never reported a dead agent through a real wrapper: ${JSON.stringify(records)}`);

    // THE SUBSCRIBER'S VIEW. A reader that knows only the record shape must be
    // able to act on this without re-deriving anything — which is what the four
    // fields are for.
    assert.equal(gone.monitor, 'WorkerMonitor');
    assert.equal(gone.branch, 'feature/sampled',
      'the finding does not name the branch it is about');
    // `realpathSync` on the test's side, because macOS symlinks /var →
    // /private/var and dispatch resolves the path while `path.dirname` does
    // not. The monitor reporting the RESOLVED path is the correct behaviour —
    // a subscriber matching worktrees across processes needs the canonical one.
    assert.equal(gone.worktree, fs.realpathSync(run.worktree),
      'the finding does not name the desk it was measured at');
    assert.ok(gone.evidence && gone.evidence.length > 0, 'the finding carries no evidence');
    assert.match(gone.measuredAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
    assert.match(gone.since, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);

    // PUBLISHED ONCE, not once per pass. The monitor keeps looping after the
    // finding holds, and a `gone` republished every interval would fill the
    // file with one fact and leave a subscriber unable to tell a new death from
    // an old one. Asserted after giving the loop several more intervals.
    execFileSync('sleep', ['3']);
    const after = fs.readFileSync(run.findingsFile, 'utf8').trim().split('\n').filter(Boolean)
      .map((l) => JSON.parse(l)).filter((x) => x.finding === 'gone');
    assert.equal(after.length, 1,
      `gone was republished on every pass — a held finding must be published once, got ${after.length}`);
  } finally {
    run.sb.cleanup();
  }
});

test('a real healthy worker is monitored and silent', () => {
  // SILENCE MEANS HEALTHY, proven on the real path rather than against stubs.
  // This is the property that makes the findings file worth reading at all, and
  // it is also the one most easily lost: an implementation that published a
  // heartbeat per pass would pass every other test in this file.
  //
  // THE CONTROL IS THE AGENTMONITOR, which is still a no-op publishing every
  // pass. Its file appearing is what tells "monitored and silent" apart from
  // "no monitor ran", which is the reading a bare absence would otherwise
  // support — and it is exactly the ambiguity the no-op slice's announcement
  // was designed to remove.
  //
  // THE WORKER MUST BURN CPU, and getting this wrong is instructive enough to
  // record. The first draft used `sleep 8` and the monitor reported `idle` —
  // correctly. A `sleep` burns no CPU, changes no files, and sits on a branch
  // whose claim commit dispatch made: all three conditions of `idle` genuinely
  // hold, so `sleep` is a faithful model of a STALLED worker and no model at
  // all of a healthy one. The fixture was wrong, not the sampler.
  //
  // A busy loop in a CHILD is the honest model, and the child matters:
  // `plot_worker_activity` sums the DESCENDANT subtree because the loop shell
  // itself waits and burns nothing — measured across the fleet 2026-08-25, 9 of
  // 11 loop shells sat at 0.01s while their `claude` child held 1.5+ minutes.
  // NO `$` IN THE COMMAND, and that is a constraint of the path rather than a
  // style choice: this string is interpolated into a single-quoted `sh -c` body
  // inside plot-dispatch.sh, so a `$n` is expanded by a shell several levels
  // out and the loop reads `[: -lt: unary operator expected`. `yes` into
  // `/dev/null` burns CPU in a grandchild with no variables at all.
  const run = dispatchOne('monitor-silent', {
    workerCommand: "sh -c 'yes > /dev/null & sleep 8; kill %1'",
  });
  const agentFindings = path.join(run.worktree, '.plot-worker.monitor.agent.jsonl');
  try {
    const agent = waitFor(agentFindings, (r) => r.length > 0, 15_000);
    assert.ok(agent.length > 0,
      'the AgentMonitor never published, so a silent WorkerMonitor proves nothing — no monitor may have run at all');

    // Several monitor intervals have passed by now, over a worker that is
    // busy-but-quiet with no commits. Nothing should have been published.
    const worker = fs.existsSync(run.findingsFile)
      ? fs.readFileSync(run.findingsFile, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l))
      : [];
    assert.deepEqual(worker.filter((x) => x.finding !== 'clear'), [],
      `a healthy worker produced WorkerMonitor findings: ${JSON.stringify(worker)}`);
  } finally {
    run.sb.cleanup();
  }
});

test('the published findings file does not make the worktree read as dirty', () => {
  // THE NAME IS THE CONTRACT, and this is where it is cashed. The monitor
  // publishes INTO the worktree it watches, so a findings file the fleet did
  // not already ignore would make every monitored worktree read as holding
  // unlanded work — `stalled`, for a fleet that is perfectly healthy. The whole
  // fleet, on the day the monitors were attached.
  //
  // `plot_worker_dirty` is asked directly, because it is the function whose
  // answer that failure would come through.
  const run = dispatchOne('monitor-not-dirty', { workerCommand: "sh -c 'true'" });
  try {
    waitFor(run.findingsFile, (r) => r.length > 0);
    assert.ok(fs.existsSync(run.findingsFile), 'nothing was published, so this proves nothing');

    const dirty = execFileSync('bash', ['-c', `
      . ${JSON.stringify(path.join(SCRIPTS, 'plot-worker-state.sh'))}
      plot_worker_dirty ${JSON.stringify(run.worktree)}
    `], { encoding: 'utf8' }).trim();

    assert.equal(dirty, '',
      `the monitor's own findings file reads as unlanded work: ${dirty}`);
  } finally {
    run.sb.cleanup();
  }
});
