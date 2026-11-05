import { describe, it, expect } from 'vitest';
import { pulseBranchReading, type FleetReading } from '../src/index.js';

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
