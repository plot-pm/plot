import { z } from 'zod';

import { LimitBasisSchema, type LimitBasis, type LimitReading } from './limit.js';

/**
 * Which budget this is — `(connector, account, bucket)`.
 *
 * Three parts, each load-bearing. The connector because every connector meters
 * differently or not at all; the account because a limit is spent by a person
 * and not by a checkout; the bucket because one connector meters several pools
 * independently — GitHub's `core` and `graphql` are 5000 each, and a GraphQL
 * exhaustion says nothing about REST.
 *
 * Every part is a STRING this record does not validate. `Tracker` already names
 * `linear`, a connector Plot has no adapter for, and `ci_backend()` validates
 * nothing at all; `Git host` is the counter-example, a closed enum that dies on
 * an unknown value. A design keyed to four connectors breaks on the fifth, and
 * GitLab and Trello are next.
 *
 * The bucket keeps the connector's OWN word. Normalising it would lose the
 * difference between a GitHub Actions minute quota and the API's 5000/hr, which
 * are the same vendor on different budgets.
 */
export const BudgetKeySchema = z.object({
  connector: z.string(),
  account: z.string(),
  bucket: z.string(),
});
export type BudgetKey = z.infer<typeof BudgetKeySchema>;

/**
 * One line of the record: what a call spent, and what the response said.
 *
 * TWO FACTS TRAVEL TOGETHER AND NEITHER IS USEFUL ALONE. The spend says how
 * fast the account is going; the reading says what is left. A spend without a
 * reading cannot say what remains, and a reading without a spend cannot say how
 * fast it is being consumed — so one line carries both, which is also what
 * keeps the line inside {@link MAX_LINE_BYTES}.
 */
export interface BudgetEntry {
  /** Which budget was spent. */
  key: BudgetKey;
  /** When, epoch milliseconds. A line without a timestamp cannot be windowed. */
  at: number;
  /** How many calls this line accounts for; one per call is the normal case. */
  spent: number;
  /** The ceiling the connector reports, or null where it reports none. */
  limit: number | null;
  /** How many the connector says remain, or null where it does not say. */
  remaining: number | null;
  /** When the connector's window resets, epoch milliseconds; null where unreported. */
  resetAt: number | null;
  /** How the reading was come by — `actual`, `predicted` or `unknown`. */
  basis: LimitBasis;
}

/**
 * The most bytes one appended line may occupy, including its newline.
 *
 * CONCURRENT `O_APPEND` IS ATOMIC ONLY BELOW `PIPE_BUF`, so a line that can
 * exceed it can interleave with another writer's and both are lost. The cap is
 * therefore part of the format rather than a nicety: it is what licenses the
 * lock-free design.
 *
 * 512 IS MEASURED, NOT DOCUMENTED. `getconf PIPE_BUF /` on the macOS machine
 * this fleet runs on (Darwin 25.5.0, arm64) reports **512** — POSIX's
 * guaranteed minimum. Linux reports 4096, and both this record's plan and
 * `DESIGN-budget.md` said "4096 bytes on Linux and macOS" until this slice
 * measured it. A cap set at 4096 would be eight times the atomicity guarantee
 * on the machine it runs on, which is the exact class of bug the cap exists to
 * prevent, arrived at by trusting a constant over a reading.
 *
 * So the cap is the SMALLEST value the fleet's machines report, and a machine
 * reporting less than this would need it lowered again. A record read on Linux
 * and written on macOS shares one file, so the smallest wins rather than the
 * local one.
 */
export const MAX_LINE_BYTES = 512;

/** The field separator — a tab, because no key part or number may contain one. */
const SEP = '\t';

/** The format's version marker, first field of every line. */
const FORMAT = 'b1';

/** How a null number is written, so an absent field is not an empty one. */
const NONE = '-';

/**
 * Writes a number, or the absent marker.
 *
 * ABSENT IS NOT ZERO. A `remaining` of 0 means the bucket is spent and every
 * call is refused; an absent one means the connector did not say. Writing null
 * as `0` would make silence read as exhaustion, and an empty field between two
 * tabs would make it read as either.
 */
const num = (value: number | null): string => (value === null ? NONE : String(value));

/** Reads a field back, treating the absent marker and any nonsense as null. */
const readNum = (field: string): number | null => {
  if (field === NONE) return null;
  const value = Number(field);
  return Number.isFinite(value) ? value : null;
};

/**
 * Strips what the format cannot carry from a key part.
 *
 * A tab would add a field and a newline would add a line, so both are replaced
 * rather than escaped: an escape scheme costs every reader a decoder, and the
 * only inputs are a connector name, an account name and a bucket name — none of
 * which any connector spells with whitespace.
 */
const clean = (value: string): string => value.replace(/[\t\r\n]/g, '_');

/**
 * Encodes one entry as the line that is appended.
 *
 * Tab-separated and single-line, so a reader needs no parser and a partially
 * written line is discardable by shape. The leading {@link FORMAT} marker is
 * what lets a later slice add a field without every existing reader
 * misreading the ones it already has.
 *
 * @param entry - what was spent and what the response said.
 * @returns the line, newline included, ready to append.
 * @throws never — an over-long line is the caller's to refuse via
 *   {@link withinLineCap}, because throwing here would lose a real spend over
 *   a formatting fault.
 */
export const encodeEntry = (entry: BudgetEntry): string =>
  [
    FORMAT,
    clean(entry.key.connector),
    clean(entry.key.account),
    clean(entry.key.bucket),
    String(Math.trunc(entry.at)),
    String(Math.trunc(entry.spent)),
    num(entry.limit),
    num(entry.remaining),
    entry.resetAt === null ? NONE : String(Math.trunc(entry.resetAt)),
    entry.basis,
  ].join(SEP) + '\n';

