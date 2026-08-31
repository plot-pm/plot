// Contract test for skills/plot/scripts/plot-agent-monitor.sh — the
// AgentMonitor's sampling.
//
// UNIT-FIRST AGAINST MOCKED PORTS, and here the argument is stronger than it is
// for the WorkerMonitor next door: one of this monitor's five seams is a HOST
// ROUND TRIP. `unaskable` — the state where `gh` is absent, unauthed, or
// failing — is the reading this monitor must get right and the one a test can
// least afford to produce for real. You cannot break GitHub to see what
// happens, and waiting for it to break on its own is not a test. That is why
// the sprint's goal says unit AND mock.
//
// So the script is SOURCED with `PLOT_MONITOR_NO_MAIN=1`, which defines every
// function and runs no loop, and the five `monitor_*` ports are redefined per
// test. Nothing here calls `gh`, and nothing here sleeps for a cadence.
//
// WHAT IS DELIBERATELY *NOT* MOCKED: `sample_finding`'s ordering, `publish`,
// and the publish-on-change rule. Those are the slice's logic, and a test that
// stubbed them would assert its own stubs.
//
// The seam between this file and `test/e2e/agent-monitor-reads.test.mjs` is the
// process boundary: here, every finding and every refusal against fake ports;
// there, one real wrapper over a real desk publishing a real finding.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const scripts = path.join(here, '..', '..', 'skills', 'plot', 'scripts');
const monitor = path.join(scripts, 'plot-agent-monitor.sh');

/**
 * Drive the monitor with its ports replaced.
 *
 * `ports` is shell redefining any of `monitor_pr_state`, `monitor_has_commits`,
 * `monitor_dirty`, `monitor_blocked`, `monitor_unpushed` and
 * `monitor_changeset`. `passes` is how many times `monitor_pass` runs — the
 * publish-on-change rule means the clearing case needs at least two.
 *
 * Returns the findings the monitor published, parsed. Publishing goes to a real
 * file because that IS the publish path in this slice; stubbing it would leave
 * the one thing a subscriber reads untested.
 */
function drive(ports, passes = 1) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-amon-'));
  const file = path.join(dir, 'findings.jsonl');
  const script = `
    PLOT_MONITOR_NO_MAIN=1
    . ${JSON.stringify(monitor)}
    ${ports}
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
        PLOT_MONITOR_INTERVAL: '300',
      },
    });
    if (!fs.existsSync(file)) return [];
    return fs.readFileSync(file, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/** A desk that owes nothing: no marker, clean, pushed, commits, a PR, a changeset. */
const SETTLED = `
  monitor_blocked() { return 1; }
  monitor_dirty() { return 0; }
  monitor_unpushed() { return 1; }
  monitor_has_commits() { return 0; }
  monitor_pr_state() { return 0; }
  monitor_changeset() { return 0; }
