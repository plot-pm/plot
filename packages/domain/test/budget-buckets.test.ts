import { describe, expect, it } from 'vitest';

import { encodeEntry, type BudgetEntry, type BudgetKey } from '../src/entities/budget.js';
import { accountSpend, bucketVerdict } from '../src/rules/budget-record.js';

/**
 * THE BUDGET KNOWS WHICH BUCKET IT SPENT.
 *
 * One connector meters several pools independently, and until this slice the
 * record filed every GitHub call against one bucket named `api` — so a spent
 * GraphQL pool and a full REST one summed to a number describing neither.
 * Measured 2026-09-01 from the response headers: `core` 4990 of 5000,
 * `graphql` **0** of 5000, on one account at one moment.
 */

const NOW = 1_788_269_670_000;
const MINUTE = 60 * 1000;

const key = (bucket: string, account = 'jwloka'): BudgetKey => ({
  connector: 'github',
  account,
  bucket,
});

const entry = (bucket: string, at: number, over: Partial<BudgetEntry> = {}): BudgetEntry => ({
  key: key(bucket),
  at,
  spent: 1,
  limit: 5000,
  remaining: 4990,
  resetAt: null,
  basis: 'actual',
  ...over,
});

const lines = (...entries: readonly BudgetEntry[]): readonly string[] =>
  entries.map((one) => encodeEntry(one).trimEnd());

describe('a spent bucket does not stop the other', () => {
  it('reads each bucket by its own name', () => {
    // THE MEASUREMENT THIS SLICE EXISTS FOR. Both readings are of one account
    // at one moment, and they disagree by 4990.
    const record = lines(
      entry('core', NOW - 10 * MINUTE, { remaining: 4990 }),
      entry('graphql', NOW - 5 * MINUTE, { remaining: 0 }),
    );
    expect(bucketVerdict(record, key('graphql'), NOW)).toBe('spent');
    expect(bucketVerdict(record, key('core'), NOW)).toBe('spendable');
  });

  it('and the reverse — a spent REST pool leaves GraphQL answerable', () => {
    const record = lines(
      entry('core', NOW - 10 * MINUTE, { remaining: 0 }),
      entry('graphql', NOW - 5 * MINUTE, { remaining: 4990 }),
    );
    expect(bucketVerdict(record, key('core'), NOW)).toBe('spent');
    expect(bucketVerdict(record, key('graphql'), NOW)).toBe('spendable');
  });

  it('answers unknown for a bucket the record has never seen', () => {
    // NOT `spendable`, so silence is not read as room; and not `spent`, so a
    // fresh record does not refuse the one call that would tell it anything.
    const record = lines(entry('core', NOW - MINUTE));
    expect(bucketVerdict(record, key('graphql'), NOW)).toBe('unknown');
  });

  it('answers unknown where the connector reported no number', () => {
    // `unknown` IS NEVER `free`. A missing header is not an empty bucket and
    // not a full one — the rule slice 1 settled, at the point where routing
    // reads it.
    const record = lines(
      entry('graphql', NOW - MINUTE, { basis: 'unknown', limit: null, remaining: null }),
    );
    expect(bucketVerdict(record, key('graphql'), NOW)).toBe('unknown');
  });
});

