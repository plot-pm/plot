import fs from 'node:fs';
import path from 'node:path';

import {
  claimStaleMsOf,
  fleetScopeRow,
  repairAdmits,
  REVIEW_START_BUDGET,
  reviewPrNext,
  reviewRunLive,
  type DefaultBranchReading,
  type FixerReading,
  type FleetOwner,
  type ReviewPrNextReadings,
  type SlicePrStep,
} from '@plot-pm/domain';
import { agentsFs, defaultBranchFile, fixerAttemptsFile, prIndexFile, repairRecordFile, treesGit } from '@plot-pm/domain/adapters';
import { detachedNode } from '@plot-pm/domain/adapters/detached/detached-node';
import {
  endReviewRun,
  readReviewRuns,
  readReviewStarts,
  startReview,
  type StartReviewOptions,
} from '@plot-pm/domain/adapters/review-start/review-start-node';
import type { PrIndexRow } from '@plot-pm/domain/entities/pr-index';
import type { Detached } from '@plot-pm/domain/ports/detached';
import type { FixerAttemptsStore } from '@plot-pm/domain/ports/fixer-attempts';
import type { Refs } from '@plot-pm/domain/ports/refs';
import type { RepairRecordStore } from '@plot-pm/domain/ports/repair-record';
import { fixerReadingOf } from '@plot-pm/domain/rules/fixer-attempts';
import { repairRoleOf, type RepairMergeReading } from '@plot-pm/domain/rules/repair-pr';
import { readRepair } from '@plot-pm/domain/workflows/merge';
import type { RunLogLine } from '@plot-pm/domain/ports/run-log';
import { hostOf, refsOf, runLogOf, stateHomeOfOpts, type ActOptions } from './action-log.js';
import { commonGitDir } from './agent-log.js';
import { readHeadOwner, type HeadOwnerPorts } from './auto-fixer.js';
import { readConfigAsync, type ConfigReadOptions } from './config-reader.js';
import { readSwitch } from './fleet-settings-store.js';
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
  autoReview: readSwitch(opts, 'autoReview'),
});

/** The most review runs live at once that the slice-PR pass starts toward, the release review's included. */
export const REVIEW_RUN_LIMIT = 1;

/** How long a `pending` `plot/review` counts as in flight: `plot-review`'s own bound of 3600 s. */
export const REVIEW_BOUND_MS = 3_600_000;

/** The owner reading of one PR, as the review pass hands it to `reviewPrNext`. */
export interface ReviewOwnerReading {
  /** The owner of the head branch, from `fleetOwner`. */
  readonly owner: FleetOwner;
  /** The fixer's attempts record for the PR, read down to the answers the scope rule needs. */
  readonly fixer: FixerReading;
}

/** The readings one pass reads besides each PR's own row and owner. */
export type ReviewPassReadings = Omit<ReviewPrNextReadings, 'row' | 'reviewRun' | 'reviewStarts' | 'owner' | 'fixer'>;

/**
 * The readings one tick hands {@link reviewTick} besides the PR's own row.
 *
 * `owners` holds the owner reading per PR number. A PR with no entry reads its
 * owner as `unread`.
 */
export type ReviewTickReadings = ReviewPassReadings & {
  readonly owners: ReadonlyMap<number, ReviewOwnerReading>;
};

/** What one tick did for one PR. */
export interface ReviewTickResult {
  readonly pr: number;
  readonly step: SlicePrStep;
  /** Set where the step was `review` and a start was tried. */
  readonly started?: { started: true; pid: number } | { started: false; why: string };
  /** The pids of runs past the bound that the tick ended before the start; set where it ended one. */
  readonly ended?: readonly number[];
}

/** A live process that holds the review run lock of one head, and since when. */
export interface ReviewLockHolder {
  /** The pid the lock names. */
  readonly pid: number;
  /** Epoch milliseconds: the lock file's time, or the first pass that saw the lock where its time cannot be read. */
  readonly since: number;
}

