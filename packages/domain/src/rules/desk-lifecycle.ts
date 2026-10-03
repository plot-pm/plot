/**
 * Which state a desk is in, and what exits it.
 *
 * Two earlier fixes each closed one way a desk gets stuck: `9260f8a65` made
 * `plot-dispatch.sh --release` detach a released desk, and
 * `rules/checkout-yield.ts` stopped reading a missing `@{upstream}` as
 * unlanded work. Neither gave the domain a LIST of desk states, so the next
 * way a desk gets stuck was found by counting 250 of them. This rule is that
 * list: every member of {@link DeskState} and the one way out of it.
 *
 * It reads no file and spawns nothing. The caller takes every reading —
 * `reapProblems`'s five (`workerPid`, `dirtyPath`, `blockedMarker`, `merge`,
 * `unpushed`), slice 1's file-changing-commit count (`rules/empty-claim.ts`),
 * and two this slice adds: whether `origin/<branch>` still exists, and
 * whether the desk holds anything besides a `PLOT-BLOCKED*` marker.
 *
 * @concept desk-lifecycle
 */

import type { MergeReading } from './reapable.js';

/** Where a desk sits in its life, named for the exit each one has. */
export type DeskState =
  | 'working'
  | 'finished'
  | 'orphaned'
  | 'refused-empty'
  | 'refused-with-work'
  | 'holding-work'
  | 'unplaced';

/** A desk reaped once its checkout is detached from a branch nobody can push to again. */
export interface DetachThenReapExit {
  readonly kind: 'detach-then-reap';
}

/** A desk reaped once its marker's text is copied somewhere that outlives it. */
export interface CopyThenReapExit {
  readonly kind: 'copy-then-reap';
  /** Where the marker's text goes before the desk is removed. */
  readonly destination: string;
}

/** A desk reaped with no further step. */
export interface ReapExit {
  readonly kind: 'reap';
}

/** A desk re-read next pass rather than acted on now. */
export interface ReReadExit {
  readonly kind: 're-read';
}

/** A desk only a person can resolve, with a reason the board can print. */
export interface PersonExit {
  readonly kind: 'person';
  /** Why a person is needed, never empty — the board must be able to word it. */
  readonly reason: string;
}

/** How a desk's state is left. */
export type DeskExit =
  | DetachThenReapExit
  | CopyThenReapExit
  | ReapExit
  | ReReadExit
  | PersonExit;

/**
 * What the caller measured of one desk.
 *
 * Every field is a reading the caller took, never a judgement this rule makes.
 * `fileChangingCommits` is slice 1's `realCommits` count — commits beyond the
 * default branch that are not empty claim markers (`rules/empty-claim.ts`).
 * `claimRef` and `markerRecordsWork` are the two readings this slice adds:
 * neither is read from a file by this rule, because both are measurements the
 * caller is better placed to take than the rule is to re-derive.
 */
export interface DeskReadings {
  /** The live worker's pid, or `null` when no process runs in the desk. */
  readonly workerPid: string | null;
  /** The first uncommitted path beside the marker, or `''` when the tree is clean of anything else. */
  readonly dirtyPath: string;
  /** Whether the desk carries a `PLOT-BLOCKED*` marker. */
  readonly blockedMarker: boolean;
  /** What the host said about any PR for this branch. */
  readonly merge: MergeReading;
  /**
   * Commits on `HEAD` no remote holds, or `'unknown'` when they could not be
   * counted. Matches {@link TreeReadings.unpushed} in `rules/reapable.ts`.
   */
  readonly unpushed?: readonly string[] | 'unknown';
  /**
   * Commits beyond the default branch that change a file — slice 1's
   * `realCommits`, over the commits the caller read. `0` for a desk whose only
   * commit is an empty claim marker.
   */
  readonly fileChangingCommits: number;
  /** Whether `origin/<branch>` still exists. */
  readonly claimRef: boolean;
  /**
   * Whether the desk holds anything besides its `PLOT-BLOCKED*` marker — a
   * dirty path that is not the marker itself, or a file-changing commit.
   *
   * A READING, NOT A PARSE. The caller measures presence; it does not read the
   * marker's prose for a branch name or a verdict, for the reason slice 2
   * already refused that: `markerRecordsWork` answers *is there more here*,
   * never *what does the marker say*.
   */
  readonly markerRecordsWork: boolean;
  /**
   * Whether a manifest names this desk, reading {@link deskManifest}'s answer
   * from `rules/desk-manifest.ts`. `false` for `unnamed` and for `several` —
   * this rule does not re-derive that join, only consumes its answer.
   */
  readonly manifestKnown: boolean;
}

/** Where a copied-then-reaped marker's text goes. */
export const REFUSALS_LOG = '.plot/state/refusals.tsv';

const workerAlive = (readings: DeskReadings): boolean =>
  readings.workerPid !== null && readings.workerPid !== '';

