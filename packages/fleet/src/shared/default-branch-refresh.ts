import {
  DEFAULT_BRANCH_VERSION,
  type DefaultBranchReading,
  type FailingRun,
  type SettledReading,
} from '@plot-pm/domain/entities/default-branch';
import { REPAIR_RECORD_VERSION, type CandidateCommit, type RepairRecord } from '@plot-pm/domain/entities/repair-record';
import {
  ANCESTOR_ASKS_MAX,
  ANCESTOR_WALK_DEPTH,
  advanceSettled,
  ancestorStep,
  ancestorsToAsk,
  candidateRunsOf,
  newerAncestors,
  declaredRuns,
  failingRunsOf,
  foldRuns,
  unmatchedChecks,
} from '@plot-pm/domain/rules/default-branch';
import type { WorkflowShaRun } from '@plot-pm/domain/entities/build';
import { candidatesFromCommits } from '@plot-pm/domain/rules/repair';
import { keepsRepairRecord } from '@plot-pm/domain/rules/repair-pr';
import type { BuildPort } from '@plot-pm/domain/ports/build';
import type { DefaultBranchStore } from '@plot-pm/domain/ports/default-branch';
import type { RepairRecordStore } from '@plot-pm/domain/ports/repair-record';
import type { Refs } from '@plot-pm/domain/ports/refs';

import { failedOf, readOf, type RecordReading } from './snapshot-fill.js';

/** How long a pending, red or unknown head waits before its runs are asked again, inside `Checks wait`. */
export const REASK_MS = 5 * 60 * 1000;

/** How long after a run's expected end the head is asked, so a run a little longer than the last one is not asked a second time too early. Also the shortest interval an expected end sets. */
export const EXPECTED_END_GRACE_MS = 30 * 1000;

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
 * Inside `Checks wait` a run's expected end shortens the interval: it becomes
 * the time left until that end plus {@link EXPECTED_END_GRACE_MS}, never more
 * than the interval above. An expected end that is not ahead of the last ask
 * sets nothing, so a run that overruns is asked at the interval above and not
 * on every tick.
 *
 * @param checksWaitMs - the `Checks wait` bound, in milliseconds.
 * @param pastWait - whether `Checks wait` has passed since the SHA first appeared.
 * @param untilEndMs - the time from the last ask to the run's expected end, in milliseconds; absent where no end is known.
 * @returns the re-ask interval, in milliseconds.
 */
export const reaskIntervalMs = (checksWaitMs: number, pastWait: boolean, untilEndMs?: number): number => {
  if (pastWait) return checksWaitMs / 2;
  const bound = Math.min(REASK_MS, checksWaitMs / 2);
  return untilEndMs === undefined || !(untilEndMs > 0) ? bound : Math.min(bound, untilEndMs + EXPECTED_END_GRACE_MS);
};

/**
 * Whether a held reading's runs are due to be asked again.
 *
 * Only a `pending` head inside `Checks wait` uses `expectedEndMs`; a green,
 * red or unknown head keeps its interval.
 *
 * @param previous - the held reading.
 * @param now - the current time, in milliseconds.
 * @param checksWaitMs - the `Checks wait` bound, in milliseconds.
 * @param expectedEndMs - when the head's run is expected to end, epoch milliseconds; absent where unknown.
 * @returns `true` where {@link reaskIntervalMs} has passed since the reading's `at`.
 */
export const reaskDue = (
  previous: DefaultBranchReading,
  now: number,
  checksWaitMs: number,
  expectedEndMs?: number,
): boolean => {
  const pastWait = previous.head === 'green' || now - Date.parse(previous.headSince) >= checksWaitMs;
  const at = Date.parse(previous.at);
  const untilEnd = previous.head === 'pending' && expectedEndMs !== undefined ? expectedEndMs - at : undefined;
  return now - at >= reaskIntervalMs(checksWaitMs, pastWait, untilEnd);
};

