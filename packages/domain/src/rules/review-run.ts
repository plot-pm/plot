/** One review run fleetd started: `.plot/state/review-in-flight.json` holds one live entry per PR and head. */
export interface ReviewRunEntry {
  readonly pr: number;
  /** The head commit the run reviews. */
  readonly head: string;
  /** The pid of the detached `plot-review.mjs`; `0` where the process did not report one. */
  readonly pid: number;
  /** Epoch milliseconds of the start. */
  readonly startedAt: number;
  /** `review` runs the agent; `status-only` writes the status from the verdict file. */
  readonly mode: 'review' | 'status-only';
}

/** `.plot/state/review-starts.json`: how many starts one head has had, kept across a fleetd restart. */
export interface ReviewStart {
  readonly pr: number;
  readonly head: string;
  /** Starts so far on this head. */
  readonly count: number;
  /** Epoch milliseconds of the newest start. */
  readonly lastAt: number;
}

/** How long a run whose pid is dead still counts as live, so a start is not repeated before the process shows. */
export const REVIEW_START_GRACE_MS = 30_000;

/** The most starts one head gets. */
export const REVIEW_START_BUDGET = 3;

/** The wait after start `n` before start `n + 1`: 15 min after the first, 60 min after the second. */
export const REVIEW_BACKOFF_MS: readonly number[] = [15 * 60_000, 60 * 60_000];

/**
 * Whether a review run is live: its pid answers, or its pid is dead and the
 * run started inside {@link REVIEW_START_GRACE_MS}.
 *
 * @param entry - the in-flight entry.
 * @param pidAlive - whether the entry's pid answers.
 * @param now - epoch milliseconds.
 * @returns `true` while the run counts as live.
 */
export const reviewRunLive = (entry: ReviewRunEntry, pidAlive: boolean, now: number): boolean =>
  pidAlive || now - entry.startedAt < REVIEW_START_GRACE_MS;

/**
 * What the start record allows for one head.
 *
 * A record that names another head, or no record, allows a start. Past
 * `budget` starts the head gets no more; before that, the next start waits
 * the {@link REVIEW_BACKOFF_MS} entry for the count so far.
 *
 * @param record - the head's start record, or `null` where there is none.
 * @param head - the head the start is for.
 * @param budget - the most starts one head gets.
 * @param now - epoch milliseconds.
 * @returns `ok`, or the reason the start waits or stops.
 */
export const reviewStartAllowed = (
  record: Pick<ReviewStart, 'head' | 'count' | 'lastAt'> | null,
  head: string,
  budget: number,
  now: number,
): 'ok' | 'budget-spent' | 'backoff' => {
  if (record === null || record.head !== head || record.count <= 0) return 'ok';
  if (record.count >= budget) return 'budget-spent';
  const wait = REVIEW_BACKOFF_MS[Math.min(record.count, REVIEW_BACKOFF_MS.length) - 1]!;
  return now - record.lastAt < wait ? 'backoff' : 'ok';
};
