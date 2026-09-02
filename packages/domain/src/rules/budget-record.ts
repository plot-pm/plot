import {
  budgetKeyOf,
  decodeEntry,
  headroom,
  spendVerdict,
  type BudgetEntry,
  type BudgetKey,
} from '../entities/budget.js';

/**
 * How long a window lasts where the connector states no reset.
 *
 * One hour, because that is the only interval any connector in this estate
 * publishes — GitHub's reset arrives as a Unix timestamp roughly an hour out —
 * and a fallback has to be some number.
 *
 * IT IS A FALLBACK, NOT A DEFAULT. The window is the CONNECTOR'S, and a fixed
 * age is wrong for every connector that states one: GitHub's hourly reset and a
 * Jenkins instance with no limit at all do not share a horizon. So a reset the
 * connector stated and that has since PASSED outranks this — see
 * {@link windowStart} for why a reset still in the future does not.
 */
export const FALLBACK_WINDOW_MS = 60 * 60 * 1000;

/**
 * When the current window for one budget began.
 *
 * READ FROM A RESET THAT HAS PASSED, never computed. The load-bearing fact a
 * reading carries is the moment the bucket refilled: every line older than a
 * reset that has ALREADY happened describes a bucket that no longer exists, so
 * the latest such reset is where the live window starts.
 *
 * A reset still in the FUTURE says only that the window has not closed yet, and
 * says nothing about when it opened — the interval is the connector's and it
 * publishes none. So that case falls through to {@link FALLBACK_WINDOW_MS}.
 * Treating a future reset as a window boundary is the arithmetic that discards
 * live lines: a reset 60 minutes out, minus a 60-minute interval, lands on
 * `now`, and every line ever written is then older than the window.
 *
 * The two bounds are combined by taking the LATER: a passed reset is proof the
 * bucket refilled and outranks the fallback, while the fallback bounds a
 * connector that has stated nothing.
 *
 * @param entries - the lines held for one budget, in any order.
 * @param now - epoch milliseconds.
 * @returns the timestamp at or after which a line is still live.
 */
export const windowStart = (entries: readonly BudgetEntry[], now: number): number => {
  const passed = entries.reduce<number | null>(
    (latest, entry) =>
      entry.resetAt !== null && entry.resetAt <= now && (latest === null || entry.resetAt > latest)
        ? entry.resetAt
        : latest,
    null,
  );
  const fallback = now - FALLBACK_WINDOW_MS;
  return passed === null ? fallback : Math.max(fallback, passed);
};

/**
 * Whether one line still describes the bucket that exists now.
 *
 * A line older than the window is DEAD, not merely old: the reset has passed,
 * so it describes a bucket that no longer exists. Counting it in a rate is what
 * drives the rate toward zero as the file grows.
 *
 * @param entry - the line.
 * @param from - the window's start, from {@link windowStart}.
 * @returns true where the line is inside the window.
 */
export const withinWindow = (entry: BudgetEntry, from: number): boolean => entry.at >= from;

/**
 * What one read of the record found, for one budget.
 *
 * `live` is what a rate may be derived from; `dead` is what truncation may
 * drop. Both are reported because a pruner told only what to keep cannot say
 * whether pruning is owed.
 */
export interface RecordRead {
  /** The lines inside the current window, in file order. */
  live: readonly BudgetEntry[];
  /** The lines the reset has already killed. */
  dead: readonly BudgetEntry[];
  /** How many lines could not be read at all — torn tails, newer formats. */
  unreadable: number;
}

/**
 * Reads the record's lines into live and dead, for ONE budget.
 *
 * THE WINDOW FILTER IS WHAT MAKES THE ANSWER RIGHT, not the pruning. A reader
 * that filters and never truncates is correct and wastes disk; a reader that
 * truncates and does not filter is fast and wrong. So this is the operation
 * every reader performs, and {@link truncationOwed} is the optional half.
 *
 * Lines belonging to other budgets are not this budget's business and are
 * neither returned nor counted dead — treating them as dead would let one
 * reader's truncation delete another connector's live window.
 *
 * @param lines - the record's raw lines, in file order.
 * @param key - which budget to read.
 * @param now - epoch milliseconds.
 * @returns the live lines, the dead ones, and how many were unreadable.
 */