/**
 * One tick of the review arm over the open rows.
 *
 * Reads the in-flight and start files fresh for every row, asks
 * `reviewPrNext` with the row's entry in `readings.owners`, and starts a review for a `review` step through
 * `startReview`. A second tick over a live in-flight entry answers
 * `review-in-flight` and starts nothing; the start counts survive a restart
 * because they live in `review-starts.json`. Steps other than `review` are
 * returned and not acted on.
 *
 * A run counts as live through `reviewRunLive` with `start.boundMs`. A live
 * process that holds the review lock of the row's head, as `lockHolder`
 * answers, reads as a live run on that head started at the holder's `since`,
 * so the row holds `review-in-flight` whoever started that run, and only
 * inside the bound.
 *
 * On a `review` step the tick first calls `end` with the pid of each run on
 * the row's PR whose pid answers and that `reviewRunLive` reads as past the
 * bound: an in-flight entry, or the lock holder. Each pid is ended once per tick.
 *
 * @param rows - the open rows.
 * @param readings - the readings that do not depend on the row, and the owner reading per PR.
 * @param start - the paths, ports and bounds, without the mode.
 * @param lockHolder - the live holder of the review lock of a PR's head, or `null`; no lock by default.
 * @param end - ends a run by pid and answers whether it was signalled; ends nothing by default.
 * @returns one result per row.
 */
