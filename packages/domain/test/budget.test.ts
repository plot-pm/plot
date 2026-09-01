import { describe, it, expect } from 'vitest';

import {
  budgetKeyOf,
  decodeEntry,
  encodeEntry,
  entryOf,
  headroom,
  MAX_LINE_BYTES,
  sameBudget,
  spendVerdict,
  withinLineCap,
  type BudgetEntry,
  type BudgetKey,
} from '../src/entities/budget.js';
import { actualLimit, predictedLimit, unknownLimit } from '../src/entities/limit.js';
import {
  FALLBACK_WINDOW_MS,
  groupByBudget,
  latest,
  PRUNE_THRESHOLD,
  readWindow,
  survivors,
  truncationOwed,
  windowSpend,
  windowStart,
} from '../src/rules/budget-record.js';

/**
 * The record's KEY, FORMAT, WINDOW and PRUNING — and nothing that appends to it.
 *
 * FOUR ASSERTIONS EXIST BECAUSE A NAIVE IMPLEMENTATION PASSES WITHOUT THEM, and
 * they are the reason this file is not just a round-trip test:
 *
 * 1. `unknown` does not read as headroom — asserted on the READER'S DECISION,
 *    not on the stored value. The defect is a consumer treating absence as
 *    permission, and a test that only checks `limit === null` never sees it.
 * 2. Truncation keeps every line inside the window — asserted on WHAT SURVIVES.
 *    A pruner that is merely called proves nothing.
 * 3. The line cap is the MEASURED `PIPE_BUF`, not the documented one.
 * 4. A bucket's window is its own, so one reader's truncation cannot delete
 *    another connector's live lines.
 *
 * The two-checkout assertion and the concurrent-append one need a disk and live
 * in `budget-file.test.ts`.
 */

const GITHUB: BudgetKey = { connector: 'github', account: 'jwloka', bucket: 'graphql' };
const REST: BudgetKey = { connector: 'github', account: 'jwloka', bucket: 'core' };
const NOW = 1_788_269_670_000;

/** One line for a budget, spent `spent` calls ago in the window. */
const entry = (key: BudgetKey, at: number, over: Partial<BudgetEntry> = {}): BudgetEntry => ({
  key,
  at,
  spent: 1,
  limit: 5000,
  remaining: 4854,
  resetAt: NOW + 30 * 60 * 1000,
  basis: 'actual',
  ...over,
});

describe('the key is (connector, account, bucket) and validates none of them', () => {
  it('tells two buckets of one account apart', () => {
    // MEASURED 2026-09-01: `gh` GraphQL and REST have separate limits, so a
    // GraphQL exhaustion says nothing about REST. A per-connector number would
    // refuse calls that would have succeeded.
    expect(sameBudget(GITHUB, REST)).toBe(false);
    expect(budgetKeyOf(GITHUB)).not.toBe(budgetKeyOf(REST));
  });

  it('tells two accounts of one connector apart', () => {
    expect(sameBudget(GITHUB, { ...GITHUB, account: 'someone-else' })).toBe(false);
  });

  it('carries a connector nobody has written an adapter for', () => {
    // `Tracker` already names `linear` with no adapter behind it, and a closed
    // enum here would be the edit that gets forgotten when GitLab arrives.
    const gitlab: BudgetKey = { connector: 'gitlab', account: 'jwloka', bucket: 'api' };
    const line = encodeEntry(entry(gitlab, NOW));
    expect(decodeEntry(line)?.key).toEqual(gitlab);
  });

  it('keeps the bucket in the connector own word rather than a normalised one', () => {
    // A GitHub Actions minute quota and the API's 5000/hr are the same vendor on
    // different budgets, and only the connector's own word tells them apart.
    const actions: BudgetKey = { connector: 'github', account: 'jwloka', bucket: 'actions-minutes' };
    expect(decodeEntry(encodeEntry(entry(actions, NOW)))?.key.bucket).toBe('actions-minutes');
  });
});

