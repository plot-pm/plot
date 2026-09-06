import { describe, it, expect } from 'vitest';
import {
  reapProblems,
  isReapableTree,
  firstReapRefusal,
  refDeletionProblems,
  firstRefRefusal,
  type TreeReadings,
  type RefReadings,
} from '../src/rules/reapable.js';

/**
 * A finished desk whose work landed — every refusal passes.
 *
 * The base case is the reapable one on purpose: every test below names the ONE
 * reading it changes, so what triggers a refusal is visible in the test rather
 * than buried in a fixture.
 */
const landed = (over: Partial<TreeReadings> = {}): TreeReadings => ({
  branch: 'feature/one',
  defaultBranch: 'main',
  isMain: false,
  workerPid: null,
  dirtyPath: '',
  blockedMarker: false,
  merge: 'merged',
  ...over,
});

const refusalsOf = (readings: TreeReadings) => reapProblems(readings).map((p) => p.refusal);

describe('reapProblems — a finished desk whose work landed', () => {
  it('refuses nothing when every reading passes', () => {
    expect(reapProblems(landed())).toEqual([]);
    expect(isReapableTree(landed())).toBe(true);
    expect(firstReapRefusal(landed())).toBeNull();
  });
});

describe('reapProblems — the five refusals, each triggerable alone', () => {
  it('refuses a live worker, and names the pid an operator must go and look at', () => {
    const problems = reapProblems(landed({ workerPid: '4242' }));
    expect(problems).toEqual([{ refusal: 'live-worker', detail: '4242' }]);
    expect(isReapableTree(landed({ workerPid: '4242' }))).toBe(false);
  });

  it('reads no pid as no worker — an empty pid file is not a live process', () => {
    // The pid file exists but holds nothing, which the script treats as absent.
    // Collapsing this to "a file is there, so someone is working" would refuse
    // every tree whose worker exited without clearing up.
    expect(refusalsOf(landed({ workerPid: '' }))).toEqual([]);
  });

  it('refuses uncommitted changes, and quotes the path that exists nowhere else', () => {
    const problems = reapProblems(landed({ dirtyPath: '?? .changeset/wild-pans.md' }));
    expect(problems).toEqual([
      { refusal: 'uncommitted-changes', detail: '?? .changeset/wild-pans.md' },
    ]);
  });

  it('refuses a PLOT-BLOCKED marker — a worker stopped to ask a person something', () => {
    // Reaping it discards the question along with the tree.
    expect(refusalsOf(landed({ blockedMarker: true }))).toEqual(['blocked-marker']);
  });

  it('refuses a tree sitting on the default branch, whose dispatched branch was never measured', () => {
    // `origin/main..main` is empty, so an ancestry test would clear this tree
    // for a reason that is true and says nothing about the work it was
    // dispatched for.
    expect(refusalsOf(landed({ branch: 'main' }))).toEqual(['on-default-branch']);
  });

  it('refuses the main checkout, whatever branch it holds', () => {
    expect(refusalsOf(landed({ isMain: true }))).toEqual(['on-default-branch']);
  });

  it('follows the configured default branch, not the name `main`', () => {
    expect(refusalsOf(landed({ branch: 'trunk', defaultBranch: 'trunk' }))).toEqual([
      'on-default-branch',
    ]);
    expect(refusalsOf(landed({ branch: 'main', defaultBranch: 'trunk' }))).toEqual([]);
  });

  it('refuses a branch no PR of which merged', () => {
    expect(refusalsOf(landed({ merge: 'not-merged' }))).toEqual(['no-merged-pr']);
  });
});

describe('reapProblems — the host is the authority, and silence is never permission', () => {
  it('refuses when the host could not be asked at all', () => {
    // The combination a real estate will not produce on demand: no `gh`, no
    // auth, no network. It must refuse exactly as an unmerged branch does —
    // an unreachable host answers "not merged", never "go ahead".
    expect(refusalsOf(landed({ merge: 'unreachable' }))).toEqual(['no-merged-pr']);
    expect(isReapableTree(landed({ merge: 'unreachable' }))).toBe(false);
  });

  it('keeps unreachable distinct from not-merged in the reading, though both refuse', () => {
    // The verdict is the same and the readings are not. Collapsing them at the
    // input would make a host that cannot be asked untestable — it would only
    // ever be inferred from a negative.
    const unreachable = landed({ merge: 'unreachable' });
    const notMerged = landed({ merge: 'not-merged' });
    expect(reapProblems(unreachable)).toEqual(reapProblems(notMerged));
    expect(unreachable.merge).not.toBe(notMerged.merge);
  });
});

