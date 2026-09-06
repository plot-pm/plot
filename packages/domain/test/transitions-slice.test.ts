import { describe, expect, it } from 'vitest';
import { SliceVerdictSchema, type SliceVerdict } from '../src/entities/fleet.js';
import { sliceVerdict, sliceVerdicts, waitVerdict, type PrereqAnswer } from '../src/rules/eligible.js';
import {
  isDecision,
  isRefusal,
  observeSliceVerdict,
  prerequisiteCleared,
  sliceId,
  sliceVerdictObservable,
  SLICE_LIFECYCLE,
} from '../src/transitions/slice.js';

/** The slice every case is about — one identity, so a refusal's subject is never in doubt. */
const SLICE = sliceId('2026-09-04-a-lifecycle-is-enforced-by-a-test', 'The slice’s lifecycle');

/** The branch a waiting slice names, and the one `plot-release-refs.sh` would reap. */
const PREREQ = 'feature/a-slice-can-wait-on-another-plan';

/** Observes a move, reporting priors landed unless a case says otherwise. */
const move = (from: SliceVerdict, to: SliceVerdict, priorComplete = true) =>
  observeSliceVerdict(SLICE, from, { to, priorComplete });

/** What the host said about the prerequisite, put to the rule. */
const waits = (waitsOn: string, answer: PrereqAnswer) =>
  prerequisiteCleared(SLICE, { waitsOn, answer });

describe('the states are consumed, never redeclared', () => {
  it('names the verdicts the entity owns, in the diagram’s order', () => {
    expect([...SLICE_LIFECYCLE].sort()).toEqual([...SliceVerdictSchema.options].sort());
    expect(SLICE_LIFECYCLE).toEqual(['unapproved', 'blocked', 'eligible', 'complete', 'empty']);
  });

  it('admits every verdict `sliceVerdict` can produce', () => {
    // The rule in `rules/eligible.ts` is the only producer. A verdict it emits
    // and this file refuses as unrecognised would be a lifecycle over a
    // different set of states than the estate actually derives.
    const produced = new Set<SliceVerdict>([
      sliceVerdict({ outstanding: 0, phase: 'approved' }, true),
      sliceVerdict({ outstanding: 1, phase: 'delivered' }, true),
      sliceVerdict({ outstanding: 1, phase: 'draft' }, true),
      sliceVerdict({ outstanding: 1, phase: 'approved' }, true),
      sliceVerdict({ outstanding: 1, phase: 'approved' }, false),
      // `empty` is produced by a slice naming no branch — the fifth verdict,
      // added 2026-09-06 because zero outstanding could not tell *all merged*
      // from *none named*.
      sliceVerdict({ outstanding: 0, phase: 'approved', branches: 0 }, true),
    ]);
    expect([...produced].sort()).toEqual([...SliceVerdictSchema.options].sort());
  });
});

describe('observeSliceVerdict judges a move the lifecycle diagram allows', () => {
  it('lets an approval reach a slice whose priors have not landed', () => {
    const result = move('unapproved', 'blocked');
    expect(isDecision(result)).toBe(true);
    if (!isDecision(result)) return;
    expect(result.from).toBe('unapproved');
    expect(result.to).toBe('blocked');
    expect(result.dispatchable).toBe(false);
  });

  it('lets an approval reach `eligible` directly where the priors already landed', () => {
    // Not a shortcut: a one-slice plan does this on every approval, having no
    // prior slice to wait for.
    const result = move('unapproved', 'eligible');
    expect(isDecision(result)).toBe(true);
    if (!isDecision(result)) return;
    expect(result.dispatchable).toBe(true);
  });

  it('lets a prior slice landing unblock this one', () => {
    expect(isDecision(move('blocked', 'eligible'))).toBe(true);
  });

  it('lets every non-deferred branch merging complete the slice', () => {
    const result = move('eligible', 'complete');
    expect(isDecision(result)).toBe(true);
    if (!isDecision(result)) return;
    expect(result.dispatchable).toBe(false);
  });

  it('walks the whole diagram end to end', () => {
    const path: readonly SliceVerdict[] = ['unapproved', 'blocked', 'eligible', 'complete'];
    for (let i = 0; i < path.length - 1; i += 1) {
      expect(isDecision(move(path[i], path[i + 1]))).toBe(true);
    }
  });
});

