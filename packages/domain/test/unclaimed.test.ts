import { describe, it, expect } from 'vitest';
import {
  isUnclaimedTree,
  dispositionOf,
  unclaimedTrees,
  scanCostOf,
  unclaimedNotice,
  SCAN_COST_MS_PER_TREE,
  type RegisteredTreeReadings,
} from '../src/rules/unclaimed.js';

/**
 * A worktree in `/private/tmp` that nobody dispatched — the population the plan
 * measured twelve of.
 *
 * The base case is the finding on purpose: every test below names the ONE
 * reading it changes, so what keeps a tree out of the report is visible in the
 * test rather than buried in a fixture.
 */
const leftover = (over: Partial<RegisteredTreeReadings> = {}): RegisteredTreeReadings => ({
  path: '/private/tmp/wt818',
  branch: '',
  isMain: false,
  prunable: false,
  registered: false,
  planNamed: false,
  dirtyCount: 0,
  ...over,
});

describe('isUnclaimedTree — three claims, and each refuses on its own', () => {
  it('names a hand-made tree nobody registered and no plan slices', () => {
    expect(isUnclaimedTree(leftover())).toBe(true);
  });

  it('keeps the main checkout, which is the repository', () => {
    expect(isUnclaimedTree(leftover({ isMain: true }))).toBe(false);
  });

  it('keeps a desk the registry names', () => {
    expect(isUnclaimedTree(leftover({ registered: true }))).toBe(false);
  });

  it('keeps a DETACHED desk the registry names', () => {
    // The plan read "a detached tree can never be claimed, so it is unclaimed
    // by construction". Measured 2026-09-09 on this estate, two of six
    // registered agents held a detached desk, because `--start` cuts a free
    // agent's tree detached at `origin/<main>`. The registration is the claim.
    expect(isUnclaimedTree(leftover({ branch: '', registered: true }))).toBe(false);
  });

  it('keeps a tree on a branch some plan slices, with no manifest at all', () => {
    // A `kill -9` between `git worktree add` and the registry write leaves
    // exactly this: no manifest, and a plan that still names the branch.
    expect(isUnclaimedTree(leftover({ branch: 'feature/one', planNamed: true }))).toBe(false);
  });

  it('names a prunable entry, because every scan still walks it', () => {
    expect(isUnclaimedTree(leftover({ prunable: true }))).toBe(true);
  });
});

describe('dispositionOf — what a person may do, and never what this does', () => {
  it('prints the removal command for a clean tree', () => {
    expect(dispositionOf(leftover())).toEqual({
      disposition: 'remove',
      command: 'git worktree remove /private/tmp/wt818',
    });
  });

  it('names a dirty tree for a person and prints NO command', () => {
    // The reaper's own refusal: the case where the guard is wrong is the case
    // where destruction cannot be undone.
    expect(dispositionOf(leftover({ dirtyCount: 3 }))).toEqual({
      disposition: 'read-it',
      command: '',
    });
  });

  it('prunes a vanished directory, whatever else was measured of it', () => {
    // Git's own answer, and nothing inside the tree can overturn it — there is
    // nothing in there to read.
    expect(dispositionOf(leftover({ prunable: true, dirtyCount: 9 }))).toEqual({
      disposition: 'prune',
      command: 'git worktree prune',
    });
  });
});

describe('unclaimedTrees — the findings, in the order git listed them', () => {
  it('reports nothing on an estate where every worktree is dispatched', () => {
    const claimed = [
      leftover({ path: '/estate', isMain: true }),
      leftover({ path: '/estate/.worktrees/one', branch: 'feature/one', registered: true }),
      leftover({ path: '/estate/.worktrees/free-a', registered: true }),
    ];
    expect(unclaimedTrees(claimed)).toEqual([]);
  });

  it('reports nothing over no trees at all', () => {
    expect(unclaimedTrees([])).toEqual([]);
  });

  it('carries the path, the branch and the dirt of each finding', () => {
    const findings = unclaimedTrees([
      leftover({ path: '/private/tmp/wt818' }),
      leftover({ path: '/private/tmp/wt819', branch: 'feature/two', dirtyCount: 4 }),
    ]);
    expect(findings).toEqual([
      {
        path: '/private/tmp/wt818',
        branch: '',
        dirtyCount: 0,
        disposition: 'remove',
        command: 'git worktree remove /private/tmp/wt818',
      },
      {
        path: '/private/tmp/wt819',
        branch: 'feature/two',
        dirtyCount: 4,
        disposition: 'read-it',
        command: '',
      },
    ]);
  });
});

describe('scanCostOf — the number that connects the finding to the timeout', () => {
  it('costs nothing where nothing is carried', () => {
    expect(scanCostOf([])).toBe(0);
  });

  it('charges the measured per-worktree cost of one scan', () => {
    const twelve = unclaimedTrees(
      Array.from({ length: 12 }, (_, i) => leftover({ path: `/private/tmp/wt${i}` })),
    );
    expect(scanCostOf(twelve)).toBe(Math.round(12 * SCAN_COST_MS_PER_TREE));
    expect(scanCostOf(twelve)).toBe(79);
  });

  it('charges a dirty tree exactly what it charges a clean one', () => {
    // The cost is the walk, and the walk does not care whether a person may
    // remove the tree.
    const clean = unclaimedTrees([leftover({ path: '/a' })]);
    const dirty = unclaimedTrees([leftover({ path: '/b', dirtyCount: 7 })]);
    expect(scanCostOf(dirty)).toBe(scanCostOf(clean));
  });
});

describe('unclaimedNotice — the sentence a person reads', () => {
  it('says nothing where every worktree is dispatched', () => {
    // Not a line of zeros: a supervisor saying `0 unclaimed worktrees` every
    // minute is a line a person learns to skip.
    expect(unclaimedNotice([])).toBe('');
  });

  it('names the count and what the scan pays for it', () => {
    const findings = unclaimedTrees(
      Array.from({ length: 12 }, (_, i) => leftover({ path: `/private/tmp/wt${i}` })),
    );
    expect(unclaimedNotice(findings)).toBe(
      '12 worktrees nobody dispatched — the scan walks all of them, 79ms every pulse',
    );
  });

  it('says worktree, singular, of one', () => {
    expect(unclaimedNotice(unclaimedTrees([leftover()]))).toBe(
      '1 worktree nobody dispatched — the scan walks all of them, 7ms every pulse',
    );
  });

  it('names the dirty ones separately, as trees for a person to read', () => {
    const findings = unclaimedTrees([
      leftover({ path: '/a' }),
      leftover({ path: '/b', dirtyCount: 2 }),
      leftover({ path: '/c', dirtyCount: 5 }),
    ]);
    expect(unclaimedNotice(findings)).toBe(
      '3 worktrees nobody dispatched — the scan walks all of them, 20ms every pulse; 2 hold uncommitted work and are for a person to read',
    );
  });
});