describe('the format holds one line per call, inside the measured atomicity cap', () => {
  it('caps a line at the smallest PIPE_BUF the fleet measured', () => {
    // 512, NOT 4096. `getconf PIPE_BUF /` reports 512 on this fleet's macOS
    // machines; Linux reports 4096, and both the plan and DESIGN-budget.md said
    // "4096 bytes on Linux and macOS" until this slice measured it. A cap at
    // 4096 would be eight times the guarantee on the machine it runs on.
    expect(MAX_LINE_BYTES).toBe(512);
  });

  it('writes an ordinary line far inside the cap', () => {
    const line = encodeEntry(entry(GITHUB, NOW));
    expect(withinLineCap(line)).toBe(true);
    expect(line.endsWith('\n')).toBe(true);
  });

  it('refuses a line whose key alone would exceed the cap', () => {
    const huge = encodeEntry(entry({ ...GITHUB, account: 'a'.repeat(600) }, NOW));
    expect(withinLineCap(huge)).toBe(false);
  });

  it('counts bytes rather than characters', () => {
    // A UTF-8 account name costs more than its length, and it is bytes the
    // kernel guarantees.
    const wide = encodeEntry(entry({ ...GITHUB, account: 'ü'.repeat(300) }, NOW));
    expect(wide.length).toBeLessThan(MAX_LINE_BYTES);
    expect(withinLineCap(wide)).toBe(false);
  });

  it('round-trips every field', () => {
    const original = entry(GITHUB, NOW, { spent: 3, remaining: 0, basis: 'actual' });
    expect(decodeEntry(encodeEntry(original))).toEqual(original);
  });

  it('writes an absent number as absent rather than as zero', () => {
    // A `remaining` of 0 means the bucket is spent and every call is refused; an
    // absent one means the connector did not say. A fallback of 0 would make
    // silence read as exhaustion.
    const silent = entry(GITHUB, NOW, { remaining: null, resetAt: null });
    const read = decodeEntry(encodeEntry(silent));
    expect(read?.remaining).toBeNull();
    expect(read?.resetAt).toBeNull();
  });

  it('skips a torn line rather than throwing on it', () => {
    // The file is appended to by processes that may be killed mid-write, so a
    // torn tail is a thing every reader meets. A reader that throws reports the
    // whole account's budget as unreadable, which reads as headroom to anything
    // that takes a fallback.
    expect(decodeEntry('b1\tgithub\tjwlok')).toBeNull();
    expect(decodeEntry('')).toBeNull();
  });

  it('skips a line from a format it does not know', () => {
    expect(decodeEntry('b2\tgithub\tjwloka\tgraphql\t1\t1\t1\t1\t1\tactual')).toBeNull();
  });

  it('never lets a key part add a field or a line', () => {
    const nasty: BudgetKey = { connector: 'git\thub', account: 'jw\nloka', bucket: 'graphql' };
    const line = encodeEntry(entry(nasty, NOW));
    expect(line.split('\n').filter((part) => part !== '')).toHaveLength(1);
    expect(decodeEntry(line)?.key).toEqual({
      connector: 'git_hub',
      account: 'jw_loka',
      bucket: 'graphql',
    });
  });

  it('builds a line from a limit reading and a spend', () => {
    const reading = actualLimit({
      connector: 'github',
      bucket: 'graphql',
      limit: 5000,
      remaining: 4854,
      resetAt: NOW + 60_000,
    });
    const built = entryOf(GITHUB, reading, NOW);
    expect(built).toEqual({
      key: GITHUB,
      at: NOW,
      spent: 1,
      limit: 5000,
      remaining: 4854,
      resetAt: NOW + 60_000,
      basis: 'actual',
    });
  });
});

