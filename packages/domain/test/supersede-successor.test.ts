import { describe, expect, it } from 'vitest';
import { successorPreconditions } from '../src/rules/supersede-successor.js';
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
