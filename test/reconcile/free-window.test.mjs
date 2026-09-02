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
// an absence rather than about the empty value. `plot-fleet-scan.sh --next` is
// the one thing that runs INSIDE the window, so the scripts directory is copied
// and the scan replaced by a shim that snapshots the manifest and then delegates
// to the real one. The snapshot is the evidence: it is a byte-for-byte copy of
// what the registry would have read at that instant.
//
// THE COPY IS THE WHOLE DIRECTORY because `script_dir` is the loop's own
// location and every helper resolves from it — shimming one script in place
// would edit the repo under a running fleet.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
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
 * The scripts directory, copied, with `plot-fleet-scan.sh` wrapped in a shim
 * that appends the manifest's current bytes to a log before delegating.
 *
 * IT DELEGATES RATHER THAN ANSWERING. The real scan decides whether the hop
 * happens at all, and a stub that invented an answer would test the shim.
 */
function shimmedScripts(root, snapshotLog) {
  const dir = path.join(root, 'scripts');
  fs.cpSync(scripts, dir, { recursive: true });
  const real = path.join(dir, 'plot-fleet-scan.real.sh');
  fs.renameSync(path.join(dir, 'plot-fleet-scan.sh'), real);
  fs.writeFileSync(path.join(dir, 'plot-fleet-scan.sh'), `#!/usr/bin/env bash
# Snapshot the manifest as the registry would read it right now, then delegate.
if [ -n "\${PLOT_MANIFEST_FILE:-}" ] && [ -f "\$PLOT_MANIFEST_FILE" ]; then
  cat "\$PLOT_MANIFEST_FILE" >> ${JSON.stringify(snapshotLog)}
  printf '\\n--SNAP--\\n' >> ${JSON.stringify(snapshotLog)}
fi
exec bash ${JSON.stringify(real)} "\$@"
`, { mode: 0o755 });
  return dir;
}

/**
 * The fixture agent: it commits, pushes, and LANDS its slice as a merge commit,
 * which is what opens the second wave between the loop's two `--next` calls. A
 * fast-forward would leave branch and main at the same oid, which the scan reads
 * as `open` — the second wave would never open and the worker would never hop.
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
    const dir = shimmedScripts(sb.root, snapshotLog);

    // PRECONDITION: wave 2 must be blocked, or the hop is over ungated work.
    const before = execFileSync('bash', [path.join(dir, 'plot-fleet-scan.real.sh'), '--offline', 'freewin'],
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
      },
    });

    // THE HOP HAPPENED: only the hop creates the second desk.
    assert.ok(fs.existsSync(path.join(wtRoot, 'plot-wt-feature-api')),
      'precondition: the worker must have hopped, or there is no window to have passed through');

    const snaps = fs.readFileSync(snapshotLog, 'utf8')
      .split('\n--SNAP--\n').filter((s) => s.trim() !== '').map((s) => JSON.parse(s));
    assert.ok(snaps.length >= 1, 'the scan ran inside the window and snapshotted the manifest');

    // THE WINDOW IS OPEN. Every snapshot is taken between `seal_declaration`
    // and `update_manifest_on_hop`, and in every one the agent holds nothing —
    // which is the fact `free` is derived from and the fact that did not exist
    // before this slice.
    for (const snap of snaps) {
      assert.equal(snap.branch, '',
        'between finishing a slice and being handed the next, the manifest names no branch');
    }

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
