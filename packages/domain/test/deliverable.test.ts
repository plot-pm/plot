import { describe, it, expect } from 'vitest';
import { allSlicesMerged, type FleetReading, type BranchState, type SliceVerdict } from '../src/index.js';

/**
 * The deliverable rule, tested at the domain boundary.
 *
 * These are NOT a copy of the board's `merged-waves-reach-testing.test.ts`.
 * That file stays where it is and still passes unedited, exercising the board's
 * re-export — which is the evidence that the move preserved behaviour. It
 * cannot move here: it builds its fixture with `PlanMetaSchema.parse`, the
 * board's plan contract, and the domain neither has that schema nor may import
 * it.
 *
 * So these tests do what the board's cannot: read the rule through the narrow
 * `{ file }` the domain declares, and name every branch the coverage gate
 * counts — two `unknown`, three `not-merged`, one `merged`, plus the basename
 * join the lookup depends on.
 */

/** One slice, whatever branches it holds — the state tuple is what these vary. */
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
  // `summary.waves` keeps its wire name: the board both parses and BUILDS this
  // tally, so its counter moves with those producers rather than ahead of them.
  summary: {
    plans: 1, waves: slices.length, branches: 0, claimed: 0,
    eligible: 0, blocked: 0, deferred: 0,
  },
} as FleetReading);

const PLAN = '/repo/docs/plans/2026-08-21-done-means-delivered.md';
const BASE = '2026-08-21-done-means-delivered.md';

describe('allSlicesMerged — every non-deferred branch has landed', () => {
  describe('unknown — nothing is asserted, and a caller must say so', () => {
    it('reads no pulse as unknown, never as not-merged', () => {
      // Git has said nothing, and "nothing said" is not "all merged". A cold
      // cache keeps a plan where it was.
      expect(allSlicesMerged({ file: PLAN }, null, true)).toBe('unknown');
    });

    it('reads an unfinished scan as unknown even when the plan IS present', () => {
      // A timed-out scan's `plans` array holds only what arrived, so no
      // negative may be read from it. Asked BEFORE the lookup, because the
      // lookup cannot tell a real absence from an unreached one.
      const p = pulse(BASE, [slice('Reached', 'complete', [['feature/a', 'merged']])]);
      expect(allSlicesMerged({ file: PLAN }, p, false)).toBe('unknown');
      expect(allSlicesMerged({ file: PLAN }, p, false)).not.toBe('merged');
    });
  });

  describe('not-merged — the plan stays in Development', () => {
    it('reads a COMPLETE scan that does not name the plan as a real absence', () => {
      // It looked and did not find it, unlike the unfinished read above.
      const p = pulse('some-other-plan.md', [slice('Reached', 'complete', [['feature/a', 'merged']])]);
      expect(allSlicesMerged({ file: PLAN }, p, true)).toBe('not-merged');
    });

    it('refuses when any non-deferred slice is not complete', () => {
      // One unfinished slice and the work is not done.
      const p = pulse(BASE, [
        slice('Reached', 'complete', [['feature/a', 'merged']]),
        slice('Verified', 'eligible', [['feature/b', 'open']]),
      ]);
      expect(allSlicesMerged({ file: PLAN }, p, true)).toBe('not-merged');
    });

    it('refuses a plan with no slices at all — vacuous truth is not delivery', () => {
      // Every slice complete over no branches is a plan nobody built. The
      // `merged > 0` guard is what stops the empty reduction promoting it.
      expect(allSlicesMerged({ file: PLAN }, pulse(BASE, []), true)).toBe('not-merged');
    });

    it('refuses a plan whose every branch is deferred', () => {
      // All deferred: there is no landed work to testify to. The slice is
      // skipped as not-outstanding, and contributes nothing to the count either.
      const p = pulse(BASE, [slice('Shelved', 'complete', [['feature/a', 'deferred']])]);
      expect(allSlicesMerged({ file: PLAN }, p, true)).toBe('not-merged');
    });
  });

  describe('merged — the measurement the phase-after-Development reads', () => {
    it('holds when every branch of every slice has merged', () => {
      const p = pulse(BASE, [
        slice('Reached', 'complete', [['feature/a', 'merged']]),
        slice('Verified', 'complete', [['feature/b', 'merged'], ['feature/c', 'merged']]),
      ]);
      expect(allSlicesMerged({ file: PLAN }, p, true)).toBe('merged');
    });

    it('exempts a deferred branch beside merged ones', () => {
      // The scan's own rule: a shelved branch is not outstanding work, so six
      // merged and three deferred is as complete as nine merged.
      const p = pulse(BASE, [
        slice('Reached', 'complete', [['feature/a', 'merged'], ['feature/b', 'deferred']]),
      ]);
      expect(allSlicesMerged({ file: PLAN }, p, true)).toBe('merged');
    });

    it('skips an all-deferred slice without refusing the plan it sits in', () => {
      // The `continue` arm: the shelved slice is passed over, and the landed one
      // beside it still carries the plan.
      const p = pulse(BASE, [
        slice('Shelved', 'blocked', [['feature/a', 'deferred']]),
        slice('Reached', 'complete', [['feature/b', 'merged']]),
      ]);
      expect(allSlicesMerged({ file: PLAN }, p, true)).toBe('merged');
    });

    it('reads the slice VERDICT, not a second walk of the branch states', () => {
      // The scan already decided completeness. A slice the scan calls complete
      // is complete here even where a branch beneath it reads `open` — deciding
      // it twice is the second implementation this repo keeps removing.
      const p = pulse(BASE, [slice('Reached', 'complete', [['feature/a', 'open']])]);
      expect(allSlicesMerged({ file: PLAN }, p, true)).toBe('merged');
    });
  });

  describe('the basename join', () => {
    it('joins a full path against the pulse\'s bare filename', () => {
      const p = pulse(BASE, [slice('Reached', 'complete', [['feature/a', 'merged']])]);
      expect(allSlicesMerged({ file: PLAN }, p, true)).toBe('merged');
    });

    it('joins a bare filename that has no directory at all', () => {
      // `lastIndexOf` returns -1 and the slice starts at 0.
      const p = pulse(BASE, [slice('Reached', 'complete', [['feature/a', 'merged']])]);
      expect(allSlicesMerged({ file: BASE }, p, true)).toBe('merged');
    });

    it('strips a trailing slash the way path.basename does', () => {
      // Unreachable from a real plan path — a plan file never ends in `/` — and
      // here so the inlined basename is provably equivalent to the node call it
      // replaced, rather than equivalent only on expected inputs.
      const p = pulse('plans', [slice('Reached', 'complete', [['feature/a', 'merged']])]);
      expect(allSlicesMerged({ file: 'docs/plans/' }, p, true)).toBe('merged');
    });

    it('reads a path of only slashes as the empty basename', () => {
      // The `end === 0` arm: nothing survives the strip, so there is no name to
      // join on and no plan matches.
      const p = pulse(BASE, [slice('Reached', 'complete', [['feature/a', 'merged']])]);
      expect(allSlicesMerged({ file: '///' }, p, true)).toBe('not-merged');
    });
  });
});