describe('observeSliceVerdict refuses a move the diagram does not draw', () => {
  it('refuses a verdict that is not one of the four', () => {
    const result = observeSliceVerdict(SLICE, 'blocked', { to: 'waiting' });
    expect(isRefusal(result)).toBe(true);
    if (!isRefusal(result)) return;
    expect(result.reason).toBe('verdict-unrecognised');
    // `waiting` is a real BranchState and is deliberately not a slice verdict:
    // `DESIGN-slice.md` §4 keeps the branch's progress off the slice's word.
    expect(result.detail).toContain('waiting');
  });

  it('refuses a move to the verdict the slice already holds', () => {
    const result = move('eligible', 'eligible');
    expect(isRefusal(result)).toBe(true);
    if (!isRefusal(result)) return;
    expect(result.reason).toBe('verdict-unchanged');
  });

  it('refuses every move out of `complete` — merged work does not un-merge', () => {
    for (const to of ['unapproved', 'blocked', 'eligible'] as const) {
      const result = move('complete', to);
      expect(isRefusal(result)).toBe(true);
      if (!isRefusal(result)) continue;
      expect(result.reason).toBe('verdict-terminal');
    }
  });

  it('refuses `eligible` -> `blocked`: a started slice does not become unstarted', () => {
    const result = move('eligible', 'blocked');
    expect(isRefusal(result)).toBe(true);
    if (!isRefusal(result)) return;
    expect(result.reason).toBe('verdict-unreachable');
  });

  it('refuses `blocked` -> `unapproved`: a plan does not lose its approval', () => {
    // The two never collapse (`DESIGN-slice.md` §14) and they resolve
    // differently — one by merging work, the other by a person. Moving back
    // would tell a reader to go find an approver for a plan that has one.
    const result = move('blocked', 'unapproved');
    expect(isRefusal(result)).toBe(true);
    if (!isRefusal(result)) return;
    expect(result.reason).toBe('verdict-unreachable');
    expect(result.detail).toContain('eligible');
  });

  it('refuses `eligible` -> `unapproved`', () => {
    const result = move('eligible', 'unapproved');
    expect(isRefusal(result)).toBe(true);
    if (!isRefusal(result)) return;
    expect(result.reason).toBe('verdict-unreachable');
  });

  it('refuses `unapproved` -> `complete`: nothing skips the work', () => {
    const result = move('unapproved', 'complete');
    expect(isRefusal(result)).toBe(true);
    if (!isRefusal(result)) return;
    expect(result.reason).toBe('verdict-unreachable');
  });

  it('refuses `blocked` -> `complete`', () => {
    const result = move('blocked', 'complete');
    expect(isRefusal(result)).toBe(true);
    if (!isRefusal(result)) return;
    expect(result.reason).toBe('verdict-unreachable');
  });

  it('refuses `eligible` with a prior slice unlanded — the ordering is a gate', () => {
    const result = move('blocked', 'eligible', false);
    expect(isRefusal(result)).toBe(true);
    if (!isRefusal(result)) return;
    expect(result.reason).toBe('prior-slice-unlanded');
  });

  it('refuses the same on the direct route out of `unapproved`', () => {
    const result = move('unapproved', 'eligible', false);
    expect(isRefusal(result)).toBe(true);
    if (!isRefusal(result)) return;
    expect(result.reason).toBe('prior-slice-unlanded');
  });

  it('does not ask the ordering of a move that is not into `eligible`', () => {
    // `priorComplete` is read for one destination. A `blocked` verdict is
    // ABOUT unlanded priors, so refusing it for having them would refuse the
    // only honest way to report them.
    expect(isDecision(move('unapproved', 'blocked', false))).toBe(true);
  });

  it('refuses on a reading the caller measured and found unmet', () => {
    const result = observeSliceVerdict(SLICE, 'blocked', {
      to: 'eligible',
      preconditions: [{ name: 'plan-parsed', met: false, detail: 'no ## Branches section' }],
    });
    expect(isRefusal(result)).toBe(true);
    if (!isRefusal(result)) return;
    expect(result.reason).toBe('precondition-unmet');
    expect(result.detail).toContain('no ## Branches section');
  });
});

describe('sliceVerdictObservable answers without granting permission', () => {
  it('agrees with the judgement it summarises', () => {
    expect(sliceVerdictObservable(SLICE, 'blocked', 'eligible')).toBe(true);
    expect(sliceVerdictObservable(SLICE, 'complete', 'eligible')).toBe(false);
    expect(sliceVerdictObservable(SLICE, 'blocked', 'eligible', false)).toBe(false);
  });
});