/** What the refresh remembers of how long the declared runs take. Held in memory only. */
export interface RunTiming {
  /**
   * Notes the folded runs of one commit: when they started, and, where every one concluded `success` and reports an end, how long they took.
   *
   * @param sha - the commit the runs belong to.
   * @param runs - the declared runs of that commit, from `declaredRuns`.
   */
  observe(sha: string, runs: readonly WorkflowShaRun[]): void;
  /**
   * When the commit's runs are expected to end.
   *
   * @param sha - the commit asked about.
   * @returns the start of its runs plus the last duration observed, epoch milliseconds; `undefined` where either is unread.
   */
  expectedEndMs(sha: string): number | undefined;
}

const TIMING_SHAS_MAX = 16;

const epochOf = (text: string | undefined): number | undefined => {
  const ms = text === undefined || text === '' ? NaN : Date.parse(text);
  return Number.isFinite(ms) && ms > 0 ? ms : undefined;
};

/**
 * Builds a {@link RunTiming} that holds the start of each commit it saw and the last green duration.
 *
 * Nothing is persisted: after a restart `expectedEndMs` answers `undefined`
 * until a green run has been observed, and the head is asked at
 * {@link REASK_MS}. A duration comes only from runs that all report an end, so
 * a bare workflow run (which reports none) never sets one.
 *
 * @returns an empty timing.
 */
export const runTiming = (): RunTiming => {
  const starts = new Map<string, number>();
  let durationMs: number | undefined;
  return {
    observe: (sha, runs) => {
      if (runs.length === 0) return;
      const began = runs.map((run) => epochOf(run.startedAt));
      if (began.some((ms) => ms === undefined)) return;
      const start = Math.min(...(began as number[]));
      starts.delete(sha);
      starts.set(sha, start);
      if (starts.size > TIMING_SHAS_MAX) starts.delete(starts.keys().next().value as string);
      const ended = runs.map((run) => epochOf(run.completedAt));
      if (!runs.every((run) => run.conclusion === 'success') || ended.some((ms) => ms === undefined)) return;
      const took = Math.max(...(ended as number[])) - start;
      if (took > 0) durationMs = took;
    },
    expectedEndMs: (sha) => {
      const start = starts.get(sha);
      return start === undefined || durationMs === undefined ? undefined : start + durationMs;
    },
  };
};