export const readWindow = (lines: readonly string[], key: BudgetKey, now: number): RecordRead => {
  const wanted = budgetKeyOf(key);
  let unreadable = 0;
  const mine: BudgetEntry[] = [];
  for (const line of lines) {
    if (line.trim() === '') continue;
    const entry = decodeEntry(line);
    if (entry === null) {
      unreadable += 1;
      continue;
    }
    if (budgetKeyOf(entry.key) === wanted) mine.push(entry);
  }
  const from = windowStart(mine, now);
  return {
    live: mine.filter((entry) => withinWindow(entry, from)),
    dead: mine.filter((entry) => !withinWindow(entry, from)),
    unreadable,
  };
};

/**
 * Every budget the record holds, keyed by {@link budgetKeyOf}.
 *
 * Needed by the one write that is not an append: truncation has to keep every
 * OTHER budget's live window too, so it needs all of them and not only the one
 * the reader came for.
 *
 * @param lines - the record's raw lines, in file order.
 * @returns the entries per budget key, in file order within each.
 */
export const groupByBudget = (
  lines: readonly string[],
): ReadonlyMap<string, readonly BudgetEntry[]> => {
  const groups = new Map<string, BudgetEntry[]>();
  for (const line of lines) {
    if (line.trim() === '') continue;
    const entry = decodeEntry(line);
    if (entry === null) continue;
    const key = budgetKeyOf(entry.key);
    const existing = groups.get(key);
    if (existing === undefined) groups.set(key, [entry]);
    else existing.push(entry);
  }
  return groups;
};

/**
 * The lines a truncation keeps — every budget's live window, and nothing else.
 *
 * ONE FILE, MANY BUDGETS. A truncation driven by one reader's window would drop
 * another connector's live lines, and the two windows differ in length because
 * the reset is the connector's. So this recomputes the window per budget from
 * that budget's own readings.
 *
 * Unreadable lines are DROPPED. A torn tail describes nothing, and a line from
 * a format this Plot cannot read is one it must not preserve on faith — the
 * record is re-derivable from the next call, so losing a line costs a cadence
 * one reading.
 *
 * @param lines - the record's raw lines, in file order.
 * @param now - epoch milliseconds.
 * @returns the entries to write back, oldest first.
 */
export const survivors = (lines: readonly string[], now: number): readonly BudgetEntry[] => {
  const kept: BudgetEntry[] = [];
  for (const entries of groupByBudget(lines).values()) {
    const from = windowStart(entries, now);
    for (const entry of entries) if (withinWindow(entry, from)) kept.push(entry);
  }
  return kept.sort((left, right) => left.at - right.at);
};

/**
 * The fewest dead lines worth the one write that is not an append.
 *
 * Truncation rewrites the whole file, and in that moment a concurrent
 * appender's line can be lost. A hundred lines is under a tenth of the ~1,160
 * an hour measured 2026-09-01, so the rewrite happens a few times a window
 * rather than on every read — while a threshold of one would make every reader
 * a writer and reintroduce the contention the append-only design removes.
 */
export const PRUNE_THRESHOLD = 100;

/**
 * Whether this reader should truncate what it has just proven dead.
 *
 * PRUNED BY THE READER THAT ALREADY READ IT. A reader holding the file has just
 * established which lines are dead; a separate cleaner would re-read everything
 * to learn the same thing and would need a lock the append-only design exists
 * to avoid.
 *
 * A failed truncation costs disk rather than correctness, which is why this
 * answers *should* and never *must*: the window filter is what makes the answer
 * right.
 *
 * @param read - what {@link readWindow} found.
 * @returns true where enough lines are dead to be worth rewriting the file.
 */
export const truncationOwed = (read: RecordRead): boolean =>
  read.dead.length + read.unreadable >= PRUNE_THRESHOLD;

/**
 * How many calls were spent inside the window, and over how long.
 *
 * Derived over the WINDOW rather than the file, which is the whole reason the
 * window exists: dividing a fixed spend by an ever-growing span relaxes the
 * cadence forever, which is the opposite of what the record is for.
 *
 * @param read - what {@link readWindow} found.
 * @param now - epoch milliseconds.
 * @returns the calls spent, the span they were spent over in milliseconds, and
 *   the implied hourly rate; a null rate where the window holds no span to
 *   divide by.
 */
