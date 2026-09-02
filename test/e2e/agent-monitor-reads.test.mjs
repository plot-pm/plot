// Flow test: the AgentMonitor's sampling, across the process boundary.
//
// ONE TEST FILE, AND IT IS ABOUT THE BOUNDARY RATHER THAN THE LOGIC. Every
// finding, every refusal and the ordering between them are covered in
// `test/reconcile/agentmonitor.test.mjs` against mocked ports — including
// `unaskable`, which no real run can produce on demand.
//
// What a mocked-port test CANNOT establish is that the whole thing survives the
// journey it actually makes: a real `plot-dispatch.sh` fan-out, a real detached
// `sh -c` wrapper with its single-quoted body, a real monitor sourcing a real
// `plot-worker-state.sh` from a different cwd, a real `gh` on a real `PATH`,
// a real append, and a real reader parsing it. Every one of those is a place a
// working implementation can be broken by a quoting level, and none of them is
// visible to a unit test.
//
// THE HOST IS STUBBED, NOT REACHED. This monitor makes one host call per pass,
// and an e2e that asked GitHub would be a test whose result depends on a token,
// a rate limit and a network. The stub is on `PATH`, which is itself part of
// what this file proves: the monitor is a detached grandchild, and a `PATH` that
// did not survive the wrapper would have it silently answering `unaskable` and
// publishing nothing — a green test for a broken monitor.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { makeSandbox, sh, stubHost, SCRIPTS } from './helpers.mjs';

const PLAN_CONFIG = '- **Plan directory:** docs/plans/\n- **Active index:** docs/plans/active/\n';

/** An approved single-branch plan on origin, so dispatch has something eligible. */
function dispatchablePlan(work, { slug = 'agent-monitor', date = '2026-08-31' } = {}) {
  const rel = `docs/plans/${date}-${slug}.md`;
  fs.mkdirSync(path.join(work, 'docs', 'plans', 'active'), { recursive: true });
  fs.mkdirSync(path.join(work, 'docs', 'plans', 'delivered'), { recursive: true });
  fs.writeFileSync(path.join(work, rel), `# Agent monitor

## Status

- **Phase:** Approved
- **Type:** feature
- **Review:** pr
- **Impl:** own branches
- **Approved:** ${date}, alice, in-session

## Branches

### Implementation
- \`feature/watched-desk\` — the branch whose desk is really read
`);
  fs.symlinkSync(`../${date}-${slug}.md`, path.join(work, 'docs', 'plans', 'active', `${slug}.md`));
  fs.mkdirSync(path.join(work, '.plot', 'briefs'), { recursive: true });
  fs.writeFileSync(path.join(work, '.plot', 'briefs', 'watched-desk.md'),
    '# Brief: feature/watched-desk\n\nThe monitor is the subject, not this.\n');
  sh(work, 'git add -A && git commit -qm plan && git push -q origin main');
  return rel;
}

/**
 * Dispatch one real worker and hand back where its AgentMonitor publishes.
 *
 * `monitorInterval` is short so a test need not wait five minutes to observe a
 * pass. Shortening it is the honest way to test a cadence: the production
 * default (300) is a choice about the HOST BUDGET, not a property of the
 * sampling, and it is overridable precisely so a test can drive the logic
 * without inheriting the budget.
 */
