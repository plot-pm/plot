import { describe, expect, it } from 'vitest';

import { rateLimitEntry } from '../src/rules/rate-limit-entry.js';
import type { AgentRunLimitReading } from '../src/ports/agent-run.js';

const reading = (over: Partial<AgentRunLimitReading> = {}): AgentRunLimitReading => ({
  status: 'allowed',
  resetsAt: 1_700_000_000,
  rateLimitType: 'session',
  utilization: 0.25,
  ...over,
});

describe('rateLimitEntry', () => {
  it('builds an entry keyed by the claude connector, the account, and the event bucket', () => {
    const actual = rateLimitEntry(reading(), 'jan@example.com', 1_700_000_000_000);

    expect(actual.key).toEqual({ connector: 'claude', account: 'jan@example.com', bucket: 'session' });
  });

  it('spends nothing — a rate-limit event rides on a run that already pays its own cost', () => {
    const actual = rateLimitEntry(reading(), 'jan@example.com', 0);

    expect(actual.spent).toBe(0);
  });

  it('models the window as one unit and remaining as the unused fraction', () => {
    const actual = rateLimitEntry(reading({ utilization: 0.25 }), 'jan@example.com', 0);

    expect(actual.limit).toBe(1);
    expect(actual.remaining).toBe(0.75);
  });

  it('reads utilization named nowhere as unknown remaining, never a full window', () => {
    const actual = rateLimitEntry(reading({ utilization: null }), 'jan@example.com', 0);

    expect(actual.remaining).toBeNull();
  });

  it('maps the live event recorded 2026-10-06: 14% used, resets 2026-10-06T16:00:00Z', () => {
    const actual = rateLimitEntry(
      { status: 'allowed', resetsAt: 1791302400, rateLimitType: 'five_hour', utilization: 0.14 },
      'jan@example.com',
      0,
    );

    expect(actual.remaining).toBeCloseTo(0.86);
    expect(new Date(actual.resetAt!).toISOString()).toBe('2026-10-06T16:00:00.000Z');
  });

  it('converts resetsAt from epoch seconds to epoch milliseconds', () => {
    const actual = rateLimitEntry(reading({ resetsAt: 1_700_000_000 }), 'jan@example.com', 0);

    expect(actual.resetAt).toBe(1_700_000_000_000);
  });

  it('carries a null resetsAt through as a null resetAt, never a computed zero', () => {
    const actual = rateLimitEntry(reading({ resetsAt: null }), 'jan@example.com', 0);

    expect(actual.resetAt).toBeNull();
  });

  it('a rejected status answers remaining 0 whatever utilization says', () => {
    // The assertion the brief calls out explicitly: utilization near the
    // boundary must not let a rejected call read as nearly-spendable.
    const actual = rateLimitEntry(
      reading({ status: 'rejected', utilization: 0.1 }),
      'jan@example.com',
      0,
    );

    expect(actual.remaining).toBe(0);
  });

  it('names no bucket as unknown rather than an empty string', () => {
    const actual = rateLimitEntry(reading({ rateLimitType: '' }), 'jan@example.com', 0);

    expect(actual.key.bucket).toBe('unknown');
  });

  it('is always actual — the SDK is the connector reporting on itself', () => {
    const actual = rateLimitEntry(reading(), 'jan@example.com', 0);

    expect(actual.basis).toBe('actual');
  });

  it('records the moment the run observed it, verbatim', () => {
    const actual = rateLimitEntry(reading(), 'jan@example.com', 1_234_000);

    expect(actual.at).toBe(1_234_000);
  });
});
