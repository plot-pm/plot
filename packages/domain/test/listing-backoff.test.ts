import { describe, expect, it } from 'vitest';

import {
  LISTING_BACKOFF_BASE_MS,
  LISTING_BACKOFF_MAX_MS,
  listingBackoff,
} from '../src/rules/listing-backoff.js';

/**
 * THE PROPERTY THIS FILE EXISTS FOR: a refused scan listing backs off instead
 * of retrying every beat. Simulated in the plan (`docs/plans/2026-10-28-
 * supervisor-tick-s-fleet-scan-reads.md`) on a fake Bitbucket host, 15 tracked
 * branches, every listing after the first refused: today's scan sweeps 48 to
 * 362 times an hour depending on how long one scan pass takes. The assertions
 * below are the shape (bounded, growing, resetting) a naive "retry every beat
 * until success" implementation would fail.
 */

describe('listingBackoff', () => {
  describe('no back-off held', () => {
    it('opens when backoffUntil is null', () => {
      const verdict = listingBackoff({ backoffUntil: null, backoffMs: null, now: 0 });

      expect(verdict.open).toBe(true);
    });

    it('starts the back-off at the base on the first refusal', () => {
      const verdict = listingBackoff({ backoffUntil: null, backoffMs: null, now: 0 });

      expect(verdict.onRefusalMs).toBe(LISTING_BACKOFF_BASE_MS);
    });
  });

  describe('a back-off held and not yet due', () => {
    it('refuses to open before backoffUntil', () => {
      const verdict = listingBackoff({ backoffUntil: 10_000, backoffMs: LISTING_BACKOFF_BASE_MS, now: 9_999 });

      expect(verdict.open).toBe(false);
    });

    it('opens exactly at backoffUntil', () => {
      const verdict = listingBackoff({ backoffUntil: 10_000, backoffMs: LISTING_BACKOFF_BASE_MS, now: 10_000 });

      expect(verdict.open).toBe(true);
    });

    it('reports the same verdict on a repeated call while held, since open never consults backoffMs', () => {
      const first = listingBackoff({ backoffUntil: 10_000, backoffMs: LISTING_BACKOFF_BASE_MS, now: 1_000 });
      const second = listingBackoff({ backoffUntil: 10_000, backoffMs: LISTING_BACKOFF_BASE_MS, now: 1_000 });

      expect(first).toEqual(second);
    });
  });

  describe('a repeated refusal', () => {
    it('grows the back-off rather than repeating the base', () => {
      const verdict = listingBackoff({ backoffUntil: 5_000, backoffMs: LISTING_BACKOFF_BASE_MS, now: 5_000 });

      expect(verdict.onRefusalMs).toBeGreaterThan(LISTING_BACKOFF_BASE_MS);
    });

    it('bounds the growth at the cap rather than compounding forever', () => {
      // A held back-off already at the cap grows no further.
      const verdict = listingBackoff({ backoffUntil: 1_000, backoffMs: LISTING_BACKOFF_MAX_MS, now: 1_000 });

      expect(verdict.onRefusalMs).toBe(LISTING_BACKOFF_MAX_MS);
    });

    it('reaches the cap within a handful of refusals, not hundreds', () => {
      let ms: number | null = null;
      let reached = -1;
      for (let i = 0; i < 20; i += 1) {
        const verdict = listingBackoff({ backoffUntil: 0, backoffMs: ms, now: 0 });
        ms = verdict.onRefusalMs;
        if (ms === LISTING_BACKOFF_MAX_MS && reached === -1) reached = i;
      }
      expect(reached).toBeGreaterThanOrEqual(0);
      expect(reached).toBeLessThan(6);
    });
  });

  describe('a success', () => {
    it('resets so the next refusal starts from the base again, not from where it left off', () => {
      // The caller clears both fields on a successful listing — this rule
      // never sees "success"; it only ever sees the null, null the caller
      // passes after one.
      const afterReset = listingBackoff({ backoffUntil: null, backoffMs: null, now: 999_999 });

      expect(afterReset.onRefusalMs).toBe(LISTING_BACKOFF_BASE_MS);
    });
  });

  describe('the simulated hour (15 branches, every listing after the first refused)', () => {
    const simulate = (passMs: number): number => {
      let t = 0;
      let attempts = 0;
      let backoffUntil: number | null = null;
      let backoffMs: number | null = null;
      let first = true;
      while (t < 3_600_000) {
        const verdict = listingBackoff({ backoffUntil, backoffMs, now: t });
        if (verdict.open) {
          attempts += 1;
          if (first) {
            first = false;
            backoffUntil = null;
            backoffMs = null;
          } else {
            backoffUntil = t + verdict.onRefusalMs;
            backoffMs = verdict.onRefusalMs;
          }
        }
        t += passMs;
      }
      return attempts;
    };

    it('makes at most 8 listing attempts an hour at a 5 s scan pass', () => {
      expect(simulate(5_000)).toBeLessThanOrEqual(8);
    });

    it('makes at most 8 listing attempts an hour at a 40 s scan pass, the same bound', () => {
      // A rule tuned to one pass duration passing the other by accident is
      // exactly the gap the plan calls out: the two measured figures (362 and
      // 48) differ by a factor of 7.5 under today's unbounded retry.
      expect(simulate(40_000)).toBeLessThanOrEqual(8);
    });
  });
});