describe('unknown does not read as headroom', () => {
  it('reports no headroom for a connector that said nothing', () => {
    // THE READER'S DECISION IS WHAT IS UNDER TEST. Asserting the stored limit is
    // null would pass against a consumer that then spends anyway.
    const silent = entryOf(GITHUB, unknownLimit('github', 'graphql'), NOW);
    expect(headroom(silent)).toBeNull();
    expect(spendVerdict(silent)).toBe('unknown');
  });

  it('does not report an unknown reading as spendable', () => {
    const silent = entryOf(GITHUB, unknownLimit('github', 'graphql'), NOW);
    expect(spendVerdict(silent)).not.toBe('spendable');
  });

  it('does not report an unknown reading as spent either', () => {
    // `unknown` is not a reason to refuse. The first call on a fresh record is
    // un-budgeted, and that is the correct cost: one call, once, to learn what
    // the connector will say.
    const silent = entryOf(GITHUB, unknownLimit('github', 'graphql'), NOW);
    expect(spendVerdict(silent)).not.toBe('spent');
  });

  it('reports no headroom where a limit is known and the spend is not', () => {
    // A prediction carries a ceiling and no remaining count, so what is LEFT is
    // unknown even though the limit is known. Reading the limit as headroom
    // would spend 5000 calls against a bucket that may already be empty.
    const guessed = entryOf(GITHUB, predictedLimit('github', 'graphql', 5000), NOW);
    expect(guessed.limit).toBe(5000);
    expect(headroom(guessed)).toBeNull();
    expect(spendVerdict(guessed)).toBe('unknown');
  });

  it('reports an empty record as unknown rather than as room', () => {
    expect(spendVerdict(null)).toBe('unknown');
  });

  it('tells a spent bucket from an unknown one', () => {
    const spent = entryOf(
      GITHUB,
      actualLimit({ connector: 'github', bucket: 'graphql', limit: 5000, remaining: 0, resetAt: NOW }),
      NOW,
    );
    expect(headroom(spent)).toBe(0);
    expect(spendVerdict(spent)).toBe('spent');
  });

  it('reports headroom where the connector reported some', () => {
    expect(spendVerdict(entry(GITHUB, NOW))).toBe('spendable');
  });
});

