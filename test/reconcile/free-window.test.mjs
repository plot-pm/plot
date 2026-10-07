// AN AGENT SAYS WHEN IT IS FREE — asserted by catching the window while it is
// open, in a real hopping worker.
//
// `free = process alive AND manifest names no branch`. The second half was
// unreachable: `plot-worker-loop.sh` calls `seal_declaration` the moment a
// branch is done and `update_manifest_on_hop` only after `--next` answers and a
// worktree is built, and between those two points the manifest still named the
// slice the agent had just finished. `isFree`'s empty-branch arm — written,
// exported and unit-tested since `a-dispatch-asks-for-a-free-agent` — had no
// production caller that could ever satisfy it.
//
// THE WINDOW IS TRANSIENT, SO IT IS OBSERVED FROM INSIDE. The exit trap removes
// the manifest on every path, so nothing survives the loop to read afterwards,
// and a test that inspected the file when the loop returned would assert about
// an absence rather than about the empty value.
//
// THE SHIM PLAYS THE REGISTRY, and since `the-registry-queues-a-brief` that is
// the honest shape rather than a convenience. The agent no longer calls
// `--next`: it reads the branch the registry wrote into its manifest. So the
// scan the loop still runs — `--why-nothing`, on the way into a wait — is
// wrapped by a shim that does exactly what the daemon does at that moment:
// snapshot what the registry would read, then hand over the next slice by
// writing `branch`. The snapshot is the evidence for the window; the write is
// the hand-over, and the hop that follows is the proof it was taken.
//
// THE COPY IS THE WHOLE DIRECTORY because `script_dir` is the loop's own
// location and every helper resolves from it — shimming one script in place
// would edit the repo under a running fleet.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const scripts = path.join(here, '..', '..', 'skills', 'plot', 'scripts');

const git = (cwd, ...args) => execFileSync('git', args, { encoding: 'utf8', cwd });

/**
 * A bare origin, a clone, and an approved two-wave plan: `feature/seam` gates
 * `feature/api` — the same shape `declaration-hop.test.mjs` uses, and for the
 * same reason. The second wave must be BLOCKED until the first lands, or the
 * worker "hops" onto work that was never gated and the window it passes through
 * proves nothing.
 */
function sandbox() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-freewin-'));
  const origin = path.join(root, 'origin.git');
  const work = path.join(root, 'work');
  git(root, 'init', '--bare', '-q', '-b', 'main', origin);
  git(root, 'clone', '-q', origin, work);
  git(work, 'config', 'user.email', 'test@example.invalid');
  git(work, 'config', 'user.name', 'Plot Test');
  git(work, 'config', 'commit.gpgsign', 'false');

  fs.writeFileSync(path.join(work, 'CLAUDE.md'), `# Fixture project

## Plot Config

- **Plan directory:** docs/plans/
- **Active index:** docs/plans/active/
- **Worker bound:** 600
`);
  fs.mkdirSync(path.join(work, 'docs', 'plans'), { recursive: true });
  fs.writeFileSync(path.join(work, 'docs', 'plans', '2026-09-02-freewin.md'), `# Free window

## Status

- **Phase:** Approved
- **Type:** feature
- **Review:** pr
- **Impl:** own branches

## Branches

### Tracer
- \`feature/seam\` — thin slice

### Implementation
- \`feature/api\` — blocked behind the seam
`);
  git(work, 'add', '-A');
  git(work, 'commit', '-qm', 'plan');
  git(work, 'push', '-q', 'origin', 'main');
  // The JS loop refuses to take up a desk that holds untracked files, so the
  // fixture's own `.plot/` and `.plot-worker.*` stay out of `git status`.
  // A fresh clone has no `.git/info/` yet, so it is made before the append.
  fs.mkdirSync(`${work}/.git/info`, { recursive: true });
  fs.appendFileSync(`${work}/.git/info/exclude`, '.plot/\n.plot-worker.*\n');
  return { root, origin, work };
}

