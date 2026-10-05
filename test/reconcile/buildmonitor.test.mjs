// Contract test for skills/plot/scripts/plot-build-monitor.sh — the
// BuildMonitor's sampling.
//
// UNIT-FIRST AGAINST A MOCKED HOST, and for this monitor the argument is at its
// strongest: every one of its four findings is about a CI run, and CI does not
// produce states to order. You cannot ask GitHub for an `action_required` run
// when a test wants one, you cannot make a run vanish, and you certainly cannot
// arrange two runs for two shas at the instant a race needs them. Waiting for
// those to occur naturally is not a test.
//
// So the script is SOURCED with `PLOT_MONITOR_NO_MAIN=1`, which defines every
// function and runs no loop, and the two `monitor_*` ports are redefined per
// test. Nothing here calls `gh`, and nothing here sleeps for a cadence.
//
// WHAT IS DELIBERATELY *NOT* MOCKED: `sample_finding`'s ordering, `run_field`'s
// JSON reading, `publish`, and the publish-on-change rule keyed by sha. Those
// are the slice's logic, and a test that stubbed them would assert its own
// stubs.
//
// THE HOST CALL IS COUNTED, not just stubbed. "It polls nothing when no run is
// live" is a `Done when` in its own right, and the only way to assert it is to
// count the round trips a pass makes. A stub that merely returns the right
// answer would let an implementation that asked on every pass pass every other
// test in this file.
//
// The seam between this file and `test/e2e/build-monitor-follows.test.mjs` is
// the process boundary: here, every finding and every refusal against a fake
// host; there, one real wrapper publishing a real finding.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const scripts = path.join(here, '..', '..', 'skills', 'plot', 'scripts');
const monitor = path.join(scripts, 'plot-build-monitor.sh');

/**
 * Drive the monitor with its ports replaced.
 *
 * `ports` is shell redefining `monitor_head_sha` and/or `monitor_run_for_sha`.
 * `passes` is how many times `monitor_pass` runs — the transitions rule means
 * the head-moves-between-passes cases need at least two.
 *
 * Returns `{ found, hostCalls }`: the findings the monitor published, parsed,
 * and how many times the host port was reached. Publishing goes to a real file
 * because that IS the publish path in this slice; stubbing it would leave the
 * one thing a subscriber reads untested.
 */
function drive(ports, passes = 1) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-bmon-'));
  const file = path.join(dir, 'findings.jsonl');
  const calls = path.join(dir, 'hostcalls');
  const script = `
    PLOT_MONITOR_NO_MAIN=1
    . ${JSON.stringify(monitor)}
    # The host-call counter: one line per call, so a port can answer by the
    # number of the call it is (\`wc -l\` is the call's own number, 1-based).
    HOSTCALLS=${JSON.stringify(calls)}
    ${ports}
    # Wrap whatever the test defined so the round trips can be counted without
    # the test having to remember to do it.
    eval "original_run_for_sha() $(declare -f monitor_run_for_sha | tail -n +2)"
    monitor_run_for_sha() { echo x >> ${JSON.stringify(calls)}; original_run_for_sha "$@"; }
    for _i in $(seq 1 ${passes}); do monitor_pass; done
  `;
  try {
    execFileSync('bash', ['-c', script], {
      encoding: 'utf8',
      timeout: 30_000,
      env: {
        ...process.env,
        PLOT_BRANCH: 'feature/watched',
        PLOT_WORKTREE: dir,
        PLOT_MONITOR_FILE: file,
        PLOT_MONITOR_INTERVAL: '30',
      },
    });
    const found = fs.existsSync(file)
      ? fs.readFileSync(file, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l))
      : [];
    const hostCalls = fs.existsSync(calls)
      ? fs.readFileSync(calls, 'utf8').trim().split('\n').filter(Boolean).length
      : 0;
    return { found, hostCalls };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

const HEAD = 'a'.repeat(40);
const OLDER = 'b'.repeat(40);

/** A run for one sha, as `plot-host.sh run-for-sha` prints it. */
const run = ({ sha = HEAD, status = 'completed', conclusion = null, url = 'https://ci/run/1' }) =>
  JSON.stringify({ sha, status, conclusion, url, startedAt: '2026-08-31T00:00:00Z' });

/** A branch sitting on HEAD, with the host answering however the test says. */
const build = (hostBody) => `
  monitor_head_sha() { printf '%s' ${JSON.stringify(HEAD)}; }
  monitor_run_for_sha() { ${hostBody} }
`;

