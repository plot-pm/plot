import { describe, expect, it } from 'vitest';

import { BOARD_PHASES, planStatus, rowPhase, toBoardPhase, type PlanReadings } from '../src/rules/phase.js';

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

describe('toBoardPhase — the column a plan phase belongs to', () => {
  it('maps every phase the plan format states', () => {
    expect(toBoardPhase('draft')).toBe('Discovery');
    expect(toBoardPhase('design')).toBe('Design');
    expect(toBoardPhase('approved')).toBe('Development');
    expect(toBoardPhase('delivered')).toBe('Testing');
    expect(toBoardPhase('released')).toBe('Released');
  });

  it('answers null for a phase it does not know', () => {
    // Not a default column: a phase this does not know is a plan format this
    // board does not understand, and Discovery would be a confident answer to
    // a question nobody could answer.
    expect(toBoardPhase('withdrawn')).toBeNull();
    expect(toBoardPhase('')).toBeNull();
  });

  it('ignores the started flag, which is a seam rather than an input', () => {
    // Kept in the signature for the day a phase forks on `started` again; with
    // the Design fork gone it changes no answer, and a test says so rather than
    // leaving a reader to infer it from an unused parameter.
    expect(toBoardPhase('approved', true)).toBe(toBoardPhase('approved', false));
  });

  it('returns only columns the board declares', () => {
    for (const phase of ['draft', 'design', 'approved', 'delivered', 'released']) {
      expect(BOARD_PHASES).toContain(toBoardPhase(phase));
    }
  });
});

describe('rowPhase — the column ONE branch belongs to', () => {
  it('sends a deferred branch back to its plan phase, whatever its commits say', () => {
    // The one place intent outranks git: a branch given up is not work in
    // progress, however far ahead it is.
    expect(rowPhase('approved', 'deferred')).toBe('Development');
    expect(rowPhase('delivered', 'deferred')).toBe('Testing');
  });

  it('reads merged and wip as started, and claimed as not', () => {
    // An empty claim marker is a dispatcher taking a branch, not an agent
    // having built anything. The mapping does not fork on it today, so what is
    // asserted is that all three land in the plan's column.
    expect(rowPhase('approved', 'merged')).toBe('Development');
    expect(rowPhase('approved', 'wip')).toBe('Development');
    expect(rowPhase('approved', 'claimed')).toBe('Development');
    expect(rowPhase('approved', 'open')).toBe('Development');
  });

  it('carries the null through for a phase it does not know', () => {
    expect(rowPhase('withdrawn', 'open')).toBeNull();
    expect(rowPhase('withdrawn', 'deferred')).toBeNull();
  });
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
    expect(planStatus(readings({ phase: 'withdrawn' }))).toBe('draft');
  });

  it('does not read landed or claimed on a terminal phase', () => {
    // The switch returns before either is consulted, and asserting it stops a
    // future edit from making a released plan deliverable again.
    expect(planStatus(readings({ phase: 'released', landed: 'merged' }))).toBe('released');
  });
});
