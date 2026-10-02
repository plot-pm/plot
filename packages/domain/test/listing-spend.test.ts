import { describe, expect, it } from 'vitest';

import { MAX_CADENCE_STRETCH, refreshIntervalMs } from '../src/rules/cadence.js';
import { listingSpend } from '../src/rules/listing-spend.js';

/**
 * THE PROPERTY THIS FILE EXISTS FOR: the fleet scan's listing follows the
 * account's rate, and a run that may not spend reuses its last listing rather
 * than reporting an empty one.
 *
 * Measured 2026-10-02 on the Bitbucket workspace `quatico` (plan slice 1): the
 * board fleet scan spent 2949 of 3150 calls an hour, 93.6%, on a 5 s pulse that
 * asks no cadence rule. The assertions below are the four a naive boolean would
 * pass without.
 */

/** The scan's unstretched listing interval — one listing per pulse. */
const PULSE = 5_000;
/** GitHub lists in one request; Bitbucket sweeps three per branch plus one. */
const GITHUB = 1;
/** Eleven branches on the repository measured 2026-09-20: 11 x 3 + 1. */
const BITBUCKET_11 = 34;

describe('listingSpend', () => {
  describe('the first reading', () => {
    it('allows the call when no listing has been made', () => {
      const verdict = listingSpend({
        intervalMs: PULSE,
        costPerListing: BITBUCKET_11,
        rate: { perHour: 3150 },
        lastListedAt: null,
        now: 0,
      });

      expect(verdict.spend).toBe(true);
      // A board that has not yet listed has nothing to reuse, so the reused
      // payload is absent rather than empty.
      expect(verdict.reuse).toBeNull();
    });

    it('allows the call on a cold start even on an account far over its share', () => {
      const verdict = listingSpend({
        intervalMs: PULSE,
        costPerListing: BITBUCKET_11,
        rate: { perHour: 100_000 },
        lastListedAt: null,
        now: 0,
      });

      expect(verdict.spend).toBe(true);
    });
  });

  describe('an account over its share', () => {
    it('defers the call', () => {
      // 3150/hr against a share of 24480/hr at 11 branches is under the share,
      // so the rate that defers is one above it.
      const verdict = listingSpend({
        intervalMs: PULSE,
        costPerListing: BITBUCKET_11,
        rate: { perHour: 100_000 },
        lastListedAt: 0,
        now: PULSE,
      });

      expect(verdict.spend).toBe(false);
    });

    it('returns the previous listing marked as older, never an empty one', () => {
      const verdict = listingSpend({
        intervalMs: PULSE,
        costPerListing: BITBUCKET_11,
        rate: { perHour: 100_000 },
        lastListedAt: 1_000,
        now: 9_000,
      });

      expect(verdict.spend).toBe(false);
      // ABSENT IS NOT FALSE. A deferred call reports the age of what it reuses;
      // an empty listing reads as "no PRs" and refused four fully-merged plans
      // on 2026-08-27.
      expect(verdict.reuse).not.toBeNull();
      expect(verdict.reuse?.ageMs).toBe(8_000);
      // Older than the pulse, which is what makes it reportable as stale.
      expect(verdict.reuse?.ageMs).toBeGreaterThan(PULSE);
    });

    it('spends again once the stretched interval has passed', () => {
      const input = {
        intervalMs: PULSE,
        costPerListing: BITBUCKET_11,
        rate: { perHour: 100_000 },
        lastListedAt: 0,
      };
      const due = listingSpend({ ...input, now: 1 }).nextAt;

      expect(listingSpend({ ...input, now: due - 1 }).spend).toBe(false);
      expect(listingSpend({ ...input, now: due }).spend).toBe(true);
    });

    it('stretches no further than the cadence ceiling', () => {
      const verdict = listingSpend({
        intervalMs: PULSE,
        costPerListing: GITHUB,
        rate: { perHour: Number.MAX_SAFE_INTEGER },
        lastListedAt: 0,
        now: 1,
      });

      // The scan inherits `MAX_CADENCE_STRETCH`; it gets no ceiling of its own.
      expect(verdict.intervalMs).toBeLessThanOrEqual(PULSE * GITHUB * MAX_CADENCE_STRETCH);
    });
  });

  describe('an account under its share', () => {
    it('allows the call once the unstretched interval has passed', () => {
      const verdict = listingSpend({
        intervalMs: PULSE,
        costPerListing: GITHUB,
        rate: { perHour: 1 },
        lastListedAt: 0,
        now: PULSE,
      });

      expect(verdict.spend).toBe(true);
      expect(verdict.intervalMs).toBe(PULSE * GITHUB);
    });
  });

  describe('an absent rate', () => {
    it('allows the call, because silence is not evidence of a busy account', () => {
      const verdict = listingSpend({
        intervalMs: PULSE,
        costPerListing: BITBUCKET_11,
        rate: null,
        lastListedAt: 0,
        now: PULSE * BITBUCKET_11,
      });

      expect(verdict.spend).toBe(true);
    });

    it('treats a null perHour the same as an unread record', () => {
      const unread = listingSpend({
        intervalMs: PULSE,
        costPerListing: GITHUB,
        rate: null,
        lastListedAt: 0,
        now: PULSE,
      });
      const noSpan = listingSpend({
        intervalMs: PULSE,
        costPerListing: GITHUB,
        rate: { perHour: null },
        lastListedAt: 0,
        now: PULSE,
      });

      expect(noSpan.spend).toBe(unread.spend);
      expect(noSpan.intervalMs).toBe(unread.intervalMs);
    });
  });

  describe('the common case', () => {
    /**
     * A GITHUB FIXTURE SEES THE SAME NUMBER OF CALLS AS BEFORE. This catches a
     * rule that slows the common case to protect the uncommon one: the
     * multiplier is 1 on GitHub, and a board whose account spends no more than
     * one scan's share must list on every pulse.
     */
    it('lists on every pulse where the account spends only this scan', () => {
      const own = (3600 * 1000) / PULSE * GITHUB;
      let listings = 0;
      let lastListedAt: number | null = null;
      for (let now = 0; now < 60_000; now += PULSE) {
        const verdict = listingSpend({
          intervalMs: PULSE,
          costPerListing: GITHUB,
          rate: { perHour: own },
          lastListedAt,
          now,
        });
        if (verdict.spend) {
          listings += 1;
          lastListedAt = now;
        }
      }

      // Twelve pulses in a minute, every one of them listing.
      expect(listings).toBe(12);
    });

    it('holds the unstretched interval where the rate is this scan alone', () => {
      const own = (3600 * 1000) / PULSE * GITHUB;

      expect(
        listingSpend({
          intervalMs: PULSE,
          costPerListing: GITHUB,
          rate: { perHour: own },
          lastListedAt: 0,
          now: PULSE,
        }).intervalMs,
      ).toBe(PULSE * GITHUB);
    });
  });

  describe('the arithmetic', () => {
    it('is refreshIntervalMs and keeps no second copy', () => {
      const rate = { perHour: 50_000 };
      const current = PULSE * BITBUCKET_11 * 3;

      expect(
        listingSpend({
          intervalMs: PULSE,
          costPerListing: BITBUCKET_11,
          rate,
          lastListedAt: 0,
          now: 1,
          currentIntervalMs: current,
        }).intervalMs,
      ).toBe(refreshIntervalMs(PULSE, BITBUCKET_11, rate, current));
    });
  });
});
