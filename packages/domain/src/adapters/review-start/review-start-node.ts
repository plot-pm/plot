import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import type { Detached } from '../../ports/detached.js';
import { reviewRunLive, type ReviewRunEntry, type ReviewStart } from '../../rules/review-run.js';

/** Where the live review runs are recorded, one entry per PR and head. */
export const reviewInFlightPath = (repoRoot: string): string =>
  join(repoRoot, '.plot', 'state', 'review-in-flight.json');

/** Where the per-head start counts are recorded; a fleetd restart keeps them. */
export const reviewStartsPath = (repoRoot: string): string =>
  join(repoRoot, '.plot', 'state', 'review-starts.json');

/** What {@link startReview} reads and writes through. */
export interface StartReviewOptions {
  readonly repoRoot: string;
  /** Absolute path of `plot-review.mjs`. */
  readonly script: string;
  /** The directory the review runs in. */
  readonly cwd: string;
  /** Where the run's output goes. */
  readonly logFile: string;
  readonly detached: Detached;
  /** Whether a pid answers. */
  readonly pidAlive: (pid: number) => boolean;
  /** The most review runs live at once. */
  readonly limit: number;
  /** `review` runs the agent; `status-only` writes the status from the verdict file. */
  readonly mode: 'review' | 'status-only';
  /** Epoch milliseconds. */
  readonly now: number;
}

/** What {@link startReview} answers. */
export type StartReviewResult =
  | { started: true; pid: number }
  | { started: false; why: 'review-in-flight' | 'at-capacity' | 'start-failed' };

/**
 * Reads a JSON array state file.
 *
 * @returns the entries; `[]` where no file exists; `null` where a file exists and does not hold an array.
 */
const readList = <T>(file: string): T[] | null => {
  let text: string;
  try {
    text = readFileSync(file, 'utf8');
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'ENOENT' ? [] : null;
  }
  try {
    const parsed: unknown = JSON.parse(text);
    return Array.isArray(parsed) ? (parsed as T[]) : null;
  } catch {
    return null;
  }
};

const writeList = (file: string, list: readonly unknown[]): void => {
  mkdirSync(dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.tmp`;
  writeFileSync(temp, `${JSON.stringify(list, null, 2)}\n`, 'utf8');
  renameSync(temp, file);
};

/**
 * The review runs recorded as live.
 *
 * @param repoRoot - the repository the fleet serves.
 * @param pidAlive - whether a pid answers.
 * @param now - epoch milliseconds.
 * @returns the live entries; `null` where the file cannot be read.
 */
export const liveReviewRuns = (
  repoRoot: string,
  pidAlive: (pid: number) => boolean,
  now: number,
): ReviewRunEntry[] | null => {
  const entries = readList<ReviewRunEntry>(reviewInFlightPath(repoRoot));
  return entries === null ? null : entries.filter((e) => reviewRunLive(e, e.pid > 0 && pidAlive(e.pid), now));
};

/**
 * The start record of every head.
 *
 * @param repoRoot - the repository the fleet serves.
 * @returns the records; `[]` where no file exists; `null` where the file cannot be read.
 */
export const readReviewStarts = (repoRoot: string): ReviewStart[] | null =>
  readList<ReviewStart>(reviewStartsPath(repoRoot));

/**
 * Starts `plot-review.mjs <pr>` (or `--status-only`) through the {@link Detached} port.
 *
 * Refuses `review-in-flight` where a live entry names the same PR and head,
 * `at-capacity` where `limit` runs are live, and `start-failed` where a state
 * file cannot be read or the process cannot start. On a start it writes the
 * in-flight entry and raises the head's start count in `review-starts.json`, which keeps one record per PR.
 * Entries that are no longer live are dropped when the file is written.
 *
 * @param pr - the PR number.
 * @param head - the head commit the run reviews.
 * @param opts - the paths, ports and bounds.
 * @returns the pid, or the refusal.
 */
export const startReview = (pr: number, head: string, opts: StartReviewOptions): StartReviewResult => {
  const live = liveReviewRuns(opts.repoRoot, opts.pidAlive, opts.now);
  const starts = readReviewStarts(opts.repoRoot);
  if (live === null || starts === null) return { started: false, why: 'start-failed' };
  if (live.some((e) => e.pr === pr && e.head === head)) return { started: false, why: 'review-in-flight' };
  if (live.length >= opts.limit) return { started: false, why: 'at-capacity' };

  try {
    const args = opts.mode === 'status-only' ? [String(pr), '--status-only'] : [String(pr)];
    const { pid } = opts.detached.node(opts.script, args, opts.cwd, opts.logFile);
    const entry: ReviewRunEntry = { pr, head, pid, startedAt: opts.now, mode: opts.mode };
    writeList(reviewInFlightPath(opts.repoRoot), [...live, entry]);
    const before = starts.find((s) => s.pr === pr && s.head === head);
    const record: ReviewStart = { pr, head, count: (before?.count ?? 0) + 1, lastAt: opts.now };
    writeList(reviewStartsPath(opts.repoRoot), [...starts.filter((s) => s.pr !== pr), record]);
    return { started: true, pid };
  } catch {
    return { started: false, why: 'start-failed' };
  }
};
