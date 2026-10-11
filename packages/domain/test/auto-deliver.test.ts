import { describe, it, expect } from 'vitest';
import { landedBranches, planAutoDeliver, planSlug, pruneDelivering, type FleetReading } from '../src/index.js';

const pulse = (phase: string, state: string): FleetReading =>
  ({
    main: 'main',
    head: 'abc',
    plans: [{ file: '2026-10-01-ship-it.md', phase, slices: [{ branches: [{ state }] }] }],
  }) as unknown as FleetReading;

describe('rules/auto-deliver', () => {
  it('spells the slug like the dispatcher', () => {
    expect(planSlug('docs/plans/2026-10-01-ship-it.md')).toBe('ship-it');
  });

  it('counts only merged branches as landed', () => {
    expect(landedBranches(pulse('approved', 'merged').plans[0])).toBe(1);
    expect(landedBranches(pulse('approved', 'deferred').plans[0])).toBe(0);
  });

  it('plans and retires nothing without a pulse', () => {
    expect(planAutoDeliver({ pulse: null, inFlight: new Set() })).toEqual([]);
    expect([...pruneDelivering(new Set(['ship-it']), null)]).toEqual(['ship-it']);
  });

  it('skips a plan that is not approved', () => {
    expect(planAutoDeliver({ pulse: pulse('delivered', 'merged'), inFlight: new Set() })).toEqual([]);
  });

  it('retires a slug once the plan leaves approved', () => {
    expect([...pruneDelivering(new Set(['ship-it']), pulse('delivered', 'merged'))]).toEqual([]);
  });
});
