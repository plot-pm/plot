// Contract test for the idle-judging functions in
// skills/plot/scripts/plot-worker-state.sh — `plot_worker_idle_now`,
// `plot_worker_idle_watch_pass`, and the readings they are built from.
//
// REPOINTED FROM THE WORKERMONITOR PROCESS (`bug/the-loop-reports-idle`). The
// WorkerMonitor process (`plot-worker-monitor.sh`) is gone: its logic moved
// into `plot-worker-state.sh`, which already held some of it
// (`plot_worker_idle_now`, `plot_worker_tree_quiet_seconds`,
// `plot_worker_dirty_filter`, `plot_worker_activity`) and gained the rest
// (`plot_worker_limited_reset`, `plot_worker_conversation_spoken`,
// `plot_worker_has_commits`, `json_escape`, `plot_worker_publish_finding`,
// `plot_worker_idle_watch_pass`). This file was `workermonitor.test.mjs`,
// 1211 lines sourcing the now-deleted script with `PLOT_MONITOR_NO_MAIN=1`
// and stubbing `monitor_*` ports; it is rewritten here against the functions
// those ports fed, sourced directly from `plot-worker-state.sh`.
//
// WHAT WAS DROPPED AS REDUNDANT WITH `test/reconcile/workeridle.test.mjs`,
// which already builds a REAL desk (a git repo, an `origin/main` ref, an aged
// commit, a transcript file) and drives `plot_worker_idle_watch_pass` over it:
//   - "a tree that moved inside the window is silent" / "the tree boundary is
//     the window, inclusive" — covered by workeridle's "a quiet tree ... FIRST
//     pass" and "a file renamed inside the window" cases, which exercise the
//     real tree reading rather than a stub returning a fixed number.
//   - "the tree reading ignores the monitor's own findings file" — covered by
//     workeridle's ".plot-worker.* files changed" case, over a real desk.
//   - "a busy worker publishes nothing" / "quiet with no commits yet" / "an
//     unanswerable commit question" / "a genuinely stopped agent is still
//     ended" — covered by workeridle's "a working child vetoes", "a branch
//     with no commits of its own", and "a quiet tree with commits ... FIRST
//     pass" cases, all against real desks.
//   - "an agent that only reads for ten minutes" / "an agent inside a
//     20-minute test run" / "fresh-transcript-quiet-tree independence" —
//     covered by workeridle's "a transcript inside the window publishes
//     nothing, however quiet the tree" and "a working child vetoes" cases.
//   - the whole "unspoken:" block (hop desks, manifest corrections, the
//     race clamp) — covered by workeridle's two race-clamp cases plus this
//     file's own `plot_worker_conversation_spoken` unit tests below, which
//     keep the reasoning about the port's three answers without re-deriving
//     the loop/manifest plumbing workeridle already drives end to end.
// Kept here instead: pure boundary/unit tests that do not need a real desk at
// all (the window boundary on `plot_worker_idle_now` directly, the #538
// claim-commit exclusion, the pid-liveness-window `subject:` tests — though
// `plot-monitor-subject.sh` is the old monitor's own file and is dropped, see
// below), plus the one-sample orchestration properties (publish once, publish
// on change, never "stalled") driven through `plot_worker_idle_watch_pass`
// with a loop of stubbed-activity passes, the way `workeridle.test.mjs`'s own
// `publishedOver` helper does.
//
// `subject: ...` tests (pid-liveness startup window) tested
// `plot-monitor-subject.sh`, a file that belonged to the old monitor process
// and has no surviving counterpart — the loop's watcher is started with its
// OWN pid, which is alive by construction for as long as the watcher runs
// (see `plot_worker_idle_watch_pass`'s header comment), so there is no
// "subject gone" question left to ask. Dropped rather than ported.
//
// `transcript-quiet: ...` and most of `unspoken: ...` test
// `plot_transcript_quiet_seconds` / `plot_transcript_exists` /
// `session_handle` directly and are UNCHANGED in entry point — those
// functions still live in `plot-transcript-quiet.sh` and
// `plot-agent-manifest.sh` and are kept here nearly verbatim, since this file
// is a sourcing site for them either way.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const scripts = path.join(here, '..', '..', 'skills', 'plot', 'scripts');
const stateLib = path.join(scripts, 'plot-worker-state.sh');
const transcriptLib = path.join(scripts, 'plot-transcript-quiet.sh');
const manifestLib = path.join(scripts, 'plot-agent-manifest.sh');

