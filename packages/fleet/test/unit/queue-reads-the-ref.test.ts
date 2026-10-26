import { describe, it, expect, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { queueWorldForRepo } from '../../src/server/entry/registryd-main.js';
import { removeTree as rmTree } from '../rm-tree.mjs';

// THE SUBJECT: the queue's `plans()` reading used to walk the CHECKOUT's
// working tree (`planStoreShell(context).listPlans()`), so a plan approved on
// the host stayed invisible until something fast-forwarded that checkout by
// hand — measured 2026-10-26, a 17-minute gap between a host-side approval and
// the queue noticing. `fleetPlanStore` now reads `origin/<default>` instead.
//
// Every fixture here is a REAL bare repository plus a REAL clone, because a
// self-remote (`git remote add origin .`) makes `origin/main` the SAME ref as
// `refs/heads/main` — pushing to one moves the other, so it cannot model
// staleness. A separate bare "host" and a separate clone that only FETCHES
// (never merges) is what actually leaves the local checkout behind while
// `origin/main` advances, the way an operator's un-fast-forwarded worktree
// does against a plan approved on the host.

const REPO_ROOT = new URL('../../../..', import.meta.url).pathname;
const SCRIPTS_DIR = path.join(REPO_ROOT, 'skills/plot/scripts');

const temps: string[] = [];
afterEach(() => {
  for (const d of temps.splice(0)) rmTree(d);
});

const git = (cwd: string, args: readonly string[]): void => {
  execFileSync('git', [...args], { cwd, stdio: 'ignore' });
};

const PLAN_TEXT = [
  '# A plan',
  '',
  '## Status',
  '',
  '- **State:** Approved',
  '',
  '## Slices',
  '',
  '### Only slice',
  '',
  '- `feature/alpha` — the work',
  '',
].join('\n');

/** A bare "host" repository and a clone of it, both real, both disposable. */
const hostAndClone = (): { bare: string; local: string } => {
  const bare = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-fleet-ref-bare-'));
  rmTree(bare);
  git(os.tmpdir(), ['init', '--quiet', '--bare', '--initial-branch=main', bare]);
  temps.push(bare);

  const local = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-fleet-ref-local-'));
  rmTree(local);
  git(os.tmpdir(), ['clone', '--quiet', bare, local]);
  git(local, ['config', 'user.email', 'test@example.com']);
  git(local, ['config', 'user.name', 'Test']);
  temps.push(local);

  // An empty bare repo has no commit for `clone` to check out, so `local`
  // needs its own first commit before anything can be pushed or fetched.
  fs.writeFileSync(path.join(local, 'f.txt'), 'hello\n');
  git(local, ['add', 'f.txt']);
  git(local, ['commit', '--quiet', '-m', 'init']);
  git(local, ['push', '--quiet', 'origin', 'main']);

  return { bare, local };
};

/** A second clone of the same bare repo, used to push a commit `local` never fetches-and-merges. */
const pushPlanFromElsewhere = (bare: string): void => {
  const other = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-fleet-ref-other-'));
  rmTree(other);
  git(os.tmpdir(), ['clone', '--quiet', bare, other]);
  git(other, ['config', 'user.email', 'test@example.com']);
  git(other, ['config', 'user.name', 'Test']);
  temps.push(other);

  fs.mkdirSync(path.join(other, 'docs/plans'), { recursive: true });
  fs.writeFileSync(path.join(other, 'docs/plans/2026-10-27-a-plan.md'), PLAN_TEXT);
  git(other, ['add', 'docs/plans/2026-10-27-a-plan.md']);
  git(other, ['commit', '--quiet', '-m', 'add plan']);
  git(other, ['push', '--quiet', 'origin', 'main']);
};

describe('the queue reads plans from origin/<default>, not the checkout', () => {
  it('reaches a branch named in a plan approved on the host while the local checkout stays behind', async () => {
    const { bare, local } = hostAndClone();
    pushPlanFromElsewhere(bare);

    // `local`'s HEAD and working tree are still at `init` — fetch without
    // merge is exactly what leaves a checkout stale against the ref.
    git(local, ['fetch', '--quiet', 'origin']);
    expect(fs.existsSync(path.join(local, 'docs/plans'))).toBe(false);

    const queue = queueWorldForRepo(local, SCRIPTS_DIR);
    const plans = await queue.plans();
    const branches = plans.flatMap((plan) => plan.slices.flatMap((slice) => slice.branches.map((b) => b.branch)));
    expect(branches).toContain('feature/alpha');
  });

  it('answers an empty plan list, never the working tree, when origin/<default> cannot be resolved', async () => {
    const local = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-fleet-ref-no-origin-'));
    temps.push(local);
    git(local, ['init', '--quiet', '--initial-branch=main']);
    git(local, ['config', 'user.email', 'test@example.com']);
    git(local, ['config', 'user.name', 'Test']);

    // A plan committed straight onto `local`'s own `main`, with NO `origin`
    // remote configured at all. If anything fell back to the working tree,
    // this plan is exactly what it would wrongly surface.
    fs.mkdirSync(path.join(local, 'docs/plans'), { recursive: true });
    fs.writeFileSync(path.join(local, 'docs/plans/2026-10-27-a-plan.md'), PLAN_TEXT);
    git(local, ['add', 'docs/plans/2026-10-27-a-plan.md']);
    git(local, ['commit', '--quiet', '-m', 'add plan']);

    const queue = queueWorldForRepo(local, SCRIPTS_DIR);
    const plans = await queue.plans();
    expect(plans).toEqual([]);
  });
});