describe('a reader consumes only lines inside the connector own window', () => {
  it('starts the window at a reset the connector stated and that has passed', () => {
    // A reset that HAS HAPPENED is proof the bucket refilled, so every line
    // before it describes a bucket that no longer exists.
    const passed = NOW - 10 * 60 * 1000;
    expect(windowStart([entry(GITHUB, NOW - 20 * 60 * 1000, { resetAt: passed })], NOW)).toBe(passed);
  });

  it('falls back to an hour where nothing states a reset', () => {
    // The window is the CONNECTOR'S. A Jenkins instance with no limit at all
    // states no horizon, so the fallback is all there is.
    expect(windowStart([entry(GITHUB, NOW, { resetAt: null })], NOW)).toBe(NOW - FALLBACK_WINDOW_MS);
  });

  it('ignores a reset still in the future', () => {
    // IT SAYS THE WINDOW HAS NOT CLOSED, not when it opened — the interval is
    // the connector's and it publishes none. Subtracting an assumed hour from a
    // reset an hour out lands on `now`, which would make every line ever
    // written older than the window.
    const ahead = NOW + 59 * 60 * 1000;
    expect(windowStart([entry(GITHUB, NOW, { resetAt: ahead })], NOW)).toBe(NOW - FALLBACK_WINDOW_MS);
  });

  it('never starts a window in the future', () => {
    const far = NOW + 10 * FALLBACK_WINDOW_MS;
    expect(windowStart([entry(GITHUB, NOW, { resetAt: far })], NOW)).toBeLessThanOrEqual(NOW);
  });

  it('prefers a passed reset over the fallback when it is later', () => {
    const passed = NOW - 5 * 60 * 1000;
    const lines = [entry(GITHUB, NOW - 30 * 60 * 1000, { resetAt: passed })];
    expect(windowStart(lines, NOW)).toBe(passed);
    expect(windowStart(lines, NOW)).toBeGreaterThan(NOW - FALLBACK_WINDOW_MS);
  });

  it('keeps the fallback where a passed reset is older than it', () => {
    // A reset from three hours ago is not evidence about the last hour. Taking
    // it would widen the window past the fallback and drag dead lines back in.
    const stale = NOW - 3 * FALLBACK_WINDOW_MS;
    expect(windowStart([entry(GITHUB, NOW, { resetAt: stale })], NOW)).toBe(
      NOW - FALLBACK_WINDOW_MS,
    );
  });

  it('drops the lines the reset has already killed', () => {
    // A rate derived over the whole file approaches zero as the file grows,
    // which is the opposite of what the record is for.
    const lines = [
      encodeEntry(entry(GITHUB, NOW - 5 * FALLBACK_WINDOW_MS)),
      encodeEntry(entry(GITHUB, NOW - 10 * 60 * 1000)),
      encodeEntry(entry(GITHUB, NOW - 60 * 1000)),
    ];
    const read = readWindow(lines, GITHUB, NOW);
    expect(read.live).toHaveLength(2);
    expect(read.dead).toHaveLength(1);
    expect(read.dead[0]?.at).toBe(NOW - 5 * FALLBACK_WINDOW_MS);
  });

  it('counts an unreadable line without letting it become a reading', () => {
    const read = readWindow([encodeEntry(entry(GITHUB, NOW)), 'garbage'], GITHUB, NOW);
    expect(read.live).toHaveLength(1);
    expect(read.unreadable).toBe(1);
  });

  it('ignores another budget lines entirely', () => {
    // Not this budget's business, and counting them dead would let one reader's
    // truncation delete another connector's live window.
    const lines = [
      encodeEntry(entry(GITHUB, NOW)),
      encodeEntry(entry(REST, NOW - 5 * FALLBACK_WINDOW_MS)),
    ];
    const read = readWindow(lines, GITHUB, NOW);
    expect(read.live).toHaveLength(1);
    expect(read.dead).toHaveLength(0);
  });

  it('reads the newest line in the window and not the newest in the file', () => {
    // A line the reset killed describes a bucket that no longer exists, so
    // reading it as the current state reports a spent bucket long after it
    // refilled. The dead line here is NEWER in remaining terms and older in time.
    const lines = [
      encodeEntry(entry(GITHUB, NOW - 5 * FALLBACK_WINDOW_MS, { remaining: 0, resetAt: null })),
      encodeEntry(entry(GITHUB, NOW - 60 * 1000, { remaining: 4000 })),
    ];
    const read = readWindow(lines, GITHUB, NOW);
    expect(latest(read)?.remaining).toBe(4000);
    expect(spendVerdict(latest(read))).toBe('spendable');
  });

  it('reports no reading where the window holds none', () => {
    const read = readWindow([], GITHUB, NOW);
    expect(latest(read)).toBeNull();
    expect(spendVerdict(latest(read))).toBe('unknown');
  });

  it('derives the rate over the window rather than over the file', () => {
    // 30 lines over the last half hour is 60 an hour. The same 30 lines with a
    // week of dead ones in front of them is still 60 an hour, which is the whole
    // reason the window exists.
    const live = Array.from({ length: 30 }, (_unused, index) =>
      encodeEntry(entry(GITHUB, NOW - 30 * 60 * 1000 + index * 60_000, { resetAt: null })),
    );
    const dead = Array.from({ length: 500 }, (_unused, index) =>
      encodeEntry(entry(GITHUB, NOW - 7 * 24 * FALLBACK_WINDOW_MS + index, { resetAt: null })),
    );
    const spendOfLive = windowSpend(readWindow(live, GITHUB, NOW), NOW);
    const spendOfBoth = windowSpend(readWindow([...dead, ...live], GITHUB, NOW), NOW);
    expect(spendOfLive.spent).toBe(30);
    expect(spendOfBoth.spent).toBe(30);
    expect(spendOfBoth.perHour).toBeCloseTo(spendOfLive.perHour ?? 0, 6);
    expect(spendOfBoth.perHour).toBeCloseTo(60, 0);
  });

  it('reports no rate where there is no span to divide by', () => {
    // One line taken this instant divides by zero. A rate of zero would read as
    // an idle account, which is the reading that relaxes a cadence wrongly.
    expect(windowSpend(readWindow([encodeEntry(entry(GITHUB, NOW))], GITHUB, NOW), NOW).perHour)
      .toBeNull();
  });
});

