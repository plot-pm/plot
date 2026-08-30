import { describe, it, expect } from 'vitest';
import {
  reapProblems,
  isReapableTree,
  firstReapRefusal,
  type TreeReadings,
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
