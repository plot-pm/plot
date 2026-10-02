import { describe, expect, it } from 'vitest';
import {
  approvable,
  approve,
  deliver,
  deliverable,
  isDecision,
  isRefusal,
  reject,
  rejectable,
  releasable,
  release,
  supersedable,
  supersede,
  undeliver,
  undeliverable,
  type ApproveInput,
  type TransitionPlan,
} from '../src/transitions/plan.js';

/** A plan in the phase and channel a test needs, with everything else valid. */
const planWith = (over: Partial<TransitionPlan> = {}): TransitionPlan => ({
  slug: 'a-plan',
  phase: 'draft',
  review: 'pr',
  approvedRecord: '',
  deliveredRecord: '',
  releasedRecord: '',
  ...over,
});

/**
 * The approver's side of an approval, which each test varies in one way.
 *
 * `people` declares the handle `who` defaults to, so a test that says nothing
 * about the reviewer gets a declared one and tests the gate it means to.
 */
const approvedBy = (over: Partial<ApproveInput> = {}): ApproveInput => ({
  on: '2026-08-29',
  who: 'jwloka',
  channel: 'plan-PR #42 merged',
  people: ['jwloka', 'eins78'],
  ...over,
});

describe('approve', () => {
  it('returns a decision carrying the phase and its record together', () => {
    const result = approve(planWith(), approvedBy({ who: 'Jan Wloka', channel: 'plan-PR #42 merged' }));
    expect(isDecision(result)).toBe(true);
    if (!isDecision(result)) return;
    expect(result.phase).toBe('approved');
    expect(result.record).toBe('2026-08-29, Jan Wloka, plan-PR #42 merged');
    expect(result.field).toBe('Approved');
  });

  it('approves a design plan, the forward exit from the transitional phase', () => {
    const result = approve(planWith({ phase: 'design' }), approvedBy({ who: 'Jan Wloka', channel: 'plan-PR #42 merged' }));
    expect(isDecision(result)).toBe(true);
  });

  it('treats an already-approved plan with no record as the repairable case', () => {
    const result = approve(planWith({ phase: 'approved' }), approvedBy({ who: 'Jan Wloka', channel: 'plan-PR #42 merged' }));
    expect(isDecision(result)).toBe(true);
  });

  it('reports nothing to do when the phase is approved and the record is written', () => {
    const result = approve(planWith({ phase: 'approved', approvedRecord: '2026-08-01, Jan, pr' }), approvedBy({ who: 'Jan Wloka', channel: 'plan-PR #42 merged' }));
    expect(isDecision(result)).toBe(true);
    if (!isDecision(result)) return;
    expect(result.alreadyRecorded).toBe(true);
    expect(result.record).toBe('2026-08-01, Jan, pr');
  });

  it('accepts a plan whose review channel was never recorded', () => {
    const result = approve(planWith({ review: 'none' }), approvedBy({ who: 'Jan Wloka', channel: 'plan-PR #42 merged' }));
    expect(isDecision(result)).toBe(true);
  });

  // --- one test per refusal, named for it ---------------------------------

  // THE SAME ASSERTIONS AS `workflows/approve.ts`, against the function the
  // shell actually reaches. `plot-approve.sh` pipes its readings to
  // `board/plot-transition.mjs`, which runs this `approve` — so a refusal
  // proven only in the workflow passes its own test and never fires for an
  // operator.
  describe('an unnamed slice', () => {
    const unnamed = [{ name: '', branches: [{ branch: 'feature/nameless' }] }];

    it('refuses a branch under no heading, naming the branch and the repair', () => {
      const result = approve(planWith(), approvedBy({ slices: unnamed }));
      expect(isRefusal(result) && result.reason).toBe('slice-unnamed');
      expect(isRefusal(result) && result.detail).toContain("'feature/nameless'");
      expect(isRefusal(result) && result.detail).toContain(
        "add '### <name> (Branch: feature/nameless)' above it under '## Slices'",
      );
    });

    it('decides no write when it refuses', () => {
      const result = approve(planWith(), approvedBy({ slices: unnamed }));
      expect(isDecision(result)).toBe(false);
    });

    it('refuses a DEFERRED branch under no heading', () => {
      const result = approve(planWith(), approvedBy({ slices: [{ name: '', branches: [{ branch: 'feature/given-up', deferred: true }] }] }));
      expect(isRefusal(result) && result.reason).toBe('slice-unnamed');
    });

    it('refuses before the review channel, on every channel', () => {
      const result = approve(planWith({ review: 'in-session' }), approvedBy({ slices: unnamed }));
      expect(isRefusal(result) && result.reason).toBe('slice-unnamed');
    });

    it('refuses an already-approved plan holding one', () => {
      const result = approve(planWith({ phase: 'approved' }), approvedBy({ slices: unnamed }));
      expect(isRefusal(result) && result.reason).toBe('slice-unnamed');
    });

    it('approves a plan whose every branch sits under a heading', () => {
      const result = approve(planWith(), approvedBy({ slices: [{ name: 'A slice', branches: [{ branch: 'feature/one' }] }] }));
      expect(isDecision(result)).toBe(true);
    });

    it('approves when no slices were read — absent is not false', () => {
      const result = approve(planWith(), approvedBy());
      expect(isDecision(result)).toBe(true);
    });

    it('keeps the idempotent re-run: an approved plan with a record and named slices', () => {
      const result = approve(planWith({ phase: 'approved', approvedRecord: '2026-08-01, Jan, pr' }), approvedBy({ slices: [{ name: 'A slice', branches: [{ branch: 'feature/one' }] }] }));
      expect(isDecision(result) && result.alreadyRecorded).toBe(true);
    });

    it('leaves `approvable` answering true, since it reads no plan file', () => {
      expect(approvable(planWith())).toBe(true);
    });
  });

  it('refuses state-terminal: a delivered plan has nothing to approve', () => {
    const result = approve(planWith({ phase: 'delivered' }), approvedBy({ who: 'Jan', channel: 'pr' }));
    expect(isRefusal(result)).toBe(true);
    if (!isRefusal(result)) return;
    expect(result.reason).toBe('state-terminal');
    expect(result.detail).toContain('delivered');
  });

  it('refuses state-terminal: a released plan has nothing to approve', () => {
    const result = approve(planWith({ phase: 'released' }), approvedBy({ who: 'Jan', channel: 'pr' }));
    expect(isRefusal(result)).toBe(true);
    if (!isRefusal(result)) return;
    expect(result.reason).toBe('state-terminal');
  });

  it('refuses state-unreadable rather than guessing an empty phase', () => {
    const result = approve(planWith({ phase: 'none' }), approvedBy({ who: 'Jan', channel: 'pr' }));
    expect(isRefusal(result)).toBe(true);
    if (!isRefusal(result)) return;
    expect(result.reason).toBe('state-unreadable');
  });

  it('refuses state-wrong for a phase that does not approve', () => {
    const result = approve(planWith({ phase: 'rejected' }), approvedBy({ who: 'Jan', channel: 'pr' }));
    expect(isRefusal(result)).toBe(true);
    if (!isRefusal(result)) return;
    expect(result.reason).toBe('state-wrong');
    expect(result.detail).toContain('rejected');
  });

  // Kept, with an empty `who`: the reason an in-session plan refuses is now
  // that nobody is named, not that the channel is in-session.
  it('refuses review-human for an in-session channel with no reviewer named', () => {
    const result = approve(planWith({ review: 'in-session' }), approvedBy({ who: '' }));
    expect(isRefusal(result)).toBe(true);
    if (!isRefusal(result)) return;
    expect(result.reason).toBe('review-human');
    expect(result.detail).toContain('in-session');
    expect(result.detail).toContain('--who');
  });

  it('refuses review-human for an in-session channel whose reviewer is whitespace', () => {
    const result = approve(planWith({ review: 'in-session' }), approvedBy({ who: '   ' }));
    expect(isRefusal(result)).toBe(true);
    if (!isRefusal(result)) return;
    expect(result.reason).toBe('review-human');
  });

  it('approves an in-session plan whose reviewer the project declares', () => {
    const result = approve(
      planWith({ review: 'in-session' }),
      approvedBy({ who: 'jwloka', channel: 'in-session' }),
    );
    expect(isDecision(result)).toBe(true);
    if (!isDecision(result)) return;
    expect(result.record).toBe('2026-08-29, jwloka, in-session');
  });

  // Its own reason, because its repair is its own: `review-human` says a human
  // is needed, this says the human named is not one the project declared.
  it('refuses reviewer-undeclared for a reviewer the People key never named', () => {
    const result = approve(
      planWith({ review: 'in-session' }),
      approvedBy({ who: 'someone-else', channel: 'in-session' }),
    );
    expect(isRefusal(result)).toBe(true);
    if (!isRefusal(result)) return;
    expect(result.reason).toBe('reviewer-undeclared');
    expect(result.detail).toContain('someone-else');
    expect(result.detail).toContain('People');
  });

  // Catches a membership test written `people.length === 0 || includes(who)`.
  it('refuses a named reviewer when the project declares nobody', () => {
    const result = approve(
      planWith({ review: 'in-session' }),
      approvedBy({ who: 'jwloka', channel: 'in-session', people: [] }),
    );
    expect(isRefusal(result)).toBe(true);
    if (!isRefusal(result)) return;
    expect(result.reason).toBe('reviewer-undeclared');
  });

  // The handle is the subject. The plan's text and the unowned-write log both
  // record handles, so matching a spelling would record a name no log carries.
  it('matches the handle and not the spelling the People key pairs with it', () => {
    const result = approve(
      planWith({ review: 'in-session' }),
      approvedBy({ who: 'Jan Wloka', channel: 'in-session' }),
    );
    expect(isRefusal(result)).toBe(true);
    if (!isRefusal(result)) return;
    expect(result.reason).toBe('reviewer-undeclared');
  });

  it('trims the reviewer before matching, so a padded handle approves', () => {
    const result = approve(
      planWith({ review: 'in-session' }),
      approvedBy({ who: '  jwloka  ', channel: 'in-session' }),
    );
    expect(isDecision(result)).toBe(true);
    if (!isDecision(result)) return;
    // Recorded as typed: trimming decides the match, it does not rewrite `who`.
    expect(result.record).toBe('2026-08-29,   jwloka  , in-session');
  });

  it('refuses review-human for a ballot channel, whatever who names', () => {
    const result = approve(planWith({ review: 'ballot' }), approvedBy({ who: 'jwloka' }));
    expect(isRefusal(result)).toBe(true);
    if (!isRefusal(result)) return;
    expect(result.reason).toBe('review-human');
    expect(result.detail).toContain('ballot');
  });

  it('refuses review-unrecognised rather than defaulting an unknown channel to pr', () => {
    const result = approve(planWith({ review: 'carrier-pigeon' }), approvedBy({ who: 'Jan', channel: 'pr' }));
    expect(isRefusal(result)).toBe(true);
    if (!isRefusal(result)) return;
    expect(result.reason).toBe('review-unrecognised');
    expect(result.detail).toContain('carrier-pigeon');
  });

  it('refuses precondition-unmet when a supplied reading refuses', () => {
    const result = approve(planWith(), approvedBy({ who: 'Jan', channel: 'pr', preconditions: [{ name: 'plan-PR merged', met: false, detail: 'PR #42 is closed' }] }));
    expect(isRefusal(result)).toBe(true);
    if (!isRefusal(result)) return;
    expect(result.reason).toBe('precondition-unmet');
    expect(result.detail).toContain('plan-PR merged');
    expect(result.detail).toContain('PR #42 is closed');
  });

  it('proceeds when every supplied reading is met', () => {
    const result = approve(planWith(), approvedBy({ who: 'Jan', channel: 'pr', preconditions: [{ name: 'plan-PR merged', met: true }] }));
    expect(isDecision(result)).toBe(true);
  });

  it('names a failing precondition that carries no detail', () => {
    const result = approve(planWith(), approvedBy({ who: 'Jan', channel: 'pr', preconditions: [{ name: 'plan-PR merged', met: false }] }));
    expect(isRefusal(result)).toBe(true);
    if (!isRefusal(result)) return;
    expect(result.detail).toBe("the reading 'plan-PR merged' is not met");
  });
});

