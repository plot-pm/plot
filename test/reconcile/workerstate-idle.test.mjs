// Contract test for the idle-judging functions in
// skills/plot/scripts/plot-worker-state.sh — `plot_worker_idle_now` and the
// readings it is built from.
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
// and stubbing `monitor_*` ports; it was rewritten here against the functions
// those ports fed, sourced directly from `plot-worker-state.sh`.
//
// `the-shell-loop-goes` REMOVED `plot_worker_idle_watch_pass`,
// `plot_worker_conversation_spoken` and `plot_worker_publish_finding` from
// `plot-worker-state.sh` (the brief's own scope line). The one-sample
// orchestration this file drove through `plot_worker_idle_watch_pass` —
// publish once, publish on change, idle-then-clear, the finding's field
// shape, the no-host-call guarantee — tested a long-running watcher subshell
// sampling repeatedly in one process. The JS loop has no such process: each
// pass is a fresh invocation, `idleNow` (`rules/sample.ts`) answers once, and
// the loop ends immediately on `idle` rather than holding a finding open
// across passes — there is no recovery-while-running to publish a `clear`
// for. `workflows-agent-loop.test.ts`'s "row 5: prompt running, idleNow
// answers idle" asserts the `worker-finding` write's shape (`finding`,
// `since`, `evidence`) and the `exit 124`/`quiet` ending; `sample.test.ts`
// covers `idleNow` itself exhaustively. The orchestration tests are dropped
// rather than ported — the property they tested (a watcher that samples
// without ending) does not exist on the JS side to test.
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
//     race clamp) — covered by workeridle's two race-clamp cases. The port
//     itself, `plot_worker_conversation_spoken`, went with the other two
//     functions named above; its three-answer behaviour (spoken / unspoken /
//     no handle) is ported to `packages/domain/test/transcript-fs.test.ts`'s
//     `transcriptFs.spoken` tests, which had no prior JS coverage.
// Kept here instead: pure boundary/unit tests that do not need a real desk at
// all (the window boundary on `plot_worker_idle_now` directly, the #538
// claim-commit exclusion).
//
// `subject: ...` tests (pid-liveness startup window) tested
// `plot-monitor-subject.sh`, a file that belonged to the old monitor process
// and has no surviving counterpart — the loop's watcher is started with its
// OWN pid, which is alive by construction for as long as the watcher runs,
// so there is no "subject gone" question left to ask. Dropped rather than
// ported.
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
const manifestLib = path.join(scripts, 'plot-agent-manifest.sh');

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

// plot_worker_conversation_spoken (THE THREE-ANSWER PORT: spoken / unspoken /
// no handle) and transcript-quiet (`plot_transcript_quiet_seconds`) both went
// with `the-shell-loop-goes` — the JS loop reads transcripts through
// `adapters/transcript/transcript-fs.ts` instead (`Transcript.spoken` and
// `.quietSeconds`). All four scenarios (spoken/unspoken/no-handle, real
// session directory, `agent-*` exclusion, newest-session-wins) are ported to
// `packages/domain/test/transcript-fs.test.ts`, which had no prior coverage.
