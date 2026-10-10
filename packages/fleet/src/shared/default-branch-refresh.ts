import {
  DEFAULT_BRANCH_VERSION,
  type DefaultBranchReading,
} from '@plot-pm/domain/entities/default-branch';
import { advanceSettled, failingRunsOf, foldRuns } from '@plot-pm/domain/rules/default-branch';
import type { BuildPort } from '@plot-pm/domain/ports/build';
import type { DefaultBranchStore } from '@plot-pm/domain/ports/default-branch';
import type { Refs } from '@plot-pm/domain/ports/refs';

/** How long a pending, red or unknown head waits before its runs are asked again, inside `Checks wait`. */
export const REASK_MS = 5 * 60 * 1000;

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
   * {@link REASK_MS}; after it, at most once per `Checks wait`.
   */
  checksWaitMs: number;
}

/** What one refresh did, for the log and the tests. */
export type DefaultBranchOutcome = 'skipped' | 'asked' | 'unreadable';

/**
 * Reads the default branch's CI once and records it.
 *
 * Reads the head SHA, and asks for its runs only when the SHA changed or the
 * previous answer is not final. A `green` head is final. A head that is
 * `pending`, `red` or `unknown` is asked again every {@link REASK_MS}, measured
 * from `askedAt`, until `Checks wait` has passed since the SHA first appeared
 * (`headSince`). After that it is asked again once per `Checks wait`, measured
 * from `askedAt`, so a re-run that turns a red head green lifts the hold on the
 * next ask. A green, unchanged SHA makes no `runsForSha` call and no write.
 *
 * The settled part moves only when the head is `red` or `green`
 * (`advanceSettled`). An unanswered question writes nothing, so a host that
 * fails never turns a red reading into no reading.
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
    const interval = pastWait ? Math.max(world.checksWaitMs, REASK_MS) : REASK_MS;
    if (now - Date.parse(previous.askedAt) < interval) return 'skipped';
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
      askedAt: stamp,
      at: stamp,
    };
  } else {
    const head = foldRuns(asked.value);
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
      failingRuns: moved ? (head === 'red' ? failingRunsOf(asked.value) : []) : (previous?.failingRuns ?? []),
      headSince,
      askedAt: stamp,
      at: stamp,
    };
  }
  await world.store.write(reading);
  return 'asked';
};