describe('deliver', () => {
  it('returns a decision carrying the phase and its record together', () => {
    const result = deliver(planWith({ phase: 'approved' }), { on: '2026-08-29' });
    expect(isDecision(result)).toBe(true);
    if (!isDecision(result)) return;
    expect(result.phase).toBe('delivered');
    expect(result.record).toBe('2026-08-29');
    expect(result.field).toBe('Delivered');
  });

  it('treats an already-delivered plan with no record as the repairable case', () => {
    const result = deliver(planWith({ phase: 'delivered' }), { on: '2026-08-29' });
    expect(isDecision(result)).toBe(true);
    if (!isDecision(result)) return;
    expect(result.alreadyRecorded).toBe(false);
  });

  it('reports nothing to do when the phase is delivered and the record is written', () => {
    const result = deliver(planWith({ phase: 'delivered', deliveredRecord: '2026-08-01' }), {
      on: '2026-08-29',
    });
    expect(isDecision(result)).toBe(true);
    if (!isDecision(result)) return;
    expect(result.alreadyRecorded).toBe(true);
    expect(result.record).toBe('2026-08-01');
  });

  it('refuses state-terminal: a released plan has nothing to deliver', () => {
    const result = deliver(planWith({ phase: 'released' }), { on: '2026-08-29' });
    expect(isRefusal(result)).toBe(true);
    if (!isRefusal(result)) return;
    expect(result.reason).toBe('state-terminal');
  });

  it('refuses state-too-early: a draft plan must be approved first', () => {
    const result = deliver(planWith({ phase: 'draft' }), { on: '2026-08-29' });
    expect(isRefusal(result)).toBe(true);
    if (!isRefusal(result)) return;
    expect(result.reason).toBe('state-too-early');
    expect(result.detail).toContain('approve it first');
  });

  it('refuses state-too-early: a design plan must be approved first', () => {
    const result = deliver(planWith({ phase: 'design' }), { on: '2026-08-29' });
    expect(isRefusal(result)).toBe(true);
    if (!isRefusal(result)) return;
    expect(result.reason).toBe('state-too-early');
  });

  it('refuses state-unreadable rather than guessing an empty phase', () => {
    const result = deliver(planWith({ phase: 'none' }), { on: '2026-08-29' });
    expect(isRefusal(result)).toBe(true);
    if (!isRefusal(result)) return;
    expect(result.reason).toBe('state-unreadable');
  });

  it('refuses state-wrong for a phase that does not deliver', () => {
    const result = deliver(planWith({ phase: 'superseded' }), { on: '2026-08-29' });
    expect(isRefusal(result)).toBe(true);
    if (!isRefusal(result)) return;
    expect(result.reason).toBe('state-wrong');
  });

  it('refuses precondition-unmet when a branch reading says work is outstanding', () => {
    const result = deliver(planWith({ phase: 'approved' }), {
      on: '2026-08-29',
      preconditions: [{ name: 'all branches merged', met: false, detail: '2 branches not merged' }],
    });
    expect(isRefusal(result)).toBe(true);
    if (!isRefusal(result)) return;
    expect(result.reason).toBe('precondition-unmet');
    expect(result.detail).toContain('2 branches not merged');
  });
});

