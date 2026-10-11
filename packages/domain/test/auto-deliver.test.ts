import { describe, it, expect } from 'vitest';
import {
  AUTO_DELIVER_MAX_FAILURES,
  AUTO_DELIVER_RETRY_BASE_MS,
  FleetReadingSchema,
  deliveryReading,
  deliveryReadings,
  landedBranches,
  pruneFailures,
  recordDeliveryFailure,
  retryDelayMs,
  retryVerdict,
  type DeliveryFailure,
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

  describe('the retry bound', () => {
    const plan = pulse('approved', [['merged']]);
    const reading = deliveryReading(plan.plans[0]);
    const failed = (count: number, lastAt = 1_000): DeliveryFailure => ({ count, lastAt, reading });

    it('doubles the delay after each failure', () => {
      expect(retryDelayMs(1)).toBe(AUTO_DELIVER_RETRY_BASE_MS);
      expect(retryDelayMs(2)).toBe(2 * AUTO_DELIVER_RETRY_BASE_MS);
      expect(retryDelayMs(2)).toBeGreaterThan(retryDelayMs(1));
    });

    it('is ready with no record, and with a record for another reading', () => {
      expect(retryVerdict(undefined, reading, 0)).toBe('ready');
      expect(retryVerdict(failed(AUTO_DELIVER_MAX_FAILURES), 'feature/x=merged', 0)).toBe('ready');
    });

    it('waits until the delay after the last failure has passed', () => {
      expect(retryVerdict(failed(1), reading, 1_000 + retryDelayMs(1) - 1)).toBe('waiting');
      expect(retryVerdict(failed(1), reading, 1_000 + retryDelayMs(1))).toBe('ready');
      expect(retryVerdict(failed(2), reading, 1_000 + retryDelayMs(1))).toBe('waiting');
      expect(retryVerdict(failed(2), reading, 1_000 + retryDelayMs(2))).toBe('ready');
    });

    it('stops after the bound, however long it waits', () => {
      expect(AUTO_DELIVER_MAX_FAILURES).toBe(3);
      expect(retryVerdict(failed(AUTO_DELIVER_MAX_FAILURES), reading, Number.MAX_SAFE_INTEGER)).toBe('stopped');
    });

    it('counts on under one reading and restarts under a new one', () => {
      expect(recordDeliveryFailure(undefined, reading, 5)).toEqual({ count: 1, lastAt: 5, reading });
      expect(recordDeliveryFailure(failed(2), reading, 9)).toEqual({ count: 3, lastAt: 9, reading });
      expect(recordDeliveryFailure(failed(2), 'other', 9)).toEqual({ count: 1, lastAt: 9, reading: 'other' });
    });

    it('reads every branch with its state, in a stable order', () => {
      expect(deliveryReading(pulse('approved', [['merged', 'deferred'], ['merged']]).plans[0])).toBe(
        'feature/0-0=merged,feature/0-1=deferred,feature/1-0=merged',
      );
      expect([...deliveryReadings(plan)]).toEqual([['ship-it', reading]]);
      expect(deliveryReadings(null).size).toBe(0);
    });

    it('holds back a plan that waits or stopped, and names it again once ready', () => {
      const input = { pulse: plan, inFlight: none };
      expect(planAutoDeliver({ ...input, failures: { 'ship-it': failed(1) }, now: 1_000 })).toEqual([]);
      expect(planAutoDeliver({ ...input, failures: { 'ship-it': failed(3) }, now: 1e12 })).toEqual([]);
      expect(planAutoDeliver({ ...input, failures: { 'ship-it': failed(1) }, now: 1e12 })).toHaveLength(1);
    });

    describe('pruneFailures', () => {
      const records = { 'ship-it': failed(2) };
      it('keeps every record across a missing pulse', () => {
        expect(pruneFailures(records, null)).toEqual(records);
      });
      it('keeps a record while the plan reads approved under the same reading', () => {
        expect(pruneFailures(records, plan)).toEqual(records);
      });
      it('drops a record once the plan leaves approved', () => {
        expect(pruneFailures(records, pulse('delivered', [['merged']]))).toEqual({});
      });
      it('drops a record once the reading changes', () => {
        expect(pruneFailures(records, pulse('approved', [['merged', 'merged']]))).toEqual({});
      });
      it('drops a record whose plan the pulse does not list, and skips plans with none', () => {
        expect(pruneFailures({ other: failed(1) }, plan)).toEqual({});
      });
    });
  });
});
