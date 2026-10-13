import { describe, expect, it } from 'vitest';

import {
  cadenceRateOf,
  ISSUE_REFRESH_MS,
  issueIntervalMs,
  issueSpendPerHour,
} from '../src/rules/cadence.js';

// The spike's Acceptance item 1, and every branch of the PR pass's subtraction
// (`docs/plans/2026-10-12-tickets-and-stories-have-lanes.md`, Acceptance, The spike).

const NOW = 1_800_000_000_000;

/** A fresh GitHub gate reading on account `jwloka` that spent one request. */
const gate = (over: Partial<{
  connector: string;
  account: string | null;
  requests: number;
  nextAt: number;
}> = {}) => ({
  connector: 'github',
  account: 'jwloka',
  requests: 1,
  nextAt: NOW + ISSUE_REFRESH_MS,
  ...over,
});

describe('the issue gate interval', () => {
  it('answers 120 000 for one request and 480 000 for four', () => {
    expect(issueIntervalMs(1)).toBe(120_000);
    expect(issueIntervalMs(4)).toBe(480_000);
  });

  it('never falls below the refresh floor', () => {
    expect(issueIntervalMs(0)).toBe(ISSUE_REFRESH_MS);
  });

  it('spends 30 requests an hour for every request count from 1 to 21', () => {
    const counts = Array.from({ length: 21 }, (_, i) => i + 1);
    expect(counts.map(issueSpendPerHour)).toEqual(counts.map(() => 30));
  });

  it('spends nothing for a pass that spent no request', () => {
    expect(issueSpendPerHour(0)).toBe(0);
  });
});

describe('cadenceRateOf', () => {
  it('subtracts 30 from 90 for a fresh reading on the same connector and account', () => {
    expect(cadenceRateOf({ perHour: 90 }, gate(), 'github', 'jwloka', NOW)).toEqual({ perHour: 60 });
  });

  it('keeps every other field of the rate', () => {
    const rate = { perHour: 90, resetAt: 5 };
    expect(cadenceRateOf(rate, gate(), 'github', 'jwloka', NOW)).toEqual({ perHour: 60, resetAt: 5 });
  });

  it('subtracts where both accounts are null', () => {
    expect(cadenceRateOf({ perHour: 90 }, gate({ account: null }), 'github', null, NOW)).toEqual({ perHour: 60 });
  });

  it('returns a null rate unchanged', () => {
    expect(cadenceRateOf(null, gate(), 'github', 'jwloka', NOW)).toBeNull();
  });

  it('returns a rate with a null perHour unchanged', () => {
    const rate = { perHour: null };
    expect(cadenceRateOf(rate, gate(), 'github', 'jwloka', NOW)).toBe(rate);
  });

  it('returns the rate unchanged with no gate reading', () => {
    const rate = { perHour: 90 };
    expect(cadenceRateOf(rate, null, 'github', 'jwloka', NOW)).toBe(rate);
  });

  it('returns the rate unchanged for a jira reading', () => {
    const rate = { perHour: 90 };
    expect(cadenceRateOf(rate, gate({ connector: 'jira', account: 'jira:0123456789ab' }), 'github', 'jwloka', NOW)).toBe(rate);
  });

  it('returns the rate unchanged for a reading on another account', () => {
    const rate = { perHour: 90 };
    expect(cadenceRateOf(rate, gate({ account: 'someone-else' }), 'github', 'jwloka', NOW)).toBe(rate);
  });

  it('returns the rate unchanged where only one account is known', () => {
    const rate = { perHour: 90 };
    expect(cadenceRateOf(rate, gate({ account: null }), 'github', 'jwloka', NOW)).toBe(rate);
  });

  it('returns the rate unchanged for a reading whose nextAt lies more than one interval in the past', () => {
    const rate = { perHour: 90 };
    expect(cadenceRateOf(rate, gate({ nextAt: NOW - ISSUE_REFRESH_MS - 1 }), 'github', 'jwloka', NOW)).toBe(rate);
  });

  it('subtracts for a reading whose nextAt lies exactly one interval in the past', () => {
    expect(cadenceRateOf({ perHour: 90 }, gate({ nextAt: NOW - ISSUE_REFRESH_MS }), 'github', 'jwloka', NOW))
      .toEqual({ perHour: 60 });
  });

  it('measures staleness by the interval of the reading\'s own request count', () => {
    // Four requests wait 480 s, so a nextAt 300 s in the past is still fresh.
    expect(cadenceRateOf({ perHour: 90 }, gate({ requests: 4, nextAt: NOW - 300_000 }), 'github', 'jwloka', NOW))
      .toEqual({ perHour: 60 });
  });

  it('never answers below 0', () => {
    expect(cadenceRateOf({ perHour: 10 }, gate(), 'github', 'jwloka', NOW)).toEqual({ perHour: 0 });
  });
});
