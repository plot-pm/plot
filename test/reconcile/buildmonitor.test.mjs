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

// ---------------------------------------------------------------------------
// THE HOST OPERATION'S OWN CONTRACT — `plot-host.sh run-for-sha`
// ---------------------------------------------------------------------------
//
// The filter is the op's whole substance, and it is a `jq` program: exercising
// it directly is the only way to see the three answers it can give. The monitor
// tests above stub this away by design, so without these the fallback rule —
// the one that makes `head moved` reachable at all — would be untested.

/** Run the op's jq filter over a `gh run list` payload. */
function runForSha(payload, sha) {
  const filter = '(map(select(.headSha == $sha)) | .[0]) // .[0]'
    + ' | select(. != null)'
    + ' | {sha:.headSha, status:.status,'
    + '    conclusion:(if (.conclusion // "") == "" then null else .conclusion end),'
    + '    url:.url, startedAt:.startedAt}';
  const out = execFileSync('jq', ['-c', '--arg', 'sha', sha, filter], {
    input: JSON.stringify(payload), encoding: 'utf8',
  }).trim();
  return out ? JSON.parse(out) : null;
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

test('run-for-sha falls back to the newest run, labelled with ITS sha', () => {
  // WHAT MAKES `head moved` REACHABLE. Filtering to the asked-for sha and
  // stopping would make a run in flight for a superseded commit look exactly
  // like no run at all, and the monitor could not tell "CI has not started"
  // from "CI is answering about the past". The fallback reports the run and
  // names its own commit; comparing the two is the monitor's rule.
  const got = runForSha([ghRun('OTHER', 'success')], 'MINE');
  assert.equal(got.sha, 'OTHER',
    'the fallback did not report which commit the run it found is actually for');
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
