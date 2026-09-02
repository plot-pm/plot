// Contract test for skills/plot/scripts/plot-worker-monitor.sh — the
// WorkerMonitor's sampling.
//
// UNIT-FIRST AGAINST MOCKED PORTS, and that is not a preference. The branches
// this monitor exists for are states a real machine will not produce on demand:
// a pid that dies BETWEEN two samples, a tree that changes between two
// readings, a subtree whose CPU clock is frozen for exactly one pass and then
// moves. A test that waits for a real machine to enter one of those is a test
// that flakes, and a flaky test on a monitor is worse than none — it teaches
// the same "ignore the finding" habit the monitor's three-condition `idle`
// exists to avoid.
//
// So the script is SOURCED with `PLOT_MONITOR_NO_MAIN=1`, which defines every
// function and runs no loop, and the four `monitor_*` ports are redefined by
// each test. Nothing here touches `ps`, and nothing here sleeps for a cadence.
//
// WHAT IS DELIBERATELY *NOT* MOCKED: `monitor_pass` itself, `publish`, the
// two-sample rule, and the change-detection. Those are the slice's logic, and a
// test that stubbed them would assert its own stubs.
//
// The seam between this file and `test/e2e/monitors-attached.test.mjs` is the
// process boundary: here, every branch against fake ports; there, one real
// wrapper publishing a real finding a real subscriber reads.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const scripts = path.join(here, '..', '..', 'skills', 'plot', 'scripts');
const monitor = path.join(scripts, 'plot-worker-monitor.sh');

/**
 * Drive the monitor with its ports replaced.
 *
 * `ports` is shell that redefines any of `monitor_pid_alive`,
 * `monitor_pid`, `monitor_transcript_quiet`, `monitor_activity`,
 * `monitor_tree_fingerprint` and `monitor_has_commits`. `passes` is how many times `monitor_pass` is called —
 * the two-sample rule means most interesting assertions need at least two.
 *
 * Returns the findings the monitor published, parsed. Publishing goes to a real
 * file because that IS the publish path in this slice; stubbing it would leave
 * the one thing a subscriber reads untested.
 */
