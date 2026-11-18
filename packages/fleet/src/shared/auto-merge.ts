import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  checkNamesOf,
  checksWaitMsOf,
  mergeIdentity,
  nextMerge,
  slicePrNext,
  type DefaultBranchReading,
  type MergePorts,
  type MergeResult,
  type MergerAppReading,
  type SlicePrNextReadings,
  type SlicePrStep,
} from '@plot-pm/domain';
import {
  baseBranchFile,
  baseRepairFile,
  buildShell,
  defaultBranchFile,
  mergerAppHeld,
  prIndexFile,
  repairRecordFile,
  type MergerAppReader,
} from '@plot-pm/domain/adapters';
import { hostForReads } from '@plot-pm/domain/adapters/host/process-host-reads';
import { refsRemoteGit } from '@plot-pm/domain/adapters/refs/refs-remote-git';
import { sprintScopeRef } from '@plot-pm/domain/adapters/sprint-scope-ref';
import { liveReviewRuns } from '@plot-pm/domain/adapters/review-start/review-start-node';
import { baseBranchRed } from '@plot-pm/domain/rules/default-branch';
import { shippedPathsOf } from '@plot-pm/domain/rules/bundle-commit';
import { DEFAULT_RELEASE_DIR, syncPathSet } from '@plot-pm/domain/rules/state-sync';
import { readUnsettled } from '@plot-pm/domain/workflows/unsettled-line';
import type { PrIndexRow } from '@plot-pm/domain/entities/pr-index';
import type { RunLogLine } from '@plot-pm/domain/ports/run-log';
import type { RepairMergeReading } from '@plot-pm/domain/rules/repair-pr';
import { readRepair, mergeAt } from '@plot-pm/domain/workflows/merge';
import { refsOf, runLogOf, scriptsOf, type ActOptions } from './action-log.js';
import { readAutoReview } from './auto-review.js';
import { readConfig } from './config-reader.js';
import { pidAlive } from './fleet-run.js';

/** The `## Plot Config` key that names the GitHub App a merge runs as. */
export const MERGER_APP_KEY = 'Merger app';

/** What one merge tick did. */
export interface MergeTickResult {
  /** Each open row's step, in row order. */
  readonly steps: readonly { pr: number; step: SlicePrStep }[];
  /** Set where a merge was tried. */
  readonly merged?: { pr: number; head: string; result: MergeResult };
}

/** The (PR, head) pairs whose merge the host refused, for the daemon's life. */
export type MergeRefusals = Map<number, string>;

/** One PR's conversation hold: the head commit it was refused at and the time its record covers. */
export interface ConversationHold {
  readonly head: string;
  /** The later of the refusal's `conversationAt` and the row's `updatedAt`, as an ISO time. */
  readonly at: string;
}

/**
 * The PRs refused `human-comment-open` or `human-comment-unread`, for the daemon's life.
 * A PR is skipped while its head and `updatedAt` are unchanged against the hold.
 */
export type ConversationHolds = Map<number, ConversationHold>;

/** Whether a hold still covers a row: same head commit, and the row's `updatedAt` is not newer than the hold. */
const holds = (hold: ConversationHold | undefined, head: string, row: PrIndexRow): boolean => {
  if (hold === undefined || hold.head !== head) return false;
  const held = Date.parse(hold.at);
  const updated = row.updatedAt === undefined ? Number.NaN : Date.parse(row.updatedAt);
  return !Number.isNaN(held) && !Number.isNaN(updated) && updated <= held;
};

/** The later of two ISO times; the one that parses where only one does, and the row's where neither does. */
const laterOf = (a: string | undefined, b: string | undefined): string => {
  const pa = a === undefined ? Number.NaN : Date.parse(a);
  const pb = b === undefined ? Number.NaN : Date.parse(b);
  if (Number.isNaN(pa)) return Number.isNaN(pb) ? '' : new Date(pb).toISOString();
  return Number.isNaN(pb) || pa >= pb ? new Date(pa).toISOString() : new Date(pb).toISOString();
};

