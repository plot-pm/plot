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
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
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

/** Runs the loop once from `wt`, tolerating its own bound as the only way it ends. */
function runOnce(wt, manifest) {
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

test('claim push: a present remote branch keeps the registry-lock violation line', () => {
  const sb = sandbox();
  try {
    const { wt, manifest } = deskHandedTo(sb, 'feature/start', 'feature/taken');
    // A SECOND CLONE CLAIMS `feature/taken` FIRST, so origin already holds a
    // ref the desk's own claim commit does not descend from — the real
    // collision two agents handed one branch would produce.
    const other = path.join(sb.root, 'other');
    git(sb.root, 'clone', '-q', sb.origin, other);
    git(other, 'config', 'user.email', 'test@example.invalid');
    git(other, 'config', 'user.name', 'Plot Test');
    git(other, 'checkout', '-q', '-b', 'feature/taken');
    git(other, 'commit', '-q', '--allow-empty', '-m', 'plot: claim feature/taken');
    git(other, 'push', '-qu', 'origin', 'feature/taken');

    const out = runOnce(wt, manifest);
    assert.match(out, /REGISTRY LOCK VIOLATION/,
      'a genuinely present, diverged ref must still read as the lock violation it is');
    assert.equal(out.includes('origin has no such branch'), false,
      'the present case must not also print the absent-ref message');
  } finally {
    fs.rmSync(sb.root, { recursive: true, force: true });
  }
});
