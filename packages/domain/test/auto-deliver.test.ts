import { describe, it, expect } from 'vitest';
import {
  FleetReadingSchema,
  landedBranches,
  planAutoDeliver,
  planSlug,
  pruneDelivering,
  type FleetReading,
} from '../src/index.js';

type St = 'open' | 'merged' | 'deferred';

const pulse = (phase: string, slices: St[][], file = '2026-10-01-ship-it.md'): FleetReading =>
  FleetReadingSchema.parse({
    main: 'main',
    head: 'abc1234',
    plans: [
      {
        file,
        phase,
        slices: slices.map((states, i) => ({
          name: `W${i}`,
          verdict: states.every((s) => s !== 'open') ? 'complete' : 'eligible',
          branches: states.map((state, j) => ({
            branch: `feature/${i}-${j}`,
            state,
            deferred: state === 'deferred',
            claimed: '',
            ref_held: false,
          })),
        })),
      },
    ],
    summary: { plans: 1, waves: 0, branches: 0, claimed: 0, eligible: 0, blocked: 0, deferred: 0 },
  });

const none = new Set<string>();
const held = new Set(['ship-it']);

describe('rules/auto-deliver', () => {
  it('spells the slug like the dispatcher', () => {
    expect(planSlug('docs/plans/2026-10-01-ship-it.md')).toBe('ship-it');
  });

  it('counts only merged branches as landed, across slices', () => {
    expect(landedBranches(pulse('approved', [['merged', 'open'], ['merged']]).plans[0])).toBe(2);
    expect(landedBranches(pulse('approved', [['deferred']]).plans[0])).toBe(0);
  });

  describe('planAutoDeliver', () => {
    it('names an approved plan whose branches all merged', () => {
      expect(planAutoDeliver({ pulse: pulse('Approved', [['merged']]), inFlight: none })).toEqual([
        { slug: 'ship-it', file: '2026-10-01-ship-it.md' },
      ]);
    });
    it('names nothing without a pulse', () => {
      expect(planAutoDeliver({ pulse: null, inFlight: none })).toEqual([]);
    });
    it('skips a plan that is not approved', () => {
      expect(planAutoDeliver({ pulse: pulse('delivered', [['merged']]), inFlight: none })).toEqual([]);
    });
    it('skips a plan already in flight', () => {
      expect(planAutoDeliver({ pulse: pulse('approved', [['merged']]), inFlight: held })).toEqual([]);
    });
    it('skips a plan with an unmerged branch', () => {
      expect(planAutoDeliver({ pulse: pulse('approved', [['merged'], ['open']]), inFlight: none })).toEqual([]);
    });
    it('skips a plan whose every branch is deferred', () => {
      expect(planAutoDeliver({ pulse: pulse('approved', [['deferred']]), inFlight: none })).toEqual([]);
    });
    it('reads an incomplete scan as unknown, not merged', () => {
      expect(planAutoDeliver({ pulse: pulse('approved', [['merged']]), inFlight: none, complete: false })).toEqual([]);
    });
  });

  describe('pruneDelivering', () => {
    it('returns an empty set unchanged', () => {
      expect(pruneDelivering(none, pulse('approved', [['merged']]))).toBe(none);
    });
    it('holds the set across a missing pulse', () => {
      expect(pruneDelivering(held, null)).toBe(held);
    });
    it('keeps a slug whose plan still reads approved and merged', () => {
      expect([...pruneDelivering(held, pulse('approved', [['merged']]))]).toEqual(['ship-it']);
    });
    it('retires a slug once the plan leaves approved', () => {
      expect([...pruneDelivering(held, pulse('delivered', [['merged']]))]).toEqual([]);
    });
    it('retires a slug whose plan is no longer fully merged', () => {
      expect([...pruneDelivering(held, pulse('approved', [['merged'], ['open']]))]).toEqual([]);
    });
    it('retires a slug whose plan the pulse does not list', () => {
      expect([...pruneDelivering(new Set(['other']), pulse('approved', [['merged']]))]).toEqual([]);
    });
  });
});