describe('release', () => {
  it('returns a decision carrying the phase and its record together', () => {
    const result = release(planWith({ phase: 'delivered' }), {
      on: '2026-08-29',
      version: 'v2.6.0',
    });
    expect(isDecision(result)).toBe(true);
    if (!isDecision(result)) return;
    expect(result.phase).toBe('released');
    expect(result.record).toBe('2026-08-29, v2.6.0');
    expect(result.field).toBe('Released');
  });

  it('normalizes a version recorded without its v prefix', () => {
    const result = release(planWith({ phase: 'delivered' }), {
      on: '2026-08-29',
      version: '2.6.0',
    });
    expect(isDecision(result)).toBe(true);
    if (!isDecision(result)) return;
    expect(result.record).toBe('2026-08-29, v2.6.0');
  });

  it('treats an already-released plan with no record as the repairable case', () => {
    const result = release(planWith({ phase: 'released' }), {
      on: '2026-08-29',
      version: 'v2.6.0',
    });
    expect(isDecision(result)).toBe(true);
    if (!isDecision(result)) return;
    expect(result.alreadyRecorded).toBe(false);
  });

  it('reports nothing to do when the phase is released and the record is written', () => {
    const result = release(planWith({ phase: 'released', releasedRecord: '2026-08-01, v2.5.0' }), {
      on: '2026-08-29',
      version: 'v2.6.0',
    });
    expect(isDecision(result)).toBe(true);
    if (!isDecision(result)) return;
    expect(result.alreadyRecorded).toBe(true);
    expect(result.record).toBe('2026-08-01, v2.5.0');
  });

  it('refuses state-too-early: an approved plan must be delivered first', () => {
    const result = release(planWith({ phase: 'approved' }), {
      on: '2026-08-29',
      version: 'v2.6.0',
    });
    expect(isRefusal(result)).toBe(true);
    if (!isRefusal(result)) return;
    expect(result.reason).toBe('state-too-early');
    expect(result.detail).toContain('deliver it first');
  });

  it('refuses state-too-early: a draft plan must be delivered first', () => {
    const result = release(planWith({ phase: 'draft' }), { on: '2026-08-29', version: 'v2.6.0' });
    expect(isRefusal(result)).toBe(true);
    if (!isRefusal(result)) return;
    expect(result.reason).toBe('state-too-early');
  });

  it('refuses state-unreadable rather than guessing an empty phase', () => {
    const result = release(planWith({ phase: 'none' }), { on: '2026-08-29', version: 'v2.6.0' });
    expect(isRefusal(result)).toBe(true);
    if (!isRefusal(result)) return;
    expect(result.reason).toBe('state-unreadable');
  });

  it('refuses state-wrong for a phase that does not release', () => {
    const result = release(planWith({ phase: 'rejected' }), {
      on: '2026-08-29',
      version: 'v2.6.0',
    });
    expect(isRefusal(result)).toBe(true);
    if (!isRefusal(result)) return;
    expect(result.reason).toBe('state-wrong');
  });

  it('refuses version-missing rather than recording a phase with no version', () => {
    const result = release(planWith({ phase: 'delivered' }), { on: '2026-08-29', version: '  ' });
    expect(isRefusal(result)).toBe(true);
    if (!isRefusal(result)) return;
    expect(result.reason).toBe('version-missing');
  });

  it('refuses precondition-unmet when a supplied reading refuses', () => {
    const result = release(planWith({ phase: 'delivered' }), {
      on: '2026-08-29',
      version: 'v2.6.0',
      preconditions: [{ name: 'every Must is done', met: false, detail: '1 Must is open' }],
    });
    expect(isRefusal(result)).toBe(true);
    if (!isRefusal(result)) return;
    expect(result.reason).toBe('precondition-unmet');
  });
});

