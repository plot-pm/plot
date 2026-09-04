// Flow test: the BuildMonitor's sampling, across the process boundary.
//
// ONE TEST FILE, AND IT IS ABOUT THE BOUNDARY RATHER THAN THE LOGIC. Every
// finding, every refusal and the ordering between them are covered in
// `test/reconcile/buildmonitor.test.mjs` against a mocked host — including the
// three no real CI will produce on demand: a run that vanishes, a host that
// refuses, and two runs for two shas at once.
//
// What a mocked-port test CANNOT establish is that the whole thing survives the
// journey it actually makes: a real `plot-dispatch.sh` fan-out, a real detached
// `sh -c` wrapper with its single-quoted body, a real monitor invoking a real
// `plot-host.sh` from a different cwd, a real `gh` on a real `PATH`, a real
// `git rev-parse` against a real worktree, a real append, and a real reader
// parsing it. Every one of those is a place a working implementation can be
// broken by a quoting level, and none is visible to a unit test.
//
// THE SHA IS THE POINT, AND IT IS A REAL ONE. The unit tests use a fixed
// 40-character string; here the monitor reads the head with real git in a real
// worktree, and the stub answers about THAT sha because the test asks git for
// it too. A monitor that read the head from the wrong place — the wrong cwd,
// the wrong ref, the dispatching repo instead of the worktree — passes every
// unit test and fails here.
//
// THE HOST IS STUBBED, NOT REACHED. An e2e that asked GitHub would be a test
// whose result depends on a token, a rate limit and a network. The stub is on
// `PATH`, which is itself part of what this file proves: the monitor is a
// detached grandchild, and a `PATH` that did not survive the wrapper would have
// it silently answering `unaskable` and publishing nothing — a green test for a
// broken monitor.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { makeSandbox, sh, stubHost, SCRIPTS, staffDesk } from './helpers.mjs';

const PLAN_CONFIG = '- **Plan directory:** docs/plans/\n- **Active index:** docs/plans/active/\n';

/** An approved single-branch plan on origin, so dispatch has something eligible. */
function dispatchablePlan(work, { slug = 'build-monitor', date = '2026-08-31' } = {}) {
  const rel = `docs/plans/${date}-${slug}.md`;
  fs.mkdirSync(path.join(work, 'docs', 'plans', 'active'), { recursive: true });
  fs.mkdirSync(path.join(work, 'docs', 'plans', 'delivered'), { recursive: true });
  fs.writeFileSync(path.join(work, rel), `# Build monitor

## Status

- **Phase:** Approved
- **Type:** feature
- **Review:** pr
- **Impl:** own branches
- **Approved:** ${date}, alice, in-session

## Branches

### Implementation
- \`feature/watched-build\` — the branch whose run is really followed
`);
  fs.symlinkSync(`../${date}-${slug}.md`, path.join(work, 'docs', 'plans', 'active', `${slug}.md`));
  fs.mkdirSync(path.join(work, '.plot', 'briefs'), { recursive: true });
  fs.writeFileSync(path.join(work, '.plot', 'briefs', 'watched-build.md'),
    '# Brief: feature/watched-build\n\nThe monitor is the subject, not this.\n');
  sh(work, 'git add -A && git commit -qm plan && git push -q origin main');
  return rel;
}

/**
 * Dispatch one real worker and hand back where its BuildMonitor publishes.
 *
 * `monitorInterval` is short so a test need not wait for a production cadence.
 * Shortening it is the honest way to test this one: the default (30) is a
 * choice about the HOST BUDGET, and the budget is what the silence rule
 * protects — not the sampling logic, which is the same at any interval.
 */
