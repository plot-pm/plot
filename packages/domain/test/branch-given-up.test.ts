import { describe, expect, it } from 'vitest';
import { branchGivenUp, type PlanBranchLines } from '../src/rules/branch-given-up.js';

const plan = (active: boolean, branch: string, deferred: boolean): PlanBranchLines => ({
  active,
  slices: [{ branches: [{ branch, deferred }] }],
});

describe('branchGivenUp', () => {
  it('is true for a deferred line in a plan outside the Active index', () => {
    expect(branchGivenUp('b', [plan(false, 'b', true)])).toBe(true);
  });
  it('is true for a deferred line in an Active-index plan', () => {
    expect(branchGivenUp('b', [plan(true, 'b', true)])).toBe(true);
  });
  it('is false when no plan names the branch', () => {
    expect(branchGivenUp('b', [plan(true, 'other', true)])).toBe(false);
    expect(branchGivenUp('b', [])).toBe(false);
  });
  it('is false for an unannotated line', () => {
    expect(branchGivenUp('b', [plan(true, 'b', false)])).toBe(false);
  });
  it('is false when an Active-index plan schedules the branch as an active slice', () => {
    expect(branchGivenUp('b', [plan(false, 'b', true), plan(true, 'b', false)])).toBe(false);
  });
  it('ignores an active line in a plan the Active index does not link', () => {
    expect(branchGivenUp('b', [plan(false, 'b', true), plan(false, 'b', false)])).toBe(true);
  });
});
