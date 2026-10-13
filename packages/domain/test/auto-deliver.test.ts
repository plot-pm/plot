import { describe, it, expect } from 'vitest';
import {
  AUTO_DELIVER_MAX_FAILURES,
  AUTO_DELIVER_RETRY_BASE_MS,
  FleetReadingSchema,
  deliveryReading,
  dependentsOf,
  hasUndeliveredDependent,
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

  describe('a tracer plan and its dependent', () => {
    type Spec = { file: string; phase: string; tracer?: boolean; branch: string; state: St; waits?: string[] };
    const world = (specs: Spec[]): FleetReading =>
      FleetReadingSchema.parse({
        main: 'main',
        head: 'abc1234',
        plans: specs.map((x) => ({
          file: x.file,
          phase: x.phase,
          tracer: x.tracer ?? false,
          slices: [
            {
              name: 'W0',
              verdict: x.state === 'merged' ? 'complete' : 'eligible',
              branches: [
                { branch: x.branch, state: x.state, deferred: false, claimed: '', ref_held: false, waits_on: x.waits ?? [] },
              ],
            },
          ],
        })),
        summary: { plans: 1, waves: 0, branches: 0, claimed: 0, eligible: 0, blocked: 0, deferred: 0 },
      });
    const tracer = (over: Partial<Spec> = {}): Spec => ({
      file: '2026-10-01-a-tracer.md', phase: 'approved', tracer: true, branch: 'feature/t', state: 'merged', ...over,
    });
    const dependent = (over: Partial<Spec> = {}): Spec => ({
      file: '2026-10-02-b-dependent.md', phase: 'approved', branch: 'feature/d', state: 'merged', waits: ['feature/t'], ...over,
    });
    const slugs = (specs: Spec[], extra: Partial<Parameters<typeof planAutoDeliver>[0]> = {}) =>
      planAutoDeliver({ pulse: world(specs), inFlight: none, ...extra }).map((p) => p.slug);

    it('does not name a tracer plan that nothing waits on', () => {
      expect(slugs([tracer()])).toEqual([]);
    });
    it('never names a tracer plan in the pass that names its approved dependent', () => {
      expect(slugs([tracer(), dependent()])).toEqual(['b-dependent']);
      expect(slugs([dependent(), tracer()])).toEqual(['b-dependent']);
    });
    it('names the tracer plan on the pass after its dependent reads delivered', () => {
      const before = [tracer(), dependent()];
      expect(slugs(before)).toEqual(['b-dependent']);
      const after = [tracer(), dependent({ phase: 'delivered' })];
      expect(slugs(after, { inFlight: new Set(['b-dependent']) })).toEqual(['a-tracer']);
    });
    it('names only the dependent while the tracer plan has an unmerged slice', () => {
      expect(slugs([tracer({ state: 'open' }), dependent()])).toEqual(['b-dependent']);
    });
    it('names a tracer plan alone once its dependent has delivered', () => {
      expect(slugs([tracer(), dependent({ phase: 'delivered' })])).toEqual(['a-tracer']);
      expect(slugs([dependent({ phase: 'Delivered' }), tracer()])).toEqual(['a-tracer']);
    });
    it('does not retry a tracer plan whose dependent is still unfinished', () => {
      expect(slugs([tracer(), dependent({ state: 'open' })])).toEqual([]);
    });
    it('does not retry a tracer plan already in flight', () => {
      expect(slugs([tracer(), dependent({ phase: 'delivered' })], { inFlight: new Set(['a-tracer']) })).toEqual([]);
    });
    it('holds a tracer plan back by the retry bound after its dependent delivered', () => {
      const failures = (specs: Spec[]) => ({
        'a-tracer': {
          count: AUTO_DELIVER_MAX_FAILURES,
          lastAt: 1_000,
          reading: deliveryReading(world(specs).plans[0]),
        },
      });
      const after = [tracer(), dependent({ phase: 'delivered' })];
      expect(slugs(after, { failures: failures(after), now: 1_000 })).toEqual([]);
    });
    it('names a tracer plan once when two dependents wait on it', () => {
      const second = dependent({ file: '2026-10-03-c-second.md', branch: 'feature/e' });
      expect(slugs([tracer(), dependent(), second])).toEqual(['b-dependent', 'c-second']);
      expect(slugs([tracer(), dependent({ phase: 'delivered' }), second])).toEqual(['a-tracer', 'c-second']);
    });
    it('leaves a plain plan alone', () => {
      expect(slugs([dependent({ waits: [] })])).toEqual(['b-dependent']);
    });

    describe('dependentsOf and hasUndeliveredDependent', () => {
      const plans = (specs: Spec[]) => world(specs).plans;
      it('finds the plans whose waits_on names a branch of the plan', () => {
        const ps = plans([tracer(), dependent(), dependent({ file: '2026-10-04-d-other.md', branch: 'feature/o', waits: ['feature/x'] })]);
        expect(dependentsOf(ps[0], ps).map((p) => p.file)).toEqual(['2026-10-02-b-dependent.md']);
      });
      it('does not count the plan itself', () => {
        const ps = plans([tracer({ waits: ['feature/t'] })]);
        expect(dependentsOf(ps[0], ps)).toEqual([]);
      });
      it('answers false for a plan with no dependent', () => {
        const ps = plans([tracer()]);
        expect(hasUndeliveredDependent(ps[0], ps)).toBe(false);
      });
      it('answers true while a dependent is approved', () => {
        const ps = plans([tracer(), dependent()]);
        expect(hasUndeliveredDependent(ps[0], ps)).toBe(true);
      });
      it('answers false once every dependent is delivered or released', () => {
        const ps = plans([tracer(), dependent({ phase: 'delivered' }), dependent({ file: '2026-10-03-c-second.md', branch: 'feature/e', phase: 'released' })]);
        expect(hasUndeliveredDependent(ps[0], ps)).toBe(false);
      });
      it('answers true when one of two dependents is not delivered', () => {
        const ps = plans([tracer(), dependent({ phase: 'delivered' }), dependent({ file: '2026-10-03-c-second.md', branch: 'feature/e' })]);
        expect(hasUndeliveredDependent(ps[0], ps)).toBe(true);
      });
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
