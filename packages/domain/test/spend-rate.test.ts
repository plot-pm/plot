import { describe, expect, it } from 'vitest';

import { encodeEntry, type BudgetEntry, type BudgetKey } from '../src/entities/budget.js';
import { PRUNE_THRESHOLD, spendRate } from '../src/rules/budget-record.js';

/**
 * The ONE ANSWER a reader of the record gets.
 *
 * The four rules beneath it are already covered by `budget.test.ts`; what this
 * file pins is that they are COMPOSED the same way for every caller. The
 * board's cadence, the banner's wording and the pruner all read this, and a
 * caller assembling the four itself is a caller that can assemble them
 * differently.
 */

const KEY: BudgetKey = { connector: 'github', account: 'jwloka', bucket: 'api' };
const NOW = 1_788_269_670_000;
const MINUTE = 60 * 1000;

const entry = (at: number, over: Partial<BudgetEntry> = {}): BudgetEntry => ({
  key: KEY,
  at,
  spent: 1,
  limit: 5000,
  remaining: 4854,
  resetAt: null,
  basis: 'actual',
  ...over,
});

const lines = (...entries: readonly BudgetEntry[]): readonly string[] =>
  entries.map((one) => encodeEntry(one).trimEnd());

describe('the spend rate is read over the window', () => {
  it('counts the live lines and divides by the span they cover', () => {
    const read = spendRate(lines(entry(NOW - 30 * MINUTE), entry(NOW - 15 * MINUTE)), KEY, NOW);
    expect(read.spent).toBe(2);
    expect(read.spanMs).toBe(30 * MINUTE);
    expect(Math.round(read.perHour ?? 0)).toBe(4);
  });

  it('ignores the lines a passed reset has killed', () => {
    // THE WHOLE REASON THE WINDOW EXISTS. Measured 2026-09-01: ~1,160 lines an
    // hour, 15 MB a week. A rate over the whole file approaches zero, and a
    // cadence derived from it relaxes forever.
    const passed = NOW - 20 * MINUTE;
    const read = spendRate(
      lines(
        entry(NOW - 40 * MINUTE, { resetAt: passed }),
        entry(NOW - 10 * MINUTE, { resetAt: passed }),
      ),
      KEY,
      NOW,
    );
    expect(read.spent).toBe(1);
  });

  it('does not let a reset still ahead discard the window', () => {
    // THE ARITHMETIC THAT DISCARDS EVERY LIVE LINE. A reset an hour out says
    // only that the window has not closed; it says nothing about when it
    // opened. Reading it as a boundary lands the window start on `now`, and
    // every line ever written is then older than the window — a record that
    // holds 40 calls reports a spend of 0, which reads as headroom.
    const ahead = NOW + 55 * MINUTE;
    const read = spendRate(
      lines(
        entry(NOW - 40 * MINUTE, { resetAt: ahead }),
        entry(NOW - 10 * MINUTE, { resetAt: ahead }),
      ),
      KEY,
      NOW,
    );
    expect(read.spent).toBe(2);
    expect(read.spanMs).toBe(40 * MINUTE);
  });

  it('counts only this budget', () => {
    // A rate that summed the file would report a GitHub cadence inflated by
    // every Jenkins poll on the machine.
    const other: BudgetKey = { connector: 'jenkins', account: 'ci', bucket: '' };
    const read = spendRate(
      lines(entry(NOW - MINUTE), entry(NOW - 2 * MINUTE, { key: other })),
      KEY,
      NOW,
    );
    expect(read.spent).toBe(1);
  });

  it('reports an absent rate rather than a zero one where there is no span', () => {
    // An invented rate is exactly the dishonest cadence input the record exists
    // to remove. One line has nothing to divide by.
    const read = spendRate(lines(entry(NOW)), KEY, NOW);
    expect(read.spent).toBe(1);
    expect(read.perHour).toBeNull();
  });

  it('reports nothing at all from an empty record', () => {
    const read = spendRate([], KEY, NOW);
    expect(read.spent).toBe(0);
    expect(read.perHour).toBeNull();
    expect(read.reading).toBeNull();
    expect(read.verdict).toBe('unknown');
  });
});

describe('the reading is the newest live line', () => {
  it('reads the current state from the newest line inside the window', () => {
    const read = spendRate(
      lines(entry(NOW - 20 * MINUTE, { remaining: 4900 }), entry(NOW - MINUTE, { remaining: 4854 })),
      KEY,
      NOW,
    );
    expect(read.reading?.remaining).toBe(4854);
    expect(read.headroom).toBe(4854);
    expect(read.verdict).toBe('spendable');
  });

  it('never reads a dead line as the current state', () => {
    // A line the reset has killed describes a bucket that no longer exists, so
    // reading it as current would report a spent bucket long after it refilled.
    const read = spendRate(lines(entry(NOW - 5 * 60 * MINUTE, { remaining: 0 })), KEY, NOW);
    expect(read.reading).toBeNull();
    expect(read.verdict).toBe('unknown');
  });

  it('tells a recorded zero apart from an unknown', () => {
    // The pair the record refuses to collapse: 0 means the bucket is spent and
    // every call is refused; absent means the connector did not say.
    const spent = spendRate(lines(entry(NOW, { remaining: 0 })), KEY, NOW);
    expect(spent.verdict).toBe('spent');
    expect(spent.headroom).toBe(0);

    const silent = spendRate(
      lines(entry(NOW, { basis: 'unknown', limit: null, remaining: null })),
      KEY,
      NOW,
    );
    expect(silent.verdict).toBe('unknown');
    expect(silent.headroom).toBeNull();
  });

  it('refuses an unknown basis as headroom even where a number was stored', () => {
    // `unknown` IS NOT HEADROOM, and the stored value is not the defect — a
    // consumer reading absence as permission is.
    const read = spendRate(lines(entry(NOW, { basis: 'unknown', remaining: 4854 })), KEY, NOW);
    expect(read.headroom).toBeNull();
    expect(read.verdict).toBe('unknown');
  });
});

describe('the reader says whether pruning is owed', () => {
  it('owes nothing while the dead lines are few', () => {
    const read = spendRate(lines(entry(NOW - 5 * 60 * MINUTE), entry(NOW - MINUTE)), KEY, NOW);
    expect(read.pruneOwed).toBe(false);
  });

  it('owes a truncation once enough lines are dead', () => {
    // Truncation is the one write that is not an append, so a threshold of one
    // would make every reader a writer and reintroduce the contention the
    // append-only design removes.
    const dead = Array.from({ length: PRUNE_THRESHOLD }, (_, index) =>
      entry(NOW - 5 * 60 * MINUTE - index),
    );
    const read = spendRate(lines(...dead, entry(NOW - MINUTE)), KEY, NOW);
    expect(read.pruneOwed).toBe(true);
  });

  it('counts an unreadable line toward pruning and never toward the spend', () => {
    // A torn tail describes nothing. Counting it as a spend would inflate the
    // rate; ignoring it entirely would leave it in the file forever.
    const read = spendRate([...lines(entry(NOW)), 'b1\tgithub\tjwloka', 'not a line'], KEY, NOW);
    expect(read.spent).toBe(1);
    expect(read.unreadable).toBe(2);
  });
});