function drive(ports, passes = 1, { env = {} } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-wmon-'));
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
        PLOT_MONITOR_INTERVAL: '30',
        ...env,
      },
    });
    if (!fs.existsSync(file)) return [];
    return fs.readFileSync(file, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * Ports for a live agent that has written nothing for far longer than the
 * window, with no child process burning CPU behind it, over a tree that never
 * moves. That is the whole of the new `quiet` reading, and BOTH readings are
 * needed: since 2026-09-02 a frozen CPU clock alone is not a stall, because an
 * agent waiting on a model response has exactly that clock.
 *
 * 99999 is well past the 900 s default, so the window's exact value is not
 * baked into every test that merely needs *quiet*.
 */
const QUIET = `
  monitor_pid_alive() { return 0; }
  monitor_pid() { printf '4242'; }
  monitor_transcript_quiet() { printf '99999'; }
  monitor_activity() { printf 'idle'; }
  monitor_tree_fingerprint() { printf 'unchanged'; }
  monitor_has_commits() { return 0; }
`;

test('worker-monitor: a single idle sample reports nothing', () => {
  // THE FIRST HALF OF THE TWO-SAMPLE RULE, and the property that stops the
  // monitor crying wolf. One idle reading is a process caught between syscalls;
  // the COMPARISON is the finding, so one pass cannot make it.
  const published = drive(QUIET, 1);
  assert.deepEqual(published, [],
    'one idle sample published a finding — a process between syscalls is now reported as a stall');
});

test('worker-monitor: two consecutive idle samples over an unchanged tree report idle', () => {
  // The other half. Same ports, one more pass — so the ONLY difference between
  // this test and the one above is the number of readings, which is exactly the
  // property under test.
  const published = drive(QUIET, 2);
  assert.equal(published.length, 1,
    `two idle samples should publish exactly one finding, got ${JSON.stringify(published)}`);
  assert.equal(published[0].finding, 'idle');
  assert.equal(published[0].monitor, 'WorkerMonitor',
    'the finding does not identify its monitor — the attention slice cannot tell it from an AgentMonitor entry');
  assert.equal(published[0].branch, 'feature/watched');
});

test('worker-monitor: it is called idle and never stalled', () => {
  // A CONTRACT WITH THE SPEC, not a spelling preference. `stalled` is an AGENT
  // fact — "exited 0, unlanded work, no PR" (DESIGN-agent.md). A stalled agent
  // has work to rescue; an idle worker may just be waiting on the network. An
  // earlier draft of this slice reused the name and put a process fact on the
  // agent side, which is the exact confusion CLAUDE.md's Machine/Registry split
  // exists to prevent — so it is asserted rather than left to review.
  const published = drive(QUIET, 2);
  assert.equal(published[0].finding, 'idle');
  const blob = JSON.stringify(published);
  assert.doesNotMatch(blob, /stall/i,
    'the WorkerMonitor used the word `stalled`, which the spec reserves for an Agent fact');

  // And the source itself, because the finding string is only one place it
  // could leak in — an `evidence` line calling it a stall would mislead just as
  // effectively as the word in the `finding` field.
  const src = fs.readFileSync(monitor, 'utf8');
  const findingLines = src.split('\n').filter((l) => /finding=|evidence=/.test(l));
  for (const line of findingLines) {
    assert.doesNotMatch(line, /stall/i,
      `a finding or evidence assignment names a stall: ${line.trim()}`);
  }
});

test('worker-monitor: a tree that changed between samples resets the comparison', () => {
  // THE THIRD ROW OF THE TRUTH TABLE. `no CPU, tree CHANGED between samples` is
  // `silent`, because something is plainly happening — an agent can write for a
  // long time without its subtree registering a centisecond in any one sample.
  //
  // This is the branch a real machine will not give you on demand, and the
  // reason this suite mocks: the fingerprint has to differ between two
  // consecutive readings at a moment of the test's choosing.
  const changing = QUIET.replace(
    "monitor_tree_fingerprint() { printf 'unchanged'; }",
    `monitor_tree_fingerprint() {
       _n=$(cat "$PLOT_WORKTREE/.n" 2>/dev/null || echo 0)
       _n=$((_n + 1)); printf '%s' "$_n" > "$PLOT_WORKTREE/.n"
       printf 'tree-%s' "$_n"
     }`,
  );
  const published = drive(changing, 4);
  assert.deepEqual(published, [],
    'a tree changing between samples still reported idle — the monitor is reporting a working agent as stalled');
});

test('worker-monitor: quiet with no commits yet is silent, not idle', () => {
  // THE MIDDLE ROW, and the one where the false positives would have been. An
  // agent given a hard first slice is quiet for a long time with nothing to
  // show. What separated the three stalls measured 2026-08-30 is that each had
  // already COMMITTED and then gone quiet.
  const noCommits = QUIET.replace('monitor_has_commits() { return 0; }',
    'monitor_has_commits() { return 1; }');
  const published = drive(noCommits, 3);
  assert.deepEqual(published, [],
    'a quiet agent with nothing committed was reported idle — an agent thinking about a hard first slice now looks like a stall');
});

test('worker-monitor: an unanswerable commit question does not fire idle', () => {
  // `monitor_has_commits` returns 2 when there is no ref to count against — a
  // repo with no remote. A FAILURE TO OBSERVE IS NOT EVIDENCE OF SOMETHING TO
  // SEE, the rule `plot_worker_task_state` reached the hard way after a
  // fallback counted against the trunk and read every clean branch as stalled.
  const unanswerable = QUIET.replace('monitor_has_commits() { return 0; }',
    'monitor_has_commits() { return 2; }');
  const published = drive(unanswerable, 3);
  assert.deepEqual(published, [],
    'an unanswerable commit question was treated as a yes — silence about a fact is not the fact');
});

test('worker-monitor: a dead pid reports gone, on ONE sample', () => {
  // ASYMMETRIC ON PURPOSE. A dead process does not come back, so a second
  // confirmation costs a whole interval and buys nothing; a frozen CPU clock
  // genuinely can be transient, which is why `idle` pays for two and `gone`
  // does not.
  const published = drive(`
    monitor_pid_alive() { return 1; }
    monitor_pid() { printf '4242'; }
  `, 1);
  assert.equal(published.length, 1, 'a dead pid did not report on the first sample');
  assert.equal(published[0].finding, 'gone');
  assert.match(published[0].evidence, /4242/,
    'the gone finding does not name the pid it is about — the evidence is a claim someone has to re-derive');
});

test('worker-monitor: a pid that dies mid-sample reports gone on the pass that sees it', () => {
  // The transition, which a real machine will not schedule for you: alive on
  // one pass, dead on the next. This is the sequence a monitor actually
  // observes, and it must publish once — not on the live pass, and not twice.
  const dying = `
    monitor_pid() { printf '4242'; }
    monitor_activity() { printf 'working'; }
    monitor_tree_fingerprint() { printf 'unchanged'; }
    monitor_has_commits() { return 0; }
    monitor_pid_alive() {
      _n=$(cat "$PLOT_WORKTREE/.p" 2>/dev/null || echo 0)
      _n=$((_n + 1)); printf '%s' "$_n" > "$PLOT_WORKTREE/.p"
      [ "$_n" -ge 3 ] && return 1
      return 0
    }
  `;
  const published = drive(dying, 4);
  assert.equal(published.length, 1,
    `a pid dying mid-run should publish gone exactly once, got ${JSON.stringify(published)}`);
  assert.equal(published[0].finding, 'gone');
});

test('worker-monitor: an unwritten pid file is *not yet*, never gone', () => {
  // THE STARTUP WINDOW, inherited rather than widened. The wrapper backgrounds
  // the monitors BEFORE it writes `.plot-worker.pid`, so the monitor's first
  // pass can genuinely land in the gap. Reporting a dead agent because its
  // birth has not been recorded would make the loudest finding the least
  // trustworthy — and it would fire on every worker, once, forever.
  //
  // Driven through the REAL `monitor_pid_alive` against a real absent file,
  // because the port under test here IS the file read.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-wmon-window-'));
  try {
    const rc = execFileSync('bash', ['-c', `
      PLOT_MONITOR_NO_MAIN=1
      . ${JSON.stringify(monitor)}
      monitor_pid_alive; printf '%s' "$?"
    `], {
      encoding: 'utf8',
      env: { ...process.env, PLOT_WORKTREE: dir, PLOT_PID_FILE: path.join(dir, '.plot-worker.pid') },
    });
    assert.equal(rc, '2',
      'an absent pid file did not read as unknown — a worker in its startup window would be reported gone');

    // An EMPTY file is the same window: the wrapper has opened it and not yet
    // written. `> file` then `printf` is not atomic.
    fs.writeFileSync(path.join(dir, '.plot-worker.pid'), '');
    const rcEmpty = execFileSync('bash', ['-c', `
      PLOT_MONITOR_NO_MAIN=1
      . ${JSON.stringify(monitor)}
      monitor_pid_alive; printf '%s' "$?"
    `], {
      encoding: 'utf8',
      env: { ...process.env, PLOT_WORKTREE: dir, PLOT_PID_FILE: path.join(dir, '.plot-worker.pid') },
    });
    assert.equal(rcEmpty, '2', 'an empty pid file did not read as unknown');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('worker-monitor: a busy worker publishes nothing, however long it runs', () => {
  // SILENCE MEANS HEALTHY. This is the property that keeps the findings file
  // worth reading: a monitor that emitted a line per pass would bury the one
  // line that matters under a hundred that do not.
  const busy = QUIET.replace("monitor_activity() { printf 'idle'; }",
    "monitor_activity() { printf 'working'; }");
  assert.deepEqual(drive(busy, 6), [],
    'a healthy worker produced findings — silence no longer means healthy');
});

test('worker-monitor: past the window, a live pid with NO child is idle', () => {
  // THIS ASSERTION INVERTED ON 2026-09-02, and the inversion is the fix.
  //
  // Under the CPU rule the monitor refused `idle` for a pid whose subtree held
  // no CPU clock at all, because the reading arrived with no evidence the agent
  // had done anything — the absence of a child was not the presence of an idle
  // one, and it was only ever read beside a 0.4 s sample.
  //
  // The transcript changes what the empty answer means. Reaching this line
  // already establishes the agent has written nothing for over 900 s; a live
  // pid with no child process behind it is then precisely an agent that has
  // stopped, not one whose measurement is missing. Refusing here would leave
  // the commonest real stall unreported.
  const nothing = QUIET.replace("monitor_activity() { printf 'idle'; }",
    "monitor_activity() { printf ''; }");
  const published = drive(nothing, 4);
  assert.equal(published.length, 1,
    `expected one idle finding, got ${JSON.stringify(published)}`);
  assert.equal(published[0].finding, 'idle');
});

test('worker-monitor: it publishes the moment a finding holds and nothing when nothing changed', () => {
  // THE PLAN'S CLAUSE, both halves. `idle` holds from the second pass onward,
  // and passes three through eight say the same thing — so exactly one line is
  // published, at the moment it first held.
  const published = drive(QUIET, 8);
  assert.equal(published.length, 1,
    `a held finding was republished on every pass, got ${published.length} lines`);
  assert.equal(published[0].finding, 'idle');
});

test('worker-monitor: a finding that stops holding is published as clear', () => {
  // THE CLEARING CASE IS NEWS TOO. A board that only ever hears about the onset
  // leaves a stale entry up after the worker recovered, and an operator learns
  // that entries are not to be believed — the same cost as a false positive,
  // arriving later.
  const recovers = `
    monitor_pid_alive() { return 0; }
    monitor_pid() { printf '4242'; }
    monitor_tree_fingerprint() { printf 'unchanged'; }
    monitor_has_commits() { return 0; }
    monitor_transcript_quiet() { printf '99999'; }
    monitor_activity() {
      _n=$(cat "$PLOT_WORKTREE/.a" 2>/dev/null || echo 0)
      _n=$((_n + 1)); printf '%s' "$_n" > "$PLOT_WORKTREE/.a"
      if [ "$_n" -ge 4 ]; then printf 'working'; else printf 'idle'; fi
    }
  `;
  const published = drive(recovers, 6);
  assert.equal(published.length, 2,
    `expected an idle then a clear, got ${JSON.stringify(published)}`);
  assert.equal(published[0].finding, 'idle');
  assert.equal(published[1].finding, 'clear');
});

test('worker-monitor: every finding carries finding, since, evidence and measuredAt', () => {
  // THE RECORD SHAPE, which slice 1 settled and this slice must not redesign.
  // `measuredAt` is required for a reason that outlives any one finding: a
  // reading without one cannot be judged stale.
  for (const [label, ports, passes] of [
    ['idle', QUIET, 2],
    ['gone', 'monitor_pid_alive() { return 1; }\nmonitor_pid() { printf "7"; }', 1],
  ]) {
    const [record] = drive(ports, passes);
    assert.ok(record, `${label} published nothing`);
    for (const field of ['finding', 'since', 'evidence', 'measuredAt']) {
      assert.ok(record[field] && String(record[field]).length > 0,
        `the ${label} finding is missing ${field}`);
    }
    assert.match(record.measuredAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/,
      `the ${label} finding has an unusable measuredAt`);
    assert.match(record.since, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/,
      `the ${label} finding has an unusable since`);
  }
});

test('worker-monitor: `nothing measured yet` is gone from the script', () => {
  // The no-op slice put that literal in deliberately, and said in as many words
  // that it "disappears in the slice that gives it its first real measurement".
  // Grepping for it is how a reviewer checks whether a monitor has been given
  // its behaviour — so this slice removes it and pins the removal.
  const src = fs.readFileSync(monitor, 'utf8');
  assert.doesNotMatch(src, /nothing measured yet/,
    'the no-op announcement survived into a monitor that measures — a reader grepping for it would conclude this monitor is still blind');
});

test('worker-monitor: it makes no host call at all', () => {
  // NOT "FEW" — NONE. A monitor on a ~30s cadence that asks the host has become
  // an AgentMonitor with a fast loop, and the rate problem follows it.
  //
  // Asserted over the SOURCE rather than by observing a run, because a host call
  // on a branch this test happens not to take would pass unobserved. `gh`/`bb`
  // are the two host CLIs; `plot-host.sh` is the adapter that wraps them.
  const src = fs.readFileSync(monitor, 'utf8')
    .split('\n')
    .filter((l) => !/^\s*#/.test(l))   // comments may name what it must not do
    .join('\n');
  assert.doesNotMatch(src, /\bplot-host\.sh\b/, 'the WorkerMonitor calls the host adapter');
  assert.doesNotMatch(src, /(^|[^-\w])(gh|bb)\s+(pr|issue|api|repo)\b/m,
    'the WorkerMonitor invokes a host CLI directly');
  // `git fetch` is the other network call, and it is the tempting one: "are
  // there commits?" reads like a question about the remote. It is not — the
  // local ref answers it, and the monitor answers *unanswerable* when there is
  // no local ref rather than reaching for the network.
  assert.doesNotMatch(src, /git\s[^\n]*\bfetch\b/,
    'the WorkerMonitor fetches — `commits present` must be answered from local refs or not at all');
});

test('worker-monitor: the tree fingerprint ignores the monitor\'s own findings file', () => {
  // THE SELF-REFERENCE BUG THIS AVOIDS, asserted against the real fingerprint.
  //
  // The monitor appends to `.plot-worker.monitor.worker.jsonl` INSIDE the
  // worktree it fingerprints. A raw `git status` fingerprint would therefore
  // change every time the monitor published, and `idle` could never hold across
  // two passes — the monitor would suppress its own finding forever on the
  // strength of its own output. `plot_worker_dirty_filter` drops the
  // `.plot-worker.` prefix, which is why the fingerprint goes through it.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-wmon-self-'));
  try {
    execFileSync('git', ['init', '-q', '-b', 'main', dir]);
    execFileSync('git', ['-C', dir, 'config', 'user.email', 't@t']);
    execFileSync('git', ['-C', dir, 'config', 'user.name', 't']);
    execFileSync('git', ['-C', dir, 'config', 'commit.gpgsign', 'false']);
    fs.writeFileSync(path.join(dir, 'a.txt'), 'a');
    execFileSync('git', ['-C', dir, 'add', '-A']);
    execFileSync('git', ['-C', dir, 'commit', '-qm', 'init']);

    const fingerprint = () => execFileSync('bash', ['-c', `
      PLOT_MONITOR_NO_MAIN=1
      . ${JSON.stringify(monitor)}
      monitor_tree_fingerprint
    `], { encoding: 'utf8', env: { ...process.env, PLOT_WORKTREE: dir } });

    const before = fingerprint();
    fs.writeFileSync(path.join(dir, '.plot-worker.monitor.worker.jsonl'), '{"finding":"idle"}\n');
    assert.equal(fingerprint(), before,
      'the monitor publishing changed its own tree fingerprint — it watches itself, and idle can never hold for two passes');

    // The control: a REAL change must still move it, or the fingerprint is
    // measuring nothing and the "tree changed" row of the truth table is dead.
    fs.writeFileSync(path.join(dir, 'new-work.ts'), 'export const x = 1;\n');
    assert.notEqual(fingerprint(), before,
      'a new source file did not move the fingerprint — the tree-changed condition can never fire');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('worker-monitor: a commit moves the fingerprint even with an identical status', () => {
  // HEAD IS PART OF THE FINGERPRINT, and this is the case that needs it. An
  // agent that stages its work and commits leaves an EMPTY status either side
  // of a clean commit — so a status-only fingerprint would read "unchanged"
  // across the single most meaningful thing an agent does.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-wmon-head-'));
  try {
    execFileSync('git', ['init', '-q', '-b', 'main', dir]);
    execFileSync('git', ['-C', dir, 'config', 'user.email', 't@t']);
    execFileSync('git', ['-C', dir, 'config', 'user.name', 't']);
    execFileSync('git', ['-C', dir, 'config', 'commit.gpgsign', 'false']);
    fs.writeFileSync(path.join(dir, 'a.txt'), 'a');
    execFileSync('git', ['-C', dir, 'add', '-A']);
    execFileSync('git', ['-C', dir, 'commit', '-qm', 'one']);

    const fingerprint = () => execFileSync('bash', ['-c', `
      PLOT_MONITOR_NO_MAIN=1
      . ${JSON.stringify(monitor)}
      monitor_tree_fingerprint
    `], { encoding: 'utf8', env: { ...process.env, PLOT_WORKTREE: dir } });

    const before = fingerprint();
    fs.writeFileSync(path.join(dir, 'b.txt'), 'b');
    execFileSync('git', ['-C', dir, 'add', '-A']);
    execFileSync('git', ['-C', dir, 'commit', '-qm', 'two']);

    assert.notEqual(fingerprint(), before,
      'a clean commit left the fingerprint unchanged — an agent that commits between passes reads as idle');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('worker-monitor: commits are counted against a local ref, and absent means unanswerable', () => {
  // `monitor_has_commits` drives the third condition, and it is the port most
  // likely to be "improved" into a fetch by someone who reads the question as
  // being about the remote. All three arms, against real repos.
  const mk = (label) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), `plot-wmon-${label}-`));
    execFileSync('git', ['init', '-q', '-b', 'main', dir]);
    for (const [k, v] of [['user.email', 't@t'], ['user.name', 't'], ['commit.gpgsign', 'false']]) {
      execFileSync('git', ['-C', dir, 'config', k, v]);
    }
    return dir;
  };
  const ask = (dir) => execFileSync('bash', ['-c', `
    PLOT_MONITOR_NO_MAIN=1
    . ${JSON.stringify(monitor)}
    monitor_has_commits; printf '%s' "$?"
  `], { encoding: 'utf8', env: { ...process.env, PLOT_WORKTREE: dir } });

  // No remote at all → UNANSWERABLE (2), not "yes". Counting against nothing
  // would count the whole history from the root commit and read every branch in
  // a remote-less repo as having committed.
  const solo = mk('solo');
  try {
    fs.writeFileSync(path.join(solo, 'a.txt'), 'a');
    execFileSync('git', ['-C', solo, 'add', '-A']);
    execFileSync('git', ['-C', solo, 'commit', '-qm', 'one']);
    assert.equal(ask(solo), '2',
      'a repo with no origin ref answered the commit question — it must answer *unanswerable*');
  } finally {
    fs.rmSync(solo, { recursive: true, force: true });
  }

  // With a real origin: level with main → no (1); one commit ahead → yes (0).
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-wmon-remote-'));
  try {
    const origin = path.join(root, 'origin.git');
    const work = path.join(root, 'work');
    execFileSync('git', ['init', '-q', '--bare', '-b', 'main', origin]);
    execFileSync('git', ['clone', '-q', origin, work]);
    for (const [k, v] of [['user.email', 't@t'], ['user.name', 't'], ['commit.gpgsign', 'false']]) {
      execFileSync('git', ['-C', work, 'config', k, v]);
    }
    fs.writeFileSync(path.join(work, 'a.txt'), 'a');
    execFileSync('git', ['-C', work, 'add', '-A']);
    execFileSync('git', ['-C', work, 'commit', '-qm', 'one']);
    execFileSync('git', ['-C', work, 'push', '-q', 'origin', 'main']);
    execFileSync('git', ['-C', work, 'checkout', '-q', '-b', 'feature/x']);

    assert.equal(ask(work), '1',
      'a branch level with origin/main reported commits — the middle row of the truth table is unreachable');

    fs.writeFileSync(path.join(work, 'b.txt'), 'b');
    execFileSync('git', ['-C', work, 'add', '-A']);
    execFileSync('git', ['-C', work, 'commit', '-qm', 'two']);
    assert.equal(ask(work), '0',
      'a branch one commit ahead of origin/main did not report commits — `idle` can never fire');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// ── monitor_has_commits against a REAL repository ─────────────────────────────
// Every test above stubs this function, which is exactly how it shipped broken:
// the stub makes its CALLERS testable and makes the function itself invisible.
// 21 assertions were green while it counted the wrong thing.
//
// Measured 2026-08-30 (#538 red in CI): it counted `origin/main..HEAD`, and
// `plot-dispatch.sh:2074` writes `commit --allow-empty -m "plot: claim <branch>"`
// BEFORE the agent starts. So "the branch already carries commits" was true from
// second zero on every dispatched branch, and a worker burning CPU in
// `yes > /dev/null` was reported idle because the only condition that could have
// refused was satisfied by bookkeeping the agent never did.
//
// These run the real function against a real git repo. A stub cannot catch this.

/** A repo with an origin/main and a branch carrying the commits described. */
const repoWith = (commits) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-wmon-repo-'));
  const git = (...args) => execFileSync('git', ['-C', dir, ...args], { stdio: 'pipe' });
  git('init', '-q', '-b', 'main');
  git('config', 'user.email', 'test@example.com');
  git('config', 'user.name', 'Test');
  fs.writeFileSync(path.join(dir, 'seed'), 'seed\n');
  git('add', '-A');
  git('commit', '-q', '-m', 'seed');
  // A local ref standing in for origin/main — the function accepts either.
  git('update-ref', 'refs/remotes/origin/main', 'HEAD');
  git('checkout', '-q', '-b', 'feature/x');
  for (const c of commits) {
    if (c === 'claim') {
      git('commit', '-q', '--allow-empty', '-m', 'plot: claim feature/x');
    } else {
      fs.writeFileSync(path.join(dir, c), `${c}\n`);
      git('add', '-A');
      git('commit', '-q', '-m', `work: ${c}`);
    }
  }
  return dir;
};

/** Run the real `monitor_has_commits` in `dir`; returns its exit code. */
const hasCommits = (dir) => {
  const script = `
    PLOT_MONITOR_NO_MAIN=1
    . ${JSON.stringify(monitor)}
    worktree=${JSON.stringify(dir)}
    monitor_has_commits
  `;
  const r = spawnSync('bash', ['-c', script], { encoding: 'utf8' });
  return r.status;
};

test('the claim commit alone is NOT work — this is the #538 defect', () => {
  // The exact state of every dispatched branch one second after dispatch.
  assert.equal(hasCommits(repoWith(['claim'])), 1,
    'a branch carrying only its empty claim commit reported commits — the condition ' +
    'is true from second zero on every dispatched branch and can refuse nothing');
});

test('the claim plus real work IS work', () => {
  assert.equal(hasCommits(repoWith(['claim', 'a.txt'])), 0,
    'a branch where the agent committed a file reported no commits — idle can now never fire');
});

test('work with no claim at all is work (a hand-made worktree)', () => {
  assert.equal(hasCommits(repoWith(['a.txt'])), 0);
});

test('a branch with nothing on it is not work', () => {
  assert.equal(hasCommits(repoWith([])), 1);
});

// ---------------------------------------------------------------------------
// A MONITOR ENDS WHEN ITS DESK IS GONE — the reconcile-suite hang
// ---------------------------------------------------------------------------
//
// `plot_monitor_subject` answers `starting | alive | gone` from a pid file, and
// `plot_monitor_wait` leaves only on `gone`. A missing pid file used to answer
// `starting` unconditionally, so a monitor whose worktree had been removed
// waited for a subject that was never coming.
//
// Measured on CI 2026-08-31: 14 monitors at PPID 1, aged 11-13 minutes, each
// holding a `sleep 1`, AFTER every test in the reconcile suite had passed. A
// fixture is removed at teardown, so its pid file vanishes before its agent
// does — node then cannot exit and the job dies at its ceiling. Five open PRs
// were red on this, none of them for anything in their own diff.
//
// The fix splits the missing-file case by whether the DESK is still there, so
// these assert both halves. Asserting only `gone` would pass against a version
// that always says `gone`, which would end every monitor during its startup
// window — the opposite defect, and the reason the startup case is here.
const subject = (pidFile) => {
  const script = `
    . ${JSON.stringify(path.join(scripts, 'plot-monitor-subject.sh'))}
    plot_monitor_subject ${JSON.stringify(pidFile)}
  `;
  return spawnSync('bash', ['-c', script], { encoding: 'utf8' }).stdout;
};

test('subject: a removed desk is gone, not starting — the CI hang', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-desk-'));
  const pidFile = path.join(dir, '.plot-worker.pid');
  fs.rmSync(dir, { recursive: true, force: true });
  assert.equal(subject(pidFile), 'gone',
    'a pid file whose directory is gone reported a subject still to come — ' +
    'the monitor waits forever and holds the test runner open');
});

test('subject: a desk with no pid file yet is starting — the startup window', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-desk-'));
  try {
    // The worktree exists; the wrapper has not written the pid yet. Ending here
    // would kill every monitor in the second before its agent is recorded.
    assert.equal(subject(path.join(dir, '.plot-worker.pid')), 'starting',
      'a monitor attached before its wrapper wrote the pid was told its subject was gone');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('subject: no pid file path at all is still starting — a hand-run monitor', () => {
  assert.equal(subject(''), 'starting');
});

// ═══════════════════════════════════════════════════════════════════════════
// THE TRANSCRIPT READING — what replaced the CPU rule on 2026-09-02
// ═══════════════════════════════════════════════════════════════════════════
//
// The rule these tests replace ended ELEVEN dispatched workers across two days,
// several holding uncommitted work including new test files. Every case below
// is one of those workers, or the stall the monitor must still catch.
//
// THE NUMBERS ARE WAVE 1'S, measured 2026-09-02 by `plot-quiet-stretch.sh`
// across 23 sessions in 21 worktrees, 7547 quiet stretches: p50 0s, p90 2.6s,
// p99 15.6s, max 600.8s. The 900 s default is 1.5x that maximum and 57x the
// p99.

const transcriptLib = path.join(scripts, 'plot-transcript-quiet.sh');

test('worker-monitor: an agent that only READS for ten minutes is not ended', () => {
  // THE PLAN'S OWN `Done when`, and the defect in one line. An agent reading
  // files runs tools whose CPU is charged to short-lived children that are gone
  // by the next 0.4 s sample, so the old rule saw a frozen subtree clock and
  // called it a stall. Its transcript, meanwhile, gains a line per tool call.
  //
  // Ten minutes is 600 s — past every stretch wave 1 measured except the single
  // 600.8 s `gh pr checks --watch`, and still inside the 900 s window. A reading
  // agent is therefore `busy` on the transcript alone, whatever its CPU says.
  const reading = QUIET.replace("monitor_transcript_quiet() { printf '99999'; }",
    "monitor_transcript_quiet() { printf '600'; }");
  assert.deepEqual(drive(reading, 8), [],
    'a working agent that only read for ten minutes was reported idle — the defect this slice exists to fix');
});

test('worker-monitor: an agent inside a 20-minute test run is not ended', () => {
  // THE CASE A THRESHOLD ALONE CANNOT COVER, and why the window is a gate
  // rather than the verdict. 28 of the 37 over-window stretches wave 1 measured
  // are an agent waiting on its OWN command, and the four longest are this
  // repo's gates: `gh pr checks --watch` 600.8s, `pnpm run test:board` 600.3s,
  // `pnpm run test:reconcile` 584.9s and 575.5s.
  //
  // Those cluster at 600 because that is where a watch command and a test
  // runner time out — a CEILING, not a distribution's tail. A project whose
  // suite is slower produces a longer one, so no single number picked from this
  // sample is safe. What separates this agent from a stopped one is that a
  // child is on a core, and that is what the second reading asks.
  const building = QUIET.replace("monitor_activity() { printf 'idle'; }",
    "monitor_activity() { printf 'working'; }");
  assert.deepEqual(drive(building, 8), [],
    'an agent whose test suite was running was reported idle — the CPU reading did not save it');
});

test('worker-monitor: a genuinely stopped agent is still ended', () => {
  // THE OTHER HALF, and the one that keeps the fix from being a deletion. Past
  // the window with nothing burning CPU, over an unchanged tree, with commits
  // already on the branch — every condition the finding has ever carried.
  const published = drive(QUIET, 2);
  assert.equal(published.length, 1,
    `a stopped agent published ${JSON.stringify(published)} — the monitor stopped finding real stalls`);
  assert.equal(published[0].finding, 'idle');
});

test('worker-monitor: the window boundary is the measured maximum, with margin', () => {
  // THE THRESHOLD ITSELF, asserted rather than described. Just inside is busy,
  // just outside is a candidate — and the default sits at 900 s so that the
  // 600.8 s maximum wave 1 measured clears it by five minutes.
  const at = (n) => QUIET.replace("monitor_transcript_quiet() { printf '99999'; }",
    `monitor_transcript_quiet() { printf '${n}'; }`);

  assert.deepEqual(drive(at(899), 4), [],
    'a transcript quiet for 899s fired inside the 900s window');
  assert.equal(drive(at(901), 2).length, 1,
    'a transcript quiet for 901s did not fire past the 900s window');

  // 600.8 s — the longest stretch ever measured on this estate, an agent
  // watching its own PR checks. It must be silence, and with room to spare.
  assert.deepEqual(drive(at(601), 4), [],
    'the longest quiet stretch wave 1 measured was reported idle');
});

test('worker-monitor: the window is configurable, and the default is 900', () => {
  // A PROJECT WHOSE GATES ARE SLOWER THAN THIS REPO'S must be able to say so
  // without editing the script — the same reason `Worker bound` is a config
  // key. The measurement that chose 900 is this estate's, and Plot does not
  // assume every adopter's suite looks like its own.
  const src = fs.readFileSync(monitor, 'utf8');
  assert.match(src, /PLOT_MONITOR_QUIET_SECONDS:=900/,
    'the default window is no longer 900s — if that is deliberate, the numbers in the header must move with it');

  const wide = QUIET.replace("monitor_transcript_quiet() { printf '99999'; }",
    "monitor_transcript_quiet() { printf '1200'; }");
  assert.deepEqual(drive(wide, 4, { env: { PLOT_MONITOR_QUIET_SECONDS: '1800' } }), [],
    'a project that widened the window still had its worker reported idle');
});

test('worker-monitor: no transcript is UNAVAILABLE, and publishes nothing', () => {
  // THE FALLBACK, settled by `the-registry-supervises-its-agents`: a capability
  // the adopting project does not provide is UNAVAILABLE, never failed and
  // never zero.
  //
  // BOTH WRONG READINGS ARE FAILURES, in opposite directions. Read as zero, an
  // unreadable agent reports healthy forever and no stall is ever caught. Read
  // as an error, the monitor refuses to run where Plot's contract says it must
  // degrade. It is a word, and the verdict matches on it.
  //
  // What ends a stuck worker here is `Worker bound` — 8 hours on this estate.
  // The cost is stated rather than hidden, and it is smaller than the measured
  // cost of killing working agents.
  const unreadable = QUIET.replace("monitor_transcript_quiet() { printf '99999'; }",
    "monitor_transcript_quiet() { printf 'unavailable'; }");
  assert.deepEqual(drive(unreadable, 6), [],
    'an agent whose transcript could not be read was reported idle — unavailable became a finding');
});

test('worker-monitor: a missing transcript reader is unavailable, not zero', () => {
  // THE HELPER ITSELF GOING MISSING is the same answer as the transcript going
  // missing, and for the same reason: a monitor that cannot see must say so
  // rather than report that it saw nothing happen. Zero would make every worker
  // on a broken install a stall.
  const noReader = QUIET
    .replace("monitor_transcript_quiet() { printf '99999'; }", '')
    + '\n unset -f plot_transcript_quiet_seconds\n';
  assert.deepEqual(drive(noReader, 6), [],
    'a monitor whose transcript reader was absent reported idle anyway');
});

test('transcript-quiet: it reads a REAL session directory, by worktree path', () => {
  // THE JOIN, against the real layout rather than a description of it. Wave 1
  // proved this resolution on 23 sessions; the point here is that this script
  // agrees with it, since the two derive the slug independently and a drift
  // between them would make the monitor blind on exactly the estate wave 1
  // measured.
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-tq-home-'));
  const worktree = '/Users/someone/repo/.worktrees/feature-x';
  const slug = worktree.replace(/[/.]/g, '-');
  const dir = path.join(home, '.claude', 'projects', slug);
  fs.mkdirSync(dir, { recursive: true });
  try {
    fs.writeFileSync(path.join(dir, 'sess.jsonl'), '{}\n');
    const read = (extra = '') => execFileSync('bash', ['-c', `
      . ${JSON.stringify(transcriptLib)}
      ${extra}
      plot_transcript_quiet_seconds ${JSON.stringify(worktree)}
    `], { encoding: 'utf8', env: { ...process.env, PLOT_TRANSCRIPT_HOME: home } });

    const quiet = read();
    assert.match(quiet, /^\d+$/, `expected seconds, got ${quiet}`);
    assert.ok(Number(quiet) < 60, `a file just written read as ${quiet}s quiet`);

    // A DIRECTORY THAT EXISTS BUT HOLDS NO SESSION is still unavailable. The
    // runtime creates it when the project is first opened, so an empty one
    // means nothing has written here — not "quiet for a very long time".
    fs.rmSync(path.join(dir, 'sess.jsonl'));
    assert.equal(read(), 'unavailable',
      'an empty session directory read as a very long silence');
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('transcript-quiet: an `agent-` prefixed transcript is not the worker', () => {
  // WAVE 1'S FILTER, kept for its reason: a subagent's transcript is a true
  // statement about the WRONG process. A worker whose subagent is chatting
  // while the worker itself has stopped must still read as quiet — otherwise
  // the busiest stall on the estate is the one that never reports.
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-tq-sub-'));
  const worktree = '/Users/someone/repo/.worktrees/feature-y';
  const dir = path.join(home, '.claude', 'projects', worktree.replace(/[/.]/g, '-'));
  fs.mkdirSync(dir, { recursive: true });
  try {
    fs.writeFileSync(path.join(dir, 'agent-sub.jsonl'), '{}\n');
    const out = execFileSync('bash', ['-c', `
      . ${JSON.stringify(transcriptLib)}
      plot_transcript_quiet_seconds ${JSON.stringify(worktree)}
    `], { encoding: 'utf8', env: { ...process.env, PLOT_TRANSCRIPT_HOME: home } });
    assert.equal(out, 'unavailable',
      'a subagent transcript was read as the worker\'s own — the wrong process was measured');
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('transcript-quiet: the newest session across a desk is the reading', () => {
  // A WORKTREE CAN HOLD SEVERAL SESSIONS — a worker that hopped waves, or an
  // operator who opened one at the same desk. Any of them producing output
  // means somebody is working there, and the monitor's question is about the
  // DESK. Taking the maximum timestamp is what stops a live session being ended
  // because a stale sibling sits beside it.
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-tq-many-'));
  const worktree = '/Users/someone/repo/.worktrees/feature-z';
  const dir = path.join(home, '.claude', 'projects', worktree.replace(/[/.]/g, '-'));
  fs.mkdirSync(dir, { recursive: true });
  try {
    const stale = path.join(dir, 'old.jsonl');
    fs.writeFileSync(stale, '{}\n');
    // Two hours ago — past any window.
    const old = new Date(Date.now() - 7200_000);
    fs.utimesSync(stale, old, old);
    fs.writeFileSync(path.join(dir, 'live.jsonl'), '{}\n');

    const out = execFileSync('bash', ['-c', `
      . ${JSON.stringify(transcriptLib)}
      plot_transcript_quiet_seconds ${JSON.stringify(worktree)}
    `], { encoding: 'utf8', env: { ...process.env, PLOT_TRANSCRIPT_HOME: home } });
    assert.ok(Number(out) < 60,
      `a desk with one live and one stale session read as ${out}s quiet — the stale sibling won`);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});
