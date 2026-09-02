import { describe, expect, it } from 'vitest';

import {
  CLAIM_STALE_MS,
  SECONDS_PER_SLOT,
  SLOT_POLL_MS,
  SLOT_WAIT_MAX_MS,
  boundFromLimit,
  concurrencyBound,
  heldSlots,
  slotIsStale,
  slotVerdict,
  waitExhausted,
  type SlotClaim,
} from '../src/rules/concurrency.js';
import { MIN_CONCURRENCY } from '../src/rules/reaction.js';
import { actualLimit, predictedLimit, unknownLimit } from '../src/entities/limit.js';

const NOW = 1_756_700_000_000;

const claimAt = (at: number, pid = 4242, startedAt: number | null = null): SlotClaim => ({
  pid,
  startedAt,
  at,
});

describe('slotIsStale', () => {
  it('frees a slot whose claimant is gone', () => {
    expect(slotIsStale(claimAt(NOW), false, null, NOW)).toBe(true);
  });

  it('keeps a slot a live claimant holds', () => {
    expect(slotIsStale(claimAt(NOW), true, null, NOW)).toBe(false);
  });

  it('keeps a slot where the process table could not be asked', () => {
    // Nothing silently reads unreachable as permission — reclaiming here would
    // raise the number of simultaneous callers on the strength of not knowing.
    expect(slotIsStale(claimAt(NOW), null, null, NOW)).toBe(false);
  });

  it('frees a slot whose pid was reused by a different process', () => {
    const claim = claimAt(NOW, 4242, NOW - 60_000);
    expect(slotIsStale(claim, true, NOW - 10_000, NOW)).toBe(true);
  });

  it('keeps a slot whose live process is the one that claimed it', () => {
    const claim = claimAt(NOW, 4242, NOW - 60_000);
    expect(slotIsStale(claim, true, NOW - 60_000, NOW)).toBe(false);
  });

  it('ignores sub-millisecond drift in a process start time', () => {
    const claim = claimAt(NOW, 4242, NOW - 60_000.4);
    expect(slotIsStale(claim, true, NOW - 60_000.9, NOW)).toBe(false);
  });

  it('cannot compare start times it does not have', () => {
    expect(slotIsStale(claimAt(NOW, 4242, null), true, NOW - 10_000, NOW)).toBe(false);
    expect(slotIsStale(claimAt(NOW, 4242, NOW), true, null, NOW)).toBe(false);
  });

  it('frees a live claim only once it is older than the staleness bound', () => {
    const claim = claimAt(NOW - CLAIM_STALE_MS + 1);
    expect(slotIsStale(claim, true, null, NOW)).toBe(false);
    expect(slotIsStale(claimAt(NOW - CLAIM_STALE_MS), true, null, NOW)).toBe(true);
  });

  it('bounds staleness far above the longest measured call', () => {
    // The fleet scan is 18.3 s; a shorter bound would reclaim a slot a live
    // caller still holds, which is the one failure a cap must not have.
    expect(CLAIM_STALE_MS).toBeGreaterThan(18_300 * 10);
  });
});

describe('boundFromLimit', () => {
  it("derives a bound from a connector's actual hourly ceiling", () => {
    const reading = actualLimit({
      connector: 'github',
      bucket: 'core',
      limit: 5000,
      remaining: 4990,
      resetAt: NOW + 3_600_000,
    });
    // 5000 an hour at four seconds a call is 5 at once.
    expect(boundFromLimit(reading)).toBe(5);
  });

  it('derives one from a prediction just as readily', () => {
    expect(boundFromLimit(predictedLimit('bitbucket', 'api', 1000))).toBe(1);
  });

  it('lands below the eight that was refused on 2026-08-27', () => {
    const github = actualLimit({
      connector: 'github',
      bucket: 'core',
      limit: 5000,
      remaining: null,
      resetAt: null,
    });
    const derived = boundFromLimit(github);
    expect(derived).not.toBeNull();
    expect(derived as number).toBeLessThan(8);
  });

  it('compiles in no seven', () => {
    // The number is derived from the reading, so a different ceiling gives a
    // different bound — which a hard-coded cap could not do.
    const bigger = actualLimit({
      connector: 'github',
      bucket: 'core',
      limit: 15000,
      remaining: null,
      resetAt: null,
    });
    expect(boundFromLimit(bigger)).toBe(Math.floor(15000 / (3600 / SECONDS_PER_SLOT)));
  });

  it('answers null for a connector that reports nothing', () => {
    expect(boundFromLimit(unknownLimit('jenkins'))).toBeNull();
  });

  it('answers null for a reading carrying no number', () => {
    expect(
      boundFromLimit({
        connector: 'github',
        bucket: 'core',
        limit: null,
        remaining: null,
        resetAt: null,
        basis: 'actual',
      }),
    ).toBeNull();
  });

  it('refuses a ceiling that is not a usable number', () => {
    expect(boundFromLimit(predictedLimit('x', '', 0))).toBeNull();
    expect(boundFromLimit(predictedLimit('x', '', -5))).toBeNull();
    expect(boundFromLimit(predictedLimit('x', '', Number.POSITIVE_INFINITY))).toBeNull();
  });

  it('never derives a bound of zero', () => {
    // A tiny ceiling would floor to zero, which is a connector that can never
    // be called again — something no reading licenses.
    expect(boundFromLimit(predictedLimit('tiny', '', 1))).toBe(MIN_CONCURRENCY);
  });
});

