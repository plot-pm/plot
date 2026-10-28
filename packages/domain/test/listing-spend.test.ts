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
/** 1,767 PRs measured 2026-10-26: 1 + ceil(1767 / 100). */
const GITHUB_1767 = 19;
/** The listing's own unstretched base since this slice — `LISTING_REFRESH_MS`. */
const LISTING_BASE = 60_000;
const HOUR = 60 * 60 * 1000;

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

  describe('a GitHub listing priced at its real page cost', () => {
    // 1,767 PRs page at 19 requests (packages/fleet scanListingCost). This
    // catches a cost that is computed but never reaches the controller: priced
    // at 1 the interval would be 5 s, shorter than the scan's own ~2 min period.
    it('holds a 95 s interval with no rate', () => {
      const verdict = listingSpend({
        intervalMs: PULSE,
        costPerListing: GITHUB_1767,
        rate: null,
        lastListedAt: 0,
        now: PULSE,
      });

      expect(verdict.intervalMs).toBe(95_000);
    });

    it('converges to 760 s at the ceiling under sustained overspend', () => {
      let lastListedAt = 0;
      let currentIntervalMs: number | undefined;
      let intervalMs = 95_000;
      for (let step = 0; step < 50; step += 1) {
        const verdict = listingSpend({
          intervalMs: PULSE,
          costPerListing: GITHUB_1767,
          rate: { perHour: Number.MAX_SAFE_INTEGER },
          lastListedAt,
          now: lastListedAt + intervalMs,
          currentIntervalMs,
        });
        intervalMs = verdict.intervalMs;
        currentIntervalMs = verdict.intervalMs;
        lastListedAt = verdict.nextAt;
      }

      expect(intervalMs).toBe(760_000);
    });
  });

  describe('the 60 s base', () => {
    /**
     * THE PROPERTY THIS BLOCK EXISTS FOR: a fix that only raises the cadence
     * ceiling still leaves the unstretched share at 720/hr unless `scanOnce`
     * also passes the 60 s base — measured 2026-10-28, slice 2's own "done
     * when". `LISTING_BASE` stands in for `LISTING_REFRESH_MS`.
     */
    it('spends at most 60 requests an hour on an idle account reading null', () => {
      let listings = 0;
      let lastListedAt: number | null = null;
      for (let now = 0; now < HOUR; now += LISTING_BASE) {
        const verdict = listingSpend({
          intervalMs: LISTING_BASE,
          costPerListing: GITHUB,
          rate: { perHour: null },
          lastListedAt,
          now,
        });
        if (verdict.spend) {
          listings += 1;
          lastListedAt = now;
        }
      }

      expect(listings).toBeLessThanOrEqual(60);
    });

    it('spends at most 60 requests an hour on an idle account reading zero', () => {
      let listings = 0;
      let lastListedAt: number | null = null;
      for (let now = 0; now < HOUR; now += LISTING_BASE) {
        const verdict = listingSpend({
          intervalMs: LISTING_BASE,
          costPerListing: GITHUB,
          rate: { perHour: 0 },
          lastListedAt,
          now,
        });
        if (verdict.spend) {
          listings += 1;
          lastListedAt = now;
        }
      }

      expect(listings).toBeLessThanOrEqual(60);
    });
  });

  describe('a limit the account has reached', () => {
    const LIMIT = 1_000;

    /**
     * THE ASSERTION A STRETCH-CEILING-ONLY FIX CANNOT SATISFY: eight times a
     * non-zero rate is never zero, however high the ceiling goes. Only a
     * separate wait-for-reset path can spend nothing before the reset.
     *
     * `lastListedAt` sits one base interval before `now`, so without the
     * limit-wait branch the unstretched (and even the 8x-damped) interval
     * would already be due — only the wait past `resetAt` defers it.
     */
    it('spends 0 requests before the reported reset, at an actual limit', () => {
      const now = 10 * 60_000;
      const resetAt = now + 20 * 60_000;
      const verdict = listingSpend({
        intervalMs: LISTING_BASE,
        costPerListing: GITHUB,
        rate: { perHour: LIMIT, limit: LIMIT, basis: 'actual', resetAt },
        lastListedAt: now - LISTING_BASE,
        now,
      });

      expect(verdict.spend).toBe(false);
      expect(verdict.nextAt).toBe(resetAt);
    });

    it('spends nothing before the reset as the reset draws near', () => {
      // One minute before the reset the wait reads as one base interval; the
      // listing still waits for the reset itself.
      const resetAt = 30 * 60_000;
      const now = resetAt - 60_000;
      const verdict = listingSpend({
        intervalMs: LISTING_BASE,
        costPerListing: GITHUB,
        rate: { perHour: LIMIT, limit: LIMIT, basis: 'actual', resetAt },
        lastListedAt: 9 * 60_000,
        now,
        currentIntervalMs: 20 * 60_000,
      });

      expect(verdict.spend).toBe(false);
      expect(verdict.nextAt).toBe(resetAt);
    });

    it('spends nothing before the reset where the gate engages after a long stretch', () => {
      // Last listed 8 minutes ago, reset 5 minutes away: last + wait is already
      // past, and the reset still holds the listing.
      const now = 100 * 60_000;
      const resetAt = now + 5 * 60_000;
      const verdict = listingSpend({
        intervalMs: LISTING_BASE,
        costPerListing: GITHUB,
        rate: { perHour: LIMIT, limit: LIMIT, basis: 'actual', resetAt },
        lastListedAt: now - 8 * 60_000,
        now,
        currentIntervalMs: 8 * LISTING_BASE,
      });

      expect(verdict.spend).toBe(false);
      expect(verdict.nextAt).toBe(resetAt);
    });

    it('spends at the reset itself', () => {
      const resetAt = 30 * 60_000;
      const verdict = listingSpend({
        intervalMs: LISTING_BASE,
        costPerListing: GITHUB,
        rate: { perHour: LIMIT, limit: LIMIT, basis: 'actual', resetAt },
        lastListedAt: 9 * 60_000,
        now: resetAt,
        currentIntervalMs: 20 * 60_000,
      });

      expect(verdict.spend).toBe(true);
    });

    it('spends 0 requests before the reported reset, at a predicted limit', () => {
      const now = 10 * 60_000;
      const resetAt = now + 20 * 60_000;
      const verdict = listingSpend({
        intervalMs: LISTING_BASE,
        costPerListing: GITHUB,
        rate: { perHour: LIMIT, limit: LIMIT, basis: 'predicted', resetAt },
        lastListedAt: now - LISTING_BASE,
        now,
      });

      expect(verdict.spend).toBe(false);
    });

    it('falls back to the damped path once a fresh reading reports the account back under its limit', () => {
      // The reset passing does not relabel a stale over-limit reading by
      // itself — what unblocks the limit-wait is the connector's own next
      // reading, observed back under the limit. From there the damped path
      // decides, exactly as it would with no limit at all.
      const withLimit = listingSpend({
        intervalMs: LISTING_BASE,
        costPerListing: GITHUB,
        rate: { perHour: LIMIT - 1, limit: LIMIT, basis: 'actual', resetAt: null },
        lastListedAt: 0,
        now: 1,
      });
      const withoutLimit = listingSpend({
        intervalMs: LISTING_BASE,
        costPerListing: GITHUB,
        rate: { perHour: LIMIT - 1 },
        lastListedAt: 0,
        now: 1,
      });

      expect(withLimit.intervalMs).toBe(withoutLimit.intervalMs);
      expect(withLimit.spend).toBe(withoutLimit.spend);
    });

    it('stretches exactly as today below the limit', () => {
      // 100/hr against a limit of 1,000 is well under it — the existing
      // 8x-damped path, unaffected by the new optional fields.
      const withLimit = listingSpend({
        intervalMs: LISTING_BASE,
        costPerListing: GITHUB,
        rate: { perHour: 100, limit: LIMIT, basis: 'actual' },
        lastListedAt: 0,
        now: 1,
      });
      const withoutLimit = listingSpend({
        intervalMs: LISTING_BASE,
        costPerListing: GITHUB,
        rate: { perHour: 100 },
        lastListedAt: 0,
        now: 1,
      });

      expect(withLimit.intervalMs).toBe(withoutLimit.intervalMs);
    });
  });

  describe('a limit with an unknown basis', () => {
    it('behaves exactly as a null rate, whatever perHour reads', () => {
      for (const perHour of [0, 100, 1_000, 100_000]) {
        const unknownBasis = listingSpend({
          intervalMs: LISTING_BASE,
          costPerListing: GITHUB,
          rate: { perHour, limit: null, basis: 'unknown' },
          lastListedAt: 0,
          now: 1,
        });
        const noLimit = listingSpend({
          intervalMs: LISTING_BASE,
          costPerListing: GITHUB,
          rate: { perHour },
          lastListedAt: 0,
          now: 1,
        });

        expect(unknownBasis.intervalMs).toBe(noLimit.intervalMs);
        expect(unknownBasis.spend).toBe(noLimit.spend);
      }
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
