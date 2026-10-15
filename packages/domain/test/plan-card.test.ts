import { describe, expect, it } from 'vitest';
import { planCardApprover, planCardView, type PlanCardReading } from '../src/rules/plan-card.js';

const reading = (over: Partial<PlanCardReading> = {}): PlanCardReading => ({
  type: 'feature',
  assignee: '',
  approvedRaw: '',
  ...over,
});

describe('planCardApprover', () => {
  it('reads the who position from a well-formed record', () => {
    expect(planCardApprover('2026-10-15, Jan Wloka, plan-PR #1753 merged')).toBe('Jan Wloka');
  });

  it('gives no approver for a legacy bare-timestamp record', () => {
    expect(planCardApprover('2026-03-15T21:02:30Z')).toBe('');
  });

  it('gives no approver for the template placeholder', () => {
    expect(planCardApprover('<date>, <who>, <channel>')).toBe('');
  });

  it('gives no approver for an empty record', () => {
    expect(planCardApprover('')).toBe('');
  });
});

describe('planCardView', () => {
  it('reads the type lowercased', () => {
    expect(planCardView(reading({ type: 'Bug' })).type).toBe('bug');
  });

  it('gives no type where the plan stated none', () => {
    expect(planCardView(reading({ type: '' })).type).toBeNull();
  });

  it('owner is the assignee on a Draft/unapproved plan', () => {
    const view = planCardView(reading({ assignee: 'jwloka', approvedRaw: '' }));
    expect(view.owner).toBe('jwloka');
  });

  it('owner is the approver, resolved from approvedRaw, on an Approved plan', () => {
    const view = planCardView(
      reading({ assignee: 'jwloka', approvedRaw: '2026-10-15, Max Albrecht, plan-PR #1753 merged' }),
      { 'max albrecht': 'eins78' },
    );
    expect(view.owner).toBe('eins78');
  });

  it('gives no owner where the plan stated no assignee and is not yet approved', () => {
    expect(planCardView(reading({ assignee: '', approvedRaw: '' })).owner).toBeNull();
  });

  it('renders an owner spelling undeclared in People as written', () => {
    const view = planCardView(reading({ assignee: 'nobody-declared' }));
    expect(view.owner).toBe('nobody-declared');
  });

  it('gives no owner where an Approved record names no person, even with an assignee stated', () => {
    const view = planCardView(reading({ assignee: 'jwloka', approvedRaw: '2026-03-15T21:02:30Z' }));
    expect(view.owner).toBeNull();
  });
});
