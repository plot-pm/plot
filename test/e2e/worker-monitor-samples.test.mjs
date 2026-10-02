// Flow test: the loop's own idle-watching, across the process boundary.
//
// REWRITTEN FOR `bug/the-loop-reports-idle`. There is no WorkerMonitor PROCESS
// any more to test a "process boundary" for — the loop's own watcher subshell
// judges `idle` in-process, through `plot_worker_idle_watch_pass`
// (`plot-worker-state.sh`), and publishes into the same findings file. What
// survives from the original file is the journey THAT publishing has to make
// through a real dispatch: a real `plot-dispatch.sh` fan-out, a real detached
// `sh -c` wrapper launching a real `plot-worker-loop.sh`, a real watcher
// subshell sourcing `plot-worker-state.sh` from its own directory, a real
// append to a real file, and a real reader parsing it.
//
// WHAT A UNIT TEST CANNOT ESTABLISH is that the conversation handle
// (`PLOT_SESSION_ID`, `PLOT_MANIFEST_FILE`) actually reaches the watcher
// through that whole path, and that the published findings file is correctly
// excluded from the fleet's own dirty-tree reading. Both are covered here,
// against a real dispatch; the one-sample rule's own branches are covered as
// unit cases in `test/reconcile/workerstate-idle.test.mjs` and the
// real-desk cases in `test/reconcile/workeridle.test.mjs`, against real git
// repositories but not a real dispatch, for the reason those files state: a
// real machine will not produce a fifteen-minute transcript silence on
// demand, and a test that waits for one flakes.
//
// `gone` NO LONGER LIVES HERE. It is the WRAPPER's own finding now, published
// after `wait "$agent"` returns in `plot-dispatch.sh`, and the real-dispatch
// proof of THAT journey is `test/e2e/monitors-attached.test.mjs`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { makeSandbox, sh, SCRIPTS, staffDesk } from './helpers.mjs';

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
    '# Brief: feature/sampled\n\nThe watcher is the subject, not this.\n');
  sh(work, 'git add -A && git commit -qm plan && git push -q origin main');
  return rel;
}

/**
 * Dispatch one real worker and hand back where its watcher publishes.
 *
 * `monitorInterval` is short so the loop's SECOND pass lands inside a test's
 * patience. Shortening it is the honest way to test a cadence: the production
 * default (30) is a choice about load, not a property of the logic, and it is
 * overridable precisely so that a test need not wait half a minute to observe
 * two passes.
 */