describe('the offer is separate from the act', () => {
  it('approvable reports whether the board should offer Approve', () => {
    expect(approvable(planWith())).toBe(true);
    expect(approvable(planWith({ phase: 'delivered' }))).toBe(false);
    expect(approvable(planWith({ review: 'in-session' }))).toBe(false);
  });

  it('deliverable reports whether the board should offer Deliver', () => {
    expect(deliverable(planWith({ phase: 'approved' }))).toBe(true);
    expect(deliverable(planWith({ phase: 'draft' }))).toBe(false);
  });

  it('releasable reports whether the board should offer Release', () => {
    expect(releasable(planWith({ phase: 'delivered' }))).toBe(true);
    expect(releasable(planWith({ phase: 'approved' }))).toBe(false);
  });

  it('approve refuses on its own, for a caller that never asked approvable', () => {
    const plan = planWith({ phase: 'delivered' });
    expect(approvable(plan)).toBe(false);
    expect(isRefusal(approve(plan, approvedBy({ who: 'Jan', channel: 'pr' })))).toBe(true);
  });
});

describe('a decision is assertable as a value', () => {
  it('carries the plan it is about, so a writer needs no second lookup', () => {
    const result = approve(planWith({ slug: 'the-domain-moves-out' }), approvedBy({ who: 'Jan', channel: 'pr' }));
    if (!isDecision(result)) throw new Error('expected a decision');
    expect(result.slug).toBe('the-domain-moves-out');
  });

  it('is comparable by deep equality, carrying no functions or dates', () => {
    const twice = () =>
      approve(planWith(), approvedBy({ who: 'Jan', channel: 'plan-PR #42 merged' }));
    expect(twice()).toEqual(twice());
  });

  it('narrows to exactly one of the two shapes', () => {
    const decision = approve(planWith(), approvedBy({ who: 'Jan', channel: 'pr' }));
    const refusal = approve(planWith({ phase: 'released' }), approvedBy({ who: 'Jan', channel: 'pr' }));
    expect([isDecision(decision), isRefusal(decision)]).toEqual([true, false]);
    expect([isDecision(refusal), isRefusal(refusal)]).toEqual([false, true]);
  });
});