`;

/** Override one or more ports on top of a settled desk. */
const desk = (overrides) => SETTLED + overrides;

// ---------------------------------------------------------------------------
// EACH FINDING, INDIVIDUALLY TRIGGERABLE — the plan's first `Done when`
// ---------------------------------------------------------------------------

test('owes a review fires on a branch with commits, a clean tree and no PR', () => {
  // THE FINDING THIS PLAN WAS WRITTEN FOR. Twice in one session, finished work
  // sat on a branch with no PR and nothing noticed; both were found because a
  // person asked.
  const found = drive(desk('monitor_pr_state() { return 1; }'));
  assert.equal(found.length, 1, `expected exactly one finding, got ${JSON.stringify(found)}`);
  assert.equal(found[0].finding, 'owes a review');
  assert.equal(found[0].monitor, 'AgentMonitor');
  assert.equal(found[0].branch, 'feature/watched',
    'the finding does not name the branch it is about');
  assert.match(found[0].evidence, /no PR/,
    'the evidence does not say what is missing');
});

test('owes a review does NOT fire once a PR exists', () => {
  // THE OTHER HALF OF THE SAME `Done when`, and the one that keeps the finding
  // worth reading. A monitor that reported finished work forever — including
  // after the review it asked for was opened — would be ignored within a day.
  const found = drive(desk('monitor_pr_state() { return 0; }'));
  assert.deepEqual(found, [],
    `a branch whose PR exists produced findings: ${JSON.stringify(found)}`);
});

test('owes an answer fires on a PLOT-BLOCKED marker in the tree', () => {
  const found = drive(desk(`
    monitor_blocked() { return 0; }
    plot_worker_blocked_file() { printf 'PLOT-BLOCKED.md'; }
  `));
  assert.equal(found.length, 1);
  assert.equal(found[0].finding, 'owes an answer');
  assert.match(found[0].evidence, /PLOT-BLOCKED\.md/,
    'the evidence does not name the marker a person must read');
});

test('holds unlanded work fires on an uncommitted tree', () => {
  const found = drive(desk("monitor_dirty() { printf 'src/thing.ts\\nsrc/other.ts\\n'; }"));
  assert.equal(found.length, 1);
  assert.equal(found[0].finding, 'holds unlanded work');
  assert.match(found[0].evidence, /src\/thing\.ts/,
    'the evidence does not name a file, so a reader cannot tell what is on the floor');
});

test('holds unlanded work fires on commits the upstream does not have', () => {
  // THE SECOND ROUTE TO THE SAME DEBT. Uncommitted and unpushed are one finding
  // because they are one fact to a reader — the work exists in one place only —
  // and neither is safe to review. They differ in the evidence.
  const found = drive(desk('monitor_unpushed() { return 0; }'));
  assert.equal(found.length, 1);
  assert.equal(found[0].finding, 'holds unlanded work');
  assert.match(found[0].evidence, /upstream/);
});

test('owes a gate fires on a PR with no changeset', () => {
  // Measured 2026-08-30: `feature/the-workflows-decide-without-acting` had
  // commits, a clean tree and no marker — every other finding said nothing —
  // and no changeset, so it would have landed red.
  const found = drive(desk('monitor_changeset() { return 1; }'));
  assert.equal(found.length, 1);
  assert.equal(found[0].finding, 'owes a gate');
  assert.match(found[0].evidence, /changeset/);
});

// ---------------------------------------------------------------------------
// THE REFUSALS — what is NOT a finding
// ---------------------------------------------------------------------------

test('a host that refuses produces no finding at all', () => {
  // THE STATE THIS FILE EXISTS FOR, and the reason the PR lookup is a port
  // rather than a call to `pr_merged`. That helper collapses an unreachable
  // host into "not merged", which is right for the reaper — silence must never
  // be permission to delete. Here the direction inverts: read as "no PR", an
  // unaskable host reports `owes a review` about every branch on the estate the
  // moment `gh` loses its token, and the storm's common cause is that nothing
  // was measured at all.
  const found = drive(desk('monitor_pr_state() { return 2; }'));
  assert.deepEqual(found, [],
    `an unaskable host produced a finding: ${JSON.stringify(found)}`);
});

test('a branch with no commits owes nothing, even with no PR', () => {
  // An agent still thinking about a hard first slice owes nobody anything.
  // Calling that a debt is what teaches an operator to ignore the word.
  const found = drive(desk(`
    monitor_has_commits() { return 1; }
    monitor_pr_state() { return 1; }
  `));
  assert.deepEqual(found, [],
    `a branch with nothing on it produced a finding: ${JSON.stringify(found)}`);
});

test('an unanswerable commit count produces no finding', () => {
  // No `origin/<default>` ref to count against — a repo with no remote. A
  // failure to observe is not evidence of something to see.
  const found = drive(desk(`
    monitor_has_commits() { return 2; }
    monitor_pr_state() { return 1; }
  `));
  assert.deepEqual(found, [], `an unanswerable count produced a finding: ${JSON.stringify(found)}`);
});

test('an unanswerable changeset reading produces no gate finding', () => {
  const found = drive(desk('monitor_changeset() { return 2; }'));
  assert.deepEqual(found, [], `an unanswerable gate produced a finding: ${JSON.stringify(found)}`);
});

test('a settled desk publishes nothing — silence means it owes nothing', () => {
  // The property that makes the findings file worth reading, and the one most
  // easily lost: an implementation publishing a heartbeat per pass would pass
  // every other test in this file.
  assert.deepEqual(drive(SETTLED, 3), []);
});

// ---------------------------------------------------------------------------
// THE ORDER — one finding per pass, ranked by what the reader must do first
// ---------------------------------------------------------------------------

test('a marker outranks unlanded work, which outranks an owed review', () => {
  // THE FINDINGS ARE NOT MUTUALLY EXCLUSIVE — a desk can hold a marker AND
  // uncommitted work AND commits with no PR, all at once — and the record
  // carries one `finding`, so the sampler must choose. It chooses by what the
  // reader must do first, which is the order `plot_worker_task_state` already
  // uses. Two components ranking one desk's debts differently is the drift
  // `plot-worker-state.sh` was extracted to end.
  const all = `
    monitor_blocked() { return 0; }
    plot_worker_blocked_file() { printf 'PLOT-BLOCKED.md'; }
    monitor_dirty() { printf 'src/thing.ts\\n'; }
    monitor_unpushed() { return 0; }
    monitor_has_commits() { return 0; }
    monitor_pr_state() { return 1; }
    monitor_changeset() { return 1; }
  `;
  assert.equal(drive(all)[0].finding, 'owes an answer',
    'a person being the blocker did not outrank everything else');

  const noMarker = all.replace('monitor_blocked() { return 0; }', 'monitor_blocked() { return 1; }');
  assert.equal(drive(noMarker)[0].finding, 'holds unlanded work',
    'work on the floor did not outrank an owed review; a PR would be incomplete');

  const clean = noMarker
    .replace("monitor_dirty() { printf 'src/thing.ts\\n'; }", 'monitor_dirty() { return 0; }')
    .replace('monitor_unpushed() { return 0; }', 'monitor_unpushed() { return 1; }');
  assert.equal(drive(clean)[0].finding, 'owes a review',
    'invisible finished work did not outrank a missing gate');
});

test('owes a gate does not compete with owes a review', () => {
  // A branch with no PR and no changeset owes a REVIEW first. The plan's Acting
  // slice opens the PR anyway and names the missing gate in its body, because
  // withholding it would leave finished work invisible until someone happens to
  // write the changeset — the exact failure this plan exists to end, one step
  // later in the process.
  const found = drive(desk(`
    monitor_pr_state() { return 1; }
    monitor_changeset() { return 1; }
  `));
  assert.equal(found.length, 1);
  assert.equal(found[0].finding, 'owes a review');
});

// ---------------------------------------------------------------------------
// PUBLISH ON CHANGE — the plan's third `Done when`
// ---------------------------------------------------------------------------

test('a held finding is published once, not once per pass', () => {
  // On a 300s cadence a republished finding would still fill the file, and a
  // subscriber could not tell a new debt from an old one. `since` carries the
  // age instead.
  const found = drive(desk('monitor_pr_state() { return 1; }'), 4);
  assert.equal(found.length, 1,
    `a held finding was republished ${found.length} times`);
});

test('every finding carries finding, since, evidence and measuredAt', () => {
  // THE SUBSCRIBER'S VIEW. A reader that knows only the record shape must act
  // on this without re-deriving anything — and it must not need a second parser
  // for the WorkerMonitor's file, which publishes the same four fields.
  const [f] = drive(desk('monitor_pr_state() { return 1; }'));
  assert.equal(typeof f.finding, 'string');
  assert.ok(f.evidence.length > 0, 'the finding carries no evidence');
  assert.match(f.measuredAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
  assert.match(f.since, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
});

test('a debt that is paid is published as clear', () => {
  // The clearing case is news. A board that never hears it leaves a stale entry
  // up after the PR was opened — which is the half of "does NOT fire once a PR
  // exists" that a subscriber can act on.
  //
  // The host answers `no PR` on the first pass and `PR` on the second, which is
  // exactly what opening a PR looks like from here.
  //
  // THE COUNTER LIVES IN A FILE, not a variable, and that is a fact about the
  // sampler worth recording: `monitor_pass` reads its finding through
  // `$(sample_finding)`, so every port runs in a SUBSHELL and anything one
  // assigns dies with it. It costs production nothing — all five real ports are
  // stateless reads — but a stub that counts its own calls has to count
  // somewhere the subshell cannot discard.
  const found = drive(desk(`
    monitor_pr_state() {
      if [ -e "$PLOT_WORKTREE/.asked" ]; then return 0; fi
      : > "$PLOT_WORKTREE/.asked"
      return 1
    }
  `), 2);
  assert.equal(found.length, 2, `expected a finding then a clear, got ${JSON.stringify(found)}`);
  assert.equal(found[0].finding, 'owes a review');
  assert.equal(found[1].finding, 'clear');
  assert.match(found[1].evidence, /owes a review/,
    'the clear does not name the finding it retracts');
});

// ---------------------------------------------------------------------------
// IT WRITES NOTHING AT ALL — the plan's last `Done when`
// ---------------------------------------------------------------------------

test('a full pass writes nothing but the findings file', () => {
  // "PUBLISHING IS ITS ONLY OUTPUT" is stricter than "it does not act", and it
  // is checkable: run a pass over a real directory and see whether anything
  // other than the findings file appeared. A monitor that cached its last
  // verdict to disk would pass every other test here.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-amon-w-'));
  try {
    fs.writeFileSync(path.join(dir, 'keep.txt'), 'untouched\n');
    const before = fs.readdirSync(dir).sort();
    execFileSync('bash', ['-c', `
      PLOT_MONITOR_NO_MAIN=1
      . ${JSON.stringify(monitor)}
      ${desk('monitor_pr_state() { return 1; }')}
      monitor_pass; monitor_pass
    `], {
      encoding: 'utf8',
      timeout: 30_000,
      env: {
        ...process.env,
        PLOT_BRANCH: 'feature/watched',
        PLOT_WORKTREE: dir,
        PLOT_MONITOR_FILE: path.join(dir, 'findings.jsonl'),
      },
    });
    const after = fs.readdirSync(dir).sort();
    assert.deepEqual(after, [...before, 'findings.jsonl'].sort(),
      `the monitor wrote something other than its findings: ${JSON.stringify(after)}`);
    assert.equal(fs.readFileSync(path.join(dir, 'keep.txt'), 'utf8'), 'untouched\n');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
