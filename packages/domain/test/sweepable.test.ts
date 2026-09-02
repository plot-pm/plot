import { describe, it, expect } from 'vitest';
import {
  branchSweepProblems,
  isSweepableBranch,
  firstBranchRefusal,
  claimSweepProblems,
  isSweepableClaim,
  firstClaimRefusal,
  dirtyTreeOwner,
  isUnownedDirtyTree,
  unownedDirtyTrees,
  type LocalBranchReadings,
  type ClaimRefReadings,
  type DirtyTreeReadings,
} from '../src/rules/sweepable.js';

/**
 * A merged branch no worktree holds — the population the plan measured.
 *
 * The base case is the sweepable one on purpose: every test below names the ONE
 * reading it changes, so what triggers a refusal is visible in the test rather
 * than buried in a fixture.
 */
const landed = (over: Partial<LocalBranchReadings> = {}): LocalBranchReadings => ({
  branch: 'feature/one',
  defaultBranch: 'main',
  hasMergedPr: true,
  checkedOut: false,
  ...over,
});

describe('branchSweepProblems — the gate is the host and the checkout', () => {
  it('sweeps a merged branch that no worktree holds', () => {
    expect(branchSweepProblems(landed())).toEqual([]);
    expect(isSweepableBranch(landed())).toBe(true);
    expect(firstBranchRefusal(landed())).toBeNull();
  });

  it('keeps the default branch, whatever else is true of it', () => {
    // Acting on it is unrecoverable, so no other reading overturns it.
    expect(branchSweepProblems(landed({ branch: 'main' }))).toEqual(['default-branch']);
    expect(isSweepableBranch(landed({ branch: 'main' }))).toBe(false);
  });

  it('keeps a branch the host did not merge — unlanded work', () => {
    expect(branchSweepProblems(landed({ hasMergedPr: false }))).toEqual(['no-merged-pr']);
  });

  it('keeps a merged branch a worktree still holds', () => {
    // Deleting a branch out from under a checkout is exactly what the reaper's
    // guards exist to prevent, so this refuses on its own.
    expect(branchSweepProblems(landed({ checkedOut: true }))).toEqual(['checked-out']);
    expect(isSweepableBranch(landed({ checkedOut: true }))).toBe(false);
  });

  it('reports the most urgent refusal first when several apply', () => {
    const both = landed({ hasMergedPr: false, checkedOut: true });
    expect(branchSweepProblems(both)).toEqual(['no-merged-pr', 'checked-out']);
    expect(firstBranchRefusal(both)).toBe('no-merged-pr');
  });
});

describe('branchSweepProblems — the gate is NOT `git branch -d`', () => {
  it('sweeps a squash-merged branch, which is permanently ahead of main', () => {
    // THE DEFECT THIS PINS. `git branch -d` refuses an unmerged branch, and a
    // squash-merge rewrites the commits so the branch stays ahead of the
    // default branch forever. Measured 2026-09-02: 85 of 98 local branches on
    // this estate were merged, and `-d` would have kept all 85 for the wrong
    // reason. Nothing in the readings is ancestry, so nothing here can regress
    // to it: a branch the host merged is swept whether or not git agrees.
    expect(isSweepableBranch(landed({ hasMergedPr: true }))).toBe(true);
  });

  it('reads the host, never the PR state — a merged PR reports CLOSED', () => {
    // `hasMergedPr` is the merge timestamp, and there is deliberately no
    // `state` field to be tempted by. A caller that read `state` would answer
    // false for every squash-merged branch, which is the whole population.
    const readings = landed();
    expect(Object.keys(readings)).not.toContain('state');
    expect(isSweepableBranch(readings)).toBe(true);
  });

  it('deletes nothing when the host cannot be asked', () => {
    // An unreachable host answers "not merged", so silence is never permission.
    expect(isSweepableBranch(landed({ hasMergedPr: false }))).toBe(false);
    expect(firstBranchRefusal(landed({ hasMergedPr: false }))).toBe('no-merged-pr');
  });
});

/** An abandoned claim: empty, and a plan annotation records the decision. */
const claim = (over: Partial<ClaimRefReadings> = {}): ClaimRefReadings => ({
  branch: 'feature/two',
  isEmptyClaim: true,
  disposition: 'abandoned',
  ...over,
});