/**
 * Appends one `merge` record for the one PR a tick tried, naming the identity
 * it merged as (`merged as app` / `merged as host`) or the refusal
 * (`failed: <reason>`).
 *
 * @param opts - where the fleet acts.
 * @param pr - the PR number the tick tried.
 * @param branch - the row's head branch name.
 * @param head - the commit the merge was pinned to.
 * @param result - `mergeAt`'s outcome.
 * @param identity - the identity {@link mergeIdentity} named for this tick.
 * @param now - epoch milliseconds.
 */
const logMergeAttempt = async (
  opts: ActOptions,
  pr: number,
  branch: string,
  head: string,
  result: MergeResult,
  identity: 'app' | 'host',
  now: number,
): Promise<void> => {
  const outcome = result.merged ? `merged as ${identity}` : `failed: ${result.reason}`;
  const line: RunLogLine = {
    plan: '',
    branch,
    pr: String(pr),
    head,
    step: 'merge',
    outcome,
    at: new Date(now).toISOString(),
  };
  await runLogOf(opts).append(line);
};

/**
 * Appends one `merge-hold` record the first time a (PR, head, reason)
 * combination holds — the same dedup shape `auto-review.ts`'s
 * `logReviewStart` uses for `review-start`.
 *
 * @param opts - where the fleet acts.
 * @param row - the row that held.
 * @param reason - the hold reason `slicePrNext` answered.
 * @param logged - the hold keys already recorded, for the daemon's life.
 * @param now - epoch milliseconds.
 */
const logMergeHold = async (
  opts: ActOptions,
  row: PrIndexRow,
  reason: string,
  logged: Set<string>,
  now: number,
): Promise<void> => {
  const key = `${row.number}:${row.head}:${reason}`;
  if (logged.has(key)) return;
  logged.add(key);
  const line: RunLogLine = {
    plan: '',
    branch: row.head,
    pr: String(row.number),
    head: row.head,
    step: 'merge-hold',
    outcome: reason,
    at: new Date(now).toISOString(),
  };
  await runLogOf(opts).append(line);
};

/**
 * Reads the repair record's merge reading once for a tick.
 *
 * Reads nothing on a default branch that is not settled red, and nothing where
 * the record names no open row. The re-ask of the red commit's runs happens
 * here once, never once per row: the reading holds for every row.
 *
 * @param rows - the open rows.
 * @param defaultBranch - the tick's default-branch reading.
 * @param ports - the merge controller's ports.
 * @returns the reading, or `undefined` where the exception has nothing to read.
 */
const repairReading = async (
  rows: readonly PrIndexRow[],
  defaultBranch: DefaultBranchReading | null,
  ports: MergePorts,
): Promise<RepairMergeReading | undefined> => {
  const settled = defaultBranch?.settled;
  if (defaultBranch === null || settled === undefined || settled.state !== 'red' || ports.repair === undefined) return undefined;
  const record = await ports.repair.read();
  if (!record.ok || record.value === null) return undefined;
  const { repairPr, revertPr } = record.value;
  const named = rows.find((r) => r.number === repairPr || r.number === revertPr);
  if (named === undefined) return undefined;
  return readRepair(ports, defaultBranch.branch, settled, named.number);
};

/**
 * Reads the repair record's merge reading of each red sprint base, once for a tick.
 *
 * Reads a base's record only where its reading is red and fresh
 * ({@link baseBranchRed}), and re-asks the red commit's runs only where the
 * record names an open row into that base, once per base.
 *
 * @param rows - the open rows.
 * @param baseReadings - the tick's reading of each non-default base, by name.
 * @param ports - the merge controller's ports.
 * @param now - epoch milliseconds of the tick.
 * @returns the reading of each base the exception has something to read for.
 */