/** The host returns one run object. */
const answers = (obj) => build(`printf '%s' ${JSON.stringify(run(obj))}; return 0;`);

// ---------------------------------------------------------------------------
// EACH FINDING, INDIVIDUALLY TRIGGERABLE — the plan's first `Done when`
// ---------------------------------------------------------------------------

test('build failed fires when a run for the head reaches a failing conclusion', () => {
  const { found } = drive(answers({ conclusion: 'failure' }));
  assert.equal(found.length, 1, `expected exactly one finding, got ${JSON.stringify(found)}`);
  assert.equal(found[0].finding, 'build failed');
  assert.equal(found[0].monitor, 'BuildMonitor');
  assert.equal(found[0].branch, 'feature/watched',
    'the finding does not name the branch it is about');
  assert.match(found[0].evidence, /https:\/\/ci\/run\/1/,
    'the evidence does not name the run, so a reader cannot go and look at it');
});

test('a free agent\'s monitor reports the branch its desk was handed, not the empty one it started with', () => {
  // A free agent starts with PLOT_BRANCH empty and takes its slice later, in the
  // same desk. A branch read once at start left `monitor_run_for_sha` with no
  // branch to ask about, so no finding was ever published for that slice.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-bmon-free-'));
  const file = path.join(dir, 'findings.jsonl');
  const desk = path.join(dir, 'desk');
  try {
    execFileSync('git', ['init', '-q', '-b', 'main', desk]);
    execFileSync('git', ['-C', desk, 'checkout', '-q', '-b', 'feature/handed']);
    const script = `
      PLOT_MONITOR_NO_MAIN=1
      . ${JSON.stringify(monitor)}
      monitor_head_sha() { printf '%s' ${JSON.stringify(HEAD)}; }
      monitor_run_for_sha() {
        [ "$branch" = feature/handed ] || return 2
        printf '%s' ${JSON.stringify(run({ conclusion: 'failure' }))}; return 0;
      }
      monitor_pass
    `;
    execFileSync('bash', ['-c', script], {
      encoding: 'utf8',
      timeout: 30_000,
      env: { ...process.env, PLOT_BRANCH: '', PLOT_WORKTREE: desk, PLOT_MONITOR_FILE: file },
    });
    const found = fs.existsSync(file)
      ? fs.readFileSync(file, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l))
      : [];
    assert.equal(found.length, 1, `expected one finding for the handed branch, got ${JSON.stringify(found)}`);
    assert.equal(found[0].finding, 'build failed');
    assert.equal(found[0].branch, 'feature/handed');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('build passed fires when a run reaches success', () => {
  const { found } = drive(answers({ conclusion: 'success' }));
  assert.equal(found.length, 1);
  assert.equal(found[0].finding, 'build passed');
  assert.match(found[0].evidence, new RegExp(HEAD),
    'the evidence does not name the sha the answer is about');
});

test('build needs approval fires on action_required', () => {
  // A REAL STATE, NOT AN EDGE CASE. Bot branches hit it — the release PR's runs
  // need a manual click before they start. A monitor that folded this into "not
  // passed yet" would report the build pending forever while it waits for a
  // click nobody knows is needed.
  const { found } = drive(answers({ status: 'completed', conclusion: 'action_required' }));
  assert.equal(found.length, 1);
  assert.equal(found[0].finding, 'build needs approval');
  assert.match(found[0].evidence, /approval/);
});

test('build needs approval fires on a waiting run, which carries no conclusion yet', () => {
  // The same state seen earlier in a run's life: GitHub reports `waiting` as a
  // STATUS with no conclusion at all. Read only for a conclusion, this run is
  // indistinguishable from one still going — which is the "pending forever"
  // failure, arriving by the other route.
  const { found } = drive(answers({ status: 'waiting', conclusion: null }));
  assert.equal(found.length, 1);
  assert.equal(found[0].finding, 'build needs approval');
});

test('head moved fires when the run in hand is for an older sha', () => {
  // THE FINDING THAT EARNS THIS MONITOR. A build's subject is a sha, not a
  // branch, and a green result for code nobody will merge is worse than none —
  // it invites a merge of the wrong thing. Measured 2026-08-30: two merge
  // waiters reported on superseded runs and had to be stopped and re-armed.
  const { found } = drive(answers({ sha: OLDER, conclusion: 'success' }));
  assert.equal(found.length, 1);
  assert.equal(found[0].finding, 'head moved',
    'a run for a superseded sha was reported as its own conclusion');
  assert.match(found[0].evidence, new RegExp(OLDER), 'the evidence does not name the stale sha');
  assert.match(found[0].evidence, new RegExp(HEAD), 'the evidence does not name the current head');
});

test('a success for a superseded sha is never reported as build passed', () => {
  // The sharp half of the same `Done when`, stated as the negative it protects:
  // "a finding about a superseded run is never reported as current". The test
  // above proves `head moved` fires; this one proves the green answer does not
  // leak out under any other name.
  const { found } = drive(answers({ sha: OLDER, conclusion: 'success' }));
  assert.equal(found.filter((f) => f.finding === 'build passed').length, 0,
    `a superseded run was published as current: ${JSON.stringify(found)}`);
});

// ---------------------------------------------------------------------------
// IT POLLS NOTHING WHEN NO RUN IS LIVE — asserted, not assumed
// ---------------------------------------------------------------------------

test('no head means the host is never asked at all', () => {
  // THE SILENCE RULE, IN ITS STRUCTURAL FORM. `monitor_head_sha` is a local git
  // read and it GATES the host call, so a worktree with nothing in it costs
  // zero round trips. This is what makes a 30-second cadence against a host
  // affordable, and a monitor that asked anyway is the rate problem this whole
  // design avoids.
  const { found, hostCalls } = drive(`
    monitor_head_sha() { printf ''; }
    monitor_run_for_sha() { printf '%s' ${JSON.stringify(run({ conclusion: 'success' }))}; return 0; }
  `, 3);
  assert.equal(hostCalls, 0,
    `the monitor questioned an idle host ${hostCalls} time(s) with no head to ask about`);
  assert.deepEqual(found, [], `a branch with no head produced findings: ${JSON.stringify(found)}`);
});

test('a settled sha is never asked about again', () => {
  // THE SECOND HALF OF THE SILENCE, and the one an implementation is most
  // likely to miss. A build's answer changes once and stays: once this sha's
  // run has concluded, every further pass would spend a host round trip to
  // re-learn a fact already published. Ten passes, one question.
  const { found, hostCalls } = drive(answers({ conclusion: 'success' }), 10);
  assert.equal(hostCalls, 1,
    `a settled build was re-asked ${hostCalls} times; the answer cannot change`);
  assert.equal(found.length, 1, 'a terminal answer was republished');
});

test('a run still in progress is asked again, because its answer can still change', () => {
  // The counterpart to the test above, and what keeps that optimisation honest:
  // an unfinished run is NOT settled, so the monitor must keep asking. An
  // implementation that settled every sha it had once seen would go silent on
  // exactly the builds somebody is waiting for.
  const { found, hostCalls } = drive(answers({ status: 'in_progress', conclusion: null }), 3);
  assert.equal(hostCalls, 3, 'a live run stopped being polled before it concluded');
  assert.deepEqual(found, [],
    `a run still going produced a finding: ${JSON.stringify(found)}`);
});

// ---------------------------------------------------------------------------
// THE REFUSALS — the branches a real CI will not produce on demand
// ---------------------------------------------------------------------------

test('a host that refuses produces no finding at all', () => {
  // A FAILURE TO OBSERVE IS NOT EVIDENCE OF SOMETHING TO SEE. An unreachable
  // host is not a build that is absent, and this monitor's healthy signal IS
  // silence — so a `gh` failure read as "no run" would be invisible by
  // construction.
  const { found } = drive(build('return 2;'), 2);
  assert.deepEqual(found, [],
    `an unaskable host produced a finding: ${JSON.stringify(found)}`);
});

test('a run that vanishes produces no finding', () => {
  // THE HOST WAS ASKED AND HAS NO RUN FOR THIS SHA — the ordinary state of a
  // freshly pushed commit before CI wakes up, and also what a deleted run looks
  // like. Empty is a real answer and deliberately not an error.
  const { found } = drive(build("printf ''; return 0;"), 2);
  assert.deepEqual(found, [], `an absent run produced a finding: ${JSON.stringify(found)}`);
});

test('two runs for two shas: the answer follows the head, not the newest run', () => {
  // THE RACE THE MONITOR EXISTS FOR, and the one a real CI cannot be asked to
  // stage. The host holds runs for both shas; the head is HEAD. An
  // implementation reading "the newest run" — which is what `gh run list`
  // returns first, and what the branch-scoped `runs` op would give — reports
  // the OLDER sha's conclusion as current.
  const { found } = drive(`
    monitor_head_sha() { printf '%s' ${JSON.stringify(HEAD)}; }
    monitor_run_for_sha() {
      # A host pinned to the sha it was asked about, which is what
      # \`run-for-sha\` guarantees and \`runs\` cannot.
      if [ "$1" = ${JSON.stringify(HEAD)} ]; then
        printf '%s' ${JSON.stringify(run({ sha: HEAD, conclusion: 'failure' }))}
      else
        printf '%s' ${JSON.stringify(run({ sha: OLDER, conclusion: 'success' }))}
      fi
      return 0
    }
  `);
  assert.equal(found.length, 1);
  assert.equal(found[0].finding, 'build failed',
    'the monitor reported the other sha’s run; the answer must follow the head');
});

// ---------------------------------------------------------------------------
// TRANSITIONS, NOT CONDITIONS — the publish rule
// ---------------------------------------------------------------------------

test('the same answer about the same sha is published once', () => {
  // A monitor that republished `build failed` every thirty seconds would fill
  // the findings file with one fact repeated, and a subscriber could not tell a
  // new failure from an old one. `since` carries the age instead.
  const { found } = drive(answers({ conclusion: 'failure' }), 5);
  assert.equal(found.length, 1, `one failure was published ${found.length} times`);
});

test('the same answer about a NEW sha is published again', () => {
  // THE HALF THAT MAKES THESE TRANSITIONS RATHER THAN CONDITIONS. `build
  // passed` for a new commit is news even though the word is the same as last
  // time — and it is precisely the answer an operator pushed in order to get.
  // Keyed by finding alone, the second green would be swallowed.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-bmon-'));
  const file = path.join(dir, 'findings.jsonl');
  const script = `
    PLOT_MONITOR_NO_MAIN=1
    . ${JSON.stringify(monitor)}
    # The head moves between the two passes, exactly as a push moves it.
    monitor_head_sha() { if [ -f ${JSON.stringify(dir)}/moved ]; then printf '%s' ${JSON.stringify(OLDER)}; else printf '%s' ${JSON.stringify(HEAD)}; fi; }
    monitor_run_for_sha() { printf '{"sha":"'"$1"'","status":"completed","conclusion":"success","url":"https://ci/run/1","startedAt":"t"}'; return 0; }
    monitor_pass
    touch ${JSON.stringify(dir)}/moved
    monitor_pass
  `;
  try {
    execFileSync('bash', ['-c', script], {
      encoding: 'utf8',
      timeout: 30_000,
      env: {
        ...process.env,
        PLOT_BRANCH: 'feature/watched',
        PLOT_WORKTREE: dir,
        PLOT_MONITOR_FILE: file,
      },
    });
    const found = fs.existsSync(file)
      ? fs.readFileSync(file, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l))
      : [];
    assert.equal(found.length, 2,
      `a pass on a new sha was swallowed by the previous sha’s answer: ${JSON.stringify(found)}`);
    assert.deepEqual(found.map((f) => f.finding), ['build passed', 'build passed']);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('head moved settles nothing: the next pass still asks, and answers for the new head', () => {
  // THE BUG THIS PLAN FIXES. A naive fix settles on `settled_shas` regardless
  // of which finding fired, which would make this pass silent forever once
  // `head moved` published once for the superseded sha — exactly #1255's
  // symptom, where no `build failed` ever followed a corrected push. This
  // drives ONE sourced monitor through two passes: pass 1 sees a run for the
  // OLDER sha while HEAD has already moved on; pass 2, with the host now
  // answering for the new head, must still be asked and must still publish.
  const { found, hostCalls } = drive(build(`
    if [ "$(wc -l < "$HOSTCALLS")" -le 1 ]; then
      printf '%s' ${JSON.stringify(run({ sha: OLDER, conclusion: 'success' }))}
    else
      printf '%s' ${JSON.stringify(run({ sha: HEAD, conclusion: 'failure' }))}
    fi
    return 0;
  `), 2);
  assert.equal(hostCalls, 2, `the second pass must still ask the host; got ${hostCalls} call(s)`);
  assert.deepEqual(found.map((f) => f.finding), ['head moved', 'build failed'],
    `expected head moved then build failed for the new HEAD, got ${JSON.stringify(found.map((f) => f.finding))}`);
});

// ---------------------------------------------------------------------------
// THE HOST OPERATION'S OWN CONTRACT — `plot-host.sh run-for-sha`
// ---------------------------------------------------------------------------
//
// The filter is the op's whole substance, and it is a `jq` program: exercising
// it directly is the only way to see the answers it can give. The monitor
// tests above stub this away by design, so without these the match rule —
// only the asked-for sha, nothing else — would be untested.

/**
 * Run the real `plot-host.sh run-for-sha` over a `gh run list` payload.
 *
 * A stubbed `gh` prints the payload; the op's own jq filter answers. Returns
 * the parsed run, or null when the op prints nothing.
 */
function runForSha(payload, sha) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-bmon-gh-'));
  try {
    fs.writeFileSync(path.join(dir, 'payload.json'), JSON.stringify(payload));
    fs.writeFileSync(path.join(dir, 'gh'), `#!/usr/bin/env bash\ncat ${JSON.stringify(path.join(dir, 'payload.json'))}\n`);
    fs.chmodSync(path.join(dir, 'gh'), 0o755);
    const out = execFileSync('bash', [path.join(scripts, 'plot-host.sh'), 'run-for-sha', 'feature/watched', sha], {
      encoding: 'utf8',
      env: {
        ...process.env,
        PATH: `${dir}:${process.env.PATH}`,
        PLOT_HOST: 'github',
        PLOT_CI: 'github-actions',
        PLOT_BUDGET_HOME: path.join(dir, 'budget-home'),
        PLOT_BUDGET_ACCOUNT: 'test-account',
      },
    }).trim();
    return out ? JSON.parse(out) : null;
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

const ghRun = (headSha, conclusion, status = 'completed') =>
  ({ headSha, conclusion, status, startedAt: 't', url: `https://ci/${headSha}` });

test('run-for-sha prefers the asked-for sha over a newer run', () => {
  // THE PRIMARY CASE, and the reason the op exists beside `runs`. `gh run list`
  // returns newest-first, so the naive answer is the top entry — which is for
  // whatever sha was pushed last, not the one being asked about.
  const got = runForSha([ghRun('NEW', null, 'in_progress'), ghRun('MINE', 'success')], 'MINE');
  assert.equal(got.sha, 'MINE');
  assert.equal(got.conclusion, 'success');
});

test('run-for-sha answers nothing when no run matches the asked-for sha', () => {
  // A run for any OTHER commit is not evidence about the one asked for.
  // Reporting it would read as a live answer for a commit the branch has
  // already moved past, which is worse than no answer at all.
  const got = runForSha([ghRun('OTHER', 'success')], 'MINE');
  assert.equal(got, null,
    'a run for a different sha must not be reported as the answer for this one');
});

test('run-for-sha reports nothing when the branch has no runs at all', () => {
  // The ordinary state of a fresh push. Empty is a real answer, not an error.
  assert.equal(runForSha([], 'MINE'), null);
});

test('run-for-sha reports a null conclusion for a run still going', () => {
  // `status` and `conclusion` are never collapsed: a run that is `in_progress`
  // has no conclusion, and inventing one would make a live build indistinguish-
  // able from a finished one.
  const got = runForSha([ghRun('MINE', '', 'in_progress')], 'MINE');
  assert.equal(got.conclusion, null);
  assert.equal(got.status, 'in_progress');
});

test('a finding carries the four fields every monitor publishes', () => {
  // ONE SUBSCRIBER READS ALL THREE MONITORS' FILES and must not need a third
  // parser to do it. The shape is the contract, not an implementation detail.
  const { found } = drive(answers({ conclusion: 'failure' }));
  assert.equal(found.length, 1);
  for (const field of ['monitor', 'branch', 'worktree', 'finding', 'since', 'evidence', 'measuredAt']) {
    assert.ok(found[0][field] !== undefined && found[0][field] !== '',
      `the published finding has no ${field}`);
  }
});

// ---------------------------------------------------------------------------
// THE MONITOR FOLLOWS THE HOP — `watchedDesk`
// ---------------------------------------------------------------------------
//
// `PLOT_WORKTREE` is fixed at launch, but a hop rewrites the manifest's
// `worktree` field before the agent's next slice starts. A naive fix that
// re-reads only the branch (`monitor_branch`, already per-pass) passes every
// test above and fails this one: the finding must name the NEW desk's head
// sha and land in the NEW desk's findings file, with nothing new in the old
// one's.

test('a hop moves both the head sha this monitor asks about and where it writes', () => {
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-bmon-hop-'));
  try {
    const origin = path.join(sandbox, 'origin.git');
    const repo = path.join(sandbox, 'repo');
    execFileSync('git', ['init', '--bare', '-q', '-b', 'main', origin]);
    execFileSync('git', ['clone', '-q', origin, repo]);
    execFileSync('git', ['-C', repo, 'config', 'user.email', 'corpus@example.invalid']);
    execFileSync('git', ['-C', repo, 'config', 'user.name', 'Plot Test']);
    execFileSync('git', ['-C', repo, 'config', 'commit.gpgsign', 'false']);
    fs.writeFileSync(path.join(repo, 'f.txt'), 'x\n');
    execFileSync('git', ['-C', repo, 'add', '-A']);
    execFileSync('git', ['-C', repo, 'commit', '-qm', 'init']);
    execFileSync('git', ['-C', repo, 'push', '-q', 'origin', 'main']);

    const deskA = path.join(sandbox, 'desk-a');
    const deskB = path.join(sandbox, 'desk-b');
    execFileSync('git', ['-C', repo, 'branch', 'slice-a']);
    execFileSync('git', ['-C', repo, 'worktree', 'add', '-q', deskA, 'slice-a']);
    execFileSync('git', ['-C', repo, 'branch', 'slice-b']);
    execFileSync('git', ['-C', repo, 'worktree', 'add', '-q', deskB, 'slice-b']);
    const headA = execFileSync('git', ['-C', deskA, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
    const headB = execFileSync('git', ['-C', deskB, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();

    const manifest = path.join(sandbox, 'manifest.json');
    fs.writeFileSync(manifest, `{\n  "worktree": "${deskA}",\n  "pid": "1"\n}\n`);

    // A stubbed plot-host.sh in the real script directory would affect every
    // other test; instead copy only the files `plot-build-monitor.sh` and its
    // sourced siblings need into a scratch directory, where the monitor
    // resolves `plot-host.sh` and `plot-monitor-subject.sh` beside itself via
    // `$(dirname "${BASH_SOURCE[0]}")`.
    const scratchScripts = path.join(sandbox, 'scripts');
    fs.mkdirSync(scratchScripts);
    for (const name of ['plot-build-monitor.sh', 'plot-monitor-subject.sh']) {
      fs.copyFileSync(path.join(scripts, name), path.join(scratchScripts, name));
    }
    fs.writeFileSync(path.join(scratchScripts, 'plot-host.sh'), `#!/usr/bin/env bash
echo "{\\"sha\\":\\"$3\\",\\"status\\":\\"completed\\",\\"conclusion\\":\\"failure\\",\\"url\\":\\"https://ci/run\\",\\"startedAt\\":\\"t\\"}"
`);
    fs.chmodSync(path.join(scratchScripts, 'plot-host.sh'), 0o755);
    const scratchMonitor = path.join(scratchScripts, 'plot-build-monitor.sh');

    const { PLOT_BRANCH: _ignoredBranch, PLOT_WORKTREE: _ignoredWorktree, ...cleanEnv } = process.env;
    const env = {
      ...cleanEnv,
      PLOT_BRANCH: 'slice-a',
      PLOT_WORKTREE: deskA,
      PLOT_MANIFEST_FILE: manifest,
    };
    execFileSync('bash', [scratchMonitor, '--once'], { encoding: 'utf8', timeout: 30_000, env });

    // The hop: rewrite the manifest's worktree to desk B.
    fs.writeFileSync(manifest, `{\n  "worktree": "${deskB}",\n  "pid": "1"\n}\n`);
    execFileSync('bash', [scratchMonitor, '--once'], { encoding: 'utf8', timeout: 30_000, env });

    const readFindings = (desk) => {
      const f = path.join(desk, '.plot-worker.monitor.build.jsonl');
      return fs.existsSync(f)
        ? fs.readFileSync(f, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l))
        : [];
    };
    const foundA = readFindings(deskA);
    const foundB = readFindings(deskB);

    assert.equal(foundA.length, 1, `desk A should hold exactly its own pass: ${JSON.stringify(foundA)}`);
    assert.match(foundA[0].evidence, new RegExp(headA));

    assert.equal(foundB.length, 1,
      `the second pass must land in desk B's findings file, not desk A's: ${JSON.stringify(foundB)}`);
    assert.equal(foundB[0].worktree, deskB, 'the finding does not name desk B');
    assert.match(foundB[0].evidence, new RegExp(headB),
      'the finding asks about desk A\'s head instead of following the hop to desk B');
  } finally {
    fs.rmSync(sandbox, { recursive: true, force: true });
  }
});
