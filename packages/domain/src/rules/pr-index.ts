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

/**
 * What kind of answer one refresh received.
 *
 * **THREE WORDS RATHER THAN TWO BOOLEANS.** `complete: boolean` on the update
 * carried two facts at once — *the call asked about the whole history* and
 * *every state answered* — and a healthy delta is the case where they disagree:
 * it asked about a window, and every state answered. Folding it as not-complete
 * marked the store partial, and the next refresh then refused to narrow, so the
 * board made its 43 s full listing on every second refresh (measured
 * 2026-10-01).
 *
 * A second boolean beside `complete` would express the same three states and one
 * more that nobody defined. Three words cannot.
 *
 * - `whole` — a full read, every state answered. It REPLACES the store, so a PR
 *   the host no longer lists leaves it. The only answer that sees a deletion.
 * - `delta` — a window over a whole store, every state answered. It MERGES, and
 *   leaves a whole store whole: a PR that has not changed since the watermark is
 *   still as stored.
 * - `partial` — a state did not answer. It MERGES and leaves the store partial
 *   whatever it merged into, because the rows belonging to the unreached state
 *   are exactly the ones nobody re-read.
 *
 * **VENDOR WORDS STAY OUT.** `partial` is the shape Bitbucket's per-state arm
 * can take, and the domain names the shape rather than the host.
 */
export type PrAnswerKind = 'whole' | 'delta' | 'partial';

/** What a refresh learned, as the rule takes it. */
export interface PrIndexUpdate {
  /** Which connector answered. */
  connector: string;
  /** The rows the host returned this time. */
  rows: readonly PrIndexRow[];
  /** What kind of answer this was — see {@link PrAnswerKind}. */
  kind: PrAnswerKind;
  /** When this machine wrote the store, ISO-8601. */
  at: string;
}

/**
 * The kind of answer a window and a partial sentence amount to.
 *
 * **THE DOMAIN DECIDES THE KIND, NOT THE CONTROLLER.** `refreshPrs` held this
 * as the expression `window.complete && partialSaid === null`, which could not
 * express a healthy delta as anything but not-whole — the defect. The rule
 * lives here so the three kinds are unit-testable without a fixture host.
 *
 * **A PARTIAL SENTENCE OUTRANKS THE WINDOW.** A state that did not answer means
 * rows exist the store has never seen, and that is true of a full read and of a
 * window alike. So a partial full read is `partial` and not `whole`.
 *
 * @param window - what this refresh asked the host for.
 * @param partialSaid - the sentence naming the states that did not answer, or
 *   null where every state answered.
 * @returns the kind {@link foldPrIndex} should be handed.
 */
export const answerKind = (
  window: PrWindow, partialSaid: string | null,
): PrAnswerKind => {
  if (partialSaid !== null) return 'partial';
  return window.kind;
};

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
 * **`partial` LATCHES `complete` DOWN AND ONLY `whole` CLEARS IT.** A partial
 * answer merged into a complete store leaves a store nobody has proven whole,
 * and proving it whole is what licenses *asked, and there is no PR*.
 *
 * **A `delta` LEAVES WHOLENESS EXACTLY AS IT FOUND IT, AND THAT IS THIS
 * SLICE.** A window over a whole store answers about every PR that changed, so
 * every PR it did not mention is still as stored and the store is still whole.
 * Writing `complete: false` there is what made the next refresh refuse to
 * narrow, so the board asked for the whole history every second refresh. A
 * delta over a PARTIAL store stays partial: a window cannot see the rows the
 * unreached state holds, because they did not change.
 *
 * **WHOLENESS IS INHERITED, NEVER MANUFACTURED.** Only `whole` writes `true`.
 * A `delta` takes the held store's flag, so a delta over a store that was never
 * proven whole — or over no store at all — leaves one that still is not. The
 * fold can preserve wholeness or clear it and can never invent it.
 *
 * **`wholeAt` IS ADVANCED BY `whole` ALONE AND CARRIED OTHERWISE.** It is the
 * full read's clock: `at` moves on every fold, so measuring the daily full read
 * against `at` would stop it ever falling due on a healthy board.
 *
 * @param held - the store as it was read, or null where there was none.
 * @param update - what this refresh learned.
 * @returns the store to write.
 */
