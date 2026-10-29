import {
  DEFAULT_BRANCH_VERSION,
  type DefaultBranchReading,
  type FailingRun,
  type SettledReading,
} from '@plot-pm/domain/entities/default-branch';
import { REPAIR_RECORD_VERSION, type RepairRecord } from '@plot-pm/domain/entities/repair-record';
import {
  ANCESTOR_ASKS_MAX,
  ANCESTOR_WALK_DEPTH,
  advanceSettled,
  ancestorStep,
  ancestorsToAsk,
  newerAncestors,
  declaredRuns,
  failingRunsOf,
  foldRuns,
  unmatchedChecks,
} from '@plot-pm/domain/rules/default-branch';
import type { BuildPort } from '@plot-pm/domain/ports/build';
import type { DefaultBranchStore } from '@plot-pm/domain/ports/default-branch';
import type { RepairRecordStore } from '@plot-pm/domain/ports/repair-record';
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
  /** The repair record's file, written at the change from green to red. Fleetd is its only writer. */
  repair: RepairRecordStore;
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
  /** Where the last walk ended without a concluded commit; the next one resumes past it. */
  walked?: string;
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
 * does not reach the settled commit asks nothing. A walk whose asks all came
 * back unconcluded records its last commit in `walked`, and the next refresh
 * of the same head resumes past it, so a burst longer than
 * `ANCESTOR_ASKS_MAX` is covered across refreshes at `ANCESTOR_ASKS_MAX` asks
 * each. A resumed walk that finds a concluded commit re-asks the newer commits
 * it skipped, newest first (`newerAncestors`), and settles on the first of
 * them that has concluded, or on the commit it found where none has. The
 * settled commit is therefore the newest concluded commit between the head and
 * the previous settled commit as the host answered in this refresh: never
 * green while a newer commit on that line answered red.
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
  const asking = ancestorsToAsk(line, headSha, kept.settled, ANCESTOR_ASKS_MAX, kept.walked);
  const ask = async (sha: string): Promise<{ step: ReturnType<typeof ancestorStep>; failingRuns: FailingRun[] }> => {
    const asked = await world.slot(() => world.build.runsForSha(branch, sha));
    const runs = asked.ok ? declaredRuns(asked.value, world.checks) : [];
    const step = ancestorStep(sha, asked.ok ? foldRuns(runs) : null);
    return { step, failingRuns: typeof step === 'object' && step.state === 'red' ? failingRunsOf(runs) : [] };
  };
  for (const sha of asking) {
    const found = await ask(sha);
    if (found.step === 'stop') return kept;
    if (found.step === 'older') continue;
    for (const newer of newerAncestors(line, asking[0]!)) {
      const reasked = await ask(newer);
      if (reasked.step === 'stop') return kept;
      if (reasked.step !== 'older') return { settled: reasked.step, failingRuns: reasked.failingRuns };
    }
    return { settled: found.step, failingRuns: found.failingRuns };
  }
  const last = asking[asking.length - 1];
  return last === undefined ? { settled: kept.settled, failingRuns: kept.failingRuns } : { ...kept, walked: last };
};

/**
 * Writes the repair record for a change from a green settled reading (or
 * none) to a red one.
 *
 * `candidates` is written empty here. Populating it needs each candidate's
 * subject line over the range between `carried` and `settled`, including
 * merge commits — no port operation `DefaultBranchWorld` already holds
 * answers that for an arbitrary range (`Refs.commitSubjects` carries no sha;
 * `Refs.commitsSync` needs a local checkout directory this world does not
 * have and excludes merges; `Refs.mergeSubjects` takes no range). Adding one
 * is out of this slice's scope. With no previous reading the record also has
 * no `lastGreenSha`, and `warn` is told so.
 *
 * @param world - the reads and the repair record's file.
 * @param branch - the default branch's name.
 * @param settled - the new, red settled reading.
 * @param carried - the settled reading held before this refresh, if any.
 * @param stamp - this refresh's timestamp, ISO-8601.
 * @param warn - receives a one-line reason where the episode opens with no
 *   last green SHA, or where its candidates are not yet collected.
 */
