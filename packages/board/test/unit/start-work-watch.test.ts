import { describe, it, expect } from 'vitest';
import { claimedCount, startRefusal, verdictFromPulse } from '../../src/app/components/StartWorkButton.js';
import type { Card, DispatchInfo } from '../../src/contract/schema.js';

/**
 * WHICH FACT THE START BUTTON WATCHES, AND WHEN IT REFUSES.
 *
 * The defect this file pins: `card.started` describes the PLAN while the action
 * starts a BRANCH, so on a plan with more than one wave the flag is already
 * true at the moment of the click and can never move again. Three pulses later
 * the button said *no change — see log* about a dispatch that had prepared a
 * worktree and pushed a claim.
 *
 * The card carried the answer the whole time: `sliceSummary.claimed` is the
 * count a dispatch moves, and it moves on every wave.
 *
 * FIELDS, NOT WHOLE OBJECTS. A sibling branch added a contract field on
 * 2026-08-17 and a hand-written fixture asserted with `toEqual` failed CI
 * without being wrong about anything. Every assertion here names what it cares
 * about.
 */

/** A card shaped like the one whose button appeared to do nothing. */
function card(over: Partial<Card> = {}): Card {
  return {
    slug: 'acting-buttons-show-they-act',
    title: 'A button that starts an agent should look like it did',
    type: 'bug',
    phase: 'Development',
    path: 'docs/plans/2026-08-17-acting-buttons-show-they-act.md',
    prs: [],
    started: true,
    ...over,
  } as Card;
}

const ready: DispatchInfo = { available: true, reason: '' };
const bound0000: DispatchInfo = {
  available: false,
  reason: 'the board is not on localhost',
};

describe('claimedCount — the count the action itself moves', () => {
  it('reads `claimed` from the wave summary', () => {
    expect(claimedCount(card({ sliceSummary: { waves: 3, branches: 3, deferred: 0, claimed: 1, eligible: 1 } })))
      .toBe(1);
  });

  it('is UNKNOWN rather than zero when no pulse has landed', () => {
    // The contract marks both counts `.optional()` for exactly this: `claimed:
    // 0` and "git has not been read yet" must not be the same value, or a
    // button comparing them across pulses would read an arriving first scan as
    // a successful dispatch.
    expect(claimedCount(card({ sliceSummary: { waves: 3, branches: 3, deferred: 0 } })))
      .toBeUndefined();
  });

  it('does not consult `card.started` at all', () => {
    // The pairing that matters: a fallback to `started` passes every "it
    // worked" assertion below and keeps the defect alive in the window where
    // it is most likely — a freshly restarted board with no pulse yet.
    const unstarted = claimedCount(card({ started: false, sliceSummary: { waves: 1, branches: 1, deferred: 0 } }));
    const startedPlan = claimedCount(card({ started: true, sliceSummary: { waves: 1, branches: 1, deferred: 0 } }));
    expect(unstarted).toBeUndefined();
    expect(startedPlan).toBeUndefined();
  });
});

