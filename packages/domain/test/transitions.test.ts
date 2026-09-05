import { describe, expect, it } from 'vitest';
import {
  approvable,
  approve,
  deliver,
  deliverable,
  isDecision,
  isRefusal,
  releasable,
  release,
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

describe('approve', () => {
  it('returns a decision carrying the phase and its record together', () => {
    const result = approve(planWith(), {
      on: '2026-08-29',
      who: 'Jan Wloka',
      channel: 'plan-PR #42 merged',
    });
    expect(isDecision(result)).toBe(true);
    if (!isDecision(result)) return;
    expect(result.phase).toBe('approved');
    expect(result.record).toBe('2026-08-29, Jan Wloka, plan-PR #42 merged');
    expect(result.field).toBe('Approved');
  });

  it('approves a design plan, the forward exit from the transitional phase', () => {
    const result = approve(planWith({ phase: 'design' }), {
      on: '2026-08-29',
      who: 'Jan Wloka',
      channel: 'plan-PR #42 merged',
    });
    expect(isDecision(result)).toBe(true);
  });

  it('treats an already-approved plan with no record as the repairable case', () => {
    const result = approve(planWith({ phase: 'approved' }), {
      on: '2026-08-29',
      who: 'Jan Wloka',
      channel: 'plan-PR #42 merged',
    });
    expect(isDecision(result)).toBe(true);
  });

  it('reports nothing to do when the phase is approved and the record is written', () => {
    const result = approve(planWith({ phase: 'approved', approvedRecord: '2026-08-01, Jan, pr' }), {
      on: '2026-08-29',
      who: 'Jan Wloka',
      channel: 'plan-PR #42 merged',
    });
    expect(isDecision(result)).toBe(true);
    if (!isDecision(result)) return;
    expect(result.alreadyRecorded).toBe(true);
    expect(result.record).toBe('2026-08-01, Jan, pr');
  });

  it('accepts a plan whose review channel was never recorded', () => {
    const result = approve(planWith({ review: 'none' }), {
      on: '2026-08-29',
      who: 'Jan Wloka',
      channel: 'plan-PR #42 merged',
    });
    expect(isDecision(result)).toBe(true);
  });

  // --- one test per refusal, named for it ---------------------------------

  it('refuses state-terminal: a delivered plan has nothing to approve', () => {
    const result = approve(planWith({ phase: 'delivered' }), {
      on: '2026-08-29',
      who: 'Jan',
      channel: 'pr',
    });
    expect(isRefusal(result)).toBe(true);
    if (!isRefusal(result)) return;
    expect(result.reason).toBe('state-terminal');
    expect(result.detail).toContain('delivered');
  });

  it('refuses state-terminal: a released plan has nothing to approve', () => {
    const result = approve(planWith({ phase: 'released' }), {
      on: '2026-08-29',
      who: 'Jan',
      channel: 'pr',
    });
    expect(isRefusal(result)).toBe(true);
    if (!isRefusal(result)) return;
    expect(result.reason).toBe('state-terminal');
  });

  it('refuses state-unreadable rather than guessing an empty phase', () => {
    const result = approve(planWith({ phase: 'none' }), {
      on: '2026-08-29',
      who: 'Jan',
      channel: 'pr',
    });
    expect(isRefusal(result)).toBe(true);
    if (!isRefusal(result)) return;
    expect(result.reason).toBe('state-unreadable');
  });

  it('refuses state-wrong for a phase that does not approve', () => {
    const result = approve(planWith({ phase: 'rejected' }), {
      on: '2026-08-29',
      who: 'Jan',
      channel: 'pr',
    });
    expect(isRefusal(result)).toBe(true);
    if (!isRefusal(result)) return;
    expect(result.reason).toBe('state-wrong');
    expect(result.detail).toContain('rejected');
  });

  it('refuses review-human for an in-session channel', () => {
    const result = approve(planWith({ review: 'in-session' }), {
      on: '2026-08-29',
      who: 'Jan',
      channel: 'pr',
    });
    expect(isRefusal(result)).toBe(true);
    if (!isRefusal(result)) return;
    expect(result.reason).toBe('review-human');
    expect(result.detail).toContain('in-session');
  });

  it('refuses review-human for a ballot channel', () => {
    const result = approve(planWith({ review: 'ballot' }), {
      on: '2026-08-29',
      who: 'Jan',
      channel: 'pr',
    });
    expect(isRefusal(result)).toBe(true);
    if (!isRefusal(result)) return;
    expect(result.reason).toBe('review-human');
    expect(result.detail).toContain('ballot');
  });

  it('refuses review-unrecognised rather than defaulting an unknown channel to pr', () => {
    const result = approve(planWith({ review: 'carrier-pigeon' }), {
      on: '2026-08-29',
      who: 'Jan',
      channel: 'pr',
    });
    expect(isRefusal(result)).toBe(true);
    if (!isRefusal(result)) return;
    expect(result.reason).toBe('review-unrecognised');
    expect(result.detail).toContain('carrier-pigeon');
  });

  it('refuses precondition-unmet when a supplied reading refuses', () => {
    const result = approve(planWith(), {
      on: '2026-08-29',
      who: 'Jan',
      channel: 'pr',
      preconditions: [{ name: 'plan-PR merged', met: false, detail: 'PR #42 is closed' }],
    });
    expect(isRefusal(result)).toBe(true);
    if (!isRefusal(result)) return;
    expect(result.reason).toBe('precondition-unmet');
    expect(result.detail).toContain('plan-PR merged');
    expect(result.detail).toContain('PR #42 is closed');
  });

  it('proceeds when every supplied reading is met', () => {
    const result = approve(planWith(), {
      on: '2026-08-29',
      who: 'Jan',
      channel: 'pr',
      preconditions: [{ name: 'plan-PR merged', met: true }],
    });
    expect(isDecision(result)).toBe(true);
  });

  it('names a failing precondition that carries no detail', () => {
    const result = approve(planWith(), {
      on: '2026-08-29',
      who: 'Jan',
      channel: 'pr',
      preconditions: [{ name: 'plan-PR merged', met: false }],
    });
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
    expect(isRefusal(approve(plan, { on: '2026-08-29', who: 'Jan', channel: 'pr' }))).toBe(true);
  });
});

describe('a decision is assertable as a value', () => {
  it('carries the plan it is about, so a writer needs no second lookup', () => {
    const result = approve(planWith({ slug: 'the-domain-moves-out' }), {
      on: '2026-08-29',
      who: 'Jan',
      channel: 'pr',
    });
    if (!isDecision(result)) throw new Error('expected a decision');
    expect(result.slug).toBe('the-domain-moves-out');
  });

  it('is comparable by deep equality, carrying no functions or dates', () => {
    const twice = () =>
      approve(planWith(), { on: '2026-08-29', who: 'Jan', channel: 'plan-PR #42 merged' });
    expect(twice()).toEqual(twice());
  });

  it('narrows to exactly one of the two shapes', () => {
    const decision = approve(planWith(), { on: '2026-08-29', who: 'Jan', channel: 'pr' });
    const refusal = approve(planWith({ phase: 'released' }), {
      on: '2026-08-29',
      who: 'Jan',
      channel: 'pr',
    });
    expect([isDecision(decision), isRefusal(decision)]).toEqual([true, false]);
    expect([isDecision(refusal), isRefusal(refusal)]).toEqual([false, true]);
  });
});