const writeRepairRecord = async (
  world: DefaultBranchWorld,
  branch: string,
  settled: SettledReading,
  carried: SettledReading | undefined,
  stamp: string,
  warn: (line: string) => void,
): Promise<void> => {
  if (carried === undefined) {
    warn(`plot-fleetd: repair record opened for ${settled.sha} with no last green SHA to pick candidates from`);
  } else {
    warn(`plot-fleetd: repair record opened for ${settled.sha} with no candidates collected yet`);
  }
  const candidates: readonly { sha: string; subject: string }[] = [];
  const record: RepairRecord = {
    v: REPAIR_RECORD_VERSION,
    branch,
    state: 'idle',
    ...(carried ? { lastGreenSha: carried.sha } : {}),
    firstRedSha: settled.sha,
    redSince: stamp,
    candidates: [...candidates],
    rerun: 'none',
    preRevertRerun: 'none',
    at: stamp,
  };
  await world.repair.write(record);
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
 * (`declaredRuns`); an empty list folds every run. A declared name matching
 * none of the head's runs is reported to `warn` ({@link unmatchedChecks}), so
 * a config typo reads differently from a quiet repository instead of folding
 * into the same `unknown`.
 *
 * The settled part moves to the head when the head is `red` or `green`
 * (`advanceSettled`). A head that is `pending` or `unknown` moves it to the
 * newest concluded commit between the head and the settled commit, read by
 * {@link settleBehindHead}. One refresh therefore makes at most
 * `1 + ANCESTOR_ASKS_MAX` CI asks, plus the re-asks of the commits a resumed
 * walk skipped when it finds a concluded commit, fewer than
 * `ANCESTOR_WALK_DEPTH`. The resume point `walked` is kept only while the head
 * is unchanged. A host that fails writes `head: 'unknown'`, keeps the
 * settled part, and keeps the previous `askedAt`: `askedAt` is when a host last
 * answered, so a red reading the host stopped confirming ages out after
 * `Checks wait`. `at` records every ask, answered or not. An unaskable CI
 * writes nothing.
 *
 * @param world - the reads and the file.
 * @param warn - receives a one-line reason for each declared check name that
 *   matched none of the head's runs, and for each path that ends the refresh
 *   with `'unreadable'`; defaults to doing nothing.
 * @returns what the refresh did.
 */
export const refreshDefaultBranch = async (
  world: DefaultBranchWorld,
  warn: (line: string) => void = () => undefined,
): Promise<DefaultBranchOutcome> => {
  const branch = await world.branch();
  if (branch === null) {
    warn('plot-fleetd: default-branch read skipped — the default branch could not be read');
    return 'unreadable';
  }

  const tip = await world.refs.remoteSha(branch);
  if (!tip.ok || tip.value === 'unknown') {
    warn(`plot-fleetd: default-branch read skipped — the remote tip of '${branch}' could not be read`);
    return 'unreadable';
  }
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
  if (!asked.ok && asked.why === 'unaskable') {
    warn(`plot-fleetd: default-branch read skipped — CI did not answer for '${branch}' at ${sha}`);
    return 'unreadable';
  }

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
    for (const name of unmatchedChecks(asked.value, world.checks)) {
      warn(`plot-fleetd: default-branch check '${name}' matched no run for ${sha}`);
    }
    const runs = declaredRuns(asked.value, world.checks);
    const head = foldRuns(runs);
    const advanced = advanceSettled(carried, sha, head);
    // The failing runs belong to the settled commit: new ones when it moved
    // to this head or to an ancestor, otherwise those already held.
    const { settled, failingRuns, walked } =
      advanced !== carried
        ? { settled: advanced, failingRuns: head === 'red' ? failingRunsOf(runs) : [] }
        : await settleBehindHead(world, branch, sha, {
            settled: carried,
            failingRuns: previous?.failingRuns ?? [],
            ...(unchanged && previous.walked ? { walked: previous.walked } : {}),
          });

    // The change from a green settled reading (or none) to a red one: write
    // the repair record before this reading, so a crash or a second tick on
    // one machine starts no second repair.
    if (settled?.state === 'red' && settled.sha !== carried?.sha && carried?.state !== 'red') {
      await writeRepairRecord(world, branch, settled, carried, stamp, warn);
    }

    reading = {
      v: DEFAULT_BRANCH_VERSION,
      branch,
      headSha: sha,
      head,
      ...(settled ? { settled } : {}),
      ...(walked ? { walked } : {}),
      failingRuns: [...failingRuns],
      headSince,
      askedAt: stamp,
      at: stamp,
    };
  }
  await world.store.write(reading);
  return 'asked';
};