describe('a dispatch on an ALREADY-STARTED plan reads as success', () => {
  // The live shape from 2026-08-17: the plan was started, one branch was
  // eligible and none was claimed. `card.started` cannot move here — which is
  // the whole defect — so the confirmation has to come from `claimed`.
  const before = card({ started: true, sliceSummary: { waves: 3, branches: 3, deferred: 0, claimed: 0, eligible: 1 } });
  const after = card({ started: true, sliceSummary: { waves: 3, branches: 3, deferred: 0, claimed: 1, eligible: 0 } });

  it('the watched count moves even though `started` does not', () => {
    expect(before.started).toBe(true);
    expect(after.started).toBe(true);
    expect(claimedCount(after)!).toBeGreaterThan(claimedCount(before)!);
  });

  it('and the SECOND wave behaves the same as the first', () => {
    // A fix tested only on a first click passes without touching the defect:
    // there `started` flips false → true and the old code saw the change. Wave
    // 2 is where it never could.
    const wave1Claimed = card({ started: true, sliceSummary: { waves: 3, branches: 3, deferred: 0, claimed: 1, eligible: 1 } });
    const wave2Claimed = card({ started: true, sliceSummary: { waves: 3, branches: 3, deferred: 0, claimed: 2, eligible: 0 } });
    expect(claimedCount(wave2Claimed)!).toBeGreaterThan(claimedCount(wave1Claimed)!);
  });

  it('a dispatcher that really declined moves nothing', () => {
    // The pairing for the two above: a fix that simply stops showing `no change
    // — see log` passes them and deletes a true signal. A lost claim race leaves
    // the count exactly where it was, and that must still read as a decline.
    const declined = card({ started: true, sliceSummary: { waves: 3, branches: 3, deferred: 0, claimed: 0, eligible: 1 } });
    expect(claimedCount(declined)).toBe(claimedCount(before));
  });
});

describe('verdictFromPulse — what the button concludes after a click', () => {
  const LIMIT = 3;
  const verdict = (over: Partial<Parameters<typeof verdictFromPulse>[0]>) =>
    verdictFromPulse({ claimedAtClick: 0, claimedNow: 0, pulsesElapsed: 0, limit: LIMIT, ...over });

  it('A DISPATCH ON AN ALREADY-STARTED PLAN READS AS SUCCESS', () => {
    // The live shape from 2026-08-17, and the whole point of this branch. The
    // card was `started: true, claimed: 0, eligible: 1` — so the flag the old
    // code watched was already true and could not move. The claim it pushed
    // could, and did.
    expect(verdict({ claimedAtClick: 0, claimedNow: 1 })).toBe('confirmed');
  });

  it('and so does the SECOND wave, which is where the old code could not see', () => {
    // Wave 1 already claimed. `card.started` is true on both sides of this
    // click, so a fix tested only on a first dispatch — where `started` flips
    // false → true — passes without ever touching the defect.
    expect(verdict({ claimedAtClick: 1, claimedNow: 2 })).toBe('confirmed');
    expect(verdict({ claimedAtClick: 2, claimedNow: 3 })).toBe('confirmed');
  });

  it('keeps waiting while nothing has moved yet', () => {
    // A worktree create plus a push takes longer than one pulse. Concluding
    // here would report a decline on a dispatch that is simply still working.
    expect(verdict({ claimedAtClick: 0, claimedNow: 0, pulsesElapsed: 1 })).toBe('waiting');
    expect(verdict({ claimedAtClick: 0, claimedNow: 0, pulsesElapsed: 2 })).toBe('waiting');
  });

  it('stops watching (`gave-up`) once the wait elapses with the count unmoved', () => {
    // The verdict is unchanged by `the-button-claims-only-what-it-knows`; what
    // changed is what `gave-up` RENDERS. It no longer shows *no change — see
    // log* (a failure the button cannot know happened, plus a path that
    // expires) but the reassurance `DISPATCHED_WORD`, with the dispatcher log
    // moved to the row's durable `Status` menu entry. The verdict layer still
    // marks the moment the button stops watching, which is all it ever meant.
    expect(verdict({ claimedAtClick: 0, claimedNow: 0, pulsesElapsed: LIMIT })).toBe('gave-up');
  });

  it('treats an ABSENT count as unknown, never as unchanged', () => {
    // The pulse stopping mid-flight is not evidence of anything. It must not
    // confirm, and it must not decline early either — the wait runs its course
    // and the log gets the last word.
    expect(verdict({ claimedAtClick: 0, claimedNow: undefined, pulsesElapsed: 1 })).toBe('waiting');
    expect(verdict({ claimedAtClick: undefined, claimedNow: 1, pulsesElapsed: 1 })).toBe('waiting');
    expect(verdict({ claimedAtClick: undefined, claimedNow: undefined, pulsesElapsed: 1 }))
      .toBe('waiting');
  });

  it('a first scan ARRIVING is not a dispatch succeeding', () => {
    // undefined → 5 is the board learning what was already true, not five
    // branches being claimed by one click. Treating missing as zero would make
    // every first pulse read as a triumphant success.
    expect(verdict({ claimedAtClick: undefined, claimedNow: 5, pulsesElapsed: 1 })).toBe('waiting');
  });

  it('a count going DOWN is not success', () => {
    // Claims are reaped when a branch merges, so the count falls in normal
    // operation. A `!==` comparison would call that a successful dispatch.
    expect(verdict({ claimedAtClick: 2, claimedNow: 1, pulsesElapsed: 1 })).toBe('waiting');
  });
});