export const windowSpend = (
  read: RecordRead,
  now: number,
): { spent: number; spanMs: number; perHour: number | null } => {
  const spent = read.live.reduce((total, entry) => total + entry.spent, 0);
  const oldest = read.live.reduce<number | null>(
    (earliest, entry) => (earliest === null || entry.at < earliest ? entry.at : earliest),
    null,
  );
  const spanMs = oldest === null ? 0 : Math.max(0, now - oldest);
  return {
    spent,
    spanMs,
    perHour: spanMs > 0 ? (spent * FALLBACK_WINDOW_MS) / spanMs : null,
  };
};

/**
 * The most recent reading for a budget, or null where the window holds none.
 *
 * THE LAST LINE IN THE WINDOW, not the last line in the file. A line the reset
 * has killed describes a bucket that no longer exists, so reading it as the
 * current state would report a spent bucket long after it refilled.
 *
 * @param read - what {@link readWindow} found.
 * @returns the newest live entry, or null.
 */
export const latest = (read: RecordRead): BudgetEntry | null =>
  read.live.reduce<BudgetEntry | null>(
    (newest, entry) => (newest === null || entry.at >= newest.at ? entry : newest),
    null,
  );

/**
 * What one reader learns from the record about one budget.
 *
 * ONE ANSWER RATHER THAN FOUR CALLS, because the four are always wanted
 * together and a caller assembling them itself is a caller that can assemble
 * them differently. A cadence needs the rate; the banner needs the reading; the
 * reader that holds the file is the only one cheaply placed to say whether
 * pruning is owed.
 */
export interface SpendRate {
  /** How many calls the window holds. */
  spent: number;
  /** How long they were spent over, in milliseconds. */
  spanMs: number;
  /**
   * The implied calls per hour, or null where the window holds no span.
   *
   * NULL IS AN ABSENT RATE, NEVER A ZERO ONE. One line, or several written
   * inside one millisecond, gives nothing to divide by — and a rate invented
   * there would be the dishonest cadence input the record exists to remove. A
   * caller dividing by this must read the null, not coerce it.
   */
  perHour: number | null;
  /** The newest live reading, or null where the window holds none. */
  reading: BudgetEntry | null;
  /**
   * How many calls the connector says remain, or null where that is not known.
   *
   * Straight from {@link headroom}, which is where `unknown` is refused as
   * headroom: an `unknown` basis and an absent `remaining` both answer null,
   * because neither is a number a caller may spend against.
   */
  headroom: number | null;
  /** `spendable`, `spent`, or `unknown` — never a boolean. */
  verdict: 'spendable' | 'spent' | 'unknown';
  /** How many lines could not be read at all. */
  unreadable: number;
  /** Whether enough lines are dead to be worth the one write that is not an append. */
  pruneOwed: boolean;
}

/**
 * Reads one budget's spend out of the record's raw lines.
 *
 * THE ONE ENTRY POINT FOR A READER, and the reason it exists rather than four
 * exported rules: every caller wants the rate AND the reading AND the verdict,
 * and a caller that composes them itself composes them slightly differently.
 * The board's cadence, the banner's wording and the pruner all read this.
 *
 * DERIVED OVER THE WINDOW, WHICH IS THE WHOLE POINT. Measured 2026-09-01: one
 * board at 5 s and eleven scripts at 90 s append ~1,160 lines an hour, 15 MB a
 * week. A rate over the whole file approaches zero as it grows, so a cadence
 * derived from it relaxes forever — the opposite of what the record is for.
 *
 * @param lines - the record's raw lines, in file order.
 * @param key - which budget to read.
 * @param now - epoch milliseconds.
 * @returns the spend, the reading, and whether pruning is owed.
 */
export const spendRate = (
  lines: readonly string[],
  key: BudgetKey,
  now: number,
): SpendRate => {
  const read = readWindow(lines, key, now);
  const { spent, spanMs, perHour } = windowSpend(read, now);
  const reading = latest(read);
  return {
    spent,
    spanMs,
    perHour,
    reading,
    headroom: reading === null ? null : headroom(reading),
    verdict: spendVerdict(reading),
    unreadable: read.unreadable,
    pruneOwed: truncationOwed(read),
  };
};

