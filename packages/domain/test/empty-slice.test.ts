import { describe, it, expect } from 'vitest';
import { allSlicesMerged, type FleetReading, type BranchState, type SliceVerdict } from '../src/index.js';
import { sliceVerdict, sliceVerdicts } from '../src/rules/eligible.js';

/**
 * A SLICE THAT NAMES NO BRANCH, held to ONE answer by both rules that read it.
 *
 * The defect was not either rule alone — it was that they disagreed. Measured
 * 2026-09-06 across 474 slices in 207 plans:
 *
 * - `rules/eligible.ts` called a branchless slice `complete`, from
 *   `outstanding === 0` as its FIRST test, above the phase check and beyond
 *   correction by anything downstream.
 * - `rules/deliverable.ts` skipped the same shape with `continue`.
 *
 * So one rule reported finished work over a prose heading while the other
 * refused to count it, and a plan could read deliverable on a heading nobody
 * had worked. Live in the code and dormant in the estate: all 22 branchless
 * slices sat on Released or Superseded plans, and the first plan to carry one
 * before shipping would have surfaced it.
 *
 * **A test asserting one rule proves nothing here**, because either rule alone
 * was self-consistent. This file asserts the pair, which is the property that
 * was actually broken.
 *
 * The answer is `empty` rather than `complete` or a silence. It resolves by
 * EDITING THE PLAN — giving the heading a branch, or deleting it — which is
 * neither what `blocked` resolves by (merging) nor what `unapproved` resolves
 * by (approving), so it may not borrow either word.
 */

/** One slice as the pulse carries it. `[]` is the shape under test. */
const slice = (
  name: string,
  verdict: SliceVerdict,
  branches: Array<[string, BranchState]>,
) => ({
  name,
  verdict,
  branches: branches.map(([branch, state]) => ({
    branch,
    state,
    deferred: state === 'deferred',
    deferred_reason: '',
    claimed: '',
    local_dirty: false,
    local_worktree: '',
  })),
});

const pulse = (file: string, slices: ReturnType<typeof slice>[]): FleetReading => ({
  main: 'main',
  head: 'abc1234',
  plans: [{ file, slices }],
  summary: {
    plans: 1, waves: slices.length, branches: 0, claimed: 0,
    eligible: 0, blocked: 0, deferred: 0,
  },
} as FleetReading);

const PLAN = '2026-09-06-a-slices-section-can-be-satisfied-by-prose.md';

describe('an empty slice is not finished — the two rules give one answer', () => {
  it('is `empty` to eligible and `not-merged` to deliverable, for one plan shape', () => {
    // THE PAIR, in one assertion, over the one plan the defect describes: a
    // single heading under `## Slices` carrying prose and no branch.
    const verdict = sliceVerdict({ outstanding: 0, phase: 'approved', branches: 0 }, true);
    expect(verdict).toBe('empty');

    const p = pulse(PLAN, [slice('Prose only', verdict, [])]);
    expect(allSlicesMerged({ file: PLAN }, p, true)).toBe('not-merged');
  });

  it('does not call it complete under ANY phase a person can still act on', () => {
    // The old test was the FIRST one in the function, so no phase corrected it.
    // Every phase that is not finished must now withhold the word.
    for (const phase of ['draft', 'approved', 'design', 'superseded', 'UNKNOWN', '']) {
      expect(sliceVerdict({ outstanding: 0, phase, branches: 0 }, true)).toBe('empty');
    }
  });

  it('refuses delivery over an empty slice sitting beside a landed one', () => {
    // The `continue` arm's real cost: the merged slice beside it satisfied
    // `merged > 0`, so the plan read deliverable and the empty heading was
    // never counted against it.
    const p = pulse(PLAN, [
      slice('Prose only', 'empty', []),
      slice('Reached', 'complete', [['feature/a', 'merged']]),
    ]);
    expect(allSlicesMerged({ file: PLAN }, p, true)).toBe('not-merged');
  });
});

describe('an empty slice is distinguished from the shapes it was folded into', () => {
  it('keeps `complete` for a slice whose branches all merged', () => {
    // The other half of `outstanding === 0`, and the one that was always right.
    // Both count zero outstanding; only this one has a branch to count.
    expect(sliceVerdict({ outstanding: 0, phase: 'approved', branches: 2 }, true)).toBe('complete');
  });

  it('keeps `complete` for a slice holding only deferred branches', () => {
    // A DECISION, NOT A MALFORMED PLAN. Deferred branches are named work
    // somebody gave up, so `branches` counts them and the slice is not `empty`.
    // Collapsing the two would report a shelving as a plan defect.
    expect(sliceVerdict({ outstanding: 0, phase: 'approved', branches: 1 }, true)).toBe('complete');
  });

  it('leaves a finished plan\'s empty heading `complete`', () => {
    // TESTED AFTER `FINISHED_PHASES` DELIBERATELY. All 22 branchless slices in
    // this estate sit on Released or Superseded plans; a released heading is
    // history, and reporting it malformed would ask a person to edit a plan
    // that shipped. The 46 historical slices stay as written.
    expect(sliceVerdict({ outstanding: 0, phase: 'released', branches: 0 }, true)).toBe('complete');
    expect(sliceVerdict({ outstanding: 0, phase: 'delivered', branches: 0 }, true)).toBe('complete');
  });
});

describe('an empty slice does not advance the fold', () => {
  it('blocks the slice after it rather than passing `complete` along', () => {
    // `complete` is what advances the chain, and the empty heading used to
    // supply it — so a plan's second slice was offered as startable on the
    // strength of a first that had landed nothing.
    expect(sliceVerdicts([
      { outstanding: 0, phase: 'approved', branches: 0 },
      { outstanding: 1, phase: 'approved', branches: 1 },
    ])).toEqual(['empty', 'blocked']);
  });

  it('still advances past a genuinely complete first slice', () => {
    // The control: the change withholds the word from ONE shape and leaves
    // ordering otherwise as it was.
    expect(sliceVerdicts([
      { outstanding: 0, phase: 'approved', branches: 1 },
      { outstanding: 1, phase: 'approved', branches: 1 },
    ])).toEqual(['complete', 'eligible']);
  });
});
