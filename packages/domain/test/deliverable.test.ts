import { describe, it, expect } from 'vitest';
import {
  allSlicesConfirmed,
  allSlicesMerged,
  FleetReadingSchema,
  type FleetReading,
  type BranchState,
  type SliceVerdict,
} from '../src/index.js';

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

    // REWRITTEN 2026-09-23, and deliberately: this asserted `not-merged` for a
    // plan whose branches were all given up, which is the behaviour
    // `work-given-up-is-not-work-never-done` removes. It lives on in the
    // `work given up` block below, asserting `merged`.
    //
    // What survives here is the guard it was conflated with: a plan that names
    // NO branch is still refused, and that is a different question from a plan
    // whose branches were given up. The old `merged > 0` could not tell them
    // apart, which is the defect.
    it('refuses a plan whose slices name no branch, however complete they read', () => {
      const p = pulse(BASE, [
        slice('prose', 'complete', []),
        slice('also-prose', 'complete', []),
      ]);
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

describe('allSlicesMerged — work given up is not work never done', () => {
  // The defect: `merged > 0` counted only non-deferred branches, so a plan
  // whose branches were ALL deferred reached the end with `merged === 0` and
  // answered `not-merged` — the same word a plan nobody built gets. Measured
  // 2026-09-22: the deliver controller refused `a-test-must-not-stop-the-fleet`
  // while `plot-deliver.sh --dry-run` reported "0 merged, 1 deferred" and
  // would have delivered it.
  it('delivers a plan whose every branch was given up', () => {
    const p = pulse(BASE, [slice('only-wave', 'complete', [['feature/gone', 'deferred']])]);
    expect(allSlicesMerged({ file: PLAN }, p, true)).toBe('merged');
  });

  it('delivers a plan whose branches were given up across several slices', () => {
    const p = pulse(BASE, [
      slice('one', 'complete', [['feature/a', 'deferred']]),
      slice('two', 'complete', [['feature/b', 'deferred'], ['feature/c', 'deferred']]),
    ]);
    expect(allSlicesMerged({ file: PLAN }, p, true)).toBe('merged');
  });

  // THE GUARD THAT MUST SURVIVE. `merged + deferred` is zero exactly when
  // every slice named no branch at all, which is the case the original
  // `merged > 0` was written for — a prose heading that parses as a finished
  // wave. The line above it already refuses an individual empty slice; this
  // is the second net.
  it('refuses a plan that names no branch at all', () => {
    const p = pulse(BASE, [slice('prose-heading', 'complete', [])]);
    expect(allSlicesMerged({ file: PLAN }, p, true)).toBe('not-merged');
  });

  // The regression this change must not cause: a deferred branch beside an
  // unfinished one must not make the plan deliverable. The `slice.verdict`
  // test refuses first, before the counter is ever read.
  it('still refuses a plan with one branch given up and one unfinished', () => {
    const p = pulse(BASE, [
      slice('done', 'complete', [['feature/a', 'deferred']]),
      slice('open', 'eligible', [['feature/b', 'open']]),
    ]);
    expect(allSlicesMerged({ file: PLAN }, p, true)).toBe('not-merged');
  });

  // The slice's VERDICT carries the merge state, not the branch's own word:
  // the rule counts every non-deferred branch of a `complete` slice as landed
  // and never inspects `b.state`. So an unfinished branch is refused by its
  // slice not being `complete`, which is the shape the scan actually emits —
  // a `complete` slice holding an `open` branch is a contradiction no pulse
  // produces, and asserting on one tests the fixture rather than the rule.
  it('still refuses a plan whose slice holds a given-up branch and is unfinished', () => {
    const p = pulse(BASE, [
      slice('mixed', 'eligible', [['feature/a', 'deferred'], ['feature/b', 'open']]),
    ]);
    expect(allSlicesMerged({ file: PLAN }, p, true)).toBe('not-merged');
  });

  it('delivers a plan mixing a merged branch and a given-up one', () => {
    const p = pulse(BASE, [
      slice('mixed', 'complete', [['feature/a', 'merged'], ['feature/b', 'deferred']]),
    ]);
    expect(allSlicesMerged({ file: PLAN }, p, true)).toBe('merged');
  });
});

/**
 * One slice whose branches carry evidence words — the shape a throttled host
 * produces, where a merge subject is all that proves a branch landed.
 */
const sliceWithEvidence = (
  name: string,
  verdict: SliceVerdict,
  branches: Array<[string, BranchState, 'subject' | undefined]>,
) => ({
  name,
  verdict,
  branches: branches.map(([branch, state, evidence]) => ({
    branch,
    state,
    deferred: state === 'deferred',
    deferred_reason: '',
    claimed: '',
    local_dirty: false,
    local_worktree: '',
    evidence,
  })),
});

describe('allSlicesConfirmed — the host has answered, not only the merge subject', () => {
  // WHY A SECOND RULE RATHER THAN A WIDER ONE. `allSlicesMerged` answers *is
  // this plan finished*, which the wave gate and the plan's status word read,
  // and a subject-proven slice IS finished for both — opening the next slice is
  // reversible. This answers *has the landing been confirmed*, which is what a
  // delivery needs, because a delivery is not.
  it('answers merged when every branch was confirmed by the host', () => {
    const p = pulse(BASE, [
      sliceWithEvidence('one', 'complete', [['feature/a', 'merged', undefined]]),
    ]);
    expect(allSlicesConfirmed({ file: PLAN }, p, true)).toBe('merged');
  });

  // THE ONE DIFFERENCE FROM `allSlicesMerged`, and the measured defect behind
  // it: without this, a subject-proven plan reads `merged` during a 429, the
  // first auto-deliver tick starts `plot-deliver.sh`, which refuses, and
  // `pruneDelivering` keeps the slug in `inFlight` while the plan still reads
  // approved and merged — so no later tick delivers until the board restarts.
  it('answers unknown when a branch is proved only by its merge subject', () => {
    const p = pulse(BASE, [
      sliceWithEvidence('one', 'complete', [['feature/a', 'merged', 'subject']]),
    ]);
    expect(allSlicesConfirmed({ file: PLAN }, p, true)).toBe('unknown');
    // And the wave gate's rule is unmoved by the same pulse, which is what
    // keeps the next slice startable while the delivery waits.
    expect(allSlicesMerged({ file: PLAN }, p, true)).toBe('merged');
  });

  it('answers unknown when one branch of several is proved only by subject', () => {
    const p = pulse(BASE, [
      sliceWithEvidence('one', 'complete', [['feature/a', 'merged', undefined]]),
      sliceWithEvidence('two', 'complete', [
        ['feature/b', 'merged', undefined],
        ['feature/c', 'merged', 'subject'],
      ]),
    ]);
    expect(allSlicesConfirmed({ file: PLAN }, p, true)).toBe('unknown');
  });

  // A DEFERRED BRANCH IS EXEMPT, as it is in `allSlicesMerged`. Work given up
  // is not work awaiting confirmation, and a `subject` word on one would be a
  // scan defect rather than a reason to hold a delivery for ever.
  it('answers merged when only a deferred branch carries the subject word', () => {
    const p = pulse(BASE, [
      sliceWithEvidence('one', 'complete', [
        ['feature/a', 'merged', undefined],
        ['feature/b', 'deferred', 'subject'],
      ]),
    ]);
    expect(allSlicesConfirmed({ file: PLAN }, p, true)).toBe('merged');
  });

  it('answers merged for a plan whose every branch was given up', () => {
    const p = pulse(BASE, [
      sliceWithEvidence('only-wave', 'complete', [['feature/gone', 'deferred', undefined]]),
    ]);
    expect(allSlicesConfirmed({ file: PLAN }, p, true)).toBe('merged');
  });

  // THE OTHER ANSWERS ARE `allSlicesMerged`'S, UNCHANGED. They are asserted
  // here rather than assumed, because the two rules share a body and a change
  // to the shared half must not pass by being tested on one caller only.
  it('answers unknown with no pulse', () => {
    expect(allSlicesConfirmed({ file: PLAN }, null, true)).toBe('unknown');
  });

  it('answers unknown for an unfinished scan', () => {
    const p = pulse(BASE, [
      sliceWithEvidence('one', 'complete', [['feature/a', 'merged', undefined]]),
    ]);
    expect(allSlicesConfirmed({ file: PLAN }, p, false)).toBe('unknown');
  });

  it('answers not-merged for a plan the pulse does not name', () => {
    const p = pulse('2026-01-01-another.md', [
      sliceWithEvidence('one', 'complete', [['feature/a', 'merged', undefined]]),
    ]);
    expect(allSlicesConfirmed({ file: PLAN }, p, true)).toBe('not-merged');
  });

  it('answers not-merged for an unfinished slice', () => {
    const p = pulse(BASE, [
      sliceWithEvidence('one', 'eligible', [['feature/a', 'open', undefined]]),
    ]);
    expect(allSlicesConfirmed({ file: PLAN }, p, true)).toBe('not-merged');
  });

  it('answers not-merged for a slice naming no branch', () => {
    const p = pulse(BASE, [sliceWithEvidence('prose-heading', 'complete', [])]);
    expect(allSlicesConfirmed({ file: PLAN }, p, true)).toBe('not-merged');
  });

  // THE ORDER OF THE TWO REFUSALS, pinned. An unfinished slice holding a
  // subject-proven branch answers `not-merged` and not `unknown`: the work is
  // measurably outstanding, which is a stronger statement than *the proof is
  // weak*, and a caller that waits on `unknown` would wait for a confirmation
  // of a landing that has not happened.
  it('answers not-merged for an unfinished slice holding a subject-proven branch', () => {
    const p = pulse(BASE, [
      sliceWithEvidence('one', 'complete', [['feature/a', 'merged', undefined]]),
      sliceWithEvidence('two', 'eligible', [['feature/b', 'merged', 'subject']]),
    ]);
    expect(allSlicesConfirmed({ file: PLAN }, p, true)).toBe('not-merged');
  });

  // A PULSE PARSED FROM THE WIRE, not a typed literal. `BranchSchema` strips a
  // key it does not declare, so this is what proves the field survives the
  // parse the board performs — the round-3 finding, and the reason the field is
  // declared on the entity at all.
  it('reads the field through FleetReadingSchema', () => {
    const wire = {
      main: 'main',
      head: 'abc1234',
      plans: [{
        file: BASE,
        slices: [{
          name: 'one',
          verdict: 'complete',
          branches: [{
            branch: 'feature/a',
            state: 'merged',
            deferred: false,
            claimed: '',
            evidence: 'subject',
          }],
        }],
      }],
      summary: {
        plans: 1, waves: 1, branches: 1, claimed: 0,
        eligible: 0, blocked: 0, deferred: 0,
      },
    };
    const parsed = FleetReadingSchema.parse(wire);
    expect(parsed.plans[0].slices[0].branches[0].evidence).toBe('subject');
    expect(allSlicesConfirmed({ file: PLAN }, parsed, true)).toBe('unknown');
  });

  it('reads a parsed pulse with no evidence word as confirmed', () => {
    const wire = {
      main: 'main',
      head: 'abc1234',
      plans: [{
        file: BASE,
        slices: [{
          name: 'one',
          verdict: 'complete',
          branches: [{
            branch: 'feature/a',
            state: 'merged',
            deferred: false,
            claimed: '',
          }],
        }],
      }],
      summary: {
        plans: 1, waves: 1, branches: 1, claimed: 0,
        eligible: 0, blocked: 0, deferred: 0,
      },
    };
    const parsed = FleetReadingSchema.parse(wire);
    expect(parsed.plans[0].slices[0].branches[0].evidence).toBeUndefined();
    expect(allSlicesConfirmed({ file: PLAN }, parsed, true)).toBe('merged');
  });
});
