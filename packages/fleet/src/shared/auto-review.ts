import fs from 'node:fs';
import path from 'node:path';

import {
  REVIEW_START_BUDGET,
  slicePrNext,
  type DefaultBranchReading,
  type SlicePrNextReadings,
  type SlicePrStep,
} from '@plot-pm/domain';
import { defaultBranchFile, prIndexFile, repairRecordFile } from '@plot-pm/domain/adapters';
import { detachedNode } from '@plot-pm/domain/adapters/detached/detached-node';
import {
  liveReviewRuns,
  readReviewStarts,
  startReview,
  type StartReviewOptions,
} from '@plot-pm/domain/adapters/review-start/review-start-node';
import { sprintScopeRef } from '@plot-pm/domain/adapters/sprint-scope-ref';
import type { PrIndexRow } from '@plot-pm/domain/entities/pr-index';
import type { Detached } from '@plot-pm/domain/ports/detached';
import type { Refs } from '@plot-pm/domain/ports/refs';
import type { RepairRecordStore } from '@plot-pm/domain/ports/repair-record';
import { repairRoleOf, type RepairMergeReading } from '@plot-pm/domain/rules/repair-pr';
import { readRepair } from '@plot-pm/domain/workflows/merge';
import type { RunLogLine } from '@plot-pm/domain/ports/run-log';
import { hostOf, refsOf, runLogOf, scriptsOf, type ActOptions } from './action-log.js';
import { commonGitDir } from './agent-log.js';
import { readConfig, type ConfigReadOptions } from './config-reader.js';
import { pidAlive } from './fleet-run.js';

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

/** The most review runs live at once that the slice-PR pass starts toward, the release review's included. */
export const REVIEW_RUN_LIMIT = 1;

/** How long a `pending` `plot/review` counts as in flight: `plot-review`'s own bound of 3600 s. */
export const REVIEW_BOUND_MS = 3_600_000;

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
 * A live run that holds the review lock of the row's head, as `lockHolder`
 * answers, reads as a live run on that head, so the row holds
 * `review-in-flight` whoever started that run.
 *
 * @param rows - the open rows.
 * @param readings - the readings that do not depend on the row.
 * @param start - the paths, ports and bounds, without the mode.
 * @param lockHolder - the pid of a live run holding the review lock of a PR's head, or `null`; no lock by default.
 * @returns one result per row.
 */
