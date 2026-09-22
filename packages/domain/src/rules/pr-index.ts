import {
  PR_INDEX_VERSION,
  type PrIndex,
  type PrIndexRow,
} from '../entities/pr-index.js';

/**
 * The newest `updatedAt` among some rows, or null where none carries one.
 *
 * **STRING COMPARISON, AND THAT IS DELIBERATE RATHER THAN LAZY.** ISO-8601 in
 * UTC sorts lexicographically in the same order it sorts chronologically, and
 * parsing to a `Date` would re-render the value the host sent — so a later
 * `updated:>` window would carry this machine's rendering of the host's stamp
 * rather than the stamp. The string the host wrote is the one sent back.
 *
 * A row with no `updatedAt` contributes NOTHING rather than a zero: an adapter
 * that cannot answer the field leaves the store unable to advance, which costs
 * one full read, where a zero would open a window back to 1970 on every refresh.
 *
 * @param rows - the rows to measure.
 * @returns the newest stamp, or null where no row carries one.
 */
export const watermarkOf = (rows: readonly PrIndexRow[]): string | null => {
  let newest: string | null = null;
  for (const row of rows) {
    const at = row.updatedAt;
    if (at === undefined || at === '') continue;
    if (newest === null || at > newest) newest = at;
  }
  return newest;
};

/** What a refresh learned, as the rule takes it. */
export interface PrIndexUpdate {
  /** Which connector answered. */
  connector: string;
  /** The rows the host returned this time. */
  rows: readonly PrIndexRow[];
  /**
   * Whether the answer covered every state the caller asked about.
   *
   * `false` on a partial answer — Bitbucket has no `all` state, so its arm asks
   * once per state and may reach some and not others.
   */
  complete: boolean;
  /** When this machine wrote the store, ISO-8601. */
  at: string;
}

/**
 * Folds one refresh's answer into the store.
 *
 * **A WHOLE ANSWER REPLACES; A PARTIAL ANSWER MERGES.** The distinction is the
 * rule's whole reason for existing. A complete read saw every PR the host has,
 * so a row missing from it is a row that no longer exists and must leave the
 * store — otherwise a deleted PR is immortal. A partial read saw *some* states,
 * so a row missing from it may simply belong to a state that did not answer;
 * replacing on one would delete every PR in the unreached state, which is #912
 * (nine branches reading *commits, no PR ever opened* while two had live ones)
 * reproduced on disk, where the next process inherits it.
 *
 * **KEYED BY NUMBER, NEVER BY HEAD.** A branch carries several PRs over its
 * life — a closed attempt and its reopened successor — and `plot-pr-merged.sh`
 * records what keying by the newest costs: `--limit 1` reported three branches
 * unlanded whose work was on main. `byHead` is re-derived in memory by a rule
 * that ranks an open PR over a closed one; flattening here would destroy the
 * input that rule ranks.
 *
 * **THE WATERMARK COMES FROM THE ROWS, NEVER FROM `at`.** `at` is this
 * machine's clock and answers *when did we write this*; the watermark is the
 * host's and answers *how far have we asked*. A client two seconds fast would
 * otherwise close a window over the PRs updated in that gap permanently.
 *
 * **`complete` LATCHES DOWN AND ONLY A WHOLE ANSWER CLEARS IT.** A partial
 * answer merged into a complete store leaves a store nobody has proven whole,
 * and proving it whole is what licenses *asked, and there is no PR*.
 *
 * @param held - the store as it was read, or null where there was none.
 * @param update - what this refresh learned.
 * @returns the store to write.
 */
export const foldPrIndex = (held: PrIndex | null, update: PrIndexUpdate): PrIndex => {
  const rows = new Map<number, PrIndexRow>();
  // A PARTIAL ANSWER KEEPS WHAT IT DID NOT SEE. A complete one starts empty, so
  // a PR the host no longer lists leaves the store rather than outliving it.
  if (!update.complete && held !== null) {
    for (const row of held.rows) rows.set(row.number, row);
  }
  // The answer's rows overwrite whatever was held for the same number: the host
  // has just spoken about them, and a stale row for a number the host answered
  // is the one row that is certainly wrong.
  for (const row of update.rows) rows.set(row.number, row);
  const merged = Array.from(rows.values()).sort((a, b) => a.number - b.number);
  return {
    v: PR_INDEX_VERSION,
    connector: update.connector,
    watermark: watermarkOf(merged),
    // A WHOLE ANSWER IS THE ONLY THING THAT MAKES A STORE WHOLE, and it does
    // so on its own: it replaced every row, so nothing unverified survives. A
    // partial answer leaves the store partial whatever it merged into — the
    // rows belonging to a state that did not answer are exactly the ones
    // nobody has re-read, and a store previously proven whole says nothing
    // about them now.
    complete: update.complete,
    at: update.at,
    rows: merged,
  };
};

/** What a refresh may ask the host for. */
export interface PrWindow {
  /**
   * The stamp to send as `--since`, or null to ask for everything.
   *
   * The host's own value, passed through byte-for-byte — never re-rendered.
   */
  since: string | null;
  /**
   * Whether the answer this window produces will cover every PR the host has.
   *
   * **THE SAME WORD `foldPrIndex` TAKES, AND THAT IS THE POINT.** A delta
   * answer merges; only a full read replaces, so only a full read can drop a PR
   * the host no longer lists.
   */
  complete: boolean;
}

/**
 * Decides what one refresh asks the host for.
 *
 * **A DELTA IS ASKED FOR ONLY WHERE ALL THREE HOLD:** the store was read, it
 * carries a watermark, and it was proven whole recently enough. Any of the
 * three missing means one full read, which is exactly the behaviour a board
 * with no store has always had.
 *
 * **A PARTIAL STORE MAY NOT BE NARROWED AGAINST.** `complete: false` means some
 * state did not answer, so rows exist that this store has never seen — and a
 * window over `updated:>` would never see them either, because they did not
 * change. Narrowing against a store nobody proved whole is how a gap becomes
 * permanent.
 *
 * **THE FULL-READ CLOCK IS `at`, NOT THE WATERMARK.** `at` is this machine's
 * record of when it last wrote the store and is compared against this machine's
 * own `now` — one clock, so no skew. The watermark is the HOST's and answers a
 * different question entirely; using it here would make a quiet estate, whose
 * newest PR is a month old, do a full read every single refresh.
 *
 * **AN UNREADABLE `at` MEANS A FULL READ.** A stamp that does not parse is not
 * evidence the store is fresh, and the safe direction is the expensive one: a
 * full read costs 30 s, where a delta over a store of unknown age is a window
 * whose start nobody can name.
 *
 * @param held - the store as it was read, or null where there was none.
 * @param now - this machine's clock, in epoch milliseconds.
 * @param fullReadMs - how long a delta may run before a full read is due.
 * @returns what to ask the host for.
 */
export const prWindowFor = (
  held: PrIndex | null, now: number, fullReadMs: number,
): PrWindow => {
  const full: PrWindow = { since: null, complete: true };
  if (held === null) return full;
  if (held.watermark === null || held.watermark === '') return full;
  if (!held.complete) return full;
  const wroteAt = Date.parse(held.at);
  if (Number.isNaN(wroteAt)) return full;
  // A STORE FROM THE FUTURE IS DUE A FULL READ. `now - wroteAt` is negative
  // where a clock moved back or a file travelled between machines, and a
  // negative age would read as freshly written forever. The comparison is on
  // the absolute distance so both directions are bounded by the same rule.
  if (Math.abs(now - wroteAt) >= fullReadMs) return full;
  return { since: held.watermark, complete: false };
};