/**
 * What N calls to `plot_worker_idle_watch_pass` publish, over a worktree whose
 * readings are entirely stubbed (`ports`). The window, pid, branch and
 * findings file are the caller's; `plot_worker_activity` defaults to printing
 * nothing unless `ports` overrides it.
 *
 * MIRRORS `workeridle.test.mjs`'s `publishedOver` HELPER, but drives a bare
 * worktree rather than a real desk — these tests stub every reading
 * `plot_worker_idle_watch_pass` takes, including the tree and the commit
 * question, so no git repository or transcript is needed.
 */
function publishedOver(ports, passes, { worktree, branch = 'feature/watched', window = '900', startedAt = '', pid = '4242' } = {}) {
  const dir = worktree ?? fs.mkdtempSync(path.join(os.tmpdir(), 'plot-wstate-idle-'));
  const file = path.join(dir, 'findings.jsonl');
  try {
    execFileSync('bash', ['-c', `
      set -u
      . ${JSON.stringify(transcriptLib)}
      . ${JSON.stringify(manifestLib)}
      . ${JSON.stringify(stateLib)}
      ${ports}
      for _i in $(seq 1 ${passes}); do
        plot_worker_idle_watch_pass "$WT" "$BRANCH" "$FINDINGS" "$WINDOW" "$STARTED_AT" "$PID" || true
      done
    `], {
      encoding: 'utf8',
      timeout: 30_000,
      env: {
        ...process.env,
        PLOT_SESSION_ID: '', PLOT_MANIFEST_FILE: '',
        WT: dir, BRANCH: branch, FINDINGS: file, WINDOW: window, STARTED_AT: String(startedAt), PID: String(pid),
      },
    });
    if (!fs.existsSync(file)) return [];
    return fs.readFileSync(file, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
  } finally {
    if (!worktree) fs.rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * Every reading a quiet, idle, committed worker produces — the stub analogue
 * of `workermonitor.test.mjs`'s `QUIET` ports constant, repointed at the
 * functions `plot_worker_idle_watch_pass` actually calls:
 * `plot_transcript_quiet_seconds`, `plot_worker_conversation_spoken`,
 * `plot_worker_activity`, `plot_worker_tree_quiet_seconds`,
 * `plot_worker_has_commits`.
 *
 * BOTH DURATIONS ARE 99999, well past the 900s default, so the window's exact
 * value is not baked into every test that merely needs *quiet*.
 */
const QUIET = `
  plot_transcript_quiet_seconds() { printf '99999'; }
  plot_worker_conversation_spoken() { return 0; }
  plot_worker_activity() { printf 'idle'; }
  plot_worker_tree_quiet_seconds() { printf '99999'; }
  plot_worker_has_commits() { return 0; }
`;

// ═══════════════════════════════════════════════════════════════════════════
// THE ONE-SAMPLE ORCHESTRATION — plot_worker_idle_watch_pass over stubbed reads
// ═══════════════════════════════════════════════════════════════════════════

test('idle-watch: ONE idle reading reports idle, on the first pass', () => {
  // Every duration in the rule is a SPAN (at least the window), not a
  // snapshot, so one reading answers and a process does not have to exist to
  // hold a previous one.
  const published = publishedOver(QUIET, 1);
  assert.equal(published.length, 1,
    `one idle reading should publish exactly one finding, got ${JSON.stringify(published)}`);
  assert.equal(published[0].finding, 'idle');
  assert.equal(published[0].monitor, 'WorkerMonitor',
    'the finding does not identify its monitor — the attention slice cannot tell it from an AgentMonitor entry');
  assert.equal(published[0].branch, 'feature/watched');
});

test('idle-watch: the finding is published once, however many passes run', () => {
  // A property of the CHANNEL, not of a two-sample rule: a watcher that
  // republished `idle` every pass would bury the one line that matters.
  const published = publishedOver(QUIET, 4);
  assert.equal(published.length, 1,
    `a held finding was republished, got ${published.length} lines`);
  assert.equal(published[0].finding, 'idle');
});

test('idle-watch: it is called idle and never stalled', () => {
  // A CONTRACT WITH THE SPEC, not a spelling preference. `stalled` is an AGENT
  // fact — "exited 0, unlanded work, no PR" (DESIGN-agent.md) — and an idle
  // worker may just be waiting on the network, which is the exact confusion
  // CLAUDE.md's Machine/Registry split exists to prevent.
  const published = publishedOver(QUIET, 1);
  assert.equal(published[0].finding, 'idle');
  const blob = JSON.stringify(published);
  assert.doesNotMatch(blob, /stall/i,
    'the idle watch used the word `stalled`, which the spec reserves for an Agent fact');

  // And the source itself, because the finding string is only one place it
  // could leak in — an `evidence` line calling it a stall would mislead just
  // as effectively as the word in the `finding` field.
  const src = fs.readFileSync(stateLib, 'utf8');
  const findingLines = src.split('\n').filter((l) => /finding=|evidence=/.test(l));
  for (const line of findingLines) {
    assert.doesNotMatch(line, /stall/i,
      `a finding or evidence assignment names a stall: ${line.trim()}`);
  }
});

test('idle-watch: a busy transcript publishes nothing, however long it runs', () => {
  // SILENCE MEANS HEALTHY. A watcher that emitted a line per pass would bury
  // the one line that matters under a hundred that do not.
  const busy = QUIET.replace("plot_worker_activity() { printf 'idle'; }",
    "plot_worker_activity() { printf 'working'; }");
  assert.deepEqual(publishedOver(busy, 6), [],
    'a healthy worker produced findings — silence no longer means healthy');
});

test('idle-watch: past the window, a live pid with NO child is idle', () => {
  // THE EMPTY ANSWER IS NOT A REFUSAL HERE. Reaching this line already
  // establishes the agent has written nothing for over 900s; a live pid with
  // no child process behind it is precisely an agent that has stopped, not a
  // measurement that is missing. Refusing here would leave the commonest real
  // stall unreported.
  const nothing = QUIET.replace("plot_worker_activity() { printf 'idle'; }",
    "plot_worker_activity() { printf ''; }");
  const published = publishedOver(nothing, 1);
  assert.equal(published.length, 1,
    `expected one idle finding, got ${JSON.stringify(published)}`);
  assert.equal(published[0].finding, 'idle');
});

test('idle-watch: it publishes the moment a finding holds and nothing when nothing changed', () => {
  // `idle` holds from the FIRST pass, and every pass after says the same
  // thing — so exactly one line is published, at the moment it first held.
  const published = publishedOver(QUIET, 8);
  assert.equal(published.length, 1,
    `a held finding was republished on every pass, got ${published.length} lines`);
  assert.equal(published[0].finding, 'idle');
});

test('idle-watch: a finding that stops holding is published as clear', () => {
  // THE CLEARING CASE IS NEWS TOO. A board that only ever hears about the
  // onset leaves a stale entry up after the worker recovered, and an operator
  // learns that entries are not to be believed — the same cost as a false
  // positive, arriving later.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-wstate-idle-recover-'));
  try {
    const recovers = `
      plot_transcript_quiet_seconds() { printf '99999'; }
      plot_worker_conversation_spoken() { return 0; }
      plot_worker_tree_quiet_seconds() { printf '99999'; }
      plot_worker_has_commits() { return 0; }
      plot_worker_activity() {
        _n=$(cat "${dir}/.a" 2>/dev/null || echo 0)
        _n=$((_n + 1)); printf '%s' "$_n" > "${dir}/.a"
        if [ "$_n" -ge 4 ]; then printf 'working'; else printf 'idle'; fi
      }
    `;
    const published = publishedOver(recovers, 6, { worktree: dir });
    assert.equal(published.length, 2,
      `expected an idle then a clear, got ${JSON.stringify(published)}`);
    assert.equal(published[0].finding, 'idle');
    assert.equal(published[1].finding, 'clear');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('idle-watch: every finding carries finding, since, evidence and measuredAt', () => {
  // THE RECORD SHAPE `plot_worker_publish_finding` emits, pinned directly
  // rather than through the watch pass, so a reader checking the publish
  // function's own contract does not also have to drive six readings.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-wstate-idle-shape-'));
  const file = path.join(dir, 'findings.jsonl');
  try {
    execFileSync('bash', ['-c', `
      . ${JSON.stringify(stateLib)}
      plot_worker_publish_finding "$FILE" "feature/watched" "$WT" "idle" "the evidence" ""
    `], { encoding: 'utf8', env: { ...process.env, FILE: file, WT: dir } });
    const [record] = fs.readFileSync(file, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
    assert.ok(record, 'plot_worker_publish_finding wrote nothing');
    for (const field of ['finding', 'since', 'evidence', 'measuredAt']) {
      assert.ok(record[field] && String(record[field]).length > 0,
        `the published finding is missing ${field}`);
    }
    assert.equal(record.monitor, 'WorkerMonitor',
      'the finding does not identify its monitor — the board reader keys on this exact name');
    assert.match(record.measuredAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/,
      'the finding has an unusable measuredAt');
    assert.match(record.since, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/,
      'the finding has an unusable since');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('idle-watch: it makes no host call at all', () => {
  // NOT "FEW" — NONE. A watcher that asks the host on every pass has become an
  // AgentMonitor with a fast loop, and the rate problem follows it.
  //
  // Asserted over the SOURCE of plot-worker-state.sh's idle-judging region
  // rather than by observing a run, because a host call on a branch this test
  // happens not to take would pass unobserved. `gh`/`bb` are the two host
  // CLIs; `plot-host.sh` is the adapter that wraps them. The slice is read
  // from `plot_worker_idle_now` through the end of `plot_worker_idle_watch_pass`
  // — the functions a watch pass actually calls — rather than the whole file,
  // which also holds `plot_worker_task_state` and friends with their own
  // established properties.
  const src = fs.readFileSync(stateLib, 'utf8');
  const start = src.indexOf('plot_worker_idle_now()');
  const end = src.indexOf('plot_worker_cpu_centis()');
  assert.ok(start > 0 && end > start, 'could not locate the idle-watch region to scope the check');
  const region = src.slice(start, end)
    .split('\n')
    .filter((l) => !/^\s*#/.test(l))   // comments may name what it must not do
    .join('\n');
  assert.doesNotMatch(region, /\bplot-host\.sh\b/, 'the idle watch calls the host adapter');
  assert.doesNotMatch(region, /(^|[^-\w])(gh|bb)\s+(pr|issue|api|repo)\b/m,
    'the idle watch invokes a host CLI directly');
  // `git fetch` is the other network call, and it is the tempting one: "are
  // there commits?" reads like a question about the remote. It is not — the
  // local ref answers it, and `plot_worker_has_commits` answers
  // *unanswerable* when there is no local ref rather than reaching for the
  // network.
  assert.doesNotMatch(region, /git\s[^\n]*\bfetch\b/,
    'the idle watch fetches — "commits present" must be answered from local refs or not at all');
});

// ═══════════════════════════════════════════════════════════════════════════
// plot_worker_idle_now — THE BOUNDARY, over the function directly
// ═══════════════════════════════════════════════════════════════════════════

/** Call `plot_worker_idle_now` with its seven positional readings. */
const idleNow = (pid, spoken, silence, activity, tree, commits, window) => execFileSync('bash', ['-c', `
  . ${JSON.stringify(stateLib)}
  plot_worker_idle_now ${JSON.stringify(pid)} ${JSON.stringify(spoken)} ${JSON.stringify(silence)} ${JSON.stringify(activity)} ${JSON.stringify(tree)} ${JSON.stringify(commits)} ${JSON.stringify(window)}
`], { encoding: 'utf8', timeout: 10_000 });

test('idle-now: the tree boundary is the window, inclusive', () => {
  // `>= window`, NOT `>`. The window is where the question becomes worth
  // asking, so a tree exactly at it is eligible — the same boundary the
  // transcript draws from the other side.
  assert.equal(idleNow('alive', '1', '99999', 'idle', '899', 'yes', '900'), 'silent',
    'a tree that moved 899s ago fired inside the 900s window');
  assert.equal(idleNow('alive', '1', '99999', 'idle', '900', 'yes', '900'), 'idle',
    'a tree quiet for exactly the window did not fire — the boundary excludes the window itself');
});

test('idle-now: the transcript boundary is the window, inclusive', () => {
  assert.equal(idleNow('alive', '1', '899', 'idle', '99999', 'yes', '900'), 'silent',
    'a transcript quiet for 899s fired inside the 900s window');
  assert.equal(idleNow('alive', '1', '900', 'idle', '99999', 'yes', '900'), 'idle',
    'a transcript quiet for exactly the window did not fire — the boundary excludes the window itself');
  assert.equal(idleNow('alive', '1', '901', 'idle', '99999', 'yes', '900'), 'idle',
    'a transcript quiet for 901s did not fire past the 900s window');
});

test('idle-now: an unreadable tree is silent, not a very long silence', () => {
  // A FAILURE TO OBSERVE IS NOT EVIDENCE OF SOMETHING TO SEE. Read as zero it
  // would say *everything just moved*; read as a huge number it would say
  // *nothing has moved in years*, and both are inventions.
  assert.equal(idleNow('alive', '1', '99999', 'idle', 'unreadable', 'yes', '900'), 'silent',
    'a desk whose tree could not be read was judged idle — unreadable became a finding');
});

test('idle-now: quiet with no commits yet is silent, not idle', () => {
  // THE MIDDLE ROW, and the one where the false positives would have been. An
  // agent given a hard first slice is quiet for a long time with nothing to
  // show. What separates a real stall is that it had already COMMITTED and
  // then gone quiet.
  assert.equal(idleNow('alive', '1', '99999', 'idle', '99999', 'no', '900'), 'silent',
    'a quiet agent with nothing committed was judged idle — an agent thinking about a hard first slice now looks like a stall');
});

test('idle-now: an unanswerable commit question does not fire idle', () => {
  // `plot_worker_has_commits` returns 2 (unanswerable) when there is no ref to
  // count against. A FAILURE TO OBSERVE IS NOT EVIDENCE OF SOMETHING TO SEE —
  // silence about a fact is not the fact.
  assert.equal(idleNow('alive', '1', '99999', 'idle', '99999', 'unanswerable', '900'), 'silent',
    'an unanswerable commit question was treated as a yes');
});

test('idle-now: a dead or unspoken pid never reaches idle, regardless of the rest', () => {
  assert.equal(idleNow('dead', '1', '99999', 'idle', '99999', 'yes', '900'), 'silent');
  assert.equal(idleNow('alive', '0', '99999', 'idle', '99999', 'yes', '900'), 'silent');
});

test('idle-now: a working child vetoes the finding', () => {
  // THE CPU IS A VETO, asserted where every other condition genuinely holds.
  // An agent waiting on its own 20-minute test suite has a silent transcript
  // and a quiet tree, and only the CPU separates it from one that has
  // stopped.
  assert.equal(idleNow('alive', '1', '99999', 'working', '99999', 'yes', '900'), 'silent',
    'an agent whose build was running was judged idle over an otherwise-idle reading');
});

// ═══════════════════════════════════════════════════════════════════════════
// plot_worker_has_commits — THE #538 CLAIM-COMMIT EXCLUSION, against real repos
// ═══════════════════════════════════════════════════════════════════════════
// Every test above stubs this function, which is exactly how it shipped
// broken: the stub makes its CALLERS testable and makes the function itself
// invisible. These run the real function against a real git repo.
//
// Measured 2026-08-30 (#538 red in CI): it counted `origin/main..HEAD`, and
// `plot-dispatch.sh` writes `commit --allow-empty -m "plot: claim <branch>"`
// BEFORE the agent starts. So "the branch already carries commits" was true
// from second zero on every dispatched branch, and a worker burning CPU in
// `yes > /dev/null` was reported idle because the only condition that could
// have refused was satisfied by bookkeeping the agent never did.

const made = [];
const scratch = (prefix) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  made.push(dir);
  return dir;
};
test.after(() => {
  for (const dir of made) fs.rmSync(dir, { recursive: true, force: true });
});

/** A repo with an origin/main and a branch carrying the commits described. */
const repoWith = (commits) => {
  const dir = scratch('plot-wstate-repo-');
  const git = (...args) => execFileSync('git', ['-C', dir, ...args], { stdio: 'pipe' });
  git('init', '-q', '-b', 'main');
  git('config', 'user.email', 'test@example.com');
  git('config', 'user.name', 'Test');
  git('config', 'commit.gpgsign', 'false');
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

/** Run the real `plot_worker_has_commits` in `dir`; returns its exit code. */
const hasCommits = (dir) => {
  const script = `
    . ${JSON.stringify(stateLib)}
    plot_worker_has_commits ${JSON.stringify(dir)}
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

test('plot_worker_has_commits: no origin ref at all is unanswerable, not yes', () => {
  // Counting against nothing would count the whole history from the root
  // commit and read every branch in a remote-less repo as having committed.
  const dir = scratch('plot-wstate-solo-');
  const git = (...args) => execFileSync('git', ['-C', dir, ...args], { stdio: 'pipe' });
  git('init', '-q', '-b', 'main');
  git('config', 'user.email', 'test@example.com');
  git('config', 'user.name', 'Test');
  git('config', 'commit.gpgsign', 'false');
  fs.writeFileSync(path.join(dir, 'a.txt'), 'a');
  git('add', '-A');
  git('commit', '-qm', 'one');
  assert.equal(hasCommits(dir), 2,
    'a repo with no origin ref answered the commit question — it must answer *unanswerable*');
});

// ═══════════════════════════════════════════════════════════════════════════
// plot_worker_conversation_spoken — THE THREE-ANSWER PORT
// ═══════════════════════════════════════════════════════════════════════════
// Kept here as a direct unit test of the function itself (the `unspoken:`
// block's `workermonitor.test.mjs` tests that drove it end-to-end through the
// loop and the manifest live on, unchanged, as `workeridle.test.mjs`'s desk
// fixtures and this port's own home in plot-agent-manifest.sh /
// plot-transcript-quiet.sh; this is the narrow "does the port itself answer
// its three cases" check).

const hopDesk = () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-wstate-hop-'));
  const home = path.join(root, 'home');
  const worktree = path.join(root, 'desk');
  fs.mkdirSync(worktree, { recursive: true });
  const dir = path.join(home, '.claude', 'projects', worktree.replace(/[/.]/g, '-'));
  fs.mkdirSync(dir, { recursive: true });
  const manifestFile = path.join(root, 'agent.json');
  const transcript = (name, age) => {
    const file = path.join(dir, `${name}.jsonl`);
    fs.writeFileSync(file, '{}\n');
    const t = new Date(Date.now() - age * 1000);
    fs.utimesSync(file, t, t);
    return file;
  };
  const manifest = (fields) => fs.writeFileSync(manifestFile,
    JSON.stringify({ session: 'launch-id', branch: 'bug/next', ...fields }, null, 2) + '\n');
  return {
    root, dir, worktree, manifestFile, transcript, manifest,
    env: {
      PLOT_TRANSCRIPT_HOME: home,
      PLOT_WORKTREE: worktree,
      PLOT_SESSION_ID: 'launch-id',
      PLOT_MANIFEST_FILE: manifestFile,
    },
    done: () => fs.rmSync(root, { recursive: true, force: true }),
  };
};

test('conversation-spoken: the port separates no file from no handle', () => {
  // `plot_transcript_exists` reads *no handle* as *no file*, which suits
  // `session_flag`. The port must not: a watcher with no handle that read
  // every quiet worker as unspoken would disable `idle` silently.
  const desk = hopDesk();
  const rc = (env) => execFileSync('bash', ['-c', `
    . ${JSON.stringify(transcriptLib)}
    . ${JSON.stringify(manifestLib)}
    . ${JSON.stringify(stateLib)}
    plot_worker_conversation_spoken "$PLOT_WORKTREE"; printf '%s' "$?"
  `], { encoding: 'utf8', timeout: 30_000, env: { ...process.env, ...desk.env, ...env } });
  try {
    desk.manifest({ resumeId: 'worker' });
    assert.equal(rc({}), '1', 'a handle with no file did not answer unspoken');
    desk.transcript('worker', 5000);
    assert.equal(rc({}), '0', 'a handle with a file did not answer spoken');
    assert.equal(rc({ PLOT_SESSION_ID: '', PLOT_MANIFEST_FILE: '' }), '2',
      'no handle was read as no file');
    // A manifest with no `resumeId` falls back to the launch id — the
    // prompt's order.
    desk.manifest({});
    assert.equal(rc({}), '1', 'the launch id fallback was not asked');
    desk.transcript('launch-id', 5000);
    assert.equal(rc({}), '0');
  } finally {
    desk.done();
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// transcript-quiet — plot_transcript_quiet_seconds, unchanged entry point
// ═══════════════════════════════════════════════════════════════════════════

test('transcript-quiet: it reads a REAL session directory, by worktree path', () => {
  // THE JOIN, against the real layout rather than a description of it.
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-tq-home-'));
  const worktree = '/Users/someone/repo/.worktrees/feature-x';
  const slug = worktree.replace(/[/.]/g, '-');
  const dir = path.join(home, '.claude', 'projects', slug);
  fs.mkdirSync(dir, { recursive: true });
  try {
    fs.writeFileSync(path.join(dir, 'sess.jsonl'), '{}\n');
    const read = () => execFileSync('bash', ['-c', `
      . ${JSON.stringify(transcriptLib)}
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
  // operator who opened one at the same desk. Taking the maximum timestamp is
  // what stops a live session being ended because a stale sibling sits
  // beside it.
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
