import {
  DEFAULT_BRANCH_VERSION,
  type DefaultBranchReading,
  type FailingRun,
  type SettledReading,
} from '@plot-pm/domain/entities/default-branch';
import {
  ANCESTOR_ASKS_MAX,
  ANCESTOR_WALK_DEPTH,
  advanceSettled,
  ancestorStep,
  ancestorsToAsk,
  declaredRuns,
  failingRunsOf,
  foldRuns,
} from '@plot-pm/domain/rules/default-branch';
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
  /** The remote tip reader and the local first-parent walk. */
  refs: Pick<Refs, 'remoteSha' | 'firstParentLine'>;
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

/** Where the settled part stands after a refresh, with the failing runs of its commit. */
interface Settlement {
  settled: SettledReading | undefined;
  failingRuns: readonly FailingRun[];
}

/**
 * Advances the settled part past a head that has not concluded.
 *
 * Walks the head's first-parent line locally, at most
 * `ANCESTOR_WALK_DEPTH` commits, and asks CI for the runs of the commits
 * between the head and the settled commit, newest first, at most
 * `ANCESTOR_ASKS_MAX` of them (`ancestorsToAsk`). The first commit whose runs
 * have concluded becomes the settled commit (`ancestorStep`). A host that does
 * not answer stops the walk and keeps the previous settlement. A walk that
 * does not reach the settled commit asks nothing.
 *
 * @param world - the reads.
 * @param branch - the default branch.
 * @param headSha - the head, already asked and not concluded.
 * @param kept - the settlement the refresh holds so far.
 * @returns the settlement after the walk.
 */
const settleBehindHead = async (
  world: DefaultBranchWorld,
  branch: string,
  headSha: string,
  kept: Settlement,
): Promise<Settlement> => {
  const walked = await world.refs.firstParentLine(headSha, ANCESTOR_WALK_DEPTH);
  const line = walked.ok ? walked.value : [];
  for (const sha of ancestorsToAsk(line, headSha, kept.settled, ANCESTOR_ASKS_MAX)) {
    const asked = await world.slot(() => world.build.runsForSha(branch, sha));
    const runs = asked.ok ? declaredRuns(asked.value, world.checks) : [];
    const state = asked.ok ? foldRuns(runs) : null;
    const step = ancestorStep(sha, state);
    if (step === 'stop') return kept;
    if (step !== 'older') return { settled: step, failingRuns: step.state === 'red' ? failingRunsOf(runs) : [] };
  }
  return kept;
};

/** What one refresh did, for the log and the tests. */
export type DefaultBranchOutcome = 'skipped' | 'asked' | 'unreadable';

/**
 * Reads the default branch's CI once and records it.
 *
 * Reads the head SHA, and asks for its runs when the SHA changed or the
 * previous ask is old enough. A head that is `pending`, `red` or `unknown` is
 * asked again every {@link REASK_MS}, measured from the last ask (`at`), until
 * `Checks wait` has passed since the SHA first appeared (`headSince`). After
 * that it is asked again once per half `Checks wait`, so a red head is renewed
 * before `defaultBranchRed` stops holding it, and a re-run that turns it green
 * lifts the hold on the next ask. A `green` head is asked again once per half
 * `Checks wait`, measured from `at`, so its `askedAt` stays within the bound:
 * the merge controller refuses a reading older than `Checks wait`, and a quiet
 * green branch would otherwise refuse every merge.
 *
 * Only the runs of the workflows in `world.checks` are folded
 * (`declaredRuns`); an empty list folds every run.
 *
 * The settled part moves to the head when the head is `red` or `green`
 * (`advanceSettled`). A head that is `pending` or `unknown` moves it to the
 * newest concluded commit between the head and the settled commit, read by
 * {@link settleBehindHead}. One refresh therefore makes at most
 * `1 + ANCESTOR_ASKS_MAX` CI asks. A host that fails writes `head: 'unknown'`, keeps the
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
    const pastWait = previous.head === 'green' || now - Date.parse(previous.headSince) >= world.checksWaitMs;
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
    const advanced = advanceSettled(carried, sha, head);
    // The failing runs belong to the settled commit: new ones when it moved
    // to this head or to an ancestor, otherwise those already held.
    const { settled, failingRuns } =
      advanced !== carried
        ? { settled: advanced, failingRuns: head === 'red' ? failingRunsOf(runs) : [] }
        : await settleBehindHead(world, branch, sha, { settled: carried, failingRuns: previous?.failingRuns ?? [] });
    reading = {
      v: DEFAULT_BRANCH_VERSION,
      branch,
      headSha: sha,
      head,
      ...(settled ? { settled } : {}),
      failingRuns: [...failingRuns],
      headSince,
      askedAt: stamp,
      at: stamp,
    };
  }
  await world.store.write(reading);
  return 'asked';
};