const hasUnlandedCommits = (readings: DeskReadings): boolean =>
  readings.unpushed === 'unknown' ||
  (readings.unpushed !== undefined && readings.unpushed.length > 0);

const treeIsClean = (readings: DeskReadings): boolean => readings.dirtyPath === '';

/**
 * Which state a desk is in.
 *
 * Tested in the order a live worker outranks everything: `working` is the
 * only signal describing someone acting right now, so it is read first and
 * whatever else the desk holds is read next pass instead. `finished` follows,
 * read from the host's `mergedAt` and never from ancestry or a PR's `state`
 * (`scripts/check-ancestry-decisions.sh` bans the other reading). The four
 * states after it partition desks whose PR has not merged, by two
 * dimensions — a claim ref and a marker — and `unplaced` is last because it
 * answers a prior question (*is this desk even named?*) rather than one about
 * what the desk holds.
 *
 * `orphaned` means all four hold at once: no live worker, no claim ref, no
 * file-changing commit, clean tree. A missing `claimRef` alone is not
 * `orphaned` — `plot-worker-loop.sh:963-972` read an absent `@{upstream}` as
 * *unknown, keep* and that is the rejected reading this rule replaces.
 *
 * A desk holding a file-changing commit or uncommitted work is never
 * `orphaned`, `refused-empty`, or `finished` — those three are reserved for a
 * desk with nothing left to lose, and work beside a marker reads
 * `refused-with-work` rather than `refused-empty`.
 *
 * @param readings - what was measured of the desk.
 * @returns the state the desk is in.
 */
export const deskState = (readings: DeskReadings): DeskState => {
  if (workerAlive(readings)) return 'working';
  if (!readings.manifestKnown) return 'unplaced';

  // A MARKER OUTRANKS A MERGE. `finished` is the table's own "merged PR, CLEAN
  // tree" — a desk somebody blocked on is not clean, whatever the host says
  // about its PR, so the marker is read before the merge answer rather than
  // after it. A merged desk's marker is still unresolved; reaping past it
  // would discard the question along with the tree.
  if (readings.blockedMarker) {
    return readings.markerRecordsWork ? 'refused-with-work' : 'refused-empty';
  }

  const holdsWork =
    readings.fileChangingCommits > 0 || !treeIsClean(readings) || hasUnlandedCommits(readings);

  if (readings.merge === 'merged' && !holdsWork) return 'finished';
  if (!readings.claimRef && !holdsWork) return 'orphaned';
  if (holdsWork) return 'holding-work';
  // A CLAIMED, clean, unmerged desk with no live worker, no marker and
  // nothing on the floor is not stuck — it is a slice between passes, with a
  // ref that still names it and nothing for a person to decide. Reading it as
  // `holding-work` would report every active branch on the estate as drift,
  // which is the noise the plan's own `NEEDS_A_PERSON` exclusion already
  // named. `working`'s exit — re-read next pass — is what this shape needs:
  // not somebody acting RIGHT NOW, but nothing stuck either.
  return 'working';
};

/**
 * Every state's exit, keyed by {@link DeskState} so the mapping is total and a
 * state added with no exit fails to compile.
 *
 * `finished` and `orphaned` both reap, and differently: a finished desk's
 * checkout is removed outright, while an orphaned one is detached first —
 * `plot-dispatch.sh --release`'s own reading, carried here as the domain's.
 * `refused-empty` copies the marker's text to {@link REFUSALS_LOG} before the
 * reap, because a refusal is evidence even when its desk holds nothing.
 */
const EXITS: Readonly<Record<DeskState, DeskExit>> = {
  working: { kind: 're-read' },
  finished: { kind: 'reap' },
  orphaned: { kind: 'detach-then-reap' },
  'refused-empty': { kind: 'copy-then-reap', destination: REFUSALS_LOG },
  'refused-with-work': {
    kind: 'person',
    reason: 'a PLOT-BLOCKED marker and unlanded work — a person resolves the question and the work',
  },
  'holding-work': {
    kind: 'person',
    reason: 'unlanded work, no live worker — a person decides whether to push it or let it go',
  },
  unplaced: {
    kind: 'person',
    reason: 'no manifest names this desk and no recognised name places it — a person decides what it is',
  },
};

/**
 * The exit a desk state has.
 *
 * Total over {@link DeskState}: every member of the union maps to an exit,
 * which is the plan's own test for the defect it is named for — a state added
 * with no way out.
 *
 * @param state - the state a desk is in.
 * @returns the exit that state has.
 */
export const deskExit = (state: DeskState): DeskExit => EXITS[state];

/**
 * What state a desk is in, and what exits it.
 *
 * @param readings - what was measured of the desk.
 * @returns the state and its exit, together.
 */
export const deskLifecycle = (readings: DeskReadings): { state: DeskState; exit: DeskExit } => {
  const state = deskState(readings);
  return { state, exit: deskExit(state) };
};
