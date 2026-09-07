import { describe, it, expect } from 'vitest';
import {
  reapProblems,
  isReapableTree,
  firstReapRefusal,
  refDeletionProblems,
  firstRefRefusal,
  finishedWith,
  treeIsThere,
  treeHasVanished,
  type TreeReadings,
  type RefReadings,
  type FinishedWithReadings,
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

/**
 * A merged branch nobody is using, with its worktree read.
 *
 * The base case answers `false` to every condition — nothing holds this desk —
 * so each test below names the ONE reading it changes.
 */
const desk = (over: Partial<FinishedWithReadings> = {}): FinishedWithReadings => ({
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
  tree: 'present',
  ...over,
});

describe('finishedWith — one rule, and each caller decides', () => {
  it('answers every condition both scripts apply', () => {
    // The whole point: eight conditions in one place. `plot-reap.sh` applies
    // five and `plot-release-refs.sh` applies its own set, and until this rule
    // existed the difference was visible only by reading both scripts.
    //
    // `vanished` is deliberately NOT among them and is asserted separately
    // below: the eight say something holds the desk, and it says there is no
    // desk to hold.
    const { vanished: _report, ...conditions } = finishedWith(desk());
    expect(Object.keys(conditions).sort()).toEqual([
      'blockedMarker',
      'checkedOut',
      'givenUp',
      'liveWorker',
      'noMergedPr',
      'onDefaultBranch',
      'openPr',
      'uncommittedChanges',
    ]);
  });

  it('holds nothing against a merged desk nobody is using', () => {
    expect(finishedWith(desk())).toEqual({
      givenUp: 'false',
      noMergedPr: 'false',
      openPr: 'false',
      checkedOut: 'false',
      onDefaultBranch: 'false',
      liveWorker: 'false',
      uncommittedChanges: 'false',
      blockedMarker: 'false',
      vanished: 'false',
    });
  });

  describe('each condition answers alone', () => {
    it('names a branch somebody gave up', () => {
      expect(finishedWith(desk({ givenUp: true })).givenUp).toBe('true');
    });

    it('names unlanded work', () => {
      expect(finishedWith(desk({ merge: 'not-merged' })).noMergedPr).toBe('true');
    });

    it('reads an unreachable host as unlanded, because silence is not a merge', () => {
      // The same direction `reapProblems` fails in. This is a HOST reading and
      // not a tree one, so it stays two-valued: both callers refuse either way.
      expect(finishedWith(desk({ merge: 'unreachable' })).noMergedPr).toBe('true');
    });

    it('names an open PR, even where an older PR of the branch merged', () => {
      // `changeset-release/main` carries both readings at once, which is why
      // `openPr` is measured rather than derived from `merge`.
      const both = finishedWith(desk({ merge: 'merged', openPr: true }));
      expect(both.openPr).toBe('true');
      expect(both.noMergedPr).toBe('false');
    });

    it('names a branch a worktree is sitting on', () => {
      expect(finishedWith(desk({ checkedOut: true })).checkedOut).toBe('true');
    });

    it('names the default branch, whether by name or by being the main checkout', () => {
      expect(finishedWith(desk({ branch: 'main' })).onDefaultBranch).toBe('true');
      expect(finishedWith(desk({ isMain: true })).onDefaultBranch).toBe('true');
    });

    it('names a live worker', () => {
      expect(finishedWith(desk({ workerPid: '4242' })).liveWorker).toBe('true');
    });

    it('names uncommitted work', () => {
      expect(finishedWith(desk({ dirtyPath: 'src/a.ts' })).uncommittedChanges).toBe('true');
    });

    it('names a question waiting for a person', () => {
      expect(finishedWith(desk({ blockedMarker: true })).blockedMarker).toBe('true');
    });
  });

  describe('the two differences that were only visible by reading both scripts', () => {
    it('an open PR keeps a ref and does NOT keep a checkout', () => {
      // `plot-release-refs.sh` refuses `pr_open`; `plot-reap.sh` has never
      // asked it. The rule states the condition, and the reaper's own verdict
      // is unmoved by it — asserted here against `reapProblems` itself.
      const open = desk({ openPr: true });
      expect(finishedWith(open).openPr).toBe('true');
      expect(reapProblems(open)).toEqual([]);
    });

    it('a live worker pid keeps a checkout and says NOTHING about a ref', () => {
      // The mirror image. `plot-reap.sh` refuses a live pid; the ref-deleter
      // never asked one until 2026-09-06. The condition is stated either way,
      // and reading it is the caller's decision rather than this rule's.
      const alive = desk({ workerPid: '4242' });
      expect(finishedWith(alive).liveWorker).toBe('true');
      expect(refusalsOf(alive)).toContain('live-worker');
    });
  });

  describe('a reading that cannot be taken answers unknown', () => {
    // Measured 2026-09-06: 22 of 32 remote branches have no worktree — 69% —
    // and four of the reaper's five conditions need one. A boolean would invent
    // an answer on two branches in three, for the operation that cannot be
    // undone.
    const noTree = desk({ tree: 'absent' });

    it('says unknown for the four the tree answers', () => {
      const got = finishedWith(noTree);
      expect(got.liveWorker).toBe('unknown');
      expect(got.uncommittedChanges).toBe('unknown');
      expect(got.blockedMarker).toBe('unknown');
    });

    it('still answers the conditions a tree is not needed for', () => {
      // The majority case must not go dark. The host and the plan answer these
      // with no checkout in existence.
      const got = finishedWith(desk({ tree: 'absent', givenUp: true, merge: 'not-merged' }));
      expect(got.givenUp).toBe('true');
      expect(got.noMergedPr).toBe('true');
      expect(got.onDefaultBranch).toBe('false');
      expect(got.checkedOut).toBe('false');
    });

    it('refuses nothing, so an unaskable condition disables neither caller', () => {
      // Refusing on silence is the estate's rule for an unreachable HOST.
      // Applied here it would block deletion on 69% of branches and make the
      // ref-deleter useless exactly where it is needed.
      expect(() => finishedWith(noTree)).not.toThrow();
      expect(Object.values(finishedWith(noTree))).toContain('unknown');
    });

    it('distinguishes an unread tree from a tree read and found clean', () => {
      // `dirtyPath: ''` alone means both, which is why `tree` is a reading.
      expect(finishedWith(desk({ tree: 'present' })).uncommittedChanges).toBe('false');
      expect(finishedWith(desk({ tree: 'absent' })).uncommittedChanges).toBe('unknown');
    });
  });

  describe('a vanished tree — git lists a desk whose directory is gone', () => {
    // Measured 2026-09-06: 3 of 20 worktrees on this estate were prunable, and
    // the reaper's five refusals could see none of them, since every one
    // measures something *in* a tree that is not there.
    const vanished = desk({ tree: 'vanished' });

    it('reports it, and it is not one of the conditions', () => {
      // A REPORT, NOT A REFUSAL. The eight conditions say something holds the
      // desk; this says there is no desk to hold, and `git worktree prune` is
      // the repair rather than a person going to look.
      expect(finishedWith(vanished).vanished).toBe('true');
      expect(finishedWith(desk()).vanished).toBe('false');
      expect(finishedWith(desk({ tree: 'absent' })).vanished).toBe('false');
    });

    it('makes the four tree-sourced conditions unknown, like an absent tree', () => {
      // The prior question is answered first: there is no directory, so the
      // readings that would come from one cannot be taken. Same answer as
      // `absent` for the same reason — nothing to measure.
      const got = finishedWith(vanished);
      expect(got.liveWorker).toBe('unknown');
      expect(got.uncommittedChanges).toBe('unknown');
      expect(got.blockedMarker).toBe('unknown');
    });

    it('still answers the conditions no tree is needed for', () => {
      const got = finishedWith(
        desk({ tree: 'vanished', givenUp: true, merge: 'not-merged' }),
      );
      expect(got.givenUp).toBe('true');
      expect(got.noMergedPr).toBe('true');
      expect(got.onDefaultBranch).toBe('false');
    });

    it('reads a stale reading from the tree as unknown rather than as true', () => {
      // THE CASE THAT WOULD LIE. A caller carrying last pass's pid into a
      // vanished tree must not be told a worker is alive in a directory that
      // does not exist — the reading is unavailable, not affirmative.
      const stale = desk({ tree: 'vanished', workerPid: '4242', dirtyPath: 'a.ts' });
      expect(finishedWith(stale).liveWorker).toBe('unknown');
      expect(finishedWith(stale).uncommittedChanges).toBe('unknown');
    });

    it('answers the three presences distinctly', () => {
      // `absent` means no desk was ever made; `vanished` means git lists one
      // that is gone; `present` means there is a directory to read. Only the
      // middle one has a repair, which is why it is its own word.
      expect(treeIsThere('present')).toBe(true);
      expect(treeIsThere('absent')).toBe(false);
      expect(treeIsThere('vanished')).toBe(false);
      expect(treeHasVanished('vanished')).toBe(true);
      expect(treeHasVanished('absent')).toBe(false);
      expect(treeHasVanished('present')).toBe(false);
    });

    it('leaves the five refusals untouched — the reaper still decides them', () => {
      // `prunable` joins the rule as a reading; it removes nothing. A tree that
      // is present and unlanded refuses exactly as it did.
      expect(refusalsOf(landed({ merge: 'not-merged' }))).toContain('no-merged-pr');
      expect(refusalsOf(landed({ workerPid: '1' }))).toContain('live-worker');
    });
  });

  it('changes neither script, because it decides nothing', () => {
    // The defect is that the difference between the two scripts is INVISIBLE,
    // not that it is wrong. A rule that permitted or refused would widen a
    // licence written narrow on purpose, under a refactor's name.
    const every = desk({
      givenUp: true, merge: 'not-merged', openPr: true, checkedOut: true,
      branch: 'main', workerPid: '7', dirtyPath: 'a', blockedMarker: true,
    });
    // Every CONDITION holds; `vanished` is false because this desk's tree is
    // present — which is what makes the eight answerable in the first place.
    const { vanished: report, ...conditions } = finishedWith(every);
    expect(Object.values(conditions).every((v) => v === 'true')).toBe(true);
    expect(report).toBe('false');
    // And the two existing verdicts are untouched by its existence.
    expect(refusalsOf(every)).toEqual([
      'live-worker', 'blocked-marker', 'uncommitted-changes',
      'on-default-branch', 'no-merged-pr',
    ]);
    expect(refDeletionProblems(every).map((p) => p.refusal)).toEqual([
      'given-up', 'no-merged-pr', 'open-pr', 'checked-out',
      'on-default-branch', 'live-worker', 'uncommitted-changes', 'blocked-marker',
    ]);
  });
});