export const foldPrIndex = (held: PrIndex | null, update: PrIndexUpdate): PrIndex => {
  const whole = update.kind === 'whole';
  const rows = new Map<number, PrIndexRow>();
  // A `delta` AND A `partial` KEEP WHAT THEY DID NOT SEE. A `whole` answer
  // starts empty, so a PR the host no longer lists leaves the store rather than
  // outliving it — the one answer that can see a deletion.
  if (!whole && held !== null) {
    for (const row of held.rows) rows.set(row.number, row);
  }
  // The answer's rows overwrite whatever was held for the same number: the host
  // has just spoken about them, and a stale row for a number the host answered
  // is the one row that is certainly wrong.
  //
  // EXCEPT THE FOUR VERDICTS OF A TERMINAL ROW, which the full read no longer
  // asks for — see `withHeldVerdicts`. A held value is used only where the
  // incoming row carries none, so every field the host DID answer still wins.
  const heldByNumber = new Map<number, PrIndexRow>();
  if (held !== null) {
    for (const row of held.rows) heldByNumber.set(row.number, row);
  }
  for (const row of update.rows) {
    rows.set(row.number, withHeldVerdicts(row, heldByNumber.get(row.number)));
  }
  const merged = Array.from(rows.values()).sort((a, b) => a.number - b.number);
  const index: PrIndex = {
    v: PR_INDEX_VERSION,
    connector: update.connector,
    watermark: watermarkOf(merged),
    complete: wholenessAfter(held, update.kind),
    at: update.at,
    rows: merged,
  };
  // A `whole` fold stamps the full read's clock; every other kind carries the
  // one it found, and a store that never held one still holds none. Assigned
  // conditionally rather than as `undefined`, so `encodePrIndex` omits the key
  // on a store with no full read on record instead of writing it absent.
  const wholeAt = whole ? update.at : held?.wholeAt;
  if (wholeAt !== undefined) index.wholeAt = wholeAt;
  return index;
};

/** The verdict fields, and the value each carries where it was not asked. */
const ABSENT_VERDICTS = {
  checks: 'unknown',
  mergeable: 'unknown',
  review: '',
} as const;

/**
 * One incoming row, with any verdict it did not answer taken from the store.
 *
 * **THE FOUR VERDICTS ARE ABOUT A PR'S HEAD**, and a `MERGED` or `CLOSED` head
 * is finished: no check will run against it, no review will change, and nothing
 * will make it stop merging cleanly. So the full read stopped asking for them —
 * measured 2026-10-01 on this repository, `--rich --state all --limit 1000` took
 * 43.0 s against 7.3 s without the rich fields, and all 1000 rows were terminal
 * (964 `MERGED`, 36 `CLOSED`, 0 `OPEN`). The adapter now asks the rich fields of
 * open PRs only, so a terminal row arrives carrying the absent values.
 *
 * **ONLY THE FOLD CAN DO THIS.** The adapter holds no store, so it cannot tell a
 * verdict it never asked for from one the board already has; the domain reaches
 * no host, so it cannot make the cheaper call. Each half is useless alone, and
 * the adapter half alone would erase every held verdict on the next whole fold.
 *
 * **AN `OPEN` ROW NEVER TAKES A HELD VERDICT.** The open call is the rich one, so
 * a plain `OPEN` row means the two calls disagreed about the same PR. A held
 * `green` carried onto it would show a passing check on a head that has since
 * moved — the one direction in which a stale verdict actively misleads.
 *
 * **ABSENT IS NOT FALSE.** A terminal row with nothing held keeps `unknown`,
 * which means *not asked* rather than *no checks*. Every reader already renders
 * it as unavailable: `prStates` answers `['closed']` for a `CLOSED` row before
 * reading `checks` at all, and a `MERGED` row with `mergeable: 'unknown'`
 * answers `['unknown']`.
 *
 * **EACH FIELD INDEPENDENTLY**, the rule `storeRow` states: *"a row the host
 * answered partially round-trips as partially answered."* A row answering
 * `checks` and not `mergeable` keeps its own `checks` and the held `mergeable`.
 *
 * `failing_checks` is read as absent when it is missing OR empty: the rich arm
 * emits `[]` for a row with no failures, so an empty array cannot be told from
 * one nobody asked about. Taking the held list there costs nothing a reader can
 * see — a terminal row's `checks` is held from the same store in the same pass,
 * so the list and the word it explains stay from one reading.
 *
 * @param row - the row as the answer carried it.
 * @param heldRow - the stored row with the same number, or undefined where none.
 * @returns the row to store, with absent verdicts filled from the held row.
 */
