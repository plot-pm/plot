/**
 * Whether a slice may start one more agent run.
 *
 * Decided BEFORE each run, never after: the loop counts every run it starts
 * for a slice — the first run, each `checks` resume, each CI correction — and
 * asks this before starting the next one. The count is keyed to the branch
 * and resets on a hop, the way `correctionAttempts` is (#1285); this rule
 * reads neither a file nor an environment variable, only the count and the
 * limit a caller already read.
 */

/** `Slice max runs`'s default when the key is absent. */
export const DEFAULT_SLICE_MAX_RUNS = 12;

/**
 * Whether the next run may start.
 *
 * @param runs - how many runs this slice has already started.
 * @param limit - `Slice max runs`; use {@link DEFAULT_SLICE_MAX_RUNS} where
 *   the key is absent.
 * @returns `true` where the slice is at or past its run limit and the next
 *   run must not start.
 */
export const runLimitRefusal = (runs: number, limit: number): boolean => runs >= limit;