/**
 * Counts a string's UTF-8 bytes.
 *
 * `TextEncoder` rather than `Buffer`: this module is on the pure side of the
 * package boundary, and the byte count is what the kernel guarantees, not the
 * character count — a UTF-8 account name costs more than its length.
 */
const byteLength = (value: string): number => new TextEncoder().encode(value).length;

/**
 * Whether a line fits the atomic-append guarantee.
 *
 * @param line - the encoded line, newline included.
 * @returns true where the line may be appended concurrently without tearing.
 */
export const withinLineCap = (line: string): boolean =>
  byteLength(line) <= MAX_LINE_BYTES;

/** How many fields a `b1` line carries. */
const FIELDS = 10;

/**
 * Reads one line back, or null where it is not a line this format wrote.
 *
 * A NULL IS THE NORMAL CASE, not an error. The file is appended to
 * concurrently by processes that may be killed mid-write, so a torn tail, a
 * blank line and a line from a format a newer Plot wrote are all things a
 * reader meets — and every one of them must be skipped rather than thrown on.
 * A reader that fails on one bad line reports the whole account's budget as
 * unreadable, which reads as headroom to anything that takes a fallback.
 *
 * @param line - one line of the record, with or without its newline.
 * @returns the entry, or null where the line is unreadable.
 */
export const decodeEntry = (line: string): BudgetEntry | null => {
  const fields = line.replace(/\r?\n$/, '').split(SEP);
  if (fields.length !== FIELDS || fields[0] !== FORMAT) return null;
  const [, connector, account, bucket, at, spent, limit, remaining, resetAt, basis] = fields;
  const parsedBasis = LimitBasisSchema.safeParse(basis);
  const atMs = Number(at);
  const spentCount = Number(spent);
  if (!parsedBasis.success || !Number.isFinite(atMs) || !Number.isFinite(spentCount)) return null;
  return {
    key: { connector, account, bucket },
    at: atMs,
    spent: spentCount,
    limit: readNum(limit),
    remaining: readNum(remaining),
    resetAt: readNum(resetAt),
    basis: parsedBasis.data,
  };
};

/**
 * Builds the entry a call's reading and spend make.
 *
 * @param key - which budget was spent, account included; the reading carries
 *   connector and bucket but never the account, because an adapter's
 *   session-scoped key does not need one and this record does.
 * @param reading - what the connector said about the bucket.
 * @param at - when the call happened, epoch milliseconds.
 * @param spent - how many calls this line accounts for; defaults to one.
 * @returns the entry.
 */
export const entryOf = (
  key: BudgetKey,
  reading: LimitReading,
  at: number,
  spent = 1,
): BudgetEntry => ({
  key,
  at,
  spent,
  limit: reading.limit,
  remaining: reading.remaining,
  resetAt: reading.resetAt,
  basis: reading.basis,
});

/**
 * Whether two keys name the same budget.
 *
 * @param left - one key.
 * @param right - the other.
 * @returns true where all three parts match exactly.
 */
export const sameBudget = (left: BudgetKey, right: BudgetKey): boolean =>
  left.connector === right.connector &&
  left.account === right.account &&
  left.bucket === right.bucket;

/**
 * Renders a key as one string, for grouping and for a map key.
 *
 * @param key - the budget's identity.
 * @returns `connector/account/bucket`, each part cleaned of separators.
 */
export const budgetKeyOf = (key: BudgetKey): string =>
  `${clean(key.connector)}/${clean(key.account)}/${clean(key.bucket)}`;

/**
 * How many calls a reader may still believe it has, or null where it may not.
 *
 * **`unknown` IS NOT HEADROOM, and this function is where that is decided.**
 * The stored value being null is not the defect; a consumer reading absence as
 * permission is. So the answer is `null` — *there is no number here* — for
 * every case a caller might otherwise treat as room:
 *
 * - `basis: 'unknown'` — the connector reports nothing. Not zero, not
 *   unlimited, and not a reason to refuse either: it is a reason to make the
 *   call that will answer it.
 * - `remaining: null` — the connector reports a ceiling but not a spend, so
 *   what is left is unknown even though the limit is known.
 *
 * A `predicted` reading DOES yield headroom where it carries a remaining
 * count, because a prediction is an answer. It normally carries none, which is
 * why this reads `remaining` rather than `basis` for the arithmetic.
 *
 * @param entry - the most recent reading for a budget.
 * @returns how many calls remain, or null where that is not known.
 */
export const headroom = (entry: BudgetEntry): number | null => {
  if (entry.basis === 'unknown') return null;
  return entry.remaining;
};

/**
 * Whether a reader may spend against this budget.
 *
 * THREE-WAY, never a boolean, and for the reason the estate keeps re-learning:
 * `unknown` collapsed into either of the other two is the defect. A caller that
 * needs one decision reads {@link headroom} and decides for itself.
 *
 * - `spendable` — the connector reports calls remaining.
 * - `spent` — it reports zero remaining. Stop until the reset.
 * - `unknown` — nothing is known. The first call on a fresh record is
 *   un-budgeted, and that is the correct cost: one call, once, to learn what
 *   the connector will say.
 *
 * @param entry - the most recent reading for a budget, or null where the record
 *   holds none.
 * @returns the verdict.
 */
export const spendVerdict = (entry: BudgetEntry | null): 'spendable' | 'spent' | 'unknown' => {
  if (entry === null) return 'unknown';
  const left = headroom(entry);
  if (left === null) return 'unknown';
  return left > 0 ? 'spendable' : 'spent';
};
