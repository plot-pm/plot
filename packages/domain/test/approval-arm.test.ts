import { describe, expect, it } from 'vitest';

import { approvalArm } from '../src/rules/approval-arm.js';

describe('approvalArm', () => {
  it.each(['pr', 'in-session', 'NONE', 'none', ''])('answers person for a design plan on Review: %j', (review) => {
    expect(approvalArm({ phase: 'design', review })).toBe('person');
  });

  it.each(['design', 'draft', 'approved', 'none'])('answers ballot for a ballot plan in phase %s', (phase) => {
    expect(approvalArm({ phase, review: 'ballot' })).toBe('ballot');
  });

  it.each(['draft', 'approved', 'none'])('answers pr for a %s plan on Review: pr', (phase) => {
    expect(approvalArm({ phase, review: 'pr' })).toBe('pr');
  });

  it('answers person for an in-session plan in any phase', () => {
    expect(approvalArm({ phase: 'draft', review: 'in-session' })).toBe('person');
  });

  it('answers pr for an unrecognised review on a Design plan', () => {
    expect(approvalArm({ phase: 'design', review: 'vote' })).toBe('pr');
  });
});