/** What one refresh is read and written through. */
export interface DefaultBranchWorld {
  /** The default branch's name. */
  branch(): Promise<string | null>;
  /** The remote tip reader and the local first-parent walk. */
  refs: Pick<Refs, 'remoteSha' | 'firstParentLine' | 'firstParentCommits'>;
  /** The CI connector: `system` and `runsForSha`. */
  build: Pick<BuildPort, 'system' | 'runsForSha'>;
  /** The reading's file. One process writes it: fleetd while its heartbeat reads `live`, else the board's elected PR reader. */
  store: DefaultBranchStore;
  /**
   * The repair record's file, written at the change from green to red. A
   * person may also set its `repairPr`, so fleetd keeps an open record of the
   * same episode rather than replacing it. Where absent, the refresh writes no
   * repair record.
   */
  repair?: RepairRecordStore;
  /** Runs one host call, inside a host slot where the CI system is GitHub Actions. */
  slot<T>(call: () => Promise<T>): Promise<T>;
  /** Epoch ms. */
  now(): number;
  /**
   * The `Checks wait` bound in ms. Inside it a head is re-asked every
   * {@link REASK_MS}, sooner where a pending run's expected end is known
   * ({@link RunTiming}); after it, once per half `Checks wait` ({@link reaskIntervalMs}).
   */
  checksWaitMs: number;
  /** Where the refresh notes how long the declared runs take. Absent, a pending head is asked at {@link REASK_MS}. */
  timing?: RunTiming;
  /**
   * The workflow names `Default branch checks` declares. Only their runs are
   * folded; an empty list folds every run.
   */
  checks: readonly string[];
  /**
   * Records the beat's `defaultBranch` reading into the daemon's snapshot: the
   * reading written, the held one where the beat skips, a `failed` reading
   * where a read gave no answer. It adds no read.
   */
  record?: RecordReading;
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
    const asked = await world.slot(() => world.build.runsForSha(branch, sha, world.checks));
    const runs = asked.ok ? declaredRuns(asked.value, world.checks) : [];
    if (asked.ok) world.timing?.observe(sha, runs);
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
 * `candidates` holds the first-parent commits of `carried.sha..settled.sha`,
 * newest first ({@link candidatesFromCommits}), read through
 * `Refs.firstParentCommits`. With no `carried` reading there is no last green
 * SHA, and the record keeps `candidates: []` with a `warn` saying so; a range
 * that cannot be read does the same.
 *
 * Reads the record on disk first and keeps it where it already holds this
 * episode ({@link keepsRepairRecord}), so a `repairPr` that a person recorded
 * through `plot-ask.mjs repair-pr` survives a second change to red on the same
 * commit. A failed read writes nothing, for the same reason.
 *
 * @param world - the reads and the repair record's file.
 * @param branch - the default branch's name.
 * @param settled - the new, red settled reading.
 * @param carried - the settled reading held before this refresh, if any.
 * @param stamp - this refresh's timestamp, ISO-8601.
 * @param warn - receives a one-line reason where the episode opens with no
 *   last green SHA, where its candidates are not yet collected, or where the
 *   record on disk could not be read.
 */
const writeRepairRecord = async (
  world: DefaultBranchWorld & { repair: RepairRecordStore },
  branch: string,
  settled: SettledReading,
  carried: SettledReading | undefined,
  stamp: string,
  warn: (line: string) => void,
): Promise<void> => {
  const existing = await world.repair.read();
  if (!existing.ok) {
    warn(`plot-fleetd: repair record for ${settled.sha} left unwritten — the record on disk could not be read`);
    return;
  }
  if (keepsRepairRecord(existing.value, branch, settled.sha)) return;
  let candidates: CandidateCommit[] = [];
  if (carried === undefined) {
    warn(`plot-fleetd: repair record opened for ${settled.sha} with no last green SHA to pick candidates from`);
  } else {
    const range = await world.refs.firstParentCommits(`${carried.sha}..${settled.sha}`);
    if (range.ok) candidates = candidatesFromCommits(range.value);
    else warn(`plot-fleetd: repair record opened for ${settled.sha} with no candidates — the range ${carried.sha}..${settled.sha} could not be read`);
  }
  const record: RepairRecord = {
    v: REPAIR_RECORD_VERSION,
    branch,
    state: 'idle',
    ...(carried ? { lastGreenSha: carried.sha } : {}),
    firstRedSha: settled.sha,
    redSince: stamp,
    candidates,
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
 * asked again every {@link REASK_MS}, or at the expected end of its run where that is sooner ({@link reaskIntervalMs}), measured from the last ask (`at`), until
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
 * into the same `unknown`. The head itself is read by `candidateRunsOf` over
 * every run, so a run that waits with no jobs yet reads `pending`, and a
 * cancelled run reads `unknown`.
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
 * writes nothing. Where the repository declares no CI system
 * (`build.system()` answers `''`), the refresh reads no tip and asks no CI: it
 * writes nothing and ends `'unreadable'`, as an unaskable CI does.
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
    world.record?.('defaultBranch', failedOf('the default branch could not be read', world.now()));
    return 'unreadable';
  }

  if (world.build.system() === '') {
    warn('plot-fleetd: default-branch read skipped — no CI system is declared');
    world.record?.('defaultBranch', failedOf('no CI system is declared', world.now()));
    return 'unreadable';
  }

  const tip = await world.refs.remoteSha(branch);
  if (!tip.ok || tip.value === 'unknown') {
    warn(`plot-fleetd: default-branch read skipped — the remote tip of '${branch}' could not be read`);
    world.record?.('defaultBranch', failedOf(`the remote tip of '${branch}' could not be read`, world.now()));
    return 'unreadable';
  }
  const sha = tip.value.sha;

  const stored = await world.store.read();
  const previous = stored.ok && stored.value?.branch === branch ? stored.value : null;
  const now = world.now();

  const unchanged = previous !== null && previous.headSha === sha;
  if (unchanged && !reaskDue(previous, now, world.checksWaitMs, world.timing?.expectedEndMs(sha))) {
    world.record?.('defaultBranch', readOf(previous, now));
    return 'skipped';
  }

  const asked = await world.slot(() => world.build.runsForSha(branch, sha, world.checks));
  if (!asked.ok && asked.why === 'unaskable') {
    warn(`plot-fleetd: default-branch read skipped — CI did not answer for '${branch}' at ${sha}`);
    world.record?.('defaultBranch', failedOf(`CI did not answer for '${branch}' at ${sha}`, now));
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
    world.timing?.observe(sha, runs);
    // Every run of the head, not only the declared ones: a run that waits in
    // the concurrency group has created no jobs, so only its run-level row
    // reads `pending`. A cancelled run settles nothing and reads `unknown`.
    const candidate = candidateRunsOf(asked.value, world.checks, world.build.system() === 'github-actions');
    const head = candidate === 'cancelled' ? 'unknown' : candidate;
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
    if (world.repair && settled?.state === 'red' && settled.sha !== carried?.sha && carried?.state !== 'red') {
      await writeRepairRecord({ ...world, repair: world.repair }, branch, settled, carried, stamp, warn);
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
  world.record?.('defaultBranch', readOf(reading, now));
  await world.store.write(reading);
  return 'asked';
};

/**
 * Builds a default-branch refresh that reads the remote tip only where the tip may have moved.
 *
 * `moved` answers a key that changes whenever the default branch's remote tip
 * may have moved, or `null` where it cannot say. A call returns `'skipped'`
 * and reads no tip where the key equals the key of the last refresh that read
 * the tip, the held reading names the default branch, and the held reading is
 * not due ({@link reaskDue}). Every other call runs
 * {@link refreshDefaultBranch}. A refresh that ends `'unreadable'` keeps no
 * key, so the next call reads the tip again.
 *
 * @param world - the reads and the file.
 * @param moved - the key for the default branch; it must start no process.
 * @param warn - passed to {@link refreshDefaultBranch}.
 * @returns one refresh per call.
 */
export const refreshOnChange = (
  world: DefaultBranchWorld,
  moved: (branch: string) => Promise<string | null>,
  warn: (line: string) => void = () => undefined,
): (() => Promise<DefaultBranchOutcome>) => {
  let readKey: string | null = null;
  return async () => {
    const branch = await world.branch();
    const key = branch === null ? null : await moved(branch);
    if (key !== null && key === readKey) {
      const stored = await world.store.read();
      const previous = stored.ok && stored.value?.branch === branch ? stored.value : null;
      const now = world.now();
      if (previous !== null && !reaskDue(previous, now, world.checksWaitMs, world.timing?.expectedEndMs(previous.headSha))) {
        world.record?.('defaultBranch', readOf(previous, now));
        return 'skipped';
      }
    }
    const outcome = await refreshDefaultBranch(world, warn);
    readKey = outcome === 'unreadable' ? null : key;
    return outcome;
  };
};

/** What {@link refreshBases} reads and writes beyond the default branch's own world. */
export interface BaseRefreshWorld {
  /** The CI reads, the clock and the bounds, shared with the default branch's refresh. */
  shared: Pick<DefaultBranchWorld, 'refs' | 'build' | 'slot' | 'now' | 'checksWaitMs' | 'checks'>;
  /** The reading's file for one base. */
  storeFor(base: string): DefaultBranchStore;
  /** The repair record's file for one base; a red reading opens that base's episode there. */
  repairFor(base: string): RepairRecordStore;
  /** The bases that hold a reading file now, or `null` where they could not be listed. */
  held(): Promise<readonly string[] | null>;
  /** Deletes one base's reading file and its repair record. Returns whether both are gone. */
  remove(base: string): Promise<boolean>;
}

/**
 * Refreshes one reading per `sprint/*` branch that a remote listing names, and
 * removes the file of each base the listing no longer names.
 *
 * Each base runs {@link refreshDefaultBranch} through a world whose `branch()`
 * is the base, whose `refs.remoteSha` answers from `tips`, and which has no
 * `record`, and whose `repair` is `world.repairFor(base)`: a base never touches
 * the daemon snapshot's default-branch reading or the default branch's repair
 * record, and a red reading opens an episode on its own base's record only. The bases run one after
 * another, so a base never asks concurrently with another. A base whose
 * refresh throws or ends `'unreadable'` is reported to `warn` and the next base
 * still runs. A declared check that matched no run is not reported: a sprint
 * branch with no pull request open has no runs, which is its normal state.
 *
 * Only `sprint/*` files are removed, and only where `tips` is a listing the
 * remote answered. A caller with no answered listing calls nothing.
 *
 * @param world - the reads, and the files.
 * @param tips - the tips of every `sprint/*` branch the remote lists, by name.
 * @param warn - receives one line per failure, and each line once per base.
 * @returns the outcome of each refreshed base, by name.
 */
export const refreshBases = async (
  world: BaseRefreshWorld,
  tips: Readonly<Record<string, string>>,
  warn: (line: string) => void = () => undefined,
): Promise<Readonly<Record<string, DefaultBranchOutcome | 'failed'>>> => {
  const outcomes: Record<string, DefaultBranchOutcome | 'failed'> = {};
  const bases = Object.keys(tips).filter((name) => name.startsWith('sprint/')).sort();
  for (const base of bases) {
    let last: string | null = null;
    const baseWarn = (line: string): void => {
      if (line.includes('matched no run') || line === last) return;
      last = line;
      warn(`${line} [base ${base}]`);
    };
    const store = world.storeFor(base);
    const { build, slot, now, checksWaitMs, checks } = world.shared;
    const baseWorld: DefaultBranchWorld = {
      build,
      slot,
      now,
      checksWaitMs,
      checks,
      branch: async () => base,
      refs: {
        firstParentLine: world.shared.refs.firstParentLine,
        firstParentCommits: world.shared.refs.firstParentCommits,
        remoteSha: async () => ({ ok: true, value: { sha: tips[base]! } }),
      },
      repair: world.repairFor(base),
      store: {
        read: () => store.read(),
        write: async (reading) => {
          const written = await store.write(reading);
          if (!written.ok) baseWarn(`plot-fleetd: base-branch reading for '${base}' left unwritten`);
          return written;
        },
      },
    };
    try {
      outcomes[base] = await refreshDefaultBranch(baseWorld, baseWarn);
    } catch (e) {
      outcomes[base] = 'failed';
      baseWarn(`plot-fleetd: base-branch read for '${base}' failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  const held = await world.held();
  if (held !== null) {
    for (const base of held) {
      if (!base.startsWith('sprint/') || base in tips) continue;
      if (!(await world.remove(base))) warn(`plot-fleetd: base-branch reading for '${base}' could not be removed`);
    }
  }
  return outcomes;
};

/**
 * Builds one beat that refreshes the default branch and then each `sprint/*` base.
 *
 * The bases are refreshed only where the default branch's refresh read the
 * combined tip listing during this call: an idle pass reads none, starts no
 * process, and leaves every base file as it was. A sprint tip that moves while
 * `origin/<default>` does not is therefore read when the default branch's
 * reading is next due, at most once per half `Checks wait`. A refresh that
 * throws is reported to `warn` and the bases still run on any listing it read.
 *
 * @param refresh - the default branch's refresh.
 * @param takeTips - returns the listing the refresh read since the last call and
 *   forgets it; `null` where no answered listing was read.
 * @param bases - the per-base reads, and the files.
 * @param warn - receives one line per failure.
 * @returns one beat per call.
 */
export const refreshWithBases = (
  refresh: () => Promise<unknown>,
  takeTips: () => Readonly<Record<string, string>> | null,
  bases: BaseRefreshWorld,
  warn: (line: string) => void = () => undefined,
): (() => Promise<void>) => async () => {
  takeTips();
  try {
    await refresh();
  } catch (e) {
    warn(`plot-fleetd: default-branch read failed: ${e instanceof Error ? e.message : String(e)}`);
  }
  const tips = takeTips();
  if (tips === null) return;
  try {
    await refreshBases(bases, tips, warn);
  } catch (e) {
    warn(`plot-fleetd: base-branch read failed: ${e instanceof Error ? e.message : String(e)}`);
  }
};
