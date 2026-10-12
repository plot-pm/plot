import { describe, expect, it } from 'vitest';

import { planStatus, type PlanReadings } from '../src/rules/phase.js';

/**
 * The phase rules, moved from the board's view layer.
 *
 * A phase is a rule about a Plan and a column is a rule about a Branch; neither
 * is a rendering concern. That the board still produces the same payload is
 * asserted by the move's byte-for-byte comparison, not here.
 */
const readings = (over: Partial<PlanReadings> = {}): PlanReadings => ({
  phase: 'approved',
  review: 'in-session',
  started: false,
  landed: 'not-merged',
  anyClaimed: false,
  ...over,
});

describe('planStatus — what a reader acts on', () => {
  it('renames the terminal phases and nothing more', () => {
    expect(planStatus(readings({ phase: 'released' }))).toBe('released');
    expect(planStatus(readings({ phase: 'delivered' }))).toBe('delivered');
  });

  it('calls an approved plan whose branches have all landed deliverable', () => {
    expect(planStatus(readings({ landed: 'merged' }))).toBe('deliverable');
  });

  it('prefers deliverable over in-progress when both could hold', () => {
    // Landed outranks started: a plan whose work is done is deliverable even
    // though somebody started it — which is how it came to be done.
    expect(planStatus(readings({ landed: 'merged', started: true, anyClaimed: true })))
      .toBe('deliverable');
  });

  it('calls an approved plan in progress once it is started OR claimed', () => {
    expect(planStatus(readings({ started: true }))).toBe('in-progress');
    expect(planStatus(readings({ anyClaimed: true }))).toBe('in-progress');
  });

  it('leaves an approved plan nobody has touched as approved', () => {
    expect(planStatus(readings())).toBe('approved');
  });

  it('splits a draft on its review channel, not on its phase', () => {
    // `Review: pr` means the draft is public and readable, which is `open`;
    // anything else is still a draft nobody outside the session can see.
    expect(planStatus(readings({ phase: 'draft', review: 'pr' }))).toBe('open');
    expect(planStatus(readings({ phase: 'draft', review: 'in-session' }))).toBe('draft');
  });

  it('treats an unknown phase as a draft rather than refusing', () => {
    // The default arm: a status is always answerable, unlike a column. A plan
    // whose phase does not parse is one nobody has approved.
    //
    // THE EXAMPLE USED TO BE `withdrawn`, which is not a plan phase — the two
    // real ones are `rejected` and `superseded`, and both now have their own
    // arm. Keeping it here would have asserted the new status by accident and
    // left the default arm untested. The example is a phase nothing writes.
    expect(planStatus(readings({ phase: 'not-a-phase' }))).toBe('draft');
    expect(planStatus(readings({ phase: '' }))).toBe('draft');
  });

  it('answers withdrawn for a plan somebody rejected or superseded', () => {
    // THE DEFECT: both fell through the default arm to `draft`/`open`, so the
    // estate counter reported work nobody intends to do as outstanding. A
    // withdrawn plan renders no card at all — `phaseOfPlan` answers null — so
    // the board looked right while the number did not.
    expect(planStatus(readings({ phase: 'rejected' }))).toBe('withdrawn');
    expect(planStatus(readings({ phase: 'superseded' }))).toBe('withdrawn');
  });

  it('answers withdrawn whatever the review channel says', () => {
    // The draft arm splits on `Review: pr`, and a rejected plan reached it.
    // A public draft somebody rejected is still rejected, so the withdrawn arm
    // returns BEFORE the channel is consulted.
    expect(planStatus(readings({ phase: 'rejected', review: 'pr' }))).toBe('withdrawn');
    expect(planStatus(readings({ phase: 'superseded', review: 'pr' }))).toBe('withdrawn');
  });

  it('does not read landed or claimed on a withdrawn plan', () => {
    // Terminal like `released`: a superseded plan whose branches happen to have
    // landed is still superseded, and asserting it stops a future edit from
    // making it deliverable.
    expect(planStatus(readings({ phase: 'rejected', landed: 'merged', started: true })))
      .toBe('withdrawn');
  });

  it('does not read landed or claimed on a terminal phase', () => {
    // The switch returns before either is consulted, and asserting it stops a
    // future edit from making a released plan deliverable again.
    expect(planStatus(readings({ phase: 'released', landed: 'merged' }))).toBe('released');
  });
});
