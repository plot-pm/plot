import {
  DEFAULT_BRANCH_VERSION,
  type DefaultBranchReading,
} from '@plot-pm/domain/entities/default-branch';
import { advanceSettled, declaredRuns, failingRunsOf, foldRuns } from '@plot-pm/domain/rules/default-branch';
import type { BuildPort } from '@plot-pm/domain/ports/build';
import type { DefaultBranchStore } from '@plot-pm/domain/ports/default-branch';
import type { Refs } from '@plot-pm/domain/ports/refs';

/** How long a pending, red or unknown head waits before its runs are asked again, inside `Checks wait`. */
export const REASK_MS = 5 * 60 * 1000;

/**
 * How long an unsettled head waits before its runs are asked again.
 *
 * Inside `Checks wait` (measured from `headSince`) the interval is
 * {@link REASK_MS}; past it, half of `Checks wait`. Both are capped at half of
 * `Checks wait`, because `defaultBranchRed` stops holding a reading whose
 * `askedAt` is older than `Checks wait`: a red head re-asked every half bound
 * is renewed before its hold expires, as long as the refresh beat plus one ask
 * takes less than the other half.
 *
 * @param checksWaitMs - the `Checks wait` bound, in milliseconds.
 * @param pastWait - whether `Checks wait` has passed since the SHA first appeared.
 * @returns the re-ask interval, in milliseconds.
 */
export const reaskIntervalMs = (checksWaitMs: number, pastWait: boolean): number =>
  pastWait ? checksWaitMs / 2 : Math.min(REASK_MS, checksWaitMs / 2);

/** What one refresh is read and written through. */
export interface DefaultBranchWorld {
  /** The default branch's name. */
  branch(): Promise<string | null>;
  /** The remote tip reader: `remoteSha` only. */
  refs: Pick<Refs, 'remoteSha'>;
  /** The CI connector: `runsForSha` only. */
  build: Pick<BuildPort, 'runsForSha'>;
  /** The reading's file. Fleetd is its only writer. */
  store: DefaultBranchStore;
  /** Runs one host call, inside a host slot where the CI system is GitHub Actions. */
  slot<T>(call: () => Promise<T>): Promise<T>;
  /** Epoch ms. */
  now(): number;
  /**
   * The `Checks wait` bound in ms. Inside it a head is re-asked every
   * {@link REASK_MS}; after it, once per half `Checks wait` ({@link reaskIntervalMs}).
   */
  checksWaitMs: number;
  /**
   * The workflow names `Default branch checks` declares. Only their runs are
   * folded; an empty list folds every run.
   */
  checks: readonly string[];
}

/** What one refresh did, for the log and the tests. */
export type DefaultBranchOutcome = 'skipped' | 'asked' | 'unreadable';

/**
 * Reads the default branch's CI once and records it.
 *
 * Reads the head SHA, and asks for its runs only when the SHA changed or the
 * previous answer is not final. A `green` head is final. A head that is
 * `pending`, `red` or `unknown` is asked again every {@link REASK_MS}, measured
 * from the last ask (`at`), until `Checks wait` has passed since the SHA first
 * appeared (`headSince`). After that it is asked again once per half
 * `Checks wait`, so a red head is renewed before `defaultBranchRed` stops
 * holding it, and a re-run that turns it green lifts the hold on the next ask.
 * A green, unchanged SHA makes no `runsForSha` call and no write.
 *
 * Only the runs of the workflows in `world.checks` are folded
 * (`declaredRuns`); an empty list folds every run.
 *
 * The settled part moves only when the head is `red` or `green`
 * (`advanceSettled`). A host that fails writes `head: 'unknown'`, keeps the
 * settled part, and keeps the previous `askedAt`: `askedAt` is when a host last
 * answered, so a red reading the host stopped confirming ages out after
 * `Checks wait`. `at` records every ask, answered or not. An unaskable CI
 * writes nothing.
 *
 * @param world - the reads and the file.
 * @returns what the refresh did.
 */
export const refreshDefaultBranch = async (
  world: DefaultBranchWorld,
): Promise<DefaultBranchOutcome> => {
  const branch = await world.branch();
  if (branch === null) return 'unreadable';

  const tip = await world.refs.remoteSha(branch);
  if (!tip.ok || tip.value === 'unknown') return 'unreadable';
  const sha = tip.value.sha;

  const stored = await world.store.read();
  const previous = stored.ok && stored.value?.branch === branch ? stored.value : null;
  const now = world.now();

  const unchanged = previous !== null && previous.headSha === sha;
  if (unchanged) {
    if (previous.head === 'green') return 'skipped';
    const pastWait = now - Date.parse(previous.headSince) >= world.checksWaitMs;
    if (now - Date.parse(previous.at) < reaskIntervalMs(world.checksWaitMs, pastWait)) return 'skipped';
  }

  const asked = await world.slot(() => world.build.runsForSha(branch, sha));
  if (!asked.ok && asked.why === 'unaskable') return 'unreadable';

  const stamp = new Date(now).toISOString();
  const headSince = unchanged ? previous.headSince : stamp;
  const carried = previous?.settled;

  let reading: DefaultBranchReading;
  if (!asked.ok) {
    reading = {
      v: DEFAULT_BRANCH_VERSION,
      branch,
      headSha: sha,
      head: 'unknown',
      ...(carried ? { settled: carried } : {}),
      failingRuns: previous?.failingRuns ?? [],
      headSince,
      // No answer: the age of what is carried stays the age of the last answer.
      askedAt: previous?.askedAt ?? stamp,
      at: stamp,
    };
  } else {
    const runs = declaredRuns(asked.value, world.checks);
    const head = foldRuns(runs);
    const settled = advanceSettled(carried, sha, head);
    const moved = settled !== undefined && settled.sha === sha;
    reading = {
      v: DEFAULT_BRANCH_VERSION,
      branch,
      headSha: sha,
      head,
      ...(settled ? { settled } : {}),
      // The failing runs belong to the settled commit: new ones when it moved
      // to this head, otherwise those already held.
      failingRuns: moved ? (head === 'red' ? failingRunsOf(runs) : []) : (previous?.failingRuns ?? []),
      headSince,
      askedAt: stamp,
      at: stamp,
    };
  }
  await world.store.write(reading);
  return 'asked';
};