describe('concurrencyBound', () => {
  it('takes the connector proposal where nothing has refused', () => {
    expect(concurrencyBound(5, null)).toBe(5);
  });

  it('takes the correction where the connector proposes nothing', () => {
    expect(concurrencyBound(null, 2)).toBe(2);
  });

  it('lets a refusal outrank a prediction', () => {
    expect(concurrencyBound(5, 2)).toBe(2);
  });

  it('never lets a prediction raise what a refusal established', () => {
    expect(concurrencyBound(8, 1)).toBe(1);
  });

  it('takes the proposal where the proposal is the lower of the two', () => {
    expect(concurrencyBound(2, 6)).toBe(2);
  });

  it('is unbounded where nothing licenses a number', () => {
    expect(concurrencyBound(null, null)).toBeNull();
  });

  it('never falls below one', () => {
    expect(concurrencyBound(3, 0)).toBe(MIN_CONCURRENCY);
  });
});

describe('heldSlots', () => {
  it('counts a live claim', () => {
    expect(heldSlots([{ claim: claimAt(NOW), alive: true, startedAt: null }], NOW)).toBe(1);
  });

  it('does not count a claim whose process is gone', () => {
    expect(heldSlots([{ claim: claimAt(NOW), alive: false, startedAt: null }], NOW)).toBe(0);
  });

  it('does not let twelve abandoned desks read as a full account', () => {
    // The idle rule ended twelve desks over two days; counting their claims
    // forever would deadlock the cap, which is worse than the 403 it prevents.
    const abandoned = Array.from({ length: 12 }, (_, index) => ({
      claim: claimAt(NOW - 3_600_000, 9000 + index),
      alive: false,
      startedAt: null,
    }));
    expect(heldSlots(abandoned, NOW)).toBe(0);
  });

  it('counts only the live claims in a mixed directory', () => {
    expect(
      heldSlots(
        [
          { claim: claimAt(NOW, 1), alive: true, startedAt: null },
          { claim: claimAt(NOW, 2), alive: false, startedAt: null },
          { claim: claimAt(NOW, 3), alive: null, startedAt: null },
        ],
        NOW,
      ),
    ).toBe(2);
  });

  it('is zero on an account nobody has claimed', () => {
    expect(heldSlots([], NOW)).toBe(0);
  });
});

describe('slotVerdict', () => {
  it('goes below the cap', () => {
    expect(slotVerdict(4, 5)).toBe('go');
  });

  it('waits at the cap, and never reports nothing to do', () => {
    expect(slotVerdict(5, 5)).toBe('wait');
    expect(slotVerdict(9, 5)).toBe('wait');
  });

  it('goes where nothing licenses a bound', () => {
    expect(slotVerdict(99, null)).toBe('go');
  });

  it('answers unknown where the slots could not be read', () => {
    expect(slotVerdict(null, 5)).toBe('unknown');
    expect(slotVerdict(null, null)).toBe('unknown');
  });

  it('covers the 2026-08-27 shape: eight spenders against a cap of five', () => {
    // Five go, three wait. Nothing is refused, and the three that wait return
    // to ask — the cadence degrades rather than a 403 being produced.
    const bound = 5;
    const verdicts = Array.from({ length: 8 }, (_, held) => slotVerdict(held, bound));
    expect(verdicts.filter((v) => v === 'go')).toHaveLength(5);
    expect(verdicts.filter((v) => v === 'wait')).toHaveLength(3);
    expect(verdicts).not.toContain('unknown');
  });
});

describe('waitExhausted', () => {
  it('keeps waiting inside the bound', () => {
    expect(waitExhausted(0)).toBe(false);
    expect(waitExhausted(SLOT_WAIT_MAX_MS - 1)).toBe(false);
  });

  it('proceeds once the wait has run out', () => {
    expect(waitExhausted(SLOT_WAIT_MAX_MS)).toBe(true);
  });

  it('drains a queue eight deep at the assumed call length', () => {
    expect(SLOT_WAIT_MAX_MS).toBeGreaterThanOrEqual(8 * SECONDS_PER_SLOT * 1000 - 2000);
  });

  it('polls faster than a slot is held, so a freed one is taken promptly', () => {
    expect(SLOT_POLL_MS).toBeLessThan(SECONDS_PER_SLOT * 1000);
    expect(SLOT_POLL_MS).toBeGreaterThan(0);
  });
});