function dispatchOne(name, { workerCommand, stub, monitorInterval = '1' } = {}) {
  const sb = makeSandbox({ name, config: '' });
  fs.writeFileSync(
    path.join(sb.work, 'CLAUDE.md'),
    `# Sandbox\n\n## Plot Config\n\n${PLAN_CONFIG}- **Worker command:** ${workerCommand}\n`,
  );
  dispatchablePlan(sb.work);
  // THE DESK IS LAID BY THE FIXTURE, not by the fan-out. Dispatch hands a slice
  // to the registry and cuts nothing; what these tests are about is the worker
  // and its monitors once a desk exists, so the fixture provides one and every
  // assertion below stands unchanged.
  const { worktree: wt } = staffDesk(sb.work, 'feature/watched-build', {
    env: {
      PLOT_MONITOR_INTERVAL: monitorInterval,
      ...(stub ? { PATH: `${stub.dir}:${process.env.PATH}` } : {}),
    },
  });
  return { sb, worktree: wt, findingsFile: path.join(wt, '.plot-worker.monitor.build.jsonl') };
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

/**
 * A `gh` whose `run list` answers with one run for WHATEVER sha it is asked
 * about, with the given conclusion.
 *
 * ANSWERING ABOUT THE SHA IN THE ARGUMENTS is what makes this a fixture rather
 * than a constant: `plot-host.sh run-for-sha` filters by `headSha`, so a stub
 * returning a fixed sha would be filtered out and the test would go green for
 * "no run" — the wrong reason. The stub reads `--branch`'s neighbourhood the
 * way the real host does and reports the run the real host would.
 */
const runFor = (conclusion, status = 'completed') => `
  if (argv.includes("run") && argv.includes("list")) {
    const sha = process.env.PLOT_E2E_HEAD_SHA || "";
    process.stdout.write(JSON.stringify([{
      headSha: sha,
      conclusion: ${JSON.stringify(conclusion)},
      status: ${JSON.stringify(status)},
      startedAt: "2026-08-31T00:00:00Z",
      url: "https://ci.example/run/1",
      workflowName: "CI",
    }]));
  } else if (argv.includes("pr") && argv.includes("list")) {
    process.stdout.write("[]");
  } else process.stdout.write("{}");
`;

/** A `gh` whose only run is for a sha the branch has already moved past. */
const runForOtherSha = `
  if (argv.includes("run") && argv.includes("list")) {
    process.stdout.write(JSON.stringify([{
      headSha: "${'c'.repeat(40)}",
      conclusion: "success",
      status: "completed",
      startedAt: "2026-08-31T00:00:00Z",
      url: "https://ci.example/run/stale",
      workflowName: "CI",
    }]));
  } else if (argv.includes("pr") && argv.includes("list")) {
    process.stdout.write("[]");
  } else process.stdout.write("{}");
`;

// A worker that commits a real file and exits. The commit is what gives the
// monitor a head sha to be about; NO `$` may appear, because this string is
// interpolated into a single-quoted `sh -c` body inside plot-dispatch.sh and a
// `$n` would be expanded several shells out.
const COMMITS_AND_EXITS =
  'sh -c "echo built > built.txt && git add built.txt && git commit -qm work && sleep 4"';

test('a real dispatched worker has its build followed, and a failure reaches the file', () => {
  // THE PROCESS BOUNDARY, END TO END. A real dispatch starts a real detached
  // wrapper; the BuildMonitor is its child; it reads a real head sha out of a
  // real worktree with real git; it invokes the real `plot-host.sh run-for-sha`,
  // which shells out to a `gh` that only exists because `PATH` survived two
  // levels of process; and the finding lands in a real file a real reader
  // parses.
  const stub = stubHost(runFor('failure'));
  const run = dispatchOne('build-fails', { workerCommand: COMMITS_AND_EXITS, stub });

  // The stub answers about whatever sha the worktree's head really is, which is
  // only knowable after the worker has committed. Waiting for the commit is the
  // honest ordering: before it, there is genuinely no build to report on.
  //
  // WAIT FOR THE COMMIT, NOT FOR THE FILE THE COMMIT WILL CONTAIN. An earlier
  // version watched for `built.txt` and read HEAD the moment it appeared — but
  // the worker CREATES that file and THEN commits it, so between the two
  // `rev-parse HEAD` still answers the pre-commit sha.
  //
  // Locally the commit follows fast enough to hide the gap. On CI it does not:
  // `git commit` waits on disk, the test captured the old sha, wrote it into
  // the stub, and the monitor — correctly reading the NEW head — reported a sha
  // the assertion below did not expect. Measured on main 2026-08-31: `actual`
  // named e280e769…, and the same test passes locally every time.
  //
  // So the condition is the file being TRACKED, which is true only once the
  // commit exists. `git log -1 --name-only` names the paths the last commit
  // touched; until that commit happens, `built.txt` is not among them.
  const deadline = Date.now() + 20_000;
  let head = '';
  while (Date.now() < deadline) {
    const committed = (() => {
      try {
        return execFileSync('git', ['-C', run.worktree, 'log', '-1', '--name-only', '--format='],
          { encoding: 'utf8' }).includes('built.txt');
      } catch {
        return false; // no commits yet: the branch still carries only its claim
      }
    })();
    if (committed) {
      head = execFileSync('git', ['-C', run.worktree, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
      break;
    }
    execFileSync('sleep', ['0.2']);
  }
  assert.ok(head, 'the worker never committed, so there was never a head to build');

  // The stub reads the sha from its own environment, which the dispatch has
  // already inherited — so it is written where the stub can see it and the
  // monitor's next pass finds a run for the commit that now exists.
  fs.writeFileSync(path.join(stub.dir, 'respond.mjs'),
    `const [cli, ...argv] = process.argv.slice(2);\nprocess.env.PLOT_E2E_HEAD_SHA = ${JSON.stringify(head)};\n${runFor('failure')}\n`);

  // WAIT FOR A FINDING ABOUT *THIS* HEAD, not for any build failure.
  //
  // The monitor is already running when the stub is rewritten above, and the
  // worker commits more than once — its claim, then `built.txt`. A pass that
  // lands between those two publishes a `build failed` naming the EARLIER sha,
  // and a predicate matching the finding alone returns that one. The assertion
  // below then compares the stale sha against `head` and fails with
  // "the evidence does not name the real sha the run was about".
  //
  // Measured 2026-09-01: twice in one hour, on two unrelated PRs and on main,
  // each time with an older sha in the evidence. It is a race in the test, not
  // in the monitor — and because e2e runs before every domain and board gate,
  // one such failure marks eighteen later steps `skipped`.
  const about = (f) => f.finding === 'build failed' && String(f.evidence || '').includes(head);
  const found = waitFor(run.findingsFile, (r) => r.some(about));
  const failed = found.find(about);
  assert.ok(failed,
    `the BuildMonitor published no failure for a really-failing run: ${JSON.stringify(found)}`);
  assert.equal(failed.monitor, 'BuildMonitor');
  assert.equal(failed.branch, 'feature/watched-build',
    'the finding does not name the branch it is about');
  assert.match(failed.evidence, new RegExp(head),
    'the evidence does not name the real sha the run was about');
  assert.match(failed.evidence, /ci\.example/,
    'the evidence does not name the run, so a reader cannot go and look at it');

  // THE HOST WAS REALLY REACHED, through the real adapter. Without this the
  // test would pass identically if the monitor had invented the finding, and
  // the whole point of the file is that the round trip happens.
  assert.ok(stub.calls().some((c) => c.startsWith('gh run list')),
    `the monitor never asked the host for a run: ${JSON.stringify(stub.calls())}`);
});

test('a run for a superseded sha is reported as head moved, not as its conclusion', () => {
  // THE FINDING THAT EARNS THE MONITOR, on the real path. The host's only run is
  // a SUCCESS for a sha this branch never had — the shape of a run still in
  // flight for a commit that has been pushed past. Reported as `build passed`,
  // it would invite a merge of code nobody reviewed; measured 2026-08-30, two
  // merge waiters did exactly that and had to be stopped and re-armed.
  const stub = stubHost(runForOtherSha);
  const run = dispatchOne('build-head-moved', { workerCommand: COMMITS_AND_EXITS, stub });

  const found = waitFor(run.findingsFile, (r) => r.length > 0);
  assert.ok(found.length > 0,
    'the BuildMonitor published nothing about a branch whose run is for another sha');
  assert.equal(found[0].finding, 'head moved',
    `a superseded run was published as ${found[0].finding}`);
  assert.equal(found.filter((f) => f.finding === 'build passed').length, 0,
    `a run for code nobody will merge was reported green: ${JSON.stringify(found)}`);
});

test('a worker whose branch has no run publishes nothing, and stops asking', () => {
  // THE SILENCE, ACROSS THE BOUNDARY. `it polls nothing when no run is live` is
  // asserted against counted ports in the unit file; here the subject is that
  // silence is what a real, correctly-behaving monitor actually produces — an
  // empty findings file rather than a heartbeat, a "nothing measured yet", or a
  // finding invented out of an empty answer.
  //
  // The host says it has no runs at all, which is the ordinary state of a fresh
  // push before CI wakes up.
  const stub = stubHost(`
    if (argv.includes("run") && argv.includes("list")) process.stdout.write("[]");
    else if (argv.includes("pr") && argv.includes("list")) process.stdout.write("[]");
    else process.stdout.write("{}");
  `);
  const run = dispatchOne('build-silent', { workerCommand: COMMITS_AND_EXITS, stub });

  waitFor(run.findingsFile, () => false, 6_000);
  const found = fs.existsSync(run.findingsFile)
    ? fs.readFileSync(run.findingsFile, 'utf8').trim().split('\n').filter(Boolean)
    : [];
  assert.deepEqual(found, [],
    `a branch with no run produced findings: ${JSON.stringify(found)}`);
});