const baseRepairReadings = async (
  rows: readonly PrIndexRow[],
  baseReadings: ReadonlyMap<string, DefaultBranchReading | null> | undefined,
  ports: MergePorts,
  now: number,
): Promise<ReadonlyMap<string, RepairMergeReading>> => {
  const out = new Map<string, RepairMergeReading>();
  if (ports.baseRepair === undefined || baseReadings === undefined) return out;
  for (const [base, reading] of baseReadings) {
    const settled = reading?.settled;
    if (reading === null || settled === undefined || !baseBranchRed(base, reading, now, ports.checksWaitMs)) continue;
    const record = await ports.baseRepair(base).read();
    if (!record.ok || record.value === null || record.value.repairPr === undefined) continue;
    const named = rows.find((r) => r.number === record.value?.repairPr && r.base === base);
    if (named === undefined) continue;
    out.set(base, await readRepair({ ...ports, repair: ports.baseRepair(base) }, reading.branch, settled, named.number, 'base'));
  }
  return out;
};

/**
 * One tick of the merge arm over the open rows.
 *
 * Asks {@link slicePrNext} for every row, drops a row whose (PR, head) the
 * host refused earlier, and lets {@link nextMerge} pick the lowest PR number.
 * Calls `mergeAt` for that one PR only; the rest wait for the next pass. The
 * controller refuses what the tick cannot see (`head-moved`, red checks, a
 * moved tip), and a refusal is not retried here. A `host-refused` outcome is
 * recorded in `refused`, and that PR at that head is not tried again.
 *
 * @param rows - the open rows.
 * @param readings - the readings that do not depend on the row.
 * @param ports - the merge controller's ports.
 * @param refused - the host-refused (PR, head) pairs; the caller keeps it across passes.
 * @param conversationHolds - the PRs refused `human-comment-open` or
 *   `human-comment-unread`; the caller keeps it across passes. A held PR is
 *   skipped, and the next candidate asked in the same pass, until its head
 *   differs or its row's `updatedAt` is newer than the hold. Absent, nothing is skipped.
 * @param pidAlive - whether a review run's pid is alive.
 * @param opts - where the fleet acts; `undefined` logs nothing (unit tests that pass no `ActOptions`).
 * @param logged - the merge-hold keys already recorded, for the daemon's life.
 * @param recheck - reads the `Merger app` key again immediately before a merge
 *   as the App; a reading that no longer merges as the App starts no merge.
 *   Absent, the merge goes on the reading in `readings`.
 * @returns every row's step and the merge attempt, if any.
 */
export const mergeTick = async (
  rows: readonly PrIndexRow[],
  readings: Omit<SlicePrNextReadings, 'row' | 'reviewRun' | 'reviewStarts' | 'baseReading' | 'baseRepairMerge'> & {
    /** The reading kept for each non-default base among the rows, keyed by base name. */
    baseReadings?: ReadonlyMap<string, DefaultBranchReading | null>;
  },
  ports: MergePorts,
  refused: MergeRefusals,
  repoRoot: string,
  pidAlive: (pid: number) => boolean,
  opts?: ActOptions,
  logged: Set<string> = new Set(),
  recheck?: () => MergerAppReading,
  conversationHolds?: ConversationHolds,
): Promise<MergeTickResult> => {
  const repairMerge = readings.repairMerge ?? (await repairReading(rows, readings.defaultBranch, ports));
  const live = liveReviewRuns(repoRoot, pidAlive, readings.now);
  const { baseReadings, ...shared } = readings;
  const baseRepairMerges = await baseRepairReadings(rows, baseReadings, ports, readings.now);
  const rowSteps = rows.map((row) => {
    const run = live?.find((e) => e.pr === row.number) ?? null;
    const step = slicePrNext({
      ...shared,
      baseReading: baseReadings?.get(row.base ?? '') ?? null,
      ...(baseRepairMerges.has(row.base ?? '') ? { baseRepairMerge: baseRepairMerges.get(row.base ?? '') } : {}),
      ...(repairMerge === undefined ? {} : { repairMerge }),
      row,
      reviewRun: run === null ? null : { head: run.head, pid: run.pid, startedAt: run.startedAt, live: true },
      reviewStarts: null,
    });
    return { row, pr: row.number, step };
  });
  const steps = rowSteps.map(({ pr, step }) => ({ pr, step }));
  if (opts !== undefined) {
    await Promise.all(
      rowSteps
        .filter(({ step }) => step.step === 'hold' && step.reason.startsWith('merger-app-'))
        .map(({ row, step }) => logMergeHold(opts, row, (step as { reason: string }).reason, logged, readings.now)),
    );
  }
  const candidates = rowSteps.map(({ row, pr, step }) => {
    if (step.step !== 'merge') return { pr, step };
    if (refused.get(pr) === step.head) return { pr, step: { step: 'none', why: 'host-refused' } as SlicePrStep };
    if (holds(conversationHolds?.get(pr), step.head, row)) return { pr, step: { step: 'none', why: 'human-comment' } as SlicePrStep };
    return { pr, step };
  });
  const pick = nextMerge(candidates);
  if (pick === null) return { steps };
  // THE KEY IS READ AGAIN BEFORE A MERGE AS THE APP: the held reading may be
  // older than the key file, and the next pass holds on the fresh reading.
  if (recheck !== undefined && mergeIdentity(readings.backend, readings.mergerApp).identity === 'app') {
    if (mergeIdentity(readings.backend, recheck()).identity !== 'app') return { steps };
  }
  const result = await mergeAt(ports, pick.pr, pick.head);
  if (!result.merged && result.reason === 'host-refused') refused.set(pick.pr, pick.head);
  if (!result.merged && (result.reason === 'human-comment-open' || result.reason === 'human-comment-unread')) {
    const row = rowSteps.find(({ pr }) => pr === pick.pr)?.row;
    conversationHolds?.set(pick.pr, { head: pick.head, at: laterOf(result.conversationAt, row?.updatedAt) });
  }
  if (opts !== undefined) {
    const branch = rowSteps.find(({ pr }) => pr === pick.pr)?.row.head ?? pick.head;
    const identity = mergeIdentity(readings.backend, readings.mergerApp).identity === 'app' ? 'app' : 'host';
    await logMergeAttempt(opts, pick.pr, branch, pick.head, result, identity, readings.now);
  }
  return { steps, merged: { ...pick, result } };
};

