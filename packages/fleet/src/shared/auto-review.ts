import {
  REVIEW_START_BUDGET,
  slicePrNext,
  type SlicePrNextReadings,
  type SlicePrStep,
} from '@plot-pm/domain';
import {
  liveReviewRuns,
  readReviewStarts,
  startReview,
  type StartReviewOptions,
} from '@plot-pm/domain/adapters/review-start/review-start-node';
import type { PrIndexRow } from '@plot-pm/domain/entities/pr-index';
import { readConfig, type ConfigReadOptions } from './config-reader.js';

/** The `## Plot Config` key that switches automatic review on. */
export const AUTO_REVIEW_KEY = 'Auto-review';

/** What the `Auto-review` decision reads. */
export interface AutoReviewConfig {
  /** `Auto-review: true`. */
  readonly autoReview: boolean;
}

/**
 * Whether the fleet may start reviews.
 *
 * @param config - the config reading.
 * @returns `true` when `Auto-review` is `true`.
 */
export const autoReview = (config: AutoReviewConfig): boolean => config.autoReview;

/**
 * Reads `Auto-review`. Absent, unreadable or any value but `true` is off.
 *
 * @param opts - the repository and scripts directory to read through.
 * @returns the config reading.
 */
export const readAutoReview = (opts: ConfigReadOptions): AutoReviewConfig => ({
  autoReview: readConfig(opts, AUTO_REVIEW_KEY, '') === 'true',
});

/** The readings one tick hands {@link reviewTick} besides the PR's own. */
export type ReviewTickReadings = Omit<SlicePrNextReadings, 'row' | 'reviewRun' | 'reviewStarts'>;

/** What one tick did for one PR. */
export interface ReviewTickResult {
  readonly pr: number;
  readonly step: SlicePrStep;
  /** Set where the step was `review` and a start was tried. */
  readonly started?: { started: true; pid: number } | { started: false; why: string };
}

/**
 * One tick of the review arm over the open rows.
 *
 * Reads the in-flight and start files fresh for every row, asks
 * {@link slicePrNext}, and starts a review for a `review` step through
 * `startReview`. A second tick over a live in-flight entry answers
 * `review-in-flight` and starts nothing; the start counts survive a restart
 * because they live in `review-starts.json`. Steps other than `review` are
 * returned and not acted on.
 *
 * @param rows - the open rows.
 * @param readings - the readings that do not depend on the row.
 * @param start - the paths, ports and bounds, without the mode.
 * @returns one result per row.
 */
export const reviewTick = (
  rows: readonly PrIndexRow[],
  readings: ReviewTickReadings,
  start: Omit<StartReviewOptions, 'mode' | 'now'>,
): ReviewTickResult[] => {
  const results: ReviewTickResult[] = [];
  for (const row of rows) {
    const live = liveReviewRuns(start.repoRoot, start.pidAlive, readings.now);
    const starts = readReviewStarts(start.repoRoot);
    const run = live?.find((e) => e.pr === row.number) ?? null;
    const step = slicePrNext({
      ...readings,
      row,
      reviewRun: run === null ? null : { head: run.head, pid: run.pid, startedAt: run.startedAt, live: true },
      reviewStarts: starts?.find((s) => s.pr === row.number) ?? null,
      config: { ...readings.config, startBudget: readings.config.startBudget || REVIEW_START_BUDGET },
    });
    if (step.step !== 'review') {
      results.push({ pr: row.number, step });
      continue;
    }
    results.push({
      pr: row.number,
      step,
      started: startReview(row.number, step.head, { ...start, mode: 'review', now: readings.now }),
    });
  }
  return results;
};
