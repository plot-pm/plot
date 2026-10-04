// A HAND-OVER IS CHECKED BEFORE IT IS MADE — the loop's half.
//
// #1149 measured a stale tick handing an agent a branch whose PR had already
// merged and whose remote ref was gone, which made the claim push's rejection
// read `REGISTRY LOCK VIOLATION` about a second agent that did not exist. This
// slice does not change what makes the push fail — it changes what the loop
// says when it does, and only that: an ABSENT ref prints a message naming the
// stale hand-over; a PRESENT ref keeps today's violation line unchanged,
// because that case genuinely is two agents handed one branch.
//
// THE PUSH IS DRIVEN FOR REAL, against a bare origin — cheaper than a full hop
// fixture because nothing needs to wait on a scan: the manifest names the
// target branch from the very first read, so `assigned_branch` returns it on
// the loop's first pass and the claim push is reached immediately.
//
// TWO DIFFERENT REJECTIONS, BECAUSE A PUSH TO A TRULY ABSENT REF ALWAYS
// SUCCEEDS. The "absent" case needs a server-side refusal that never creates
// the ref — a `pre-receive` hook on the bare origin, standing in for a branch
// protection rule — while the "present" case is a genuine non-fast-forward:
// a second clone claims the branch first, so the desk's own claim commit
// collides with real history already on origin.
//
// SINCE `a-release-and-a-rejected-push-name-the-agent`, A PRESENT REF ALONE IS
// NOT A LOCK VIOLATION. `claimAnswer` answers `held-by-agent` only where a
// LIVE manifest names the branch; a present ref with only a claim commit and
// no live holder is `stale-claim`, tested separately below. So the
// "registry-lock" test below now gives the other clone a live manifest too —
// the shape that actually is two agents handed one branch.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const scripts = path.join(here, '..', '..', 'skills', 'plot', 'scripts');
const loop = path.join(scripts, 'plot-worker-loop.sh');

const git = (cwd, ...args) => execFileSync('git', args, { encoding: 'utf8', cwd });

/**
 * The ambient environment with every `PLOT_*` key removed.
 *
 * **THIS TEST CAN ITSELF BE RUNNING INSIDE A `plot-worker-loop.sh` SESSION.**
 * Measured directly while writing this file: `PLOT_BRANCH`,
 * `PLOT_MANIFEST_FILE` and `PLOT_UNATTENDED` were all set in `process.env`
 * from the outer worker, and spreading that env into the child loop made it
 * run the OUTER agent's real branch on its very first pass — silently
 * reading the test's own manifest as irrelevant, because `PLOT_BRANCH` was
 * already non-empty. Every env this file hands the loop starts from this
 * base and no other.
 */
const cleanEnv = Object.fromEntries(
  Object.entries(process.env).filter(([key]) => !key.startsWith('PLOT_')),
);