/**
 * The paths Plot's own commits change: the sync path set and the generated
 * board bundles `packages/board/build.mjs` declares.
 *
 * @param opts - where the fleet acts.
 * @returns the set; without a readable `build.mjs` it holds the sync paths only.
 */
export const plotPathSetOf = (opts: ActOptions): readonly string[] => {
  const dirs = {
    planDir: readConfig(opts, 'Plan directory', 'docs/plans/'),
    activeIndex: readConfig(opts, 'Active index', 'docs/plans/active/'),
    deliveredIndex: readConfig(opts, 'Delivered index', 'docs/plans/delivered/'),
    sprintDir: readConfig(opts, 'Sprint directory', 'docs/sprints/'),
    releaseDir: DEFAULT_RELEASE_DIR,
  };
  const build = join(opts.repoRoot, 'packages/board/build.mjs');
  let shipped: readonly string[] = [];
  try {
    if (existsSync(build)) shipped = shippedPathsOf(readFileSync(build, 'utf8'));
  } catch {
    shipped = [];
  }
  return [...syncPathSet(dirs), ...shipped];
};

/**
 * Runs the merge tick on the daemon's loop.
 *
 * Reads the PR index, the default-branch reading, the active sprint's scope
 * and the config fresh, then calls {@link mergeTick}. Reads nothing and merges
 * nothing where there is no reading, no store or no open row. The newest
 * merged row stands in for a merge the on-disk reading has not seen yet.
 *
 * @param opts - where the fleet acts.
 * @param refused - the host-refused pairs, kept by the caller for the daemon's life.
 * @param conversationHolds - the conversation holds, kept by the caller for the daemon's life.
 * @param now - epoch milliseconds.
 * @param alive - whether a pid is alive.
 * @param logged - the merge-hold keys already recorded, for the daemon's life.
 * @param mergerApp - holds whether the `Merger app` key is usable, and reads it
 *   again before a merge; a reader of its own by default. A caller that runs
 *   many passes passes one reader, so the check runs once per process.
 * @returns the tick's result, or `null` where nothing was read to act on.
 */
