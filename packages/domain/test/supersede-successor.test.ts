import { describe, expect, it } from 'vitest';
import { successorCandidates, successorEntry, successorPreconditions, supersessionRefusalReason } from '../src/rules/supersede-successor.js';
import { supersede, type TransitionPlan } from '../src/transitions/plan.js';

const plan: TransitionPlan = {
  slug: 'old',
  phase: 'approved',
  review: 'pr',
  approvedRecord: '2026-11-01 by jw',
  deliveredRecord: '',
  releasedRecord: '',
};

describe('successorPreconditions', () => {
  it('meets both readings for a different plan that has a file', () => {
    const readings = successorPreconditions({ slug: 'old', by: 'new', successorFile: 'docs/plans/2026-11-02-new.md' });
    expect(readings.map((r) => [r.name, r.met])).toEqual([['same-plan', true], ['successor-not-found', true]]);
    expect(supersede(plan, { on: '2026-11-15', by: 'new', preconditions: readings })).toMatchObject({
      outcome: 'decided',
      phase: 'superseded',
      record: '2026-11-15, by `new`',
    });
  });

  it('refuses a successor that names the plan itself as same-plan', () => {
    const readings = successorPreconditions({ slug: 'old', by: ' old ', successorFile: 'docs/plans/2026-11-01-old.md' });
    const decided = supersede(plan, { on: '2026-11-15', by: 'old', preconditions: readings });
    expect(decided).toMatchObject({ outcome: 'refused', reason: 'precondition-unmet' });
    expect(decided.outcome === 'refused' && decided.detail).toContain("'same-plan'");
  });

  it('refuses a successor with no plan file as successor-not-found', () => {
    const readings = successorPreconditions({ slug: 'old', by: 'nowhere', successorFile: '' });
    const decided = supersede(plan, { on: '2026-11-15', by: 'nowhere', preconditions: readings });
    expect(decided).toMatchObject({ outcome: 'refused', reason: 'precondition-unmet' });
    expect(decided.outcome === 'refused' && decided.detail).toContain("'successor-not-found'");
  });

  it('produces no reading for an empty successor, which supersede refuses as successor-missing', () => {
    const readings = successorPreconditions({ slug: 'old', by: '', successorFile: '' });
    expect(readings).toEqual([]);
    expect(supersede(plan, { on: '2026-11-15', by: '', preconditions: readings })).toMatchObject({
      outcome: 'refused',
      reason: 'successor-missing',
    });
  });
});

describe('supersessionRefusalReason', () => {
  it('names the unmet successor reading', () => {
    const readings = successorPreconditions({ slug: 'old', by: 'nowhere', successorFile: '' });
    const decided = supersede(plan, { on: '2026-11-15', by: 'nowhere', preconditions: readings });
    expect(decided.outcome === 'refused' && supersessionRefusalReason(decided, readings)).toBe('successor-not-found');
  });

  it('keeps the domain reason for a state refusal', () => {
    const readings = successorPreconditions({ slug: 'old', by: 'new', successorFile: 'docs/plans/new.md' });
    const decided = supersede({ ...plan, phase: 'delivered' }, { on: '2026-11-15', by: 'new', preconditions: readings });
    expect(decided.outcome === 'refused' && supersessionRefusalReason(decided, readings)).toBe('state-terminal');
  });

  it('keeps precondition-unmet where the unmet reading is not a successor one', () => {
    const readings = [
      ...successorPreconditions({ slug: 'old', by: 'new', successorFile: 'docs/plans/new.md' }),
      { name: 'tree-clean', met: false, detail: 'the tree is dirty' },
    ];
    const decided = supersede(plan, { on: '2026-11-15', by: 'new', preconditions: readings });
    expect(decided.outcome === 'refused' && supersessionRefusalReason(decided, readings)).toBe('precondition-unmet');
  });
});

describe('successorCandidates', () => {
  it('offers every other plan once, sorted', () => {
    expect(successorCandidates('old', ['zeta', 'old', 'alpha', 'zeta'])).toEqual(['alpha', 'zeta']);
  });
});

describe('successorEntry', () => {
  it('is ready for another slug, trimmed', () => {
    expect(successorEntry('old', ' new ')).toEqual({ by: 'new', ready: true, reason: null });
  });

  it('is not ready while empty, naming the missing successor', () => {
    expect(successorEntry('old', '  ')).toEqual({ by: '', ready: false, reason: 'name the successor plan first' });
  });

  it('is not ready for the plan itself', () => {
    expect(successorEntry('old', 'old')).toEqual({ by: 'old', ready: false, reason: 'a plan cannot supersede itself' });
  });
});