export const reviewTick = (
  rows: readonly PrIndexRow[],
  readings: ReviewTickReadings,
  start: Omit<StartReviewOptions, 'mode' | 'now'>,
  lockHolder: (pr: number, head: string) => number | null = () => null,
): ReviewTickResult[] => {
  const results: ReviewTickResult[] = [];
  for (const row of rows) {
    const live = liveReviewRuns(start.repoRoot, start.pidAlive, readings.now);
    const starts = readReviewStarts(start.repoRoot);
    const run = live?.find((e) => e.pr === row.number) ?? null;
    const locked = row.headSha === undefined ? null : lockHolder(row.number, row.headSha);
    const reviewRun =
      run !== null
        ? { head: run.head, pid: run.pid, startedAt: run.startedAt, live: true }
        : locked !== null && row.headSha !== undefined
          ? { head: row.headSha, pid: locked, startedAt: readings.now, live: true }
          : null;
    const step = slicePrNext({
      ...readings,
      row,
      reviewRun,
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

/** Where `plot-review` takes its run lock for one head: `<common git dir>/plot/state/reviews/<pr>-<sha>.lock`. */
export const reviewLockPath = (repoRoot: string, pr: number, head: string): string =>
  path.join(commonGitDir(repoRoot) ?? path.join(repoRoot, '.git'), 'plot', 'state', 'reviews', `${pr}-${head}.lock`);

/**
 * The pid a review run lock names.
 *
 * `plot-review` writes the lock as one line, `<pid>\t<run id>`.
 *
 * @param text - the lock file's text.
 * @returns the pid, or `null` where the text is not such a line.
 */
export const reviewLockPid = (text: string): number | null => {
  const [pid, runId] = text.trim().split('\t');
  const parsed = Number(pid);
  return Number.isInteger(parsed) && parsed > 0 && runId !== undefined && runId !== '' ? parsed : null;
};

/** What the review pass reads and starts through; a test replaces each. */
export interface ReviewPassWorld {
  /** Whether `Auto-review` is on; {@link readAutoReview} by default. */
  readonly autoReview: (opts: ActOptions) => boolean;
  /** Starts `plot-review.mjs`; {@link detachedNode} by default. */
  readonly detached: Detached;
  /** Whether a pid answers. */
  readonly pidAlive: (pid: number) => boolean;
  /** The text of the review run lock of one head, or `null` where none can be read. */
  readonly readLock: (opts: ActOptions, pr: number, head: string) => string | null;
}

/** What one review pass acts on: the open rows and the readings that do not depend on a row. */
export interface ReviewPassReading {
  readonly rows: readonly PrIndexRow[];
  readonly readings: ReviewTickReadings;
}

/**
 * Reads the repair record for the review pass, so the guard admits the fix PR
 * or revert PR the record names.
 *
 * Reads nothing on a default branch that is not settled red, and walks the
 * first-parent line only where the record names an open row. The red commit's
 * runs are not asked: the guard does not read them.
 *
 * @param rows - the open rows.
 * @param defaultBranch - the pass's default-branch reading.
 * @param ports - the repair record's file and the first-parent walk.
 * @returns the reading, or `undefined` where the record names no open row.
 */
export const readRepairReview = async (
  rows: readonly PrIndexRow[],
  defaultBranch: DefaultBranchReading | null,
  ports: { repair: RepairRecordStore; refs: Pick<Refs, 'firstParentLine'> },
): Promise<RepairMergeReading | undefined> => {
  const settled = defaultBranch?.settled;
  if (defaultBranch === null || settled === undefined || settled.state !== 'red') return undefined;
  const read = await ports.repair.read();
  if (!read.ok || read.value === null) return undefined;
  const record = read.value;
  const named = rows.find((row) => repairRoleOf(record, row.number) !== null);
  if (named === undefined) return undefined;
  return readRepair(ports, defaultBranch.branch, settled, named.number);
};

/**
 * Reads what one review pass acts on: the PR index's open rows, the default
 * branch reading, the active sprint's scope on `origin/<default>`, and the
 * repair record through {@link readRepairReview}.
 *
 * @param opts - where the fleet acts.
 * @param now - epoch milliseconds.
 * @returns the reading, or `null` where the host, the index or the open rows give nothing to act on.
 */
export const readReviewPass = async (opts: ActOptions, now: number): Promise<ReviewPassReading | null> => {
  const backend = await hostOf(opts).backend();
  if (!backend.ok) return null;
  const store = await prIndexFile({ cwd: opts.repoRoot }).read(backend.value);
  if (!store.ok || store.value === null) return null;
  const rows = store.value.rows.filter((row) => row.state === 'OPEN');
  if (rows.length === 0) return null;
  const reading = await defaultBranchFile(opts.repoRoot).read();
  const defaultBranch: DefaultBranchReading | null = reading.ok ? reading.value : null;
  const branch = defaultBranch?.branch ?? 'main';
  const scope = await sprintScopeRef(refsOf(opts), scriptsOf(opts), `origin/${branch}`);
  const repairMerge = await readRepairReview(rows, defaultBranch, { repair: repairRecordFile(opts.repoRoot), refs: refsOf(opts) });
  return {
    rows,
    readings: {
      ...(repairMerge === undefined ? {} : { repairMerge }),
      newestMerged: null,
      scope,
      verdict: { read: 'absent' },
      defaultBranch,
      desk: { dead: false, why: 'live' },
      config: { autoReview: true, reviewBoundMs: REVIEW_BOUND_MS, startBudget: REVIEW_START_BUDGET, checksWaitMs: 0 },
      now,
    },
  };
};

/**
 * Logs one start: every start as `moved`, and a refusal as `failed: <why>`
 * once per PR, head and reason for as long as `logged` lives.
 */
const logReviewStart = async (
  opts: ActOptions,
  row: PrIndexRow,
  result: ReviewTickResult,
  logged: Set<string>,
  now: number,
): Promise<void> => {
  const { started, step } = result;
  if (started === undefined || step.step !== 'review') return;
  if (!started.started) {
    const key = `${row.number}:${step.head}:${started.why}`;
    if (logged.has(key)) return;
    logged.add(key);
  }
  const line: RunLogLine = {
    plan: '',
    branch: row.head,
    pr: String(row.number),
    head: step.head,
    step: 'review-start',
    outcome: started.started ? 'moved' : `failed: ${started.why}`,
    at: new Date(now).toISOString(),
  };
  await runLogOf(opts).append(line);
};

/**
 * Runs the review tick on the daemon's loop.
 *
 * With `Auto-review` off it reads nothing and starts nothing. Otherwise it
 * reads the open rows and the scope, and calls {@link reviewTick}, which starts
 * `plot-review.mjs` through the `Detached` port on each `review` step, up to
 * {@link REVIEW_RUN_LIMIT} live runs. A head whose review run lock a live pid
 * holds gets no start. Each start and refusal is written to the run log; a
 * refusal once per PR, head and reason.
 *
 * @param opts - where the fleet acts.
 * @param logged - the refusals already logged, kept by the caller for the daemon's life.
 * @param now - epoch milliseconds.
 * @param world - the ports the pass reads and starts through.
 * @param read - reads the rows and readings; {@link readReviewPass} by default.
 * @returns the tick's results, or `null` where nothing was read to act on.
 */
export const runAutoReviewPass = async (
  opts: ActOptions,
  logged: Set<string>,
  now: number = Date.now(),
  world: ReviewPassWorld = defaultReviewPassWorld,
  read: (opts: ActOptions, now: number) => Promise<ReviewPassReading | null> = readReviewPass,
): Promise<ReviewTickResult[] | null> => {
  if (!world.autoReview(opts)) return null;
  const reading = await read(opts, now);
  if (reading === null) return null;
  const stateDir = path.join(opts.repoRoot, '.plot', 'state');
  fs.mkdirSync(stateDir, { recursive: true });
  const lockHolder = (pr: number, head: string): number | null => {
    const text = world.readLock(opts, pr, head);
    const pid = text === null ? null : reviewLockPid(text);
    return pid !== null && world.pidAlive(pid) ? pid : null;
  };
  const results = reviewTick(
    reading.rows,
    { ...reading.readings, now },
    {
      repoRoot: opts.repoRoot,
      script: path.join(opts.scriptsDir, 'board', 'plot-review.mjs'),
      cwd: opts.repoRoot,
      logFile: path.join(stateDir, 'slice-review.log'),
      detached: world.detached,
      pidAlive: world.pidAlive,
      limit: REVIEW_RUN_LIMIT,
    },
    lockHolder,
  );
  for (const [index, result] of results.entries()) {
    await logReviewStart(opts, reading.rows[index]!, result, logged, now);
  }
  return results;
};

/** Reads a file, or `null` where it cannot be read. */
const readOrNull = (file: string): string | null => {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch {
    return null;
  }
};

/** The ports built from the real adapters. */
const defaultReviewPassWorld: ReviewPassWorld = {
  autoReview: (opts) => readAutoReview(opts).autoReview,
  detached: detachedNode(),
  pidAlive,
  readLock: (opts, pr, head) => readOrNull(reviewLockPath(opts.repoRoot, pr, head)),
};