export const runAutoMergePass = async (
  opts: ActOptions,
  refused: MergeRefusals,
  now: number = Date.now(),
  alive: (pid: number) => boolean = pidAlive,
  logged: Set<string> = new Set(),
  mergerApp: MergerAppReader = mergerAppHeld(),
  conversationHolds?: ConversationHolds,
): Promise<MergeTickResult | null> => {
  const context = { repoRoot: opts.repoRoot, scriptDir: opts.scriptsDir };
  // The conversation read is in-process only: the host this process composed
  // at start answers it, and the shell host answers `unaskable`.
  const host = opts.hostAdapter ?? hostForReads(context);
  const backend = await host.backend();
  if (!backend.ok) return null;
  const store = await prIndexFile({ cwd: opts.repoRoot }).read(backend.value);
  if (!store.ok || store.value === null) return null;
  const rows = store.value.rows.filter((row) => row.state === 'OPEN');
  if (rows.length === 0) return null;

  const defaultBranches = defaultBranchFile(opts.repoRoot);
  const reading = await defaultBranches.read();
  const defaultBranch: DefaultBranchReading | null = reading.ok ? reading.value : null;
  if (defaultBranch === null) return null;

  const scripts = scriptsOf(opts);
  const refs = refsOf(opts);
  const scope = await sprintScopeRef(refs, scripts, `origin/${defaultBranch.branch}`);
  const merged = store.value.rows
    .filter((row) => row.state === 'MERGED' && !row.draft && row.mergedAt !== undefined)
    .map((row) => row.mergedAt as string)
    .sort((a, b) => Date.parse(b) - Date.parse(a));
  const checksWaitMs = checksWaitMsOf(readConfig(opts, 'Checks wait', '3600'));
  const remote = refsRemoteGit({ repoRoot: opts.repoRoot, scriptDir: opts.scriptsDir });
  const plotPaths = plotPathSetOf(opts);
  const ports: MergePorts = {
    host,
    scripts,
    defaultBranch: defaultBranches,
    baseBranch: (base) => baseBranchFile(opts.repoRoot, base),
    baseRepair: (base) => baseRepairFile(opts.repoRoot, base),
    refs: { ...refs, remoteSha: remote.remoteSha },
    checksWaitMs,
    now: () => now,
    requireReading: true,
    caller: 'fleetd',
    repair: repairRecordFile(opts.repoRoot),
    build: await buildShell({ repoRoot: opts.repoRoot, scriptDir: opts.scriptsDir }),
    checks: checkNamesOf(readConfig(opts, 'Default branch checks', '')),
    mergeChecks: checkNamesOf(readConfig(opts, 'Merge checks', '')),
    plotPaths,
  };
  // Read once per tick: the line depends on the reading, not on a PR.
  const unsettled =
    defaultBranch.settled?.state === 'green'
      ? await readUnsettled(refs, defaultBranch.settled.sha, defaultBranch.headSha)
      : undefined;
  const baseReadings = new Map<string, DefaultBranchReading | null>();
  for (const base of new Set(rows.map((row) => row.base ?? ''))) {
    if (base === '' || base === defaultBranch.branch) continue;
    const read = await baseBranchFile(opts.repoRoot, base).read();
    baseReadings.set(base, read.ok ? read.value : null);
  }
  return mergeTick(
    rows,
    {
      defaultBranchName: defaultBranch.branch,
      baseReadings,
      newestMerged: merged[0] === undefined ? null : { mergedAt: merged[0] },
      pathSet: plotPaths,
      ...(unsettled === undefined ? {} : { unsettled }),
      scope,
      verdict: { read: 'absent' },
      defaultBranch,
      desk: { dead: false, why: 'live' },
      backend: backend.value,
      mergerApp: backend.value === 'github' ? mergerApp.held(context) : undefined,
      config: {
        autoReview: readAutoReview(opts).autoReview,
        reviewBoundMs: 0,
        startBudget: 0,
        checksWaitMs,
      },
      now,
    },
    ports,
    refused,
    opts.repoRoot,
    alive,
    opts,
    logged,
    () => mergerApp.fresh(context),
    conversationHolds,
  );
};