const withHeldVerdicts = (
  row: PrIndexRow,
  heldRow: PrIndexRow | undefined,
): PrIndexRow => {
  // A row the store has never seen, and an OPEN row, each keep exactly what the
  // answer said. `state` is the adapter's word passed through, so an unknown
  // word is not terminal either — this takes the two states that ARE.
  if (heldRow === undefined) return row;
  if (row.state !== 'MERGED' && row.state !== 'CLOSED') return row;
  const filled: PrIndexRow = { ...row };
  if (row.checks === ABSENT_VERDICTS.checks) filled.checks = heldRow.checks;
  if (row.review === ABSENT_VERDICTS.review) filled.review = heldRow.review;
  // Absent on this field means the word OR the key missing, because an adapter
  // predating it omits the key and the plain arm answers the word.
  if (row.mergeable === undefined || row.mergeable === ABSENT_VERDICTS.mergeable) {
    if (heldRow.mergeable !== undefined) filled.mergeable = heldRow.mergeable;
  }
  if (row.failing_checks === undefined || row.failing_checks.length === 0) {
    if (heldRow.failing_checks !== undefined) filled.failing_checks = heldRow.failing_checks;
  }
  return filled;
};

/**
 * Whether the store holds every PR up to its watermark, after one fold.
 *
 * `whole` proves it, `partial` disproves it, and `delta` answers neither — so it
 * inherits, which for a cold or never-proven store is `false`.
 *
 * @param held - the store as it was read, or null where there was none.
 * @param kind - the kind of answer being folded in.
 * @returns the `complete` flag to write.
 */
const wholenessAfter = (held: PrIndex | null, kind: PrAnswerKind): boolean => {
  if (kind === 'whole') return true;
  if (kind === 'partial') return false;
  return held?.complete ?? false;
};

/**
 * The numbers of the open PRs a delta must ask about again.
 *
 * **`pending` IS THE ONE NON-TERMINAL ANSWER.** `green`, `failing`, `none` and
 * `unknown` are all answers the host already gave; `--since` asks about them
 * again the moment `updatedAt` moves, exactly as it does today. `pending`
 * means *the host had not finished computing it*, so nothing but asking again
 * ever replaces it — `updatedAt` does not move when a check run completes
 * (#1277).
 *
 * **ONLY `OPEN`.** A `MERGED` or `CLOSED` row is terminal — *A Decision Reads
 * The Index* states "a `MERGED` row cannot revert" — so re-asking one spends a
 * question on a head nobody can act on. A stored `pending` on a merged or
 * closed row is left exactly as held.
 *
 * @param held - the store as it was read, or null where there was none.
 * @returns the numbers of the `OPEN` rows whose stored `checks` is `pending`.
 */
export const pendingOpenPrNumbers = (held: PrIndex | null): readonly number[] => {
  if (held === null) return [];
  return held.rows
    .filter((row) => row.state === 'OPEN' && row.checks === 'pending')
    .map((row) => row.number);
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
   * What kind of answer this window produces where every state answers.
   *
   * **`whole` OR `delta`, NEVER `partial`.** A window cannot predict a state
   * failing to answer; that is the host's to say, and {@link answerKind} folds
   * the sentence in. So this says *was this a full read* and nothing more.
   */
  kind: Exclude<PrAnswerKind, 'partial'>;
}

/**
 * What this process has observed about a full read that failed, as a reading.
 *
 * **IN MEMORY ON THE CALLER, NEVER IN THE STORE.** It is this process's
 * observation of this host at this moment. A store field would be inherited by
 * a process that never saw the failure, which would stand the daily full read
 * down on evidence it does not hold.
 *
 * **A READING, BECAUSE THE DOMAIN TAKES READINGS AS VALUES.** The rule imports
 * no port and awaits nothing; the caller decides what to read.
 */