/** A bare origin and a clone holding `main`, with a Plot Config and a no-op prompt. */
function sandbox() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-claimrej-'));
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
- **Worker bound:** 20
`);
  fs.mkdirSync(path.join(work, '.plot'), { recursive: true });
  // The loop sources this and the hop must complete before the prompt
  // matters, so it only needs to exist and exit cleanly.
  fs.writeFileSync(path.join(work, '.plot', 'worker-prompt.sh'), 'exit 0\n');
  git(work, 'add', '-A');
  git(work, 'commit', '-qm', 'init');
  git(work, 'push', '-q', 'origin', 'main');
  return { root, origin, work };
}

/**
 * A desk already sitting on `startBranch`, with a manifest that hands the
 * agent `targetBranch` from the very first read — so `assigned_branch`
 * answers immediately and the loop reaches the claim push on its first pass,
 * without any `--next` scan.
 */
function deskHandedTo(sb, startBranch, targetBranch) {
  const wtRoot = path.join(sb.root, 'worktrees');
  fs.mkdirSync(wtRoot, { recursive: true });
  const wt = path.join(wtRoot, `plot-wt-${startBranch.replace(/\//g, '-')}`);
  git(sb.work, 'worktree', 'add', '-q', '-b', startBranch, wt, 'origin/main');
  git(wt, 'commit', '-q', '--allow-empty', '-m', `plot: claim ${startBranch}`);
  git(wt, 'push', '-qu', 'origin', startBranch);

  const manifestDir = path.join(sb.work, '.plot', 'agents');
  fs.mkdirSync(manifestDir, { recursive: true });
  const manifest = path.join(manifestDir, 'sess-claimrej.json');
  fs.writeFileSync(manifest, JSON.stringify({
    session: 'sess-claimrej',
    resumeId: 'sess-claimrej',
    branch: targetBranch,
    worktree: wt,
    command: 'plot-worker-loop.sh',
    pid: '4242',
    wrapperPid: '4241',
    attempts: 0,
    startedAt: '2026-10-03T09:00:00Z',
  }, null, 2) + '\n');
  return { wt, manifest };
}

/** Rejects every push the bare origin receives, without creating any ref. */
function refuseEveryPush(origin) {
  const hook = path.join(origin, 'hooks', 'pre-receive');
  fs.writeFileSync(hook, '#!/bin/sh\necho "rejected by fixture hook" >&2\nexit 1\n', { mode: 0o755 });
}

/** A live process, the shape `plot_worker_state` reads as `running`. */
function spawnLive() {
  return execFileSync('bash', ['-c',
    "nohup sh -c 'sleep 300 & exec sleep 300' </dev/null >/dev/null 2>&1 & echo $!",
  ], { encoding: 'utf8' }).trim();
}

/**
 * A second agent's manifest in the SAME registry, naming `branch`, with a live
 * worker — its own desk is a REAL worktree (`git worktree add`), because
 * `plot_worker_state`'s manifest lookup resolves the registry through the
 * worktree's git metadata (`plot_main_checkout_of`), which a bare directory
 * does not carry.
 */
function liveHolderOf(sb, branch) {
  const wt = path.join(sb.root, 'worktrees', 'plot-wt-holder');
  fs.mkdirSync(path.dirname(wt), { recursive: true });
  git(sb.work, 'worktree', 'add', '-q', '--detach', wt, 'origin/main');
  const pid = spawnLive();
  const manifestDir = path.join(sb.work, '.plot', 'agents');
  fs.mkdirSync(manifestDir, { recursive: true });
  const manifest = path.join(manifestDir, 'sess-holder.json');
  fs.writeFileSync(manifest, JSON.stringify({
    session: 'sess-holder',
    resumeId: 'sess-holder',
    branch,
    worktree: wt,
    command: 'plot-worker-loop.sh',
    pid,
    wrapperPid: pid,
    attempts: 0,
    startedAt: '2026-10-03T09:00:00Z',
  }, null, 2) + '\n');
  return pid;
}

/** Runs the loop once from `wt`, tolerating its own bound as the only way it ends. */
function runOnce(wt, manifest, extraEnv = {}) {
  try {
    execFileSync('bash', [loop], {
      cwd: wt,
      encoding: 'utf8',
      timeout: 60000,
      env: {
        ...cleanEnv,
        PLOT_WORKTREE: wt,
        PLOT_MANIFEST_FILE: manifest,
        PLOT_WAIT_POLL_SECONDS: '1',
        PLOT_WAIT_BUDGET_SECONDS: '5',
        ...extraEnv,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return '';
  } catch (err) {
    // THE LOOP MAY END ON ITS OWN BOUND (124), OR ON WHATEVER FOLLOWS A
    // REJECTED PUSH (the manifest still names the same branch, so the loop
    // asks for it again and re-enters a wait this fixture's short budget also
    // ends) — either is an honest ending; the assertion is about stderr.
    return (err.stderr ?? '').toString();
  }
}

test('claim push: an absent remote branch is named, not reported as a lock violation', () => {
  const sb = sandbox();
  try {
    const { wt, manifest } = deskHandedTo(sb, 'feature/start', 'feature/gone');
    // ORIGIN REFUSES EVERY PUSH FROM HERE ON, standing in for a branch
    // protection rule — the ref is never created, so `feature/gone` stays
    // absent exactly as it would after #1149's merge-then-delete.
    refuseEveryPush(sb.origin);

    const out = runOnce(wt, manifest);
    assert.match(out, /origin has no such branch/,
      'an absent ref must be named, not folded into the lock-violation message');
    assert.equal(out.includes('REGISTRY LOCK VIOLATION'), false,
      'an absent ref is a stale hand-over, not two agents handed one branch');
  } finally {
    fs.rmSync(sb.root, { recursive: true, force: true });
  }
});

test('claim push: a present ref with a LIVE holder keeps the registry-lock violation line', () => {
  const sb = sandbox();
  let pid;
  try {
    const { wt, manifest } = deskHandedTo(sb, 'feature/start', 'feature/taken');
    // A SECOND CLONE CLAIMS `feature/taken` FIRST, so origin already holds a
    // ref the desk's own claim commit does not descend from — the real
    // collision two agents handed one branch would produce. ITS OWN MANIFEST,
    // NAMING THE BRANCH, WITH A LIVE WORKER — the fact that makes this
    // genuinely two agents handed one branch, as opposed to the stale-claim
    // shape tested separately below.
    const other = path.join(sb.root, 'other');
    git(sb.root, 'clone', '-q', sb.origin, other);
    git(other, 'config', 'user.email', 'test@example.invalid');
    git(other, 'config', 'user.name', 'Plot Test');
    git(other, 'checkout', '-q', '-b', 'feature/taken');
    // ITS OWN MESSAGE, SO ITS OWN SHA. A commit with the loop's claim message,
    // parent, author and second is byte-identical to the desk's claim commit,
    // and the desk's push then answers "Everything up-to-date" instead of
    // being rejected.
    git(other, 'commit', '-q', '--allow-empty', '-m', 'plot: claim feature/taken (the other agent)');
    git(other, 'push', '-qu', 'origin', 'feature/taken');
    pid = liveHolderOf(sb, 'feature/taken');

    const out = runOnce(wt, manifest);
    assert.match(out, /REGISTRY LOCK VIOLATION/,
      'a present ref with a live holder must still read as the lock violation it is');
    assert.equal(out.includes('origin has no such branch'), false,
      'the present case must not also print the absent-ref message');
  } finally {
    if (pid) { try { process.kill(Number(pid)); } catch { /* gone */ } }
    fs.rmSync(sb.root, { recursive: true, force: true });
  }
});

test('claim push: a stale empty claim with no live holder names the release command, not a lock violation', () => {
  // ALSO THE HOLDER-EXCLUDED-ASKER CASE: `deskHandedTo` writes the manifest
  // naming `targetBranch` (here `feature/stale`) BEFORE the push is attempted
  // — it is this agent's OWN manifest, already naming the branch it is about
  // to claim. An implementation that counted its own manifest among the
  // holders would answer `held-by-agent` here and this assertion would fail.
  const sb = sandbox();
  try {
    const { wt, manifest } = deskHandedTo(sb, 'feature/start', 'feature/stale');
    // ORIGIN ALREADY HOLDS ONE `plot: claim` COMMIT AND NO MANIFEST NAMES IT —
    // a start step outside the supervisor, #1090's shape. The desk's own claim
    // commit is a second, different claim commit (different branch name in the
    // subject's trailing text would collide on content; a distinct author date
    // keeps the two from being byte-identical), so the push is a genuine
    // non-fast-forward rather than "Everything up-to-date".
    const other = path.join(sb.root, 'other');
    git(sb.root, 'clone', '-q', sb.origin, other);
    git(other, 'config', 'user.email', 'test@example.invalid');
    git(other, 'config', 'user.name', 'Plot Test');
    git(other, 'checkout', '-q', '-b', 'feature/stale');
    git(other, 'commit', '-q', '--allow-empty', '-m', 'plot: claim feature/stale (stale start step)');
    git(other, 'push', '-qu', 'origin', 'feature/stale');

    const out = runOnce(wt, manifest);
    assert.match(out, /holds only an empty claim/);
    assert.match(out, /plot-dispatch\.sh --release feature\/stale/);
    assert.equal(out.includes('REGISTRY LOCK VIOLATION'), false,
      'a stale claim with no live holder is not two agents handed one branch');
  } finally {
    fs.rmSync(sb.root, { recursive: true, force: true });
  }
});

test('claim push: the manifest naming the rejected branch is cleared, and PLOT_BRANCH no longer runs the previous prompt', () => {
  // THE `8111e3ec` REPLAY. A loop whose `PLOT_BRANCH` names a FINISHED
  // previous slice is handed a branch whose claim push is rejected. Before
  // this slice, `continue` left `PLOT_BRANCH` naming the previous slice, so
  // the next pass's branch-holding block ran that slice's prompt again in the
  // desk this loop had just reset onto the rejected branch — sealing a
  // declaration for work the agent never did.
  const sb = sandbox();
  try {
    const { wt, manifest } = deskHandedTo(sb, 'feature/previous', 'feature/taken2');
    // The previous slice is FINISHED: it carries one real commit, so a prompt
    // run on it again would be visible as a second commit on a done slice.
    fs.writeFileSync(path.join(wt, 'done.txt'), 'finished work\n');
    git(wt, 'add', 'done.txt');
    git(wt, 'commit', '-qm', 'finished work');

    // THE PROMPT RECORDS EVERY RUN, so a second run after the rejection is
    // directly observable rather than inferred from the tree.
    fs.writeFileSync(path.join(sb.work, '.plot', 'worker-prompt.sh'),
      `echo run >> "$PLOT_WORKTREE/prompt-runs.log"\nexit 0\n`);

    // A second agent holds `feature/taken2` first, the same shape as the
    // present-ref test above, so the desk's own claim push is rejected.
    const other = path.join(sb.root, 'other');
    git(sb.root, 'clone', '-q', sb.origin, other);
    git(other, 'config', 'user.email', 'test@example.invalid');
    git(other, 'config', 'user.name', 'Plot Test');
    git(other, 'checkout', '-q', '-b', 'feature/taken2');
    git(other, 'commit', '-q', '--allow-empty', '-m', 'plot: claim feature/taken2 (the other agent)');
    git(other, 'push', '-qu', 'origin', 'feature/taken2');

    // THE LOOP'S OWN EXIT TRAP DELETES `$PLOT_MANIFEST_FILE` WHEN THE WORKER
    // LEAVES (`_cleanup_on_exit` — "Remove the manifest first — it is the
    // externally visible registration"), so a read AFTER `runOnce` returns
    // sees no file at all rather than a cleared one. A background watcher
    // copies the manifest's content on every change, so the state right after
    // the rejection — cleared, but not yet deleted by the final exit — is
    // still readable once the loop is done.
    const snapshotDir = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-claimrej-snap-'));
    const snapshot = path.join(snapshotDir, 'manifest.json');
    const watcher = spawn('bash', ['-c',
      `while true; do [ -f "$1" ] && cp "$1" "$2" 2>/dev/null; sleep 0.2; done`,
      'watcher', manifest, snapshot,
    ], { stdio: 'ignore' });
    try {
      // `PLOT_BRANCH` NAMES THE FINISHED PREVIOUS SLICE, exactly as a real loop
      // holds it going into a hop: only a SUCCESSFUL push sets it to the new
      // branch, so on entry it still carries whatever the agent worked last.
      runOnce(wt, manifest, { PLOT_BRANCH: 'feature/previous' });
    } finally {
      watcher.kill();
    }

    const runsLog = path.join(wt, 'prompt-runs.log');
    const runs = fs.existsSync(runsLog) ? fs.readFileSync(runsLog, 'utf8').trim().split('\n').filter(Boolean) : [];
    assert.deepEqual(runs, [], 'the previous slice\'s prompt must not run again after a rejected hop');
    assert.equal(git(wt, 'log', '-1', '--format=%s').trim(), 'finished work',
      'no declaration is sealed for the previous slice — its last commit is still its last');
    assert.ok(fs.existsSync(snapshot), 'the manifest existed at some point for the watcher to copy');
    assert.equal(JSON.parse(fs.readFileSync(snapshot, 'utf8')).branch, '',
      "the agent's own manifest no longer names the rejected branch");
    fs.rmSync(snapshotDir, { recursive: true, force: true });
  } finally {
    fs.rmSync(sb.root, { recursive: true, force: true });
  }
});