/** Claim a branch the way the dispatcher does, and hand the worker a desk. */
function claim(sb, branch) {
  const wtRoot = path.join(sb.root, 'worktrees');
  fs.mkdirSync(wtRoot, { recursive: true });
  const wt = path.join(wtRoot, `plot-wt-${branch.replace(/\//g, '-')}`);
  git(sb.work, 'worktree', 'add', '-q', '-b', branch, wt, 'origin/main');
  git(wt, 'commit', '-q', '--allow-empty', '-m', `plot: claim ${branch}`);
  git(wt, 'push', '-qu', 'origin', branch);
  return { wt, wtRoot };
}

/**
 * A process that plays the registry: it polls the manifest, and the first time
 * the manifest names no branch it snapshots what the registry would read and
 * HANDS OVER the next slice by writing `branch`.
 *
 * IT IS THE REGISTRY, ACTING WHERE THE REGISTRY ACTS. A daemon tick finds an
 * agent free when its manifest names no branch and matches it; this watcher
 * does the same from outside the loop, so it holds for the shell loop and the
 * JS loop alike — neither is asked to call anything for the test's sake. The
 * write is the whole of `agent-assign`: no second file, no socket, one field.
 *
 * IT HANDS OVER ONCE, the way the pool does: a second write would re-hand a
 * slice the agent already holds, the double assignment `matchQueue` makes
 * unreachable. The write is a rename, so the loop never reads half a manifest.
 */
function registryWatcher(snapshotLog, manifest, handOver) {
  const script = `
    const fs = require('fs');
    const [manifest, handOver, snapshotLog] = process.argv.slice(1);
    const tick = () => {
      let text;
      try { text = fs.readFileSync(manifest, 'utf8'); } catch { return; }
      let m;
      try { m = JSON.parse(text); } catch { return; }
      if (m.branch !== '') return;
      fs.appendFileSync(snapshotLog, text + '\\n--SNAP--\\n');
      m.branch = handOver;
      fs.writeFileSync(manifest + '.watch-tmp', JSON.stringify(m, null, 2) + '\\n');
      fs.renameSync(manifest + '.watch-tmp', manifest);
      clearInterval(timer);
    };
    const timer = setInterval(tick, 100);
  `;
  return spawn(process.execPath, ['-e', script, manifest, handOver, snapshotLog], { stdio: 'ignore' });
}

/**
 * The fixture agent: it commits, pushes, and LANDS its slice as a merge commit.
 *
 * IT STILL LANDS THE SLICE, even though the hop no longer depends on the scan
 * offering anything. The merge is what makes the hand-over LEGITIMATE rather
 * than merely possible: `feature/api` is blocked behind `feature/seam`, and a
 * registry handing it over before the seam landed would be handing out a slice
 * `isClaimable` refuses. The fixture plays a correct registry, so it waits for
 * the same fact a real one reads.
 */
const prompt = (work) => `set -e
echo "$PLOT_BRANCH" > "$PLOT_WORKTREE/work-\${PLOT_BRANCH##*/}.txt"
git -C "$PLOT_WORKTREE" add -A
git -C "$PLOT_WORKTREE" commit -qm "work on $PLOT_BRANCH"
git -C "$PLOT_WORKTREE" push -q origin "$PLOT_BRANCH"
git -C ${work} fetch -q origin
git -C ${work} merge -q --no-ff -m "Merge $PLOT_BRANCH" "origin/$PLOT_BRANCH"
git -C ${work} push -q origin main
`;