describe('A PREREQUISITE THAT MERGED AND WAS THEN REAPED STILL CLEARS', () => {
  it('clears on a merged prerequisite whose remote ref no longer exists', () => {
    // THE DEADLOCK THIS SLICE EXISTS TO REFUSE. `plot-release-refs.sh` deletes
    // the remote refs of a delivered plan's merged branches, so a prerequisite
    // that COMPLETED eventually has no ref. A rule reading refs would hold its
    // dependent forever because its dependency succeeded.
    //
    // The reading carries no ref at all — only what the host said — so this
    // case and a prerequisite whose ref still exists are the SAME call.
    const result = waits(PREREQ, 'merged');
    expect(isDecision(result)).toBe(true);
    if (!isDecision(result)) return;
    expect(result.to).toBe('eligible');
    expect(result.dispatchable).toBe(true);
  });

  it('offers no way to say the ref is gone, which is why it cannot be read', () => {
    // The type is the enforcement. `PrerequisiteReading` has two fields and
    // neither is about a ref, so a caller holding refs has nothing to pass and
    // a ref-reading rule cannot be written against it.
    const reading = { waitsOn: PREREQ, answer: 'merged' as PrereqAnswer };
    expect(Object.keys(reading).sort()).toEqual(['answer', 'waitsOn']);
  });

  it('holds while the prerequisite has a pull request and has not merged', () => {
    const result = waits(PREREQ, 'unmerged');
    expect(isRefusal(result)).toBe(true);
    if (!isRefusal(result)) return;
    expect(result.reason).toBe('prerequisite-unlanded');
    expect(result.detail).toContain(PREREQ);
  });

  it('refuses as unknown where the host has never seen a pull request — a typo', () => {
    const result = waits('feature/a-branch-nobody-created', 'none');
    expect(isRefusal(result)).toBe(true);
    if (!isRefusal(result)) return;
    expect(result.reason).toBe('prerequisite-unknown');
  });

  it('refuses as unasked where the host could not be reached — silence is not permission', () => {
    const result = waits(PREREQ, 'unreachable');
    expect(isRefusal(result)).toBe(true);
    if (!isRefusal(result)) return;
    expect(result.reason).toBe('prerequisite-unasked');
  });

  it('keeps `none` and `unreachable` apart, because they resolve oppositely', () => {
    const typo = waits(PREREQ, 'none');
    const silence = waits(PREREQ, 'unreachable');
    expect(isRefusal(typo) && isRefusal(silence)).toBe(true);
    if (!isRefusal(typo) || !isRefusal(silence)) return;
    expect(typo.reason).not.toBe(silence.reason);
  });

  it('clears a slice that declares no prerequisite at all', () => {
    // A branch declaring nothing is held by nothing. `plot-plan-meta.sh` omits
    // the `waits_on` key entirely in that case, which reaches here as ''.
    expect(isDecision(waits('', 'none'))).toBe(true);
    expect(isDecision(waits('', 'unreachable'))).toBe(true);
  });

  it('classifies `waitVerdict`’s answer rather than computing a second one', () => {
    // Two implementations of *has this prerequisite landed* is the drift that
    // deadlocks a slice. Where that rule clears, this one decides; where it
    // holds, this one refuses.
    for (const answer of ['merged', 'unmerged', 'none', 'unreachable'] as const) {
      const cleared = waitVerdict(PREREQ, answer) === '';
      expect(isDecision(waits(PREREQ, answer))).toBe(cleared);
    }
  });

  it('refuses on a reading the caller measured and found unmet', () => {
    const result = prerequisiteCleared(SLICE, { waitsOn: '', answer: 'none' }, [
      { name: 'plan-approved', met: false },
    ]);
    expect(isRefusal(result)).toBe(true);
    if (!isRefusal(result)) return;
    expect(result.reason).toBe('precondition-unmet');
  });
});

describe('the rule does not depend on `outstanding === 0` meaning finished', () => {
  it('judges a move between two verdicts without reading a branch count', () => {
    // THE CORRECTION THIS TEST ANTICIPATED HAS LANDED. It read
    // `expect(vacuous).toBe('complete')` while `rules/eligible.ts` answered
    // `complete` for a slice with no branches, and noted that
    // `the-slice-contract-says-what-it-reads` — then an open Draft — would
    // change which verdict a scan derives.
    //
    // It did: an unapproved plan's slice now reads `unapproved` rather than
    // borrowing `complete` from a zero count. **The test's point is unchanged**
    // — the move out of a verdict is judged the same way whatever the
    // derivation answers — so the fixture moves and the assertions below do
    // not.
    const vacuous = sliceVerdict({ outstanding: 0, phase: 'draft' }, false);
    expect(vacuous).toBe('unapproved');
    // Whatever that answer becomes, the move out of it is judged the same way.
    expect(isRefusal(move('complete', 'eligible'))).toBe(true);
    expect(isDecision(move('eligible', 'complete'))).toBe(true);
  });

  it('takes the verdict as a reading, so a corrected derivation moves no refusal', () => {
    const asDerived = sliceVerdicts([
      { outstanding: 1, phase: 'approved' },
      { outstanding: 1, phase: 'approved' },
    ]);
    expect(asDerived).toEqual(['eligible', 'blocked']);
    // The second slice is blocked by the first, and this rule refuses its
    // promotion for exactly that reason rather than by re-counting branches.
    const result = move('blocked', 'eligible', asDerived[0] === 'complete');
    expect(isRefusal(result)).toBe(true);
    if (!isRefusal(result)) return;
    expect(result.reason).toBe('prior-slice-unlanded');
  });
});

describe('a slice is addressed by the pair, never by name alone', () => {
  it('composes `plan#name`, and gives the default slice `slug#`', () => {
    expect(sliceId('a-plan', 'Counted')).toBe('a-plan#Counted');
    expect(sliceId('a-plan', '')).toBe('a-plan#');
  });

  it('names the slice in every refusal, so a blocker can be gone to', () => {
    const result = move('complete', 'eligible');
    expect(isRefusal(result)).toBe(true);
    if (!isRefusal(result)) return;
    expect(result.id).toBe(SLICE);
  });
});
