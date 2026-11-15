import { describe, expect, it } from 'vitest';

import { encodeEntry, type BudgetEntry } from '../src/entities/budget.js';
import { connectorSpend } from '../src/rules/budget-record.js';

const NOW = 1_788_269_670_000;
const MINUTE = 60 * 1000;

const entry = (at: number, over: Partial<BudgetEntry> & { bucket?: string } = {}): BudgetEntry => {
  const { bucket, ...rest } = over;
  return {
    key: { connector: 'github', account: 'jwloka', bucket: bucket ?? 'core' },
    at,
    spent: 1,
    limit: 5000,
    remaining: 4854,
    resetAt: null,
    basis: 'actual',
    ...rest,
  };
};

const lines = (...entries: readonly BudgetEntry[]): readonly string[] =>
  entries.map((one) => encodeEntry(one).trimEnd());

describe('connectorSpend reads every bucket of one account in one window', () => {
  it('sums the spend of every bucket and divides by the span of the oldest live line', () => {
    const read = connectorSpend(
      lines(entry(NOW - 30 * MINUTE), entry(NOW - 15 * MINUTE, { bucket: 'graphql', spent: 2 })),
      'github',
      'jwloka',
      NOW,
    );
    expect(read).toMatchObject({ spent: 3, spanMs: 30 * MINUTE, perHour: 6 });
  });

  it('starts the window at the latest reset that has passed, whichever bucket stated it', () => {
    const read = connectorSpend(
      lines(
        entry(NOW - 50 * MINUTE),
        entry(NOW - 20 * MINUTE, { bucket: 'graphql', resetAt: NOW - 10 * MINUTE }),
        entry(NOW - 5 * MINUTE),
      ),
      'github',
      'jwloka',
      NOW,
    );
    expect(read).toMatchObject({ spent: 1, spanMs: 5 * MINUTE });
  });

  it('reports the newest live line that carries a reading, from any bucket', () => {
    const read = connectorSpend(
      lines(
        entry(NOW - 3 * MINUTE, { bucket: 'graphql', remaining: 4391, resetAt: NOW + 30 * MINUTE }),
        entry(NOW - 1 * MINUTE, { basis: 'unknown', limit: null, remaining: null }),
      ),
      'github',
      'jwloka',
      NOW,
    );
    expect(read).toMatchObject({ limit: 5000, remaining: 4391, resetAt: NOW + 30 * MINUTE, basis: 'actual' });
  });

  it('reads no other connector and no other account', () => {
    const read = connectorSpend(
      lines(
        entry(NOW - 10 * MINUTE, { key: { connector: 'jira', account: 'jwloka', bucket: 'api' } }),
        entry(NOW - 10 * MINUTE, { key: { connector: 'github', account: 'someone', bucket: 'core' } }),
      ),
      'github',
      'jwloka',
      NOW,
    );
    expect(read).toEqual({ spent: 0, spanMs: 0, perHour: null, limit: null, remaining: null, resetAt: null, basis: 'unknown' });
  });

  it('skips a torn line and a blank one', () => {
    const read = connectorSpend([...lines(entry(NOW - 6 * MINUTE)), '', 'b1\tgithub\tjwloka'], 'github', 'jwloka', NOW);
    expect(read).toMatchObject({ spent: 1, spanMs: 6 * MINUTE, perHour: 10 });
  });
});