describe('truncation keeps every line inside the window', () => {
  it('keeps the live lines and drops the dead ones', () => {
    // ASSERTED ON WHAT SURVIVES. A pruner that is merely called proves nothing.
    const liveAt = [NOW - 20 * 60 * 1000, NOW - 60 * 1000];
    const lines = [
      encodeEntry(entry(GITHUB, NOW - 3 * FALLBACK_WINDOW_MS, { resetAt: null })),
      ...liveAt.map((at) => encodeEntry(entry(GITHUB, at, { resetAt: null }))),
    ];
    expect(survivors(lines, NOW).map((kept) => kept.at)).toEqual(liveAt);
  });

  it('keeps every OTHER budget live window too', () => {
    // ONE FILE, MANY BUDGETS. A truncation driven by one reader's window would
    // drop another connector's live lines, and the two windows differ in length
    // because the reset is the connector's.
    const jenkins: BudgetKey = { connector: 'jenkins', account: 'ci', bucket: '' };
    const lines = [
      encodeEntry(entry(GITHUB, NOW - 10 * 60 * 1000, { resetAt: null })),
      encodeEntry(entry(jenkins, NOW - 20 * 60 * 1000, { resetAt: null, basis: 'unknown' })),
      encodeEntry(entry(GITHUB, NOW - 3 * FALLBACK_WINDOW_MS, { resetAt: null })),
    ];
    const kept = survivors(lines, NOW);
    expect(kept).toHaveLength(2);
    expect(kept.map((line) => line.key.connector)).toEqual(['jenkins', 'github']);
  });

  it('respects a budget own stated reset when another budget states none', () => {
    // A line 30 minutes old is LIVE under the one-hour fallback and DEAD for a
    // budget whose reset passed ten minutes ago. Both are in one file, each
    // keeps its own window, and the two disagree about the same timestamp.
    const shortWindow: BudgetKey = { connector: 'bitbucket', account: 'jwloka', bucket: 'api' };
    const halfHourAgo = NOW - 30 * 60 * 1000;
    const lines = [
      encodeEntry(entry(GITHUB, halfHourAgo, { resetAt: null })),
      encodeEntry(entry(shortWindow, halfHourAgo, { resetAt: NOW - 10 * 60 * 1000 })),
    ];
    const kept = survivors(lines, NOW);
    expect(kept.map((line) => line.key.connector)).toEqual(['github']);
  });

  it('drops what it could not read at all', () => {
    // A torn tail describes nothing, and preserving a line this Plot cannot read
    // on faith would keep the file growing forever.
    const kept = survivors([encodeEntry(entry(GITHUB, NOW)), 'garbage', ''], NOW);
    expect(kept).toHaveLength(1);
  });

  it('groups the file by budget', () => {
    const lines = [encodeEntry(entry(GITHUB, NOW)), encodeEntry(entry(REST, NOW))];
    expect([...groupByBudget(lines).keys()]).toEqual([budgetKeyOf(GITHUB), budgetKeyOf(REST)]);
  });

  it('owes no truncation while the dead lines are few', () => {
    // Truncation is the one write that is not an append, and a threshold of one
    // would make every reader a writer — reintroducing the contention the
    // append-only design removes.
    const lines = Array.from({ length: PRUNE_THRESHOLD - 1 }, () =>
      encodeEntry(entry(GITHUB, NOW - 3 * FALLBACK_WINDOW_MS, { resetAt: null })),
    );
    expect(truncationOwed(readWindow(lines, GITHUB, NOW))).toBe(false);
  });

  it('owes a truncation once enough lines are dead', () => {
    const lines = Array.from({ length: PRUNE_THRESHOLD }, () =>
      encodeEntry(entry(GITHUB, NOW - 3 * FALLBACK_WINDOW_MS, { resetAt: null })),
    );
    expect(truncationOwed(readWindow(lines, GITHUB, NOW))).toBe(true);
  });

  it('counts unreadable lines toward the truncation it owes', () => {
    // They are dead weight the same way, and a file of them would otherwise
    // never be pruned.
    const lines = Array.from({ length: PRUNE_THRESHOLD }, () => 'garbage');
    expect(truncationOwed(readWindow(lines, GITHUB, NOW))).toBe(true);
  });

  it('leaves the record readable after truncation', () => {
    const lines = [
      encodeEntry(entry(GITHUB, NOW - 3 * FALLBACK_WINDOW_MS, { resetAt: null })),
      encodeEntry(entry(GITHUB, NOW - 60 * 1000, { resetAt: null })),
    ];
    const rewritten = survivors(lines, NOW).map(encodeEntry);
    const read = readWindow(rewritten, GITHUB, NOW);
    expect(read.live).toHaveLength(1);
    expect(read.dead).toHaveLength(0);
    expect(read.unreadable).toBe(0);
  });
});

/**
 * THE EDGE PATHS, each of which a reader reaches on a real record and none of
 * which the assertions above pass through.
 *
 * Every one is a case where the wrong answer READS AS HEADROOM — a field that
 * decodes to a number it is not, a window that starts too early, a pace divided
 * by a span of zero. That is the direction this record must never fail in, so
 * the paths are specified rather than left to the reducer's initial step.
 */