describe('reject', () => {
  it('returns a decision carrying the state and its record together', () => {
    const result = reject(planWith(), {
      on: '2026-09-07',
      who: 'Jan Wloka',
      why: 'the defect it fixes was disproved',
    });
    expect(isDecision(result)).toBe(true);
    if (!isDecision(result)) return;
    expect(result.phase).toBe('rejected');
    expect(result.field).toBe('Rejected');
    expect(result.record).toBe('2026-09-07, Jan Wloka, the defect it fixes was disproved');
  });

  it('rejects a design plan', () => {
    const result = reject(planWith({ phase: 'design' }), {
      on: '2026-09-07',
      who: 'Jan',
      why: 'withdrawn',
    });
    expect(isDecision(result)).toBe(true);
  });

  it('rejects an approved plan — approval is not delivery', () => {
    const result = reject(planWith({ phase: 'approved' }), {
      on: '2026-09-07',
      who: 'Jan',
      why: 'withdrawn',
    });
    expect(isDecision(result)).toBe(true);
  });

  it('treats an already-rejected plan with no record as the repairable case', () => {
    const result = reject(planWith({ phase: 'rejected' }), {
      on: '2026-09-07',
      who: 'Jan',
      why: 'withdrawn',
    });
    expect(isDecision(result)).toBe(true);
    if (!isDecision(result)) return;
    expect(result.alreadyRecorded).toBe(false);
  });

  it('reports nothing to do when the state is rejected and the record is written', () => {
    const result = reject(
      planWith({ phase: 'rejected', rejectedRecord: '2026-08-31, Jan Wloka, in-session' }),
      { on: '2026-09-07', who: 'Jan', why: 'withdrawn' },
    );
    expect(isDecision(result)).toBe(true);
    if (!isDecision(result)) return;
    expect(result.alreadyRecorded).toBe(true);
    expect(result.record).toBe('2026-08-31, Jan Wloka, in-session');
  });

  it('keeps the written record when repairing a plan whose reason was never supplied', () => {
    const result = reject(planWith({ phase: 'rejected', rejectedRecord: '2026-08-31, Jan, why' }), {
      on: '2026-09-07',
      who: 'Jan',
      why: '   ',
    });
    expect(isDecision(result)).toBe(true);
    if (!isDecision(result)) return;
    expect(result.record).toBe('2026-08-31, Jan, why');
  });

  // --- one test per refusal, named for it ---------------------------------

  it('refuses state-terminal: a delivered plan cannot be un-shipped by a verdict', () => {
    const result = reject(planWith({ phase: 'delivered' }), {
      on: '2026-09-07',
      who: 'Jan',
      why: 'withdrawn',
    });
    expect(isRefusal(result)).toBe(true);
    if (!isRefusal(result)) return;
    expect(result.reason).toBe('state-terminal');
    expect(result.detail).toContain('delivered');
    expect(result.detail).toContain('landed work');
  });

  it('refuses state-terminal: a released plan cannot be rejected', () => {
    const result = reject(planWith({ phase: 'released' }), {
      on: '2026-09-07',
      who: 'Jan',
      why: 'withdrawn',
    });
    expect(isRefusal(result)).toBe(true);
    if (!isRefusal(result)) return;
    expect(result.reason).toBe('state-terminal');
  });

  it('refuses state-unreadable rather than guessing an empty state', () => {
    const result = reject(planWith({ phase: 'none' }), {
      on: '2026-09-07',
      who: 'Jan',
      why: 'withdrawn',
    });
    expect(isRefusal(result)).toBe(true);
    if (!isRefusal(result)) return;
    expect(result.reason).toBe('state-unreadable');
  });

  it('refuses state-wrong: a superseded plan already left the lifecycle', () => {
    const result = reject(planWith({ phase: 'superseded' }), {
      on: '2026-09-07',
      who: 'Jan',
      why: 'withdrawn',
    });
    expect(isRefusal(result)).toBe(true);
    if (!isRefusal(result)) return;
    expect(result.reason).toBe('state-wrong');
    expect(result.detail).toContain('superseded');
  });

  it('refuses state-wrong for a state outside the union', () => {
    const result = reject(planWith({ phase: 'abandoned' as never }), {
      on: '2026-09-07',
      who: 'Jan',
      why: 'withdrawn',
    });
    expect(isRefusal(result)).toBe(true);
    if (!isRefusal(result)) return;
    expect(result.reason).toBe('state-wrong');
    expect(result.detail).toContain('abandoned');
  });

  it('refuses reason-missing rather than recording a verdict nobody can act on', () => {
    const result = reject(planWith(), { on: '2026-09-07', who: 'Jan', why: '   ' });
    expect(isRefusal(result)).toBe(true);
    if (!isRefusal(result)) return;
    expect(result.reason).toBe('reason-missing');
  });

  it('refuses precondition-unmet when a supplied reading refuses', () => {
    const result = reject(planWith(), {
      on: '2026-09-07',
      who: 'Jan',
      why: 'withdrawn',
      preconditions: [{ name: 'no branch has landed', met: false, detail: '1 branch merged' }],
    });
    expect(isRefusal(result)).toBe(true);
    if (!isRefusal(result)) return;
    expect(result.reason).toBe('precondition-unmet');
    expect(result.detail).toContain('1 branch merged');
  });

  it('proceeds when every supplied reading is met', () => {
    const result = reject(planWith(), {
      on: '2026-09-07',
      who: 'Jan',
      why: 'withdrawn',
      preconditions: [{ name: 'no branch has landed', met: true }],
    });
    expect(isDecision(result)).toBe(true);
  });

  it('reads a plan carrying no rejection field as one carrying no rejection', () => {
    const { rejectedRecord: _unused, ...without } = planWith({ rejectedRecord: '' });
    const result = reject(without, { on: '2026-09-07', who: 'Jan', why: 'withdrawn' });
    expect(isDecision(result)).toBe(true);
    if (!isDecision(result)) return;
    expect(result.record).toBe('2026-09-07, Jan, withdrawn');
  });
});

