import {
  checkNamesOf,
  checksWaitMsOf,
  nextMerge,
  slicePrNext,
  type DefaultBranchReading,
  type MergePorts,
  type MergeResult,
  type SlicePrNextReadings,
  type SlicePrStep,
} from '@plot-pm/domain';
import {
  buildShell,
  defaultBranchFile,
  prIndexFile,
  repairRecordFile,
} from '@plot-pm/domain/adapters';
import { refsRemoteGit } from '@plot-pm/domain/adapters/refs/refs-remote-git';
import { sprintScopeRef } from '@plot-pm/domain/adapters/sprint-scope-ref';
import { liveReviewRuns } from '@plot-pm/domain/adapters/review-start/review-start-node';
import type { PrIndexRow } from '@plot-pm/domain/entities/pr-index';
import type { RepairMergeReading } from '@plot-pm/domain/rules/repair-pr';
import { readRepair, mergeAt } from '@plot-pm/domain/workflows/merge';
import { hostOf, refsOf, scriptsOf, type ActOptions } from './action-log.js';
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
 * @param pidAlive - whether a review run's pid is alive.
 * @returns every row's step and the merge attempt, if any.
 */
export const mergeTick = async (
  rows: readonly PrIndexRow[],
  readings: Omit<SlicePrNextReadings, 'row' | 'reviewRun' | 'reviewStarts'>,
  ports: MergePorts,
  refused: MergeRefusals,
  repoRoot: string,
  pidAlive: (pid: number) => boolean,
): Promise<MergeTickResult> => {
  const repairMerge = readings.repairMerge ?? (await repairReading(rows, readings.defaultBranch, ports));
  const live = liveReviewRuns(repoRoot, pidAlive, readings.now);
  const steps = rows.map((row) => {
    const run = live?.find((e) => e.pr === row.number) ?? null;
    const step = slicePrNext({
      ...readings,
      ...(repairMerge === undefined ? {} : { repairMerge }),
      row,
      reviewRun: run === null ? null : { head: run.head, pid: run.pid, startedAt: run.startedAt, live: true },
      reviewStarts: null,
    });
    return { pr: row.number, step };
  });
  const candidates = steps.map(({ pr, step }) =>
    step.step === 'merge' && refused.get(pr) === step.head
      ? { pr, step: { step: 'none', why: 'host-refused' } as SlicePrStep }
      : { pr, step },
  );
  const pick = nextMerge(candidates);
  if (pick === null) return { steps };
  const result = await mergeAt(ports, pick.pr, pick.head);
  if (!result.merged && result.reason === 'host-refused') refused.set(pick.pr, pick.head);
  return { steps, merged: { ...pick, result } };
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
 * @param now - epoch milliseconds.
 * @param alive - whether a pid is alive.
 * @returns the tick's result, or `null` where nothing was read to act on.
 */
export const runAutoMergePass = async (
  opts: ActOptions,
  refused: MergeRefusals,
  now: number = Date.now(),
  alive: (pid: number) => boolean = pidAlive,
): Promise<MergeTickResult | null> => {
  const host = hostOf(opts);
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
  const ports: MergePorts = {
    host,
    scripts,
    defaultBranch: defaultBranches,
    refs: { ...refs, remoteSha: remote.remoteSha },
    checksWaitMs,
    now: () => now,
    requireReading: true,
    caller: 'fleetd',
    repair: repairRecordFile(opts.repoRoot),
    build: await buildShell({ repoRoot: opts.repoRoot, scriptDir: opts.scriptsDir }),
    checks: checkNamesOf(readConfig(opts, 'Default branch checks', '')),
  };
  return mergeTick(
    rows,
    {
      newestMerged: merged[0] === undefined ? null : { mergedAt: merged[0] },
      scope,
      verdict: { read: 'absent' },
      defaultBranch,
      desk: { dead: false, why: 'live' },
      mergerAppMissing: backend.value === 'github' && readConfig(opts, MERGER_APP_KEY, '') === '',
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
  );
};