describe('a field that is neither absent nor a number', () => {
  it('reads as absent rather than as NaN', () => {
    // `Number('some')` is NaN, and `headroom` returns `remaining` unchanged, so
    // a NaN there reaches `left > 0` and answers false — `spent`, a refusal
    // invented from a torn field. Reading the field as absent answers `unknown`
    // instead, which is the one verdict a caller may not treat as permission.
    const line = encodeEntry(entry(GITHUB, NOW)).split('\t');
    line[7] = 'some';
    const read = decodeEntry(line.join('\t'));
    expect(read?.remaining).toBeNull();
    expect(spendVerdict(read)).toBe('unknown');
  });

  it('rejects the whole line where the timestamp is not a number', () => {
    // `at` orders the window. A line whose timestamp does not parse cannot be
    // placed in or out of it, so it is not a reading at all.
    const line = encodeEntry(entry(GITHUB, NOW)).split('\t');
    line[4] = 'tuesday';
    expect(decodeEntry(line.join('\t'))).toBeNull();
  });

  it('rejects the whole line where the spend is not a number', () => {
    const line = encodeEntry(entry(GITHUB, NOW)).split('\t');
    line[5] = 'some';
    expect(decodeEntry(line.join('\t'))).toBeNull();
  });
});

describe('the window over several passed resets', () => {
  it('keeps the latest passed reset when an earlier one follows it in the file', () => {
    // File order is append order, which is NOT reset order: a process writing
    // late can carry an older `resetAt` than one already on disk. The window
    // takes the LATEST passed reset whichever line holds it, so a stale line
    // arriving last must not widen the window back.
    const late = NOW - 5 * 60 * 1000;
    const early = NOW - 20 * 60 * 1000;
    const lines = [
      entry(GITHUB, NOW - 30 * 60 * 1000, { resetAt: late }),
      entry(GITHUB, NOW - 25 * 60 * 1000, { resetAt: early }),
    ];
    expect(windowStart(lines, NOW)).toBe(late);
  });
});

describe('the pace of an empty window', () => {
  it('reports no pace rather than a division by zero', () => {
    // A record with no live line has no span. `spent / 0` is Infinity, which
    // would read as a rate no caller could act on, so the pace is absent.
    const read = readWindow([], GITHUB, NOW);
    const spend = windowSpend(read, NOW);
    expect(spend.spent).toBe(0);
    expect(spend.spanMs).toBe(0);
    expect(spend.perHour).toBeNull();
  });
});

describe('a blank line in the record', () => {
  it('is skipped without counting as unreadable', () => {
    // A record is appended to by several processes and ends with a newline, so
    // a trailing blank line is the normal shape rather than damage. Counting it
    // as unreadable would report corruption on every healthy file, and
    // `unreadable` is what a caller reads to decide the record cannot be
    // trusted.
    const read = readWindow(['', encodeEntry(entry(GITHUB, NOW)), '   ', ''], GITHUB, NOW);
    expect(read.live).toHaveLength(1);
    expect(read.unreadable).toBe(0);
  });
});

describe('the newest live entry among several', () => {
  it('keeps the newer entry when an older one follows it', () => {
    // File order is append order and carries no guarantee about `at`: a process
    // delayed between reading a header and writing its line appends an older
    // stamp after a newer one. The reducer keeps the newest by stamp rather
    // than the last by position, so a late-arriving old line must not become
    // the reading.
    const newer = entry(GITHUB, NOW, { remaining: 3000 });
    const older = entry(GITHUB, NOW - 60 * 1000, { remaining: 4900 });
    const read = readWindow([encodeEntry(newer), encodeEntry(older)], GITHUB, NOW);
    expect(read.live).toHaveLength(2);
    expect(latest(read)?.remaining).toBe(3000);
  });

  it('takes the last of two entries written in the same millisecond', () => {
    // `at` is a millisecond stamp and two appends can share one. The reducer
    // keeps the later line, so the answer is the one written last rather than
    // the one read first.
    const first = entry(GITHUB, NOW, { remaining: 4000 });
    const second = entry(GITHUB, NOW, { remaining: 3000 });
    const read = readWindow([encodeEntry(first), encodeEntry(second)], GITHUB, NOW);
    expect(read.live).toHaveLength(2);
    expect(latest(read)?.remaining).toBe(3000);
  });
});