describe('startRefusal — refusing before the click, in the right words', () => {
  it('lets a startable plan through', () => {
    expect(startRefusal(card({ sliceSummary: { waves: 3, branches: 3, deferred: 0, claimed: 0, eligible: 1 } }), ready))
      .toBeUndefined();
  });

  it('keeps the server refusals, and their own wording', () => {
    // The ref latch from #173 answers *is one of mine already running*; this
    // answers *may this act at all*, and where the server has said no, its
    // words win over anything the board could infer.
    const startable = card({ sliceSummary: { waves: 3, branches: 3, deferred: 0, claimed: 0, eligible: 1 } });
    expect(startRefusal(startable, bound0000)).toBe('the board is not on localhost');
  });

  it('refuses a plan with NOTHING ELIGIBLE, naming the reason', () => {
    const allClaimed = card({ sliceSummary: { waves: 3, branches: 3, deferred: 0, claimed: 3, eligible: 0 } });
    expect(startRefusal(allClaimed, ready)).toMatch(/eligible/);
  });

  it('refuses WITHOUT A PULSE and says it is waiting for the first scan', () => {
    // Reading the optional counts unguarded would crash or, worse, treat
    // missing as zero — which would refuse for the wrong reason on a plan whose
    // branches are all startable.
    const noPulse = card({ sliceSummary: { waves: 3, branches: 3, deferred: 0 } });
    expect(startRefusal(noPulse, ready)).toMatch(/first (fleet )?scan/);
  });

  it('tells the two silences apart', () => {
    // "we scanned and nothing is startable" and "we have not scanned" are
    // different statements and a reader acts differently on each — one waits,
    // the other goes and looks at why every wave is blocked.
    const noPulse = startRefusal(card({ sliceSummary: { waves: 1, branches: 1, deferred: 0 } }), ready);
    const nothingEligible = startRefusal(
      card({ sliceSummary: { waves: 1, branches: 1, deferred: 0, claimed: 1, eligible: 0 } }), ready);
    expect(noPulse).toBeDefined();
    expect(nothingEligible).toBeDefined();
    expect(noPulse).not.toBe(nothingEligible);
  });

  it('does NOT fall back to `card.started` when the counts are missing', () => {
    // The fallback is the tempting fix and it is the worse one: an unstarted
    // plan would sail through on a board that has never scanned, and the
    // button could not report on the dispatch afterwards either.
    const unstartedNoPulse = card({ started: false, phase: 'Design', sliceSummary: { waves: 1, branches: 1, deferred: 0 } });
    expect(startRefusal(unstartedNoPulse, ready)).toMatch(/first (fleet )?scan/);
  });

  it('lets a PRE-WAVE plan through — no summary is not a missing pulse', () => {
    // A plan with no `## Branches` waves gets no `sliceSummary` at all, on every
    // board, pulse or no pulse. `plot-dispatch.sh` is the authority there and
    // refuses in its own words; inventing a precondition here would put the
    // same rule in two places.
    const preSlice = card({ started: false, phase: 'Design' });
    expect(preSlice.sliceSummary).toBeUndefined();
    expect(startRefusal(preSlice, ready)).toBeUndefined();
  });
});
