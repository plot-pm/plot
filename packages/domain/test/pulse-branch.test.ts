import { describe, it, expect } from 'vitest';
import { pulseBranchReading, pulsePlanReading, type FleetReading } from '../src/index.js';

const pulse = (branches: string[]): FleetReading =>
  ({
    main: 'main',
    head: 'abc1234',
    plans: [
      {
        file: '/repo/docs/plans/p.md',
        slices: [
          {
            name: 'w',
            verdict: 'eligible',
            branches: branches.map((branch) => ({ branch, state: 'claimed', local_worktree: '/w' })),
          },
        ],
        unreadBranchItems: [],
      },
    ],
    summary: { plans: 1, waves: 1, branches: branches.length, claimed: 0, eligible: 0, blocked: 0, deferred: 0 },
  }) as unknown as FleetReading;

describe('pulseBranchReading', () => {
  it('(a) names a partial pulse when neither scan lists the branch', () => {
    expect(pulseBranchReading(pulse(['x']), false, pulse(['y']), 'nope')).toEqual({ kind: 'pulse-partial' });
    expect(pulseBranchReading(pulse(['x']), false, null, 'nope')).toEqual({ kind: 'pulse-partial' });
  });

  it('(b) reads the last finished scan when the partial one misses the branch', () => {
    const last = pulse(['nope']);
    expect(pulseBranchReading(pulse(['x']), false, last, 'nope')).toEqual({ kind: 'listed', pulse: last });
  });

  it('(c) refuses unknown-branch on a complete pulse, even when the last scan lists it', () => {
    expect(pulseBranchReading(pulse(['x']), true, pulse(['nope']), 'nope')).toEqual({ kind: 'unknown-branch' });
  });

  it('(d) lists a branch a partial pulse already reached', () => {
    const live = pulse(['nope']);
    expect(pulseBranchReading(live, false, null, 'nope')).toEqual({ kind: 'listed', pulse: live });
  });

  it('(e) answers no-pulse for a null live pulse, whatever else is passed', () => {
    for (const complete of [true, false]) {
      expect(pulseBranchReading(null, complete, pulse(['nope']), 'nope')).toEqual({ kind: 'no-pulse' });
    }
  });
});

describe('pulsePlanReading', () => {
  const plans = (...files: string[]): FleetReading =>
    ({ main: 'main', head: 'abc1234', plans: files.map((file) => ({ file, slices: [] })) }) as unknown as FleetReading;

  it('answers no-pulse for a null live pulse', () => {
    for (const complete of [true, false]) {
      expect(pulsePlanReading(null, complete, plans('docs/plans/2026-11-21-p.md'), 'p')).toEqual({ kind: 'no-pulse' });
    }
  });

  it('lists the plan in the live pulse, by its file slug, whether or not the scan finished', () => {
    const live = plans('docs/plans/2026-11-21-other.md', 'docs/plans/2026-11-21-p.md');
    expect(pulsePlanReading(live, true, null, 'p')).toEqual({ kind: 'listed', pulse: live });
    expect(pulsePlanReading(live, false, null, 'p')).toEqual({ kind: 'listed', pulse: live });
  });

  it('answers unknown-plan on a complete pulse without the plan, even when the last scan lists it', () => {
    expect(pulsePlanReading(plans('docs/plans/2026-11-21-other.md'), true, plans('docs/plans/2026-11-21-p.md'), 'p')).toEqual({
      kind: 'unknown-plan',
    });
  });

  it('reads the last finished scan where the partial one has not reached the plan', () => {
    const last = plans('docs/plans/2026-11-21-p.md');
    expect(pulsePlanReading(plans('docs/plans/2026-11-21-other.md'), false, last, 'p')).toEqual({ kind: 'listed', pulse: last });
  });

  it('answers pulse-partial where neither the partial pulse nor the last finished one lists the plan', () => {
    const live = plans('docs/plans/2026-11-21-other.md');
    expect(pulsePlanReading(live, false, plans('docs/plans/2026-11-21-another.md'), 'p')).toEqual({ kind: 'pulse-partial' });
    expect(pulsePlanReading(live, false, null, 'p')).toEqual({ kind: 'pulse-partial' });
  });
});