function dispatchOne(name, { workerCommand, stub, monitorInterval = '1' } = {}) {
  const sb = makeSandbox({ name, config: '' });
  fs.writeFileSync(
    path.join(sb.work, 'CLAUDE.md'),
    `# Sandbox\n\n## Plot Config\n\n${PLAN_CONFIG}- **Worker command:** ${workerCommand}\n`,
  );
  dispatchablePlan(sb.work);
  execFileSync('bash', [path.join(SCRIPTS, 'plot-dispatch.sh'), '--offline', '--max', '1', 'agent-monitor'], {
    cwd: sb.work,
    encoding: 'utf8',
    env: {
      ...process.env,
      PLOT_MONITOR_INTERVAL: monitorInterval,
      ...(stub ? { PATH: `${stub.dir}:${process.env.PATH}` } : {}),
    },
  });
  const wt = path.join(path.dirname(sb.work), 'plot-wt-feature-watched-desk');
  return {
    sb,
    worktree: wt,
    findingsFile: path.join(wt, '.plot-worker.monitor.agent.jsonl'),
    /**
     * The host calls THIS MONITOR made, told apart from dispatch's by CONTENT.
     *
     * A test that asserts "the monitor asked the host" cannot read the whole
     * log. `plot-dispatch.sh:715` asks `plot-host.sh pr-state` as part of its
     * eligibility check, and that spends its own `gh pr list` against the same
     * stub on the same PATH — measured 2026-09-01, six were already logged
     * before dispatch returned. An assertion over every call therefore passes
     * on a monitor that never ran.
     *
     * POSITION CANNOT SEPARATE THEM. A high-water mark taken when dispatch
     * returns looks right and is a race: the monitor is a detached grandchild
     * whose first `monitor_pass` runs before any sleep, so its call can land
     * before the mark and be discarded with dispatch's. Measured — that form
     * failed CI with an empty list while the monitor had demonstrably asked,
     * because its one call sat below the mark.
     *
     * CONTENT does separate them, and the two scripts already differ:
     * `plot-host.sh:1240` requests `--json mergedAt`, while
     * `plot-agent-monitor.sh:239` requests `--json mergedAt,number`. The
     * monitor needs the number and dispatch does not, so the field list is the
     * discriminator — and it is one the monitor would have to stop needing for
     * this filter to go wrong.
     */
    monitorCalls: () => (stub
      ? stub.calls().filter((c) => c.includes('mergedAt,number'))
      : []),
  };
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

/** A `gh` that reports no PR for any branch — the shape `owes a review` needs. */
const NO_PR = 'if (argv.includes("pr") && argv.includes("list")) process.stdout.write("[]");\nelse process.stdout.write("{}");';

/** A `gh` that reports one merged PR — the shape that must silence the finding. */
const HAS_PR = 'if (argv.includes("pr") && argv.includes("list")) process.stdout.write(JSON.stringify([{ number: 7, mergedAt: "2026-08-31T00:00:00Z" }]));\nelse process.stdout.write("{}");';

test('a real dispatched agent that commits and opens nothing is reported owes a review', () => {
  // THE FINDING THIS PLAN WAS WRITTEN FOR, on the real path. The worker command
  // makes a real commit that touches a real file and then exits without opening
  // anything — which is exactly how the two branches in the plan's motivation
  // died, and what nothing in Plot reported.
  //
  // A FILE MUST BE TOUCHED, and getting this wrong would make the test green
  // for the wrong reason. `plot-dispatch.sh` writes an empty `plot: claim`
  // commit before the agent starts, and `monitor_has_commits` counts with a
  // `-- .` pathspec precisely so that bookkeeping does not read as work. A
  // worker committing `--allow-empty` here would be correctly reported as
  // owing nothing.
  //
  // NO `$` IN THE COMMAND: this string is interpolated into a single-quoted
  // `sh -c` body inside plot-dispatch.sh, so a `$n` is expanded several shells
  // out.
  //
  // A 3s MONITOR INTERVAL, NOT 1s, AND THE FIRST DRAFT MEASURED WHY. At 1s the
  // monitor sampled BETWEEN the `echo` and the `git commit` and correctly
  // reported `holds unlanded work` — the desk really did hold an uncommitted
  // file at that instant. That is the monitor racing a fixture, and it is the
  // race the production cadence excludes by construction: 300s is chosen so
  // this monitor never reads an agent mid-edit. Compressing it to 1s
  // reintroduces the very collapse the two-monitor split exists to prevent, so
  // the interval is shortened only as far as the logic tolerates.
  //
  // THE INTERVAL CANNOT CLOSE THAT RACE, AND 3s ONLY MADE IT RARE. Measured on
  // CI 2026-09-02: the monitor published `holds unlanded work` naming
  // `done.txt`, and nothing followed it. `plot-agent-monitor.sh:490` runs its
  // first `monitor_pass` BEFORE any sleep, and `plot-dispatch.sh` starts the
  // monitor inside the wrapper immediately before the agent — so the first
  // sample races the worker's first command whatever the interval is set to.
  //
  // AND THE FIRST SAMPLE DECIDES, because the monitor publishes ON CHANGE. A
  // mid-edit `holds unlanded work` still holds once the commit lands and the
  // PR is still absent, so no second record is ever written and the poll waits
  // out its deadline against a monitor with nothing left to say.
  //
  // `sleep 12` after the push is what removes the ambiguity — not by making
  // the sample later, but by keeping the desk in the state under test for
  // several intervals after it reaches it. The debt itself is patient, so a
  // finding one interval late is as good as one on time; what the test cannot
  // tolerate is a finding about a state the fixture was only passing through.
  //
  // VERIFIED BY FORCING THE RACE, not by a green run: with 4s inserted between
  // the write and the commit, so the first sample lands mid-edit for certain,
  // the test still reports `owes a review`.
  const stub = stubHost(NO_PR);
  const run = dispatchOne('agent-owes-review', {
    stub,
    monitorInterval: '3',
    workerCommand: "sh -c 'echo work > done.txt && git add done.txt && git commit -qm work && git push -q -u origin HEAD && sleep 12'",
  });
  try {
    const records = waitFor(run.findingsFile, (r) => r.some((x) => x.finding === 'owes a review'));
    const owed = records.find((x) => x.finding === 'owes a review');
    assert.ok(owed,
      `the AgentMonitor never reported finished work with no PR: ${JSON.stringify(records)}`);

    // THE SUBSCRIBER'S VIEW. A reader that knows only the record shape must act
    // on this without re-deriving anything.
    assert.equal(owed.monitor, 'AgentMonitor');
    assert.equal(owed.branch, 'feature/watched-desk',
      'the finding does not name the branch it is about — and the branch, not the agent, is what carries the debt');
    // `realpathSync` because macOS symlinks /var → /private/var and dispatch
    // resolves the path while `path.dirname` does not.
    assert.equal(owed.worktree, fs.realpathSync(run.worktree));
    assert.ok(owed.evidence && owed.evidence.length > 0, 'the finding carries no evidence');
    assert.match(owed.measuredAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
    assert.match(owed.since, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);

    // THE HOST WAS REALLY ASKED, through a real `PATH` from a detached
    // grandchild. Without this the test would pass identically on a monitor
    // whose `gh` lookup never resolved — it would answer `unaskable`, publish
    // nothing, and the assertion above would have caught it; but the reverse
    // (a finding published without asking) is what this pins down.
    // THE MONITOR'S CALLS, not dispatch's — separated by the `--json` field
    // list rather than by position; see `dispatchOne`.
    const asked = run.monitorCalls().filter((c) => c.startsWith('gh pr list'));
    assert.ok(asked.length > 0,
      `the monitor published owes a review without asking the host: ${JSON.stringify(run.monitorCalls())}`);
    assert.ok(asked.some((c) => c.includes('feature/watched-desk')),
      'the host was asked about the wrong branch');
    // `mergedAt`, never `state`: a merged PR reports CLOSED, and squash-merge
    // leaves a branch ahead of main forever. Now implied by `monitorCalls`,
    // which selects on that field list — kept because it is the PROPERTY, and a
    // future filter that stopped selecting on content would silently drop it.
    assert.ok(asked.some((c) => c.includes('mergedAt')),
      'the PR question does not read mergedAt');

    // PUBLISHED ONCE, not once per pass. The monitor keeps looping after the
    // finding holds; a debt republished every interval would leave a subscriber
    // unable to tell a new one from an old one.
    execFileSync('sleep', ['3']);
    const after = fs.readFileSync(run.findingsFile, 'utf8').trim().split('\n').filter(Boolean)
      .map((l) => JSON.parse(l)).filter((x) => x.finding === 'owes a review');
    assert.equal(after.length, 1,
      `owes a review was republished on every pass, got ${after.length}`);
  } finally {
    run.sb.cleanup();
  }
});

test('a real agent whose branch has a PR is reported owing nothing', () => {
  // THE CONTROL, and the half of the `Done when` that keeps the finding worth
  // reading. The desk is identical to the test above — same commit, same clean
  // tree, same exit — and only the host's answer differs.
  //
  // A `.changeset/*.md` is added too, because with a PR present the gate
  // becomes the next question and this test is about `owes a review` alone.
  const stub = stubHost(HAS_PR);
  const run = dispatchOne('agent-has-pr', {
    stub,
    monitorInterval: '3',
    workerCommand: "sh -c 'mkdir -p .changeset && echo work > done.txt && printf -- '\\''---\\n\"plot\": patch\\n---\\n\\nA real description of a real change.\\n'\\'' > .changeset/thing.md && git add -A && git commit -qm work && git push -q -u origin HEAD'",
  });
  try {
    // WAIT FOR THE POLL, DO NOT GUESS AT IT. The two assertions below want
    // opposite things from the clock: the empty-findings one is a NEGATIVE and
    // gets stronger the longer it waits, while the host-was-asked one is a
    // POSITIVE and needs at least one sample to have happened.
    //
    // A fixed `sleep 5` at `monitorInterval: 3` served neither well. The worker
    // runs mkdir, a write, `git add`, `git commit` and `git push` before the
    // desk is even in the state being measured — so on a loaded runner the five
    // seconds could contain a single sampling opportunity, or none. Measured on
    // CI 2026-08-31 and again 2026-09-01: this test failed on
    // `the monitor never asked the host` on two main commits whose diffs were
    // markdown, and passed on the commits between them.
    //
    // Polling for the event is strictly stronger than the sleep it replaces:
    // the positive becomes deterministic rather than probable, and the negative
    // gets AT LEAST the old five seconds, usually more — the loop only stops
    // once a poll has actually happened.
    //
    // AND IT POLLS THE MONITOR'S CALLS, NOT THE WHOLE LOG, which is what the
    // 2026-09-01 CI failure was really about. `plot-dispatch.sh:715` spends its
    // own `gh pr list` on the same stub, so `stub.calls()` is already non-empty
    // when this loop starts: the poll returned on its first iteration, the
    // assertion below passed on dispatch's call, and the monitor was never
    // measured at all. `run.monitorCalls()` selects the monitor's calls by
    // their `--json` field list, so the loop now waits for the event it names.
    const deadline = Date.now() + 30_000;
    while (Date.now() < deadline
      && !run.monitorCalls().some((c) => c.startsWith('gh pr list'))) {
      execFileSync('sleep', ['0.25']);
    }
    const records = fs.existsSync(run.findingsFile)
      ? fs.readFileSync(run.findingsFile, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l))
      : [];
    assert.deepEqual(records.filter((x) => x.finding === 'owes a review'), [],
      `owes a review fired on a branch whose PR exists: ${JSON.stringify(records)}`);

    // SILENCE HERE IS A MEASUREMENT, not an absence, and the host log is what
    // makes it one. Without it, a monitor that never ran at all would produce
    // the same empty file — which is precisely the ambiguity the Attaching
    // slice's `nothing measured yet` no-op existed to remove, and which this
    // slice removed the no-op from.
    assert.ok(run.monitorCalls().some((c) => c.startsWith('gh pr list')),
      `the monitor never asked the host, so this silence proves nothing — it may never have sampled at all: ${JSON.stringify(run.monitorCalls())}`);
  } finally {
    run.sb.cleanup();
  }
});

test('the monitor publishes into the worktree without making it read as dirty', () => {
  // THE NAME IS THE CONTRACT, cashed for the second monitor. This script
  // appends to `.plot-worker.monitor.agent.jsonl` INSIDE the worktree whose
  // dirtiness it measures — so a findings file the filter did not drop would
  // make every monitored desk on the estate report `holds unlanded work` about
  // the monitor itself, one pass in, forever.
  //
  // Asked through `plot_worker_dirty`, the function whose answer that failure
  // would come through, and through the monitor's own port, which is the one
  // that would actually publish it.
  //
  // THE DESK MUST OWE SOMETHING, or there is no findings file to be watched by.
  // A worker that exits leaving nothing behind now publishes NOTHING — which is
  // the correct answer and a useless fixture, since the file whose effect is
  // under test would never be written. The marker is the cheapest debt that
  // needs no host answer, so the monitor publishes, the file exists, and the
  // question "does that file make the desk look dirty?" becomes askable.
  const stub = stubHost(NO_PR);
  const run = dispatchOne('agent-not-dirty', {
    stub,
    workerCommand: "sh -c 'echo PLOT-BLOCKED: hold on > PLOT-BLOCKED.md'",
  });
  try {
    waitFor(run.findingsFile, (r) => r.length > 0);
    assert.ok(fs.existsSync(run.findingsFile), 'nothing was published, so this proves nothing');

    const dirty = execFileSync('bash', ['-c', `
      . ${JSON.stringify(path.join(SCRIPTS, 'plot-worker-state.sh'))}
      plot_worker_dirty ${JSON.stringify(run.worktree)}
    `], { encoding: 'utf8' }).trim().split('\n').filter(Boolean);

    // The MARKER is legitimately dirty — the fixture wrote it. The findings
    // file must not be, and that is the whole assertion: no path carrying the
    // `.plot-worker.` prefix may appear in what the fleet reads as work.
    assert.deepEqual(dirty.filter((f) => f.includes('.plot-worker.')), [],
      `the monitor's own records read as unlanded work: ${JSON.stringify(dirty)}`);
  } finally {
    run.sb.cleanup();
  }
});

test('a real blocked desk is reported owes an answer, and the marker is named', () => {
  // A `PLOT-BLOCKED*` marker is the one finding whose subject is a PERSON, and
  // the only one a worker produces by writing a file rather than by what it
  // leaves undone. Worth one real run because the glob, the tree read and the
  // basename all cross the boundary.
  const stub = stubHost(NO_PR);
  const run = dispatchOne('agent-blocked', {
    stub,
    workerCommand: "sh -c 'echo PLOT-BLOCKED: which way? > PLOT-BLOCKED.md'",
  });
  try {
    const records = waitFor(run.findingsFile, (r) => r.some((x) => x.finding === 'owes an answer'));
    const blocked = records.find((x) => x.finding === 'owes an answer');
    assert.ok(blocked,
      `a real PLOT-BLOCKED marker was not reported: ${JSON.stringify(records)}`);
    assert.match(blocked.evidence, /PLOT-BLOCKED\.md/,
      'the evidence does not name the marker a person must go and read');
    assert.equal(blocked.branch, 'feature/watched-desk');
  } finally {
    run.sb.cleanup();
  }
});
