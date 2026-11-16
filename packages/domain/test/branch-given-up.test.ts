import { describe, expect, it } from 'vitest';
import { branchGivenUp, branchGivenUpBy, type PlanBranchLines } from '../src/rules/branch-given-up.js';

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

describe('branchGivenUpBy', () => {
  const line = (active: boolean, file: string, branch: string, deferred: boolean, reason?: string): PlanBranchLines => ({
    active,
    file,
    slices: [{ branches: [{ branch, deferred, ...(reason === undefined ? {} : { reason }) }] }],
  });
  it('names the plan file and reads a leading date from the reason', () => {
    expect(branchGivenUpBy('b', [line(false, 'p.md', 'b', true, '2026-11-02, kept for later')])).toEqual({
      file: 'p.md',
      reason: '2026-11-02, kept for later',
      date: '2026-11-02',
    });
  });
  it('answers a null date when the reason opens with none', () => {
    expect(branchGivenUpBy('b', [line(false, 'p.md', 'b', true, 'verified already implemented')])?.date).toBeNull();
    expect(branchGivenUpBy('b', [line(false, 'p.md', 'b', true)])?.date).toBeNull();
  });
  it('is null when an Active-index plan schedules the branch', () => {
    expect(branchGivenUpBy('b', [line(false, 'p.md', 'b', true, 'x'), line(true, 'q.md', 'b', false)])).toBeNull();
  });
  it('is null when no plan names the branch', () => {
    expect(branchGivenUpBy('b', [])).toBeNull();
  });
});