export interface PrFullReadFailure {
  /** When this process last saw a full read fail, epoch milliseconds. */
  at: number;
}

/**
 * Decides what one refresh asks the host for.
 *
 * **A DELTA IS ASKED FOR ONLY WHERE ALL THREE HOLD:** the store was read, it
 * carries a watermark, and it was proven whole. Any of the three missing means
 * one full read, which is exactly the behaviour a board with no store has
 * always had.
 *
 * **A PARTIAL STORE MAY NOT BE NARROWED AGAINST.** `complete: false` means some
 * state did not answer, so rows exist that this store has never seen — and a
 * window over `updated:>` would never see them either, because they did not
 * change. Narrowing against a store nobody proved whole is how a gap becomes
 * permanent.
 *
 * **THE FULL-READ CLOCK IS `wholeAt`, AND `at` CANNOT BE IT.** `at` moves on
 * every fold, delta included, so once a delta keeps a store whole a healthy
 * board's `at` is never more than one refresh old — and the daily full read, the
 * only answer that sees a DELETED PR, would never fall due again. `wholeAt`
 * moves only on a full read. Both are this machine's own clock, compared
 * against this machine's own `now`, so neither introduces skew; the watermark is
 * the HOST's and answers a different question entirely.
 *
 * **A STORE WITH NO `wholeAt` IS DUE.** No full read is on record, so there is
 * no evidence of one, and the safe direction is the expensive one.
 *
 * **AN UNREADABLE `wholeAt` MEANS A FULL READ.** A stamp that does not parse is
 * not evidence the store is fresh.
 *
 * **A FULL READ THAT JUST FAILED FALLS BACK TO A DELTA.** A server-side timeout
 * is no rate limit, so the board is told nothing to wait for and the next
 * refresh follows in 60 s with the full read still due — the heaviest query,
 * every minute. Where the store is whole, carries a watermark and the full read
 * is due ONLY BY AGE, a full read that failed inside `failureGraceMs` answers a
 * delta instead. The grace expires, so the full read is asked again: a fallback
 * with no expiry would never see a deleted PR again.
 *
 * **THE FALLBACK NEVER REACHES A STORE WITH NOTHING TO NARROW AGAINST.** A cold
 * store, a partial store and a store with no watermark each have no delta to
 * fall back to, so they keep their cadence whatever failed.
 *
 * @param held - the store as it was read, or null where there was none.
 * @param now - this machine's clock, in epoch milliseconds.
 * @param fullReadMs - how long a delta may run before a full read is due.
 * @param failed - what this process saw of a failed full read, or null.
 * @param failureGraceMs - how long a failed full read stands the next one down.
 * @returns what to ask the host for.
 */
export const prWindowFor = (
  held: PrIndex | null,
  now: number,
  fullReadMs: number,
  failed: PrFullReadFailure | null = null,
  failureGraceMs = 0,
): PrWindow => {
  const full: PrWindow = { since: null, kind: 'whole' };
  if (held === null) return full;
  if (held.watermark === null || held.watermark === '') return full;
  if (!held.complete) return full;
  // THE FULL READ'S OWN CLOCK. A store carrying none has no full read on
  // record, which is not evidence that one happened.
  if (held.wholeAt === undefined || held.wholeAt === '') return full;
  const readAt = Date.parse(held.wholeAt);
  if (Number.isNaN(readAt)) return full;
  // A STORE FROM THE FUTURE IS DUE A FULL READ. `now - readAt` is negative
  // where a clock moved back or a file travelled between machines, and a
  // negative age would read as freshly read forever. The comparison is on the
  // absolute distance so both directions are bounded by the same rule.
  if (Math.abs(now - readAt) >= fullReadMs) {
    // DUE BY AGE, AND ONLY BY AGE — every refusal above has already returned,
    // so reaching here means the store is whole and watermarked and has a
    // delta to fall back to. A full read that failed inside the grace answers
    // one rather than repeating the query that just ran too long.
    if (failed === null) return full;
    if (Math.abs(now - failed.at) >= failureGraceMs) return full;
    return { since: held.watermark, kind: 'delta' };
  }
  return { since: held.watermark, kind: 'delta' };
};