function dispatchOne(name, { workerCommand, monitorInterval = '1', env = {} } = {}) {
  const sb = makeSandbox({ name, config: '' });
  const command = typeof workerCommand === 'function' ? workerCommand(sb) : workerCommand;
  fs.writeFileSync(
    path.join(sb.work, 'CLAUDE.md'),
    `# Sandbox\n\n## Plot Config\n\n${PLAN_CONFIG}- **Worker command:** ${command}\n`,
  );
  dispatchablePlan(sb.work);
  // THE DESK IS LAID BY THE FIXTURE, not by the fan-out. Dispatch hands a slice
  // to the registry and cuts nothing; what these tests are about is the worker
  // and its watcher once a desk exists, so the fixture provides one and every
  // assertion below stands unchanged.
  const { worktree: wt } = staffDesk(sb.work, 'feature/sampled',
    { env: { PLOT_MONITOR_INTERVAL: monitorInterval, ...(typeof env === 'function' ? env(sb) : env) } });
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

test('the published findings file does not make the worktree read as dirty', () => {
  // THE NAME IS THE CONTRACT, and this is where it is cashed. The watcher
  // publishes INTO the worktree it watches, so a findings file the fleet did
  // not already ignore would make every monitored worktree read as holding
  // unlanded work — `stalled`, for a fleet that is perfectly healthy.
  //
  // `plot_worker_dirty` is asked directly, because it is the function whose
  // answer that failure would come through.
  const run = dispatchOne('monitor-not-dirty', { workerCommand: "sh -c 'true'" });
  try {
    const exitFile = path.join(run.worktree, '.plot-worker.exit');
    const deadline = Date.now() + 20_000;
    while (!fs.existsSync(exitFile) && Date.now() < deadline) execFileSync('sleep', ['0.2']);
    assert.ok(fs.existsSync(exitFile), 'the worker never finished, so this proves nothing');
    // THE WRAPPER'S OWN LINE IS WHAT POPULATES THIS FILE NOW, on an agent that
    // exits at once — `clear`, since the exit is 0. That is enough to exercise
    // the exclusion: the file need only exist and hold a line.
    waitFor(run.findingsFile, (r) => r.length > 0);
    assert.ok(fs.existsSync(run.findingsFile), 'nothing was published, so this proves nothing');

    const dirty = execFileSync('bash', ['-c', `
      . ${JSON.stringify(path.join(SCRIPTS, 'plot-worker-state.sh'))}
      plot_worker_dirty ${JSON.stringify(run.worktree)}
    `], { encoding: 'utf8' }).trim();

    assert.equal(dirty, '',
      `the watcher's own findings file reads as unlanded work: ${dirty}`);
  } finally {
    run.sb.cleanup();
  }
});

// ── the conversation handle reaches the watcher through the real launch ─────
//
// #1074. Past the window, `plot_worker_idle_watch_pass` asks whether
// `<handle>.jsonl` exists, and answers `unspoken` where it does not. The unit
// suite proves the rule against a handle it passes in by hand; only a real
// dispatch proves that the loop passes `PLOT_SESSION_ID` and
// `PLOT_MANIFEST_FILE` down to ITS OWN watcher correctly, through the exact
// quoting the wrapper and the loop apply.
//
// THE PAIR IS THE PROOF. Both runs lay the same desk: a previous slice's
// transcript far past a shortened window, a committed file whose commit is
// dated past that window, a clean tree, and a worker that sleeps. The only
// difference is whether the worker writes a file under its own handle, so the
// handle is the only thing that can separate the two outcomes.
//
// THE WORKER WRITES THE FILE, NOT THE TEST. The handle is minted inside the
// launch (`plot_session_id`) and `staffDesk` returns only after the worker has
// run, so the test cannot know it in time. The worker asks `session_handle`,
// the function the watcher asks. It runs as a script file because a `$` in
// the Worker command is expanded several shells out.
//
// THE COMMIT IS DATED PAST THE WINDOW. `idle` is one reading of the desk: the
// tree counts as quiet only when the newest of HEAD's committer time and each
// dirty path's mtime is at least the window old (`plot_worker_idle_now`,
// `docs/plans/2026-10-01-idle-is-read-from-what-the-desk-recorded.md`). A
// commit made seconds ago moves the tree inside the window, so the worker
// dates its commit through `GIT_COMMITTER_DATE` and the tree is clean after it.
const conversationDesk = (name, { spoken }) => dispatchOne(name, {
  // Both travel through `staffDesk`'s env and reach the watcher by
  // inheritance, as `PLOT_MONITOR_INTERVAL` does.
  env: (sb) => ({ PLOT_TRANSCRIPT_HOME: path.join(sb.root, 'home'), PLOT_MONITOR_QUIET_SECONDS: '60' }),
  workerCommand: (sb) => {
    const script = path.join(sb.root, 'worker.sh');
    fs.writeFileSync(script, `#!/usr/bin/env bash
. ${JSON.stringify(path.join(SCRIPTS, 'plot-agent-manifest.sh'))}
dir="$PLOT_TRANSCRIPT_HOME/.claude/projects/$(printf '%s' "$PLOT_WORKTREE" | tr '/.' '--')"
mkdir -p "$dir"
printf '{}\\n' > "$dir/previous-slice.jsonl"
touch -t 200001010000 "$dir/previous-slice.jsonl"
${spoken ? `handle=$(session_handle) || exit 3
printf '{}\\n' > "$dir/$handle.jsonl"
touch -t 200001010000 "$dir/$handle.jsonl"` : ''}
echo work > done.txt
git add done.txt
GIT_COMMITTER_DATE='2000-01-01T00:00:00 +0000' git -c user.email=a@b -c user.name=a commit -qm work
sleep 8
`);
    return `bash ${script}`;
  },
});

test('a real dispatch whose conversation has written, and gone quiet, is published idle', () => {
  // The positive half: with the handle's own file present and old, every
  // condition of `idle` holds, so the loop's own watcher must publish it.
  const name = 'monitor-spoken';
  const run = conversationDesk(name, { spoken: true });
  try {
    const records = waitFor(run.findingsFile, (r) => r.some((x) => x.finding === 'idle'));
    assert.ok(records.some((x) => x.finding === 'idle'),
      `a worker whose own transcript was silent past the window was never published idle: ${JSON.stringify(records)}`);
  } finally {
    run.sb.cleanup();
  }
});

test('a real dispatch whose conversation has not written is never published idle', () => {
  // The negative half: the same desk with no file under the handle. The
  // previous slice's silence is not this worker's. `clear`, published by the
  // wrapper on the worker's exit, is correct and is not the subject, as in
  // the dirty-file test above.
  const name = 'monitor-unspoken';
  const run = conversationDesk(name, { spoken: false });
  const exitFile = path.join(run.worktree, '.plot-worker.exit');
  try {
    const deadline = Date.now() + 30_000;
    while (!fs.existsSync(exitFile) && Date.now() < deadline) execFileSync('sleep', ['0.2']);
    assert.ok(fs.existsSync(exitFile), 'the worker never finished, so its silence proves nothing');
    const records = fs.existsSync(run.findingsFile)
      ? fs.readFileSync(run.findingsFile, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l))
      : [];
    assert.equal(records.filter((x) => x.finding === 'idle').length, 0,
      `a worker whose conversation never wrote was published idle on the previous slice's silence: ${JSON.stringify(records)}`);
  } finally {
    run.sb.cleanup();
  }
});