describe('reapProblems — combinations, and the order that reports them', () => {
  it('reports every refusal that applies, not just the first', () => {
    // An operator seeing only `live-worker` would kill the worker and try
    // again, learning about the uncommitted work one refusal at a time.
    expect(
      refusalsOf(
        landed({
          workerPid: '77',
          blockedMarker: true,
          dirtyPath: 'M src/x.ts',
          branch: 'main',
          merge: 'unreachable',
        }),
      ),
    ).toEqual([
      'live-worker',
      'blocked-marker',
      'uncommitted-changes',
      'on-default-branch',
      'no-merged-pr',
    ]);
  });

  it('holds a marker and a live pid at once — neither masks the other', () => {
    // A combination the estate will not produce on demand: a worker that wrote
    // its question and is somehow still running.
    expect(refusalsOf(landed({ workerPid: '9', blockedMarker: true }))).toEqual([
      'live-worker',
      'blocked-marker',
    ]);
  });

  it('puts the live worker first, being the only signal about someone acting now', () => {
    const problems = firstReapRefusal(
      landed({ workerPid: '13', dirtyPath: 'M a.ts', merge: 'not-merged' }),
    );
    expect(problems).toEqual({ refusal: 'live-worker', detail: '13' });
  });

  it('falls to the next refusal once the more urgent one clears', () => {
    // What a caller reporting one reason per tree shows after the worker exits.
    expect(firstReapRefusal(landed({ dirtyPath: 'M a.ts', merge: 'not-merged' }))).toEqual({
      refusal: 'uncommitted-changes',
      detail: 'M a.ts',
    });
    expect(firstReapRefusal(landed({ merge: 'not-merged' }))).toEqual({
      refusal: 'no-merged-pr',
      detail: '',
    });
  });
});

/**
 * A merged branch nobody is using — every guard passes and the ref may go.
 *
 * The base case is the deletable one, for the same reason `landed` is: every
 * test below names the ONE reading it changes.
 */
const deletable = (over: Partial<RefReadings> = {}): RefReadings => ({
  branch: 'feature/one',
  defaultBranch: 'main',
  isMain: false,
  workerPid: null,
  dirtyPath: '',
  blockedMarker: false,
  merge: 'merged',
  givenUp: false,
  openPr: false,
  checkedOut: false,
  ...over,
});

const refRefusalsOf = (readings: RefReadings) =>
  refDeletionProblems(readings).map((p) => p.refusal);