describe('claimSweepProblems — only what the scan already calls reapable', () => {
  it('sweeps an abandoned claim the plan marked deferred or moved', () => {
    expect(claimSweepProblems(claim())).toEqual([]);
    expect(isSweepableClaim(claim())).toBe(true);
    expect(firstClaimRefusal(claim())).toBeNull();
  });

  it('keeps a bare `claimed:` for a person — a slow worker and a dead one look alike', () => {
    expect(claimSweepProblems(claim({ disposition: 'unresolved' }))).toEqual(['needs-judgment']);
    expect(isSweepableClaim(claim({ disposition: 'unresolved' }))).toBe(false);
  });

  it('keeps a branch carrying real work, whatever its commit subject says', () => {
    // A human commit titled "plot: claim handling refactor" carrying real files
    // is not an empty claim. The subject alone is not evidence — the tree must
    // equal its parent's — and the caller supplies that reading.
    expect(claimSweepProblems(claim({ isEmptyClaim: false }))).toEqual(['not-an-empty-claim']);
  });

  it('refuses on both counts when a worked branch is also unresolved', () => {
    const worked = claim({ isEmptyClaim: false, disposition: 'unresolved' });
    expect(claimSweepProblems(worked)).toEqual(['not-an-empty-claim', 'needs-judgment']);
    expect(firstClaimRefusal(worked)).toBe('not-an-empty-claim');
  });
});

/** A dirty tree with nothing claiming it. */
const desk = (over: Partial<DirtyTreeReadings> = {}): DirtyTreeReadings => ({
  path: '/w/.worktrees/feature-three',
  branch: 'feature/three',
  dirtyCount: 52,
  workerPid: null,
  manifest: '',
  ...over,
});

describe('dirtyTreeOwner — the finding is the word `nobody`', () => {
  it('names nobody when neither a process nor a manifest claims the tree', () => {
    expect(dirtyTreeOwner(desk())).toBe('nobody');
    expect(isUnownedDirtyTree(desk())).toBe(true);
  });

  it('names the live pid, which outranks a manifest', () => {
    // A process observed right now beats an identity recorded once and possibly
    // outlived.
    expect(dirtyTreeOwner(desk({ workerPid: '4242', manifest: 'a1b2.json' }))).toBe('pid 4242');
    expect(isUnownedDirtyTree(desk({ workerPid: '4242' }))).toBe(false);
  });

  it('names the manifest when no process answers', () => {
    expect(dirtyTreeOwner(desk({ manifest: 'a1b2.json' }))).toBe('a1b2.json');
    expect(isUnownedDirtyTree(desk({ manifest: 'a1b2.json' }))).toBe(false);
  });

  it('reads an empty pid as no process — an empty pid file is not a live one', () => {
    expect(dirtyTreeOwner(desk({ workerPid: '' }))).toBe('nobody');
  });

  it('is not a finding about a clean tree', () => {
    // The kind is "a dirty tree nobody owns". A clean unowned tree is the
    // reaper's question, and answering it here would be a second implementation
    // of it.
    expect(isUnownedDirtyTree(desk({ dirtyCount: 0 }))).toBe(false);
  });
});

describe('unownedDirtyTrees — reported, never deleted', () => {
  it('names every unowned dirty tree with its owner as nobody', () => {
    const found = unownedDirtyTrees([
      desk(),
      desk({ path: '/w/.worktrees/feature-four', branch: 'feature/four', dirtyCount: 1 }),
      desk({ path: '/w/.worktrees/feature-five', workerPid: '99' }),
      desk({ path: '/w/.worktrees/feature-six', dirtyCount: 0 }),
    ]);
    expect(found).toEqual([
      { path: '/w/.worktrees/feature-three', branch: 'feature/three', dirtyCount: 52, owner: 'nobody' },
      { path: '/w/.worktrees/feature-four', branch: 'feature/four', dirtyCount: 1, owner: 'nobody' },
    ]);
  });

  it('produces findings and no writes — this kind has no deletion path', () => {
    // The rule returns findings rather than a decision carrying writes, which
    // is the shape that makes "reported, never deleted" checkable rather than
    // promised. The case where the guard is wrong is exactly the case where
    // destruction cannot be undone.
    const found = unownedDirtyTrees([desk()]);
    expect(found).toHaveLength(1);
    expect(found[0]).not.toHaveProperty('writes');
    expect(found.every((f) => f.owner === 'nobody')).toBe(true);
  });
});
