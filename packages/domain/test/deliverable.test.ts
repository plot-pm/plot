import { describe, it, expect } from 'vitest';
import { allWavesMerged, type FleetPulse, type BranchState, type WaveVerdict } from '../src/index.js';

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
 * counts. The readings below are the ones the rule's own doc comment
 * enumerates — two `unknown`, three `not-merged`, one `merged` — plus the
 * basename join the lookup depends on.
 */

/** One wave, whatever branches it holds — the state tuple is what these vary. */
const wave = (
  name: string,
  verdict: WaveVerdict,
  branches: Array<[string, BranchState]>,
) => ({
  name,
  verdict,
  branches: branches.map(([branch, state]) => ({
    branch,
    state,
    deferred: state === 'deferred',
    claimed: '',
    local_dirty: false,
    local_worktree: '',
  })),
});

const pulse = (file: string, waves: ReturnType<typeof wave>[]): FleetPulse => ({
  main: 'main',
  head: 'abc1234',
  plans: [{ file, waves }],
  summary: {
    plans: 1, waves: waves.length, branches: 0, claimed: 0,
    eligible: 0, blocked: 0, deferred: 0,
  },
} as FleetPulse);

const PLAN = '/repo/docs/plans/2026-08-21-done-means-delivered.md';
const BASE = '2026-08-21-done-means-delivered.md';

describe('allWavesMerged — every non-deferred branch has landed', () => {
  describe('unknown — nothing is asserted, and a caller must say so', () => {
    it('reads no pulse as unknown, never as not-merged', () => {
      // Git has said nothing, and "nothing said" is not "all merged". A cold
      // cache keeps a plan where it was.
      expect(allWavesMerged({ file: PLAN }, null, true)).toBe('unknown');
    });

    it('reads an unfinished scan as unknown even when the plan IS present', () => {
      // The measured defect of 2026-08-27: a timed-out scan's `plans` array
      // holds only what arrived, so no negative may be read from it. Asked
      // BEFORE the lookup, because the lookup cannot tell absence from unreached.
      const p = pulse(BASE, [wave('Reached', 'complete', [['feature/a', 'merged']])]);
      expect(allWavesMerged({ file: PLAN }, p, false)).toBe('unknown');
      expect(allWavesMerged({ file: PLAN }, p, false)).not.toBe('merged');
    });
  });

  describe('not-merged — the plan stays in Development', () => {
    it('reads a COMPLETE scan that does not name the plan as a real absence', () => {
      // It looked and did not find it, unlike the unfinished read above.
      const p = pulse('some-other-plan.md', [wave('Reached', 'complete', [['feature/a', 'merged']])]);
      expect(allWavesMerged({ file: PLAN }, p, true)).toBe('not-merged');
    });

    it('refuses when any non-deferred wave is not complete', () => {
      // One unfinished wave and the work is not done — the negative the plan
      // insists be asserted directly.
      const p = pulse(BASE, [
        wave('Reached', 'complete', [['feature/a', 'merged']]),
        wave('Verified', 'eligible', [['feature/b', 'open']]),
      ]);
      expect(allWavesMerged({ file: PLAN }, p, true)).toBe('not-merged');
    });

    it('refuses a plan with no waves at all — vacuous truth is not delivery', () => {
      // Every wave complete over no branches is a plan nobody built. The
      // `merged > 0` guard is what stops the empty reduction promoting it.
      expect(allWavesMerged({ file: PLAN }, pulse(BASE, []), true)).toBe('not-merged');
    });

    it('refuses a plan whose every branch is deferred', () => {
      // All deferred: there is no landed work to testify to. The wave is
      // skipped as not-outstanding, and contributes nothing to the count either.
      const p = pulse(BASE, [wave('Shelved', 'complete', [['feature/a', 'deferred']])]);
      expect(allWavesMerged({ file: PLAN }, p, true)).toBe('not-merged');
    });
  });

  describe('merged — the measurement the phase-after-Development reads', () => {
    it('holds when every branch of every wave has merged', () => {
      const p = pulse(BASE, [
        wave('Reached', 'complete', [['feature/a', 'merged']]),
        wave('Verified', 'complete', [['feature/b', 'merged'], ['feature/c', 'merged']]),
      ]);
      expect(allWavesMerged({ file: PLAN }, p, true)).toBe('merged');
    });

    it('exempts a deferred branch beside merged ones', () => {
      // The scan's own rule: a shelved branch is not outstanding work, so six
      // merged and three deferred is as complete as nine merged.
      const p = pulse(BASE, [
        wave('Reached', 'complete', [['feature/a', 'merged'], ['feature/b', 'deferred']]),
      ]);
      expect(allWavesMerged({ file: PLAN }, p, true)).toBe('merged');
    });

    it('skips an all-deferred wave without refusing the plan it sits in', () => {
      // The `continue` arm: the shelved wave is passed over, and the landed one
      // beside it still carries the plan.
      const p = pulse(BASE, [
        wave('Shelved', 'blocked', [['feature/a', 'deferred']]),
        wave('Reached', 'complete', [['feature/b', 'merged']]),
      ]);
      expect(allWavesMerged({ file: PLAN }, p, true)).toBe('merged');
    });

    it('reads the wave VERDICT, not a second walk of the branch states', () => {
      // The scan already decided completeness. A wave the scan calls complete
      // is complete here even where a branch beneath it reads `open` — deciding
      // it twice is the second implementation this repo keeps removing.
      const p = pulse(BASE, [wave('Reached', 'complete', [['feature/a', 'open']])]);
      expect(allWavesMerged({ file: PLAN }, p, true)).toBe('merged');
    });
  });

  describe('the basename join', () => {
    it('joins a full path against the pulse\'s bare filename', () => {
      const p = pulse(BASE, [wave('Reached', 'complete', [['feature/a', 'merged']])]);
      expect(allWavesMerged({ file: PLAN }, p, true)).toBe('merged');
    });

    it('joins a bare filename that has no directory at all', () => {
      // `lastIndexOf` returns -1 and the slice starts at 0.
      const p = pulse(BASE, [wave('Reached', 'complete', [['feature/a', 'merged']])]);
      expect(allWavesMerged({ file: BASE }, p, true)).toBe('merged');
    });

    it('strips a trailing slash the way path.basename does', () => {
      // Unreachable from a real plan path — a plan file never ends in `/` — and
      // here so the inlined basename is provably equivalent to the node call it
      // replaced, rather than equivalent only on expected inputs.
      const p = pulse('plans', [wave('Reached', 'complete', [['feature/a', 'merged']])]);
      expect(allWavesMerged({ file: 'docs/plans/' }, p, true)).toBe('merged');
    });

    it('reads a path of only slashes as the empty basename', () => {
      // The `end === 0` arm: nothing survives the strip, so there is no name to
      // join on and no plan matches.
      const p = pulse(BASE, [wave('Reached', 'complete', [['feature/a', 'merged']])]);
      expect(allWavesMerged({ file: '///' }, p, true)).toBe('not-merged');
    });
  });
});