test('free window: the manifest names no branch between the finish and the hop', () => {
  const sb = sandbox();
  try {
    const { wt, wtRoot } = claim(sb, 'feature/seam');
    const snapshotLog = path.join(sb.root, 'snapshots.txt');
    const dir = scripts;

    // PRECONDITION: wave 2 must be blocked, or the hop is over ungated work.
    const before = execFileSync('bash', [path.join(dir, 'plot-fleet-scan.sh'), '--offline', 'freewin'],
      { encoding: 'utf8', cwd: sb.work });
    assert.match(before, /Implementation — blocked/,
      'precondition: the second wave must be blocked, or the hop proves nothing');

    const manifestDir = path.join(sb.work, '.plot', 'agents');
    fs.mkdirSync(manifestDir, { recursive: true });
    const manifest = path.join(manifestDir, 'sess-freewin.json');
    fs.writeFileSync(manifest, JSON.stringify({
      session: 'sess-freewin',
      resumeId: 'sess-freewin',
      branch: 'feature/seam',
      worktree: wt,
      command: 'plot-worker-loop.sh',
      pid: '4242',
      wrapperPid: '4241',
      workerMonitorPid: '',
      agentMonitorPid: '',
      buildMonitorPid: '',
      attempts: 0,
      startedAt: '2026-09-02T09:00:00Z',
    }, null, 2) + '\n');

    fs.mkdirSync(path.join(wt, '.plot'), { recursive: true });
    fs.writeFileSync(path.join(wt, '.plot', 'worker-prompt.sh'), prompt(sb.work));

    // THE LOOP ENDS ON ITS BOUND, NOT ON SILENCE. Since
    // `an-agent-waits-for-work` an agent handed nothing WAITS rather than
    // exits, so this fixture — whose plan has exactly two slices and both of
    // them done once the hop completes — would never return. The wait is
    // bounded to one poll here, and the loop then exits 124 the way a real one
    // does when `Worker bound` runs out while it is free. `execFileSync` throws
    // on that, so it is caught: the exit code is not what any assertion below
    // is about.
    const watcher = registryWatcher(snapshotLog, manifest, 'feature/api');
    try {
      execFileSync('bash', [path.join(dir, 'plot-worker-loop.sh')], {
        cwd: wt,
        encoding: 'utf8',
        timeout: 120000,
        env: {
          ...process.env,
          PLOT_BRANCH: 'feature/seam',
          PLOT_WORKTREE: wt,
          PLOT_SLUG: 'freewin',
          PLOT_MANIFEST_FILE: manifest,
          // ONE POLL IS ENOUGH TO TAKE THE HAND-OVER, and the budget must
          // allow it: the shim writes the assignment on the way INTO the wait,
          // so the loop has to reach its first poll to read it. A one-second
          // budget expires before that poll and the agent ends free — which is
          // correct behaviour and not what this test is about.
          PLOT_WAIT_POLL_SECONDS: '1',
          PLOT_WAIT_BUDGET_SECONDS: '6',
        },
      });
    } catch (err) {
      assert.equal(err.status, 124,
        'the loop may only end on its own bound here, never on any other failure');    } finally {
      watcher.kill();
    }

    // THE HOP HAPPENED, AND IT HAPPENED BECAUSE THE SLICE WAS HANDED OVER.
    // This assertion carries more than it used to: the agent asks nothing and
    // selects nothing, so the only way `feature/api` can have run is that the
    // shim wrote it into the manifest and the loop read it back. Since
    // `an-agent-decides-create-or-reset` it also happens WITHOUT a second desk.
    assert.ok(fs.existsSync(path.join(wt, 'work-api.txt')),
      'the agent took the slice the registry handed it, and there is a window to have passed through');
    assert.equal(fs.existsSync(path.join(wtRoot, 'plot-wt-feature-api')), false,
      'the hop resets the desk it holds; a second desk would mean it did not');

    const snaps = fs.readFileSync(snapshotLog, 'utf8')
      .split('\n--SNAP--\n').filter((s) => s.trim() !== '').map((s) => JSON.parse(s));
    assert.ok(snaps.length >= 1, 'the registry read the manifest inside the window');

    // THE WINDOW IS OPEN. Every snapshot is taken between `seal_declaration`
    // and `update_manifest_on_hop`, and in every one the agent holds nothing —
    // which is the fact `free` is derived from and the fact that did not exist
    // before this slice.
    assert.equal(snaps[0].branch, '',
      'between finishing a slice and being handed the next, the manifest names no branch');

    // ONLY `branch`. The desk has not moved, and both the transcript join and
    // the liveness check are keyed on the worktree path — clearing it would
    // take an agent's identity with its slice.
    assert.equal(snaps[0].worktree, wt, 'the desk still names where the agent is sitting');
    assert.equal(snaps[0].session, 'sess-freewin', 'the identity survives the finish');
    assert.equal(snaps[0].resumeId, 'sess-freewin', 'the resume handle survives the finish');
    assert.equal(snaps[0].pid, '4242', 'the launch facts survive the finish');
    assert.equal(snaps[0].attempts, 0, 'the supervisor budget survives the finish');
    assert.equal(snaps[0].startedAt, '2026-09-02T09:00:00Z', 'the launch time survives the finish');
  } finally {
    fs.rmSync(sb.root, { recursive: true, force: true });
  }
});