export const reviewTick = (
  rows: readonly PrIndexRow[],
  readings: ReviewTickReadings,
  start: Omit<StartReviewOptions, 'mode' | 'now'>,
  lockHolder: (pr: number, head: string) => ReviewLockHolder | null = () => null,
  end: (pid: number) => boolean = () => false,
): ReviewTickResult[] => {
  const { owners, ...shared } = readings;
  const now = readings.now;
  const results: ReviewTickResult[] = [];
  for (const row of rows) {
    const runs = readReviewRuns(start.repoRoot, start.pidAlive);
    const starts = readReviewStarts(start.repoRoot);
    const mine = runs?.filter((r) => r.entry.pr === row.number) ?? [];
    const run = mine.find((r) => reviewRunLive(r.entry, r.pidAlive, now, start.boundMs))?.entry ?? null;
    const hung = mine.filter((r) => r.pidAlive && !reviewRunLive(r.entry, true, now, start.boundMs)).map((r) => r.entry.pid);
    const held = row.headSha === undefined ? null : lockHolder(row.number, row.headSha);
    const lockEntry =
      held === null || row.headSha === undefined
        ? null
        : { pr: row.number, head: row.headSha, pid: held.pid, startedAt: held.since, mode: 'review' as const };
    const lockLive = lockEntry !== null && reviewRunLive(lockEntry, true, now, start.boundMs);
    if (lockEntry !== null && !lockLive) hung.push(lockEntry.pid);
    const reviewRun =
      run !== null
        ? { head: run.head, pid: run.pid, startedAt: run.startedAt, live: true }
        : lockLive
          ? { head: lockEntry.head, pid: lockEntry.pid, startedAt: lockEntry.startedAt, live: true }
          : null;
    const owned = owners.get(row.number);
    const step = reviewPrNext({
      ...shared,
      row,
      owner: owned?.owner ?? 'unread',
      ...(owned === undefined ? {} : { fixer: owned.fixer }),
      reviewRun,
      reviewStarts: starts?.find((s) => s.pr === row.number) ?? null,
      config: { ...shared.config, startBudget: shared.config.startBudget || REVIEW_START_BUDGET },
    });
    if (step.step !== 'review') {
      results.push({ pr: row.number, step });
      continue;
    }
    const ended = [...new Set(hung)].filter((pid) => pid > 0 && end(pid));
    results.push({
      pr: row.number,
      step,
      started: startReview(row.number, step.head, { ...start, mode: 'review', now }),
      ...(ended.length === 0 ? {} : { ended }),
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
  /** The epoch milliseconds the review run lock of one head was written, or `null` where its time cannot be read. */
  readonly lockTime: (opts: ActOptions, pr: number, head: string) => number | null;
  /** Ends a review run by pid and answers whether it was signalled; `endReviewRun` by default. */
  readonly endRun: (pid: number) => boolean;
  /** The ports the owner reading and the attempts record are read through; the real adapters by default. */
  readonly owners: (opts: ActOptions) => ReviewOwnerPorts;
}

/** The ports {@link readReviewOwners} reads through. */
export interface ReviewOwnerPorts extends HeadOwnerPorts {
  readonly attempts: Pick<FixerAttemptsStore, 'read'>;
}

/**
 * Reads the owner of each PR's head branch and the fixer's attempts record,
 * before {@link reviewTick} runs.
 *
 * Reads nothing for a PR that `repairAdmits` names, nor for a row that
 * `fleetScopeRow` puts out of scope: such a PR costs no `Refs` call and gets no
 * entry. Every other row gets the owner from `readHeadOwner`, and a fixer
 * reading from `fixerReadingOf` over its attempts record; a failed attempts
 * read gives `{ read: 'unread' }`, which proves no fixer-pushed head.
 *
 * @param rows - the open rows.
 * @param readings - the pass's readings.
 * @param claimStaleMs - `Claim stale after`, in milliseconds; `null` where the key does not parse.
 * @param ports - the worktree listing, the registry, the commit reader and the attempts record.
 * @returns the owner reading per PR number.
 */
export const readReviewOwners = async (
  rows: readonly PrIndexRow[],
  readings: Pick<ReviewPassReadings, 'defaultBranchName' | 'repairMerge' | 'baseRepairMerge' | 'now'>,
  claimStaleMs: number | null,
  ports: ReviewOwnerPorts,
): Promise<Map<number, ReviewOwnerReading>> => {
  const owners = new Map<number, ReviewOwnerReading>();
  for (const row of rows) {
    if (repairAdmits({ row, repairMerge: readings.repairMerge, baseRepairMerge: readings.baseRepairMerge })) continue;
    if (fleetScopeRow(row, readings.defaultBranchName) !== null) continue;
    const { owner } = await readHeadOwner(ports, row, claimStaleMs, readings.now);
    const asked = await ports.attempts.read(row.number);
    owners.set(row.number, { owner, fixer: fixerReadingOf(asked.ok ? asked.value : 'unreadable', row.headSha ?? '') });
  }
  return owners;
};

/** What one review pass acts on: the open rows, the readings that do not depend on a row, and `Claim stale after`. */
export interface ReviewPassReading {
  readonly rows: readonly PrIndexRow[];
  readonly readings: ReviewPassReadings;
  /** `Claim stale after`, in milliseconds; `null` where the key does not parse. */
  readonly claimStaleMs: number | null;
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
 * branch reading, the default branch's name, `Claim stale after`, and the
 * repair record through {@link readRepairReview}. A failed name read leaves
 * `defaultBranchName` absent, so every row the repair record does not name
 * answers `base-unread`.
 *
 * @param opts - where the fleet acts.
 * @param now - epoch milliseconds.
 * @returns the reading, or `null` where the host, the index, the open rows or the state home give nothing to act on.
 */
export const readReviewPass = async (opts: ActOptions, now: number): Promise<ReviewPassReading | null> => {
  const backend = await hostOf(opts).backend();
  if (!backend.ok) return null;
  const store = await prIndexFile({ cwd: opts.repoRoot }).read(backend.value);
  if (!store.ok || store.value === null) return null;
  const rows = store.value.rows.filter((row) => row.state === 'OPEN');
  if (rows.length === 0) return null;
  const home = stateHomeOfOpts(opts);
  if (home === null) return null;
  const reading = await defaultBranchFile(home).read();
  const defaultBranch: DefaultBranchReading | null = reading.ok ? reading.value : null;
  const name = await refsOf(opts).defaultBranch();
  const claimStaleMs = claimStaleMsOf(await readConfigAsync(opts, 'Claim stale after', '24'));
  const repairMerge = await readRepairReview(rows, defaultBranch, { repair: repairRecordFile(home), refs: refsOf(opts) });
  return {
    rows,
    claimStaleMs,
    readings: {
      ...(repairMerge === undefined ? {} : { repairMerge }),
      ...(name.ok ? { defaultBranchName: name.value } : {}),
      newestMerged: null,
      verdict: { read: 'absent' },
      defaultBranch,
      desk: { dead: false, why: 'live' },
      backend: backend.value,
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
 * The review run locks the pass loop has seen whose time could not be read:
 * `<pr>:<head>` to the pid the lock named and the pass that first saw it.
 */
export type ReviewLockSeen = Map<string, { readonly pid: number; readonly at: number }>;

/**
 * The live holder of one head's review run lock, as the pass reads it.
 *
 * A lock whose text names no pid, or whose pid does not answer, has no holder
 * and leaves `seen`. A holder's `since` is the lock's time from
 * `world.lockTime`; where that cannot be read it is the pass that first saw
 * the lock with this pid, which `seen` keeps across passes.
 *
 * @param world - the lock reads and the pid probe.
 * @param opts - where the fleet acts.
 * @param seen - the first-seen times, kept by the caller for the pass loop's life.
 * @param now - epoch milliseconds.
 * @returns the holder lookup for {@link reviewTick}.
 */
export const reviewLockHolder =
  (world: Pick<ReviewPassWorld, 'readLock' | 'lockTime' | 'pidAlive'>, opts: ActOptions, seen: ReviewLockSeen, now: number) =>
  (pr: number, head: string): ReviewLockHolder | null => {
    const key = `${pr}:${head}`;
    const text = world.readLock(opts, pr, head);
    const pid = text === null ? null : reviewLockPid(text);
    if (pid === null || !world.pidAlive(pid)) {
      seen.delete(key);
      return null;
    }
    const at = world.lockTime(opts, pr, head);
    if (at !== null) return { pid, since: at };
    const first = seen.get(key);
    if (first !== undefined && first.pid === pid) return { pid, since: first.at };
    seen.set(key, { pid, at: now });
    return { pid, since: now };
  };

/**
 * The `slice-review.log` line for a run the pass ended.
 *
 * @param pid - the ended run's pid.
 * @param pr - the PR number.
 * @param boundMs - the bound the run passed, in milliseconds.
 * @returns the line, without its newline.
 */
export const reviewEndedLine = (pid: number, pr: number, boundMs: number): string =>
  `plot-review: run ${pid} on PR #${pr} passed the ${Math.round(boundMs / 1000)}s bound; ended`;

/**
 * Runs the review tick on the daemon's loop.
 *
 * With `Auto-review` off it reads nothing and starts nothing. Otherwise it
 * reads the open rows, reads each in-scope row's owner through
 * {@link readReviewOwners}, and calls {@link reviewTick}, which starts
 * `plot-review.mjs` through the `Detached` port on each `review` step, up to
 * {@link REVIEW_RUN_LIMIT} live runs. A head whose review run lock a live pid
 * holds inside {@link REVIEW_BOUND_MS} gets no start. A run past that bound
 * whose pid answers is ended through `world.endRun` before the start, and one
 * line per ended run goes to `slice-review.log`. Each start and refusal is
 * written to the run log; a refusal once per PR, head and reason.
 *
 * @param opts - where the fleet acts.
 * @param logged - the refusals already logged, kept by the caller for the daemon's life.
 * @param now - epoch milliseconds.
 * @param world - the ports the pass reads and starts through.
 * @param read - reads the rows and readings; {@link readReviewPass} by default.
 * @param lockSeen - the first-seen times of locks whose time cannot be read, kept by the caller for the pass loop's life.
 * @returns the tick's results, or `null` where nothing was read to act on.
 */
export const runAutoReviewPass = async (
  opts: ActOptions,
  logged: Set<string>,
  now: number = Date.now(),
  world: ReviewPassWorld = defaultReviewPassWorld,
  read: (opts: ActOptions, now: number) => Promise<ReviewPassReading | null> = readReviewPass,
  lockSeen: ReviewLockSeen = new Map(),
): Promise<ReviewTickResult[] | null> => {
  if (!world.autoReview(opts)) return null;
  const reading = await read(opts, now);
  if (reading === null) return null;
  const owners = await readReviewOwners(reading.rows, { ...reading.readings, now }, reading.claimStaleMs, world.owners(opts));
  const stateDir = path.join(opts.repoRoot, '.plot', 'state');
  fs.mkdirSync(stateDir, { recursive: true });
  const logFile = path.join(stateDir, 'slice-review.log');
  const results = reviewTick(
    reading.rows,
    { ...reading.readings, now, owners },
    {
      repoRoot: opts.repoRoot,
      script: path.join(opts.scriptsDir, 'board', 'plot-review.mjs'),
      cwd: opts.repoRoot,
      logFile,
      detached: world.detached,
      pidAlive: world.pidAlive,
      limit: REVIEW_RUN_LIMIT,
      boundMs: REVIEW_BOUND_MS,
    },
    reviewLockHolder(world, opts, lockSeen, now),
    world.endRun,
  );
  for (const result of results) {
    for (const pid of result.ended ?? []) fs.appendFileSync(logFile, `${reviewEndedLine(pid, result.pr, REVIEW_BOUND_MS)}\n`);
  }
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

/** The time a file was last written, or `null` where it cannot be read; `plot-review` writes its lock once. */
const writtenAtOrNull = (file: string): number | null => {
  try {
    return fs.statSync(file).mtimeMs;
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
  lockTime: (opts, pr, head) => writtenAtOrNull(reviewLockPath(opts.repoRoot, pr, head)),
  endRun: (pid) => endReviewRun(pid),
  owners: (opts) => ({
    trees: treesGit({ repoRoot: opts.repoRoot, scriptDir: opts.scriptsDir }),
    agents: agentsFs({ repoRoot: opts.repoRoot, scriptDir: opts.scriptsDir }),
    refs: refsOf(opts),
    attempts: fixerAttemptsFile(opts.repoRoot),
  }),
};