describe('undeliver', () => {
  const why = 'the corpus slice was never built';

  it('returns a decision carrying approved and its Rejected record', () => {
    const result = undeliver(planWith({ phase: 'delivered' }), { on: '2026-09-09', why });
    expect(isDecision(result)).toBe(true);
    if (!isDecision(result)) return;
    expect(result.phase).toBe('approved');
    expect(result.field).toBe('Rejected');
    expect(result.record).toBe(`2026-09-09, ${why}`);
  });

  it('treats an approved plan with no record as the repairable case', () => {
    // A phase that flipped without its record is half a reversal, and the
    // repair is to write the record — not to refuse the plan as never
    // delivered, which is what its phase alone now says.
    const result = undeliver(planWith({ phase: 'approved' }), { on: '2026-09-09', why });
    expect(isDecision(result)).toBe(true);
    if (!isDecision(result)) return;
    expect(result.alreadyRecorded).toBe(false);
  });

  it('reports nothing to do when the phase is approved and the record is written', () => {
    const result = undeliver(
      planWith({ phase: 'approved', rejectedRecord: '2026-09-01, an earlier reason' }),
      { on: '2026-09-09', why },
    );
    expect(isDecision(result)).toBe(true);
    if (!isDecision(result)) return;
    expect(result.alreadyRecorded).toBe(true);
    expect(result.record).toBe('2026-09-01, an earlier reason');
  });

  it('keeps the written record rather than overwriting it with a new reason', () => {
    // The recorded reason belongs to the reversal that happened. A repair run
    // supplying a different one must not rewrite history to say the other thing.
    const result = undeliver(
      planWith({ phase: 'delivered', rejectedRecord: '2026-09-01, the first reason' }),
      { on: '2026-09-09', why: 'a different reason' },
    );
    expect(isDecision(result)).toBe(true);
    if (!isDecision(result)) return;
    expect(result.record).toBe('2026-09-01, the first reason');
  });

  it('refuses state-terminal: a released plan cannot have its delivery reversed', () => {
    // A TAG IS PUBLIC. No edit to a phase field makes a published release
    // not have happened, so this is terminal rather than merely blocked.
    const result = undeliver(planWith({ phase: 'released' }), { on: '2026-09-09', why });
    expect(isRefusal(result)).toBe(true);
    if (!isRefusal(result)) return;
    expect(result.reason).toBe('state-terminal');
  });

  it('refuses state-too-early: a draft plan was never delivered', () => {
    const result = undeliver(planWith({ phase: 'draft' }), { on: '2026-09-09', why });
    expect(isRefusal(result)).toBe(true);
    if (!isRefusal(result)) return;
    expect(result.reason).toBe('state-too-early');
  });

  it('refuses state-too-early for a design plan too', () => {
    const result = undeliver(planWith({ phase: 'design' }), { on: '2026-09-09', why });
    expect(isRefusal(result)).toBe(true);
    if (!isRefusal(result)) return;
    expect(result.reason).toBe('state-too-early');
  });

  it('refuses state-unreadable rather than guessing an unreadable phase', () => {
    const result = undeliver(planWith({ phase: 'none' }), { on: '2026-09-09', why });
    expect(isRefusal(result)).toBe(true);
    if (!isRefusal(result)) return;
    expect(result.reason).toBe('state-unreadable');
  });

  it('refuses state-wrong: a plan that left the lifecycle has no delivery', () => {
    const result = undeliver(planWith({ phase: 'rejected' }), { on: '2026-09-09', why });
    expect(isRefusal(result)).toBe(true);
    if (!isRefusal(result)) return;
    expect(result.reason).toBe('state-wrong');
  });

  it('refuses reason-missing: a reversal with nothing saying why is unactionable', () => {
    const result = undeliver(planWith({ phase: 'delivered' }), { on: '2026-09-09', why: '   ' });
    expect(isRefusal(result)).toBe(true);
    if (!isRefusal(result)) return;
    expect(result.reason).toBe('reason-missing');
  });

  it('asks for no reason where one is already written', () => {
    // The reason was recorded when the delivery was reversed. A repair run is
    // finishing that write, not making the claim again.
    const result = undeliver(
      planWith({ phase: 'delivered', rejectedRecord: '2026-09-01, the reason' }),
      { on: '2026-09-09', why: '' },
    );
    expect(isDecision(result)).toBe(true);
  });

  it('refuses refs-swept by its own name, not as a generic unmet reading', () => {
    // A CALLER WHOSE REFS WERE SWEPT HAS ONE REPAIR. `precondition-unmet`
    // sends it looking for a reading it forgot to supply, which is a different
    // mistake with a different fix.
    const result = undeliver(planWith({ phase: 'delivered' }), {
      on: '2026-09-09',
      why,
      preconditions: [{ name: 'refs', met: false }],
    });
    expect(isRefusal(result)).toBe(true);
    if (!isRefusal(result)) return;
    expect(result.reason).toBe('refs-swept');
  });

  it('names the swept branches where the reading carried them', () => {
    const result = undeliver(planWith({ phase: 'delivered' }), {
      on: '2026-09-09',
      why,
      preconditions: [{ name: 'refs', met: false, detail: 'feature/a, feature/b' }],
    });
    expect(isRefusal(result)).toBe(true);
    if (!isRefusal(result)) return;
    expect(result.detail).toContain('feature/a, feature/b');
  });

  it('passes a met refs reading through to the decision', () => {
    const result = undeliver(planWith({ phase: 'delivered' }), {
      on: '2026-09-09',
      why,
      preconditions: [{ name: 'refs', met: true }],
    });
    expect(isDecision(result)).toBe(true);
  });

  it('refuses precondition-unmet for any other unmet reading', () => {
    const result = undeliver(planWith({ phase: 'delivered' }), {
      on: '2026-09-09',
      why,
      preconditions: [{ name: 'clean-tree', met: false }],
    });
    expect(isRefusal(result)).toBe(true);
    if (!isRefusal(result)) return;
    expect(result.reason).toBe('precondition-unmet');
  });

  it('offers the act separately from taking it', () => {
    expect(undeliverable(planWith({ phase: 'delivered' }))).toBe(true);
    expect(undeliverable(planWith({ phase: 'released' }))).toBe(false);
    expect(undeliverable(planWith({ phase: 'draft' }))).toBe(false);
  });

  it('is not reject: the two write one field and no shared state', () => {
    // `reject` writes the TERMINAL `rejected` state — a verdict that a plan
    // will not be built. This returns Delivered to Approved and keeps it live.
    // They share the `Rejected:` line because a plan file has one place for
    // *somebody said no*; a caller reaching for the wrong one is refused.
    const reversed = undeliver(planWith({ phase: 'delivered' }), { on: '2026-09-09', why });
    expect(isDecision(reversed)).toBe(true);
    if (!isDecision(reversed)) return;
    expect(reversed.phase).toBe('approved');

    expect(
      isRefusal(reject(planWith({ phase: 'delivered' }), { on: '2026-09-09', who: 'Jan', why })),
    ).toBe(true);
  });
});