/**
 * What one account is spending, bucket by bucket.
 *
 * ONE CONNECTOR METERS SEVERAL POOLS INDEPENDENTLY, and until this slice the
 * record could not say so: every GitHub call was written to one bucket named
 * `api`, so a spent GraphQL pool and a full REST one summed to a number that
 * described neither. Measured 2026-09-01 from the response headers: `core`
 * 4990 of 5000, `graphql` **0** of 5000. A single reading over that pair
 * reports plenty of room while every `gh pr` call is refused.
 *
 * `buckets` is keyed by the connector's OWN word, unvalidated — `core`,
 * `graphql`, and whatever a connector nobody has written an adapter for names
 * next.
 */
export interface AccountSpend {
  /** Every bucket the record holds for this account, by the connector's word. */
  buckets: ReadonlyMap<string, SpendRate>;
  /** The calls every bucket spent inside its own window, summed. */
  spent: number;
  /**
   * The account's implied calls per hour, or null where no bucket has a span.
   *
   * SUMMED ACROSS BUCKETS, because the cadence is about how fast the ACCOUNT
   * is going and an account spends every bucket it has. The verdict is not
   * summed and must not be — see {@link bucketVerdict}.
   */
  perHour: number | null;
  /** Whether any bucket holds enough dead lines to be worth a truncation. */
  pruneOwed: boolean;
}

/**
 * Every bucket one connector-and-account pair has spent, read separately.
 *
 * THE BUCKETS ARE DISCOVERED, NEVER LISTED. A closed set here is the edit that
 * gets forgotten when GitLab arrives — the same rule `LimitReading` states for
 * the bucket name itself. So the record's own lines say which buckets exist,
 * and a bucket nobody has seen appears the first time a call spends it.
 *
 * @param lines - the record's raw lines, in file order.
 * @param connector - the connector's own name.
 * @param account - the account the limit belongs to.
 * @param now - epoch milliseconds.
 * @returns the spend per bucket, and the account's total.
 */
export const accountSpend = (
  lines: readonly string[],
  connector: string,
  account: string,
  now: number,
): AccountSpend => {
  const names = new Set<string>();
  for (const entries of groupByBudget(lines).values()) {
    const first = entries[0];
    if (first !== undefined && first.key.connector === connector && first.key.account === account) {
      names.add(first.key.bucket);
    }
  }
  const buckets = new Map<string, SpendRate>();
  let spent = 0;
  let perHour: number | null = null;
  let pruneOwed = false;
  for (const bucket of names) {
    const rate = spendRate(lines, { connector, account, bucket }, now);
    buckets.set(bucket, rate);
    spent += rate.spent;
    if (rate.perHour !== null) perHour = (perHour ?? 0) + rate.perHour;
    if (rate.pruneOwed) pruneOwed = true;
  }
  return { buckets, spent, perHour, pruneOwed };
};

/**
 * Whether a reader may spend against ONE named bucket of an account.
 *
 * **A SPENT BUCKET DOES NOT STOP THE OTHER, and this is where that holds.** The
 * pools are independent: `gh pr view` spends `graphql` and `gh api repos/…`
 * spends `core`, so a GraphQL exhaustion is no reason to stop asking REST — the
 * board keeps answering from the bucket with 4990 left instead of pausing on
 * the one with 0. A caller asks about the bucket it is about to spend and reads
 * nothing about any other.
 *
 * `unknown` STAYS `unknown`. A bucket the record has never seen, and a bucket
 * whose readings carry no number, both answer `unknown` — not `spendable`, so
 * a caller does not read silence as room, and not `spent`, so a fresh record
 * does not refuse the first call that would have told it anything.
 *
 * @param lines - the record's raw lines, in file order.
 * @param key - the connector, account and bucket to ask about.
 * @param now - epoch milliseconds.
 * @returns `spendable`, `spent`, or `unknown` — never a boolean.
 */
export const bucketVerdict = (
  lines: readonly string[],
  key: BudgetKey,
  now: number,
): 'spendable' | 'spent' | 'unknown' => spendRate(lines, key, now).verdict;