describe('refDeletionProblems — a ref is not re-creatable', () => {
  it('refuses nothing when every reading passes', () => {
    expect(refDeletionProblems(deletable())).toEqual([]);
    expect(firstRefRefusal(deletable())).toBeNull();
  });

  describe('the five guards the ref-deleter already had', () => {
    it('keeps the ref of a branch somebody gave up', () => {
      // `/plot-reconcile` reads the `deferred:`/`moved:` annotation to tell
      // deliberate abandonment from a dead worker, and needs the ref to read it
      // against. A decision a person already recorded; no merge state overturns
      // it, which is why it is tested before the host is asked.
      expect(refRefusalsOf(deletable({ givenUp: true }))).toContain('given-up');
      expect(firstRefRefusal(deletable({ givenUp: true }))?.refusal).toBe('given-up');
    });

    it('keeps the ref of unlanded work', () => {
      expect(refRefusalsOf(deletable({ merge: 'not-merged' }))).toContain('no-merged-pr');
    });

    it('keeps the ref when the host could not be asked', () => {
      // Silence is never permission. The reading differs from `not-merged` and
      // the verdict does not — the same direction `reapProblems` fails in.
      expect(refRefusalsOf(deletable({ merge: 'unreachable' }))).toContain('no-merged-pr');
    });

    it('keeps a ref an OPEN PR is using, even where an older PR merged', () => {
      // `changeset-release/main` is merged repeatedly and Changesets recreates
      // and reuses it, so its ref carries a live release PR while an older PR
      // of its own has merged. Both readings are true at once, which is why
      // `openPr` is a reading rather than the negation of `merge`.
      const both = deletable({ merge: 'merged', openPr: true });
      expect(refRefusalsOf(both)).toContain('open-pr');
    });

    it('keeps a ref a worktree is sitting on', () => {
      expect(refRefusalsOf(deletable({ checkedOut: true }))).toContain('checked-out');
    });

    it('never deletes the default branch, whatever a plan says', () => {
      // A plan naming it is malformed, and acting on that is unrecoverable.
      const got = refDeletionProblems(deletable({ branch: 'main' }));
      expect(got.map((p) => p.refusal)).toEqual(['on-default-branch']);
      expect(got[0].detail).toBe('main');
    });
  });

  describe('the three the ref-deleter was blind to', () => {
    // Measured 2026-09-06: `plot-release-refs.sh` never asked about a live pid,
    // a dirty tree or a blocked marker. Deleting a ref out from under a running
    // worker is the failure that cannot be repaired.
    it('keeps a ref whose branch has a live worker, and names the pid', () => {
      const got = refDeletionProblems(deletable({ workerPid: '4242' }));
      expect(got.map((p) => p.refusal)).toContain('live-worker');
      expect(got.find((p) => p.refusal === 'live-worker')?.detail).toBe('4242');
    });

    it('keeps a ref whose tree holds uncommitted work, and names the path', () => {
      const got = refDeletionProblems(deletable({ dirtyPath: 'src/a.ts' }));
      expect(got.map((p) => p.refusal)).toContain('uncommitted-changes');
      expect(got.find((p) => p.refusal === 'uncommitted-changes')?.detail).toBe('src/a.ts');
    });

    it('keeps a ref whose tree holds a question for a person', () => {
      expect(refRefusalsOf(deletable({ blockedMarker: true }))).toContain('blocked-marker');
    });

    it('a caller with no tree to measure loses none of the five', () => {
      // The tree readings are empty when nothing was checked out, and the five
      // guards that do not need a tree must still fire. A refusal that never
      // fires must not displace one that does.
      const noTree = deletable({ workerPid: null, dirtyPath: '', blockedMarker: false });
      expect(refRefusalsOf({ ...noTree, merge: 'not-merged' })).toEqual(['no-merged-pr']);
    });
  });

  describe('all ten readings survive, and neither caller loses one', () => {
    it('the reaper keeps its five', () => {
      // `reapProblems` is untouched by the ref rule sharing its readings.
      expect(refusalsOf(landed({ workerPid: '1' }))).toContain('live-worker');
      expect(refusalsOf(landed({ blockedMarker: true }))).toContain('blocked-marker');
      expect(refusalsOf(landed({ dirtyPath: 'a' }))).toContain('uncommitted-changes');
      expect(refusalsOf(landed({ isMain: true }))).toContain('on-default-branch');
      expect(refusalsOf(landed({ merge: 'not-merged' }))).toContain('no-merged-pr');
    });

    it('the ref-deleter now asks all eight', () => {
      const every = refRefusalsOf(deletable({
        givenUp: true, merge: 'not-merged', openPr: true, checkedOut: true,
        branch: 'main', workerPid: '7', dirtyPath: 'a', blockedMarker: true,
      }));
      expect(every).toEqual([
        'given-up', 'no-merged-pr', 'open-pr', 'checked-out',
        'on-default-branch', 'live-worker', 'uncommitted-changes', 'blocked-marker',
      ]);
    });

    it('a given-up branch reports that first, before the host is asked', () => {
      // The order is the argument: a decision a person recorded outranks every
      // measurement, and a caller showing one reason must show that one.
      expect(firstRefRefusal(deletable({ givenUp: true, merge: 'not-merged' }))?.refusal)
        .toBe('given-up');
    });
  });

  it('answers about a branch and enumerates nothing — the scope stays the caller\'s', () => {
    // THE ASYMMETRY THIS RULE MUST NOT FLATTEN. A reaped checkout comes back
    // with `git worktree add`; a deleted ref does not. So the reaper is
    // slug-blind and the ref-deleter is scoped to one plan, and this rule reads
    // no plan and lists no branch — it answers about the one it was handed.
    expect(refDeletionProblems(deletable())).toEqual([]);
    expect(refDeletionProblems(deletable({ branch: 'feature/other' }))).toEqual([]);
  });
});