describe('supersede', () => {
  it('returns a decision carrying the state and its record together', () => {
    const result = supersede(planWith(), {
      on: '2026-09-07',
      by: 'the-wave-is-a-thing-the-board-can-hold',
    });
    expect(isDecision(result)).toBe(true);
    if (!isDecision(result)) return;
    expect(result.phase).toBe('superseded');
    expect(result.field).toBe('Superseded');
    expect(result.record).toBe('2026-09-07, by `the-wave-is-a-thing-the-board-can-hold`');
  });

  it('supersedes a design plan', () => {
    const result = supersede(planWith({ phase: 'design' }), { on: '2026-09-07', by: 'a-successor' });
    expect(isDecision(result)).toBe(true);
  });

  it('supersedes an approved plan', () => {
    const result = supersede(planWith({ phase: 'approved' }), {
      on: '2026-09-07',
      by: 'a-successor',
    });
    expect(isDecision(result)).toBe(true);
  });

  it('treats an already-superseded plan with no record as the repairable case', () => {
    const result = supersede(planWith({ phase: 'superseded' }), {
      on: '2026-09-07',
      by: 'a-successor',
    });
    expect(isDecision(result)).toBe(true);
    if (!isDecision(result)) return;
    expect(result.alreadyRecorded).toBe(false);
  });

  it('reports nothing to do when the state is superseded and the record is written', () => {
    const result = supersede(
      planWith({
        phase: 'superseded',
        supersededRecord: '2026-08-23, by `the-wave-is-a-thing-the-board-can-hold`',
      }),
      { on: '2026-09-07', by: 'a-successor' },
    );
    expect(isDecision(result)).toBe(true);
    if (!isDecision(result)) return;
    expect(result.alreadyRecorded).toBe(true);
    expect(result.record).toBe('2026-08-23, by `the-wave-is-a-thing-the-board-can-hold`');
  });

  it('keeps the written record when repairing a plan whose successor was never supplied', () => {
    const result = supersede(
      planWith({ phase: 'superseded', supersededRecord: '2026-08-22 — see the notes' }),
      { on: '2026-09-07', by: '  ' },
    );
    expect(isDecision(result)).toBe(true);
    if (!isDecision(result)) return;
    expect(result.record).toBe('2026-08-22 — see the notes');
  });

  // --- one test per refusal, named for it ---------------------------------

  it('refuses state-terminal: a delivered plan cannot be superseded', () => {
    const result = supersede(planWith({ phase: 'delivered' }), {
      on: '2026-09-07',
      by: 'a-successor',
    });
    expect(isRefusal(result)).toBe(true);
    if (!isRefusal(result)) return;
    expect(result.reason).toBe('state-terminal');
    expect(result.detail).toContain('landed work');
  });

  it('refuses state-terminal: a released plan cannot be superseded', () => {
    const result = supersede(planWith({ phase: 'released' }), {
      on: '2026-09-07',
      by: 'a-successor',
    });
    expect(isRefusal(result)).toBe(true);
    if (!isRefusal(result)) return;
    expect(result.reason).toBe('state-terminal');
  });

  it('refuses state-unreadable rather than guessing an empty state', () => {
    const result = supersede(planWith({ phase: 'none' }), { on: '2026-09-07', by: 'a-successor' });
    expect(isRefusal(result)).toBe(true);
    if (!isRefusal(result)) return;
    expect(result.reason).toBe('state-unreadable');
  });

  it('refuses state-wrong: a rejected plan already left the lifecycle', () => {
    const result = supersede(planWith({ phase: 'rejected' }), {
      on: '2026-09-07',
      by: 'a-successor',
    });
    expect(isRefusal(result)).toBe(true);
    if (!isRefusal(result)) return;
    expect(result.reason).toBe('state-wrong');
    expect(result.detail).toContain('rejected');
  });

  it('refuses state-wrong for a state outside the union', () => {
    const result = supersede(planWith({ phase: 'abandoned' as never }), {
      on: '2026-09-07',
      by: 'a-successor',
    });
    expect(isRefusal(result)).toBe(true);
    if (!isRefusal(result)) return;
    expect(result.reason).toBe('state-wrong');
    expect(result.detail).toContain('superseded');
  });

  it('refuses successor-missing rather than losing where the work went', () => {
    const result = supersede(planWith(), { on: '2026-09-07', by: '  ' });
    expect(isRefusal(result)).toBe(true);
    if (!isRefusal(result)) return;
    expect(result.reason).toBe('successor-missing');
  });

  it('refuses precondition-unmet when a supplied reading refuses', () => {
    const result = supersede(planWith(), {
      on: '2026-09-07',
      by: 'a-successor',
      preconditions: [{ name: 'the successor exists', met: false, detail: 'no such plan file' }],
    });
    expect(isRefusal(result)).toBe(true);
    if (!isRefusal(result)) return;
    expect(result.reason).toBe('precondition-unmet');
    expect(result.detail).toContain('no such plan file');
  });

  it('proceeds when every supplied reading is met', () => {
    const result = supersede(planWith(), {
      on: '2026-09-07',
      by: 'a-successor',
      preconditions: [{ name: 'the successor exists', met: true }],
    });
    expect(isDecision(result)).toBe(true);
  });

  it('reads a plan carrying no supersession field as one carrying no supersession', () => {
    const { supersededRecord: _unused, ...without } = planWith({ supersededRecord: '' });
    const result = supersede(without, { on: '2026-09-07', by: 'a-successor' });
    expect(isDecision(result)).toBe(true);
    if (!isDecision(result)) return;
    expect(result.record).toBe('2026-09-07, by `a-successor`');
  });
});

