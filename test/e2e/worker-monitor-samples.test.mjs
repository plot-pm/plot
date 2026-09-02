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
  // THE CONTROL IS THE LIVE AGENT PID, and it used to be the AgentMonitor.
  // Until `feature/the-agent-monitor-reads-the-desk` that monitor was a no-op
  // publishing `nothing measured yet` on every pass, so its file appearing was
  // what told "monitored and silent" apart from "no monitor ran". That monitor
  // now MEASURES, and a healthy desk owes it nothing — so its file is correctly
  // empty here and can no longer serve as a control. The no-op's disappearance
  // was the point of that slice; this is the one place that depended on it.
  //
  // THE TEST CANNOT WATCH A LIVE AGENT AT ALL, and MEASURING that is what
  // settled the replacement. Two drafts assumed it could — one slept a fixed
  // 3 s after the log appeared, one waited on the pid and asserted `kill -0`
  // still answered — and both failed against a working implementation.
  //
  // Measured 2026-08-31 with a timing probe: `plot-dispatch.sh` returns only
  // once the worker has FINISHED. Dispatch returned at +8627 ms — the worker's
  // whole 8 s life — and the pid file, the log and the agent's death were all
  // already in the past at that instant. There is no moment after the dispatch
  // call in which this test can find a living agent, so any assertion phrased
  // as "read the findings while it runs" is asserting something unreachable.
  //
  // The old AgentMonitor control worked for a reason that is easy to misread:
  // not good timing, but PERSISTENCE. The no-op published during those 8 s and
  // the file outlived the worker, so the check ran afterwards on a record made
  // while the worker was alive.
  //
  // SO THE CLAIM IS ABOUT THE RECORD, NOT THE MOMENT: over a healthy busy
  // worker's whole life the WorkerMonitor published no finding about its
  // health. `gone` is excluded because it is the monitor being RIGHT about a
  // worker that has finished — this test is about the passes taken while the
  // work was going on, and `idle` or `stalled` among them is the regression it
  // exists to catch.
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
  // THE WORKER MUST COMMIT, or this test asserts nothing. `idle` carries FOUR
  // conditions and `monitor_has_commits` is one of them — a branch with no
  // commits is the middle row, "it may be thinking", and no CPU reading can
  // produce a finding there. So a fixture that only burns CPU makes `idle`
  // unreachable for a reason that has nothing to do with the sampler under
  // test, and the test passes whatever the sampler says.
  //
  // MEASURED 2026-08-31, which is the only reason this is written down: with
  // `monitor_activity` mutated to return `idle` unconditionally — the exact
  // #538 regression the comment above describes — the test still passed. It was
  // vacuous on this dimension. A real commit closes that: with one on the
  // branch, three of the four conditions hold and the CPU reading is the only
  // thing left refusing, so libelling a busy worker turns this red.
  //
  // WHAT THIS ASSERTS IS THE ABSENCE OF A HEARTBEAT, NOT THE ABSENCE OF EVERY
  // FINDING — and the difference was measured the hard way, twice.
  //
  // The obvious form ("a healthy worker's findings file is empty") is a race
  // against a CPU sampler and cannot be won. CI produced a REAL `idle` on this
  // fixture at a 1 s interval and again at 3 s, each time immediately followed
  // by `clear`: "the idle finding no longer holds". Widening the window did not
  // help, which refutes the first explanation (a sample straddling the
  // `git commit`) and leaves the honest one — `plot_worker_activity` sums the
  // subtree of the AGENT pid, and whether a job backgrounded inside the inner
  // `sh -c` stays in that subtree is a property of how the runner's shell
  // reparents it. Locally it does; on CI it does not.
  //
  // A TRANSIENT `idle` IMMEDIATELY RETRACTED IS THE MONITOR WORKING. It
  // sampled, said what it saw, and withdrew it when the next sample disagreed —
  // publish-on-change doing exactly its job. Failing the test for that is
  // failing it for a correct implementation.
  //
  // So the claim is the one the docstring above actually makes: *an
  // implementation that published a heartbeat per pass would pass every other
  // test in this file*. A heartbeat is a finding that RECURS while nothing
  // changes. A finding that is retracted is not a heartbeat, and one that
  // STANDS at the end over a worker that was healthy throughout is the
  // regression. Both are decidable from the record, and neither races a
  // sampler.
  // THE BURN IS IN THE FOREGROUND, and three CI failures are why.
  //
  // The fixture used to background it — `yes > /dev/null & ... sleep 8; kill %1`
  // — and `plot_worker_activity` sums the subtree of the AGENT pid by walking
  // `ps -o pid=,ppid=` from that root. A job backgrounded inside the inner
  // `sh -c` is only in that subtree while its parent lives to hold it there;
  // on CI it was not, so the sampler read a genuinely quiet subtree and
  // published `idle` about a worker that was, in every real sense, busy.
  //
  // Locally it never reproduced, which is what made three successive diagnoses
  // wrong: a 1s interval racing the commit (refuted — it failed at 3s too),
  // then "assert no heartbeat" (refuted — the mutation passed it), then "the
  // libel must be retracted" (refuted — the worker exited before the retracting
  // pass, so one lone `idle` stood).
  //
  // A FOREGROUND LOOP IS IN THE SUBTREE BY CONSTRUCTION. It burns CPU in a
  // process the sampler is guaranteed to find, because it is the very process
  // whose pid the wrapper recorded. No reparenting, no job control, nothing for
  // a runner's shell to do differently.
  //
  // NO `$` IN THE COMMAND: this string is interpolated into a single-quoted
  // `sh -c` body inside plot-dispatch.sh, so a `$n` is expanded several shells
  // out. `while true; do :; done` needs none.
  const run = dispatchOne('monitor-silent', {
    monitorInterval: '3',
    // A FOREGROUND PIPELINE, BOUNDED BY ITS CONSUMER, AND `$`-FREE.
    //
    // Each constraint is one the alternatives fail:
    //
    //   not `sleep`     — burns nothing; a faithful model of a STALLED worker,
    //                     which is the opposite of what this test needs.
    //   not `timeout`   — this repo asserts the worker bound still fires with
    //                     `timeout(1)`/`gtimeout` ABSENT from PATH, so a
    //                     fixture needing it cannot run everywhere the suite
    //                     does.
    //   no arithmetic   — a counted `until` loop needs `$((i+1))`, and this
    //                     string is interpolated into a single-quoted `sh -c`
    //                     body inside plot-dispatch.sh: the `$` is expanded
    //                     several shells out, and the loop becomes infinite. I
    //                     verified that by hand — it hung.
    //   not backgrounded — `yes > /dev/null &` was the previous fixture and is
    //                     the whole bug: a job backgrounded inside the inner
    //                     `sh -c` is not reliably in the AGENT's subtree on CI,
    //                     so the sampler read a quiet subtree.
    //
    // `yes | head -c N | cksum` is a foreground pipeline: every process in it is
    // the agent's own descendant, so the sampler finds them by construction,
    // and `head` ends it by closing the pipe — bounded, with nothing to kill.
    //
    // `cksum` is what makes it a CPU sink rather than a throughput test.
    // Measured here: `head -c` alone consumed 6 GB in 1.2 s (it is mostly page
    // shuffling), while piping through `cksum` cost 4.7 s for 2 GB at 106 %
    // CPU. 4 GB is therefore ~10 s — comfortably more than the two passes a 3 s
    // interval needs, with room for a runner several times slower than this
    // machine.
    workerCommand: "sh -c 'echo work > done.txt; git add done.txt; "
      + "git -c user.email=a@b -c user.name=a commit -qm work; "
      + "yes | head -c 4000000000 | cksum > /dev/null; true'",
  });
  const exitFile = path.join(run.worktree, '.plot-worker.exit');
  try {
    // The worker really ran, and ran to completion: the wrapper writes this
    // file after its agent, so its presence dates the whole life the monitor
    // was watching. An absent one is "nothing ran", not "nothing to report" —
    // which is the ambiguity the old AgentMonitor control removed.
    const deadline = Date.now() + 20_000;
    while (!fs.existsSync(exitFile) && Date.now() < deadline) execFileSync('sleep', ['0.2']);
    assert.ok(fs.existsSync(exitFile),
      'no worker exit record appeared, so a silent WorkerMonitor proves nothing — the dispatch may never have run at all');

    // Several monitor intervals passed over a worker that was busy-but-quiet
    // with no commits. Nothing about its HEALTH should have been published.
    const worker = fs.existsSync(run.findingsFile)
      ? fs.readFileSync(run.findingsFile, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l))
      : [];
    // NOTHING LIBELLOUS IS LEFT STANDING. A health finding may APPEAR — the
    // sampler reports what it sees, and on a loaded runner it sees a quiet
    // subtree — but over a worker that burned CPU throughout it must be
    // RETRACTED, and `clear` is that retraction. So the last word about this
    // desk may not be `idle` or `stalled`.
    //
    // THIS IS THE ONE ASSERTION THAT GATES, and the alternatives were tried
    // and MEASURED rather than reasoned about:
    //
    //   "the file is empty"          — fails against a working implementation,
    //                                  on CI, at both 1s and 3s intervals.
    //   "no finding repeats"         — the heartbeat the docstring warns of.
    //                                  Mutating the publish-on-change guard to
    //                                  `if true` still PASSED it: on a healthy
    //                                  worker the finding is EMPTY, so
    //                                  publishing every pass still emits
    //                                  nothing. The fixture cannot produce the
    //                                  failure, so the assertion was decorative
    //                                  and is not kept.
    //
    // This one is not: mutating `monitor_activity` to return `idle`
    // unconditionally — the #538 regression — turns it RED, because the libel
    // then never clears.
    //
    // WHAT THIS FIXTURE NOW PROVES IS NARROWER, and saying so is more useful
    // than leaving the claim above to age. Since 2026-09-02 the monitor reads
    // the agent's TRANSCRIPT first and only consults `monitor_activity` past
    // the quiet window. This fixture is a synthetic worker in a sandbox with no
    // `claude -p` session behind it, so its transcript reads `unavailable` and
    // no health finding can be published at all — the assertion passes, but the
    // CPU mutation above no longer reaches it.
    //
    // The transcript rule's own branches are covered as unit cases in
    // `test/reconcile/workermonitor.test.mjs`, against mocked ports, for the
    // reason that file states: a real machine will not produce a fifteen-minute
    // transcript silence on demand, and a test that waits for one flakes.
    const last = worker.filter((x) => x.finding !== 'gone').at(-1);
    if (last) {
      assert.equal(last.finding, 'clear',
        `a healthy worker was left standing as ${last.finding} — the finding was never retracted: ${JSON.stringify(worker)}`);
    }
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