describe('an account spends every bucket it has', () => {
  it('sums the spend across buckets and keeps each reading apart', () => {
    const record = lines(
      entry('core', NOW - 30 * MINUTE, { remaining: 4990 }),
      entry('core', NOW - 20 * MINUTE, { remaining: 4989 }),
      entry('graphql', NOW - 10 * MINUTE, { remaining: 0 }),
    );
    const spend = accountSpend(record, 'github', 'jwloka', NOW);
    expect(spend.spent).toBe(3);
    expect(spend.buckets.size).toBe(2);
    expect(spend.buckets.get('graphql')?.verdict).toBe('spent');
    expect(spend.buckets.get('core')?.verdict).toBe('spendable');
  });

  it('adds the per-hour rates, because the cadence is about the account', () => {
    const record = lines(
      entry('core', NOW - 60 * MINUTE),
      entry('core', NOW - 30 * MINUTE),
      entry('graphql', NOW - 60 * MINUTE),
      entry('graphql', NOW - 30 * MINUTE),
    );
    const spend = accountSpend(record, 'github', 'jwloka', NOW);
    // Two calls over an hour in each of two buckets: four an hour on the
    // account, which is what a cadence divides by.
    expect(Math.round(spend.perHour ?? 0)).toBe(4);
  });

  it('reports a null rate where no bucket holds a span to divide by', () => {
    // NULL IS AN ABSENT RATE, NEVER A ZERO ONE. One line gives nothing to
    // divide by, and an invented rate is the dishonest cadence input the
    // record exists to remove.
    const spend = accountSpend(lines(entry('core', NOW)), 'github', 'jwloka', NOW);
    expect(spend.perHour).toBeNull();
  });

  it('discovers buckets rather than listing them', () => {
    // A CLOSED SET IS THE EDIT THAT GETS FORGOTTEN WHEN GITLAB ARRIVES. A
    // connector nobody has written an adapter for names a third thing, and it
    // appears the first time a call spends it.
    const record = lines(entry('code_search', NOW - MINUTE, { limit: 10, remaining: 9 }));
    const spend = accountSpend(record, 'github', 'jwloka', NOW);
    expect([...spend.buckets.keys()]).toEqual(['code_search']);
  });

  it('reads one account and never another on the same connector', () => {
    // THE LIMIT BELONGS TO THE ACCOUNT. Two checkouts share one, and two
    // accounts share none — summing them would report a spend nobody made.
    const record = lines(
      entry('core', NOW - MINUTE),
      { ...entry('core', NOW - MINUTE), key: key('core', 'someone-else') },
    );
    expect(accountSpend(record, 'github', 'jwloka', NOW).spent).toBe(1);
  });

  it('reports an empty record as no buckets and no rate', () => {
    const spend = accountSpend([], 'github', 'jwloka', NOW);
    expect(spend.buckets.size).toBe(0);
    expect(spend.spent).toBe(0);
    expect(spend.perHour).toBeNull();
    expect(spend.pruneOwed).toBe(false);
  });

  it('reports pruning owed where any one bucket has earned it', () => {
    // ONE FILE, MANY BUDGETS, and the reader that holds it is the one placed
    // to say whether the rewrite is worth it.
    const dead = Array.from({ length: 200 }, (_, index) =>
      entry('graphql', NOW - 200 * MINUTE + index, { resetAt: NOW - 100 * MINUTE }),
    );
    const record = lines(...dead, entry('graphql', NOW - MINUTE, { resetAt: NOW - 100 * MINUTE }));
    expect(accountSpend(record, 'github', 'jwloka', NOW).pruneOwed).toBe(true);
  });
});

describe('an unrecorded reading does not erase a recorded one', () => {
  it('keeps the last measurement when a later call could not report one', () => {
    // MEASURED 2026-09-02 AGAINST THE LIVE HOST. A header harvest recorded
    // `graphql 4391/5000 actual`; one `pr-state` followed — `gh pr view` is a
    // GraphQL wrapper that exposes no headers, so it records a spend and no
    // numbers — and the bucket then read `remaining: null`. Every `gh pr` call
    // writes such a line, so the routing gate would never again see a spent
    // pool.
    const record = lines(
      entry('graphql', NOW - 2 * MINUTE, { remaining: 0, basis: 'actual' }),
      entry('graphql', NOW - MINUTE, { limit: null, remaining: null, basis: 'unknown' }),
    );
    expect(bucketVerdict(record, key('graphql'), NOW)).toBe('spent');
  });

  it('still counts the unreadable line as a spend', () => {
    // A CALL THAT REPORTED NOTHING STILL SPENT. Only the READING is what it
    // cannot supply — dropping the spend would under-count the account, which
    // is the failure the record exists to remove.
    const record = lines(
      entry('graphql', NOW - 2 * MINUTE, { remaining: 4990 }),
      entry('graphql', NOW - MINUTE, { limit: null, remaining: null, basis: 'unknown' }),
    );
    expect(accountSpend(record, 'github', 'jwloka', NOW).spent).toBe(2);
  });

  it('reports unknown where no line in the window carries a reading', () => {
    const record = lines(
      entry('graphql', NOW - MINUTE, { limit: null, remaining: null, basis: 'unknown' }),
    );
    expect(bucketVerdict(record, key('graphql'), NOW)).toBe('unknown');
  });
});