describe('the two exits are not one verb', () => {
  it('rejectable reports whether the board should offer Reject', () => {
    expect(rejectable(planWith())).toBe(true);
    expect(rejectable(planWith({ phase: 'approved' }))).toBe(true);
    expect(rejectable(planWith({ phase: 'delivered' }))).toBe(false);
    expect(rejectable(planWith({ phase: 'superseded' }))).toBe(false);
  });

  it('supersedable reports whether the board should offer Supersede', () => {
    expect(supersedable(planWith())).toBe(true);
    expect(supersedable(planWith({ phase: 'released' }))).toBe(false);
    expect(supersedable(planWith({ phase: 'rejected' }))).toBe(false);
  });

  it('rejectable answers about the state, not about a reason nobody supplied', () => {
    expect(rejectable(planWith())).toBe(true);
    expect(isRefusal(reject(planWith(), { on: '', who: '', why: '' }))).toBe(true);
  });

  it('supersedable answers about the state, not about a successor nobody supplied', () => {
    expect(supersedable(planWith())).toBe(true);
    expect(isRefusal(supersede(planWith(), { on: '', by: '' }))).toBe(true);
  });

  it('a rejection carries why and a supersession carries which — neither carries both', () => {
    const rejected = reject(planWith(), { on: '2026-09-07', who: 'Jan', why: 'disproved' });
    const superseded = supersede(planWith(), { on: '2026-09-07', by: 'a-successor' });
    if (!isDecision(rejected) || !isDecision(superseded)) throw new Error('expected decisions');
    expect(rejected.record).toContain('disproved');
    expect(rejected.record).not.toContain('by `');
    expect(superseded.record).toContain('by `a-successor`');
  });

  it('neither verb accepts what the other has already written', () => {
    expect(isRefusal(reject(planWith({ phase: 'superseded' }), { on: '', who: '', why: 'x' }))).toBe(
      true,
    );
    expect(isRefusal(supersede(planWith({ phase: 'rejected' }), { on: '', by: 'x' }))).toBe(true);
  });
});
