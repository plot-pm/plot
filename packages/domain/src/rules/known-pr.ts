import type { Pr } from '../entities/pr.js';
import type { PrIndexRow } from '../entities/pr-index.js';
import { sliceVerdicts } from './eligible.js';
import type { LandedAnswer } from './landed.js';

/**
 * How many single-PR lookups by number one pass may make.
 *
 * One lookup costs about 10 s on the slowest connector measured, so five keep
 * a pass inside the supervisor's 60 s interval. The cap applies only while
 * the merged listing has failed.
 */
export const VIEWS_PER_PASS = 5;

/**
 * Which reading answers *did this branch land*.
 *
 * - `listing` — the merged listing answered whole, and its rows decide.
 * - `index` — the listing failed, and the PR index holds a merged row for the
 *   branch. A merged PR cannot revert, so the row is an answer.
 * - `number` — the listing failed, and a PR number is known for the branch.
 *   One lookup by that number answers.
 * - `none` — the listing failed, and nothing names a PR for the branch.
 */
export type LandedSource = 'listing' | 'index' | 'number' | 'none';

/** What the PR index knows about one branch. */
export interface KnownPr {
  /** Whether the index holds a merged, non-draft row for the branch. */
  indexMerged: boolean;
  /** The newest PR number the index holds for the branch, or null. */
  number: number | null;
}

/** A PR lookup by number: the PR, `null` where the host holds none, or no answer. */
export type ViewReading = Pick<Pr, 'state' | 'mergedAt'> | null | 'unanswered';

/** One branch line of a slice, as the plan names it. */
export interface SliceLine {
  /** The branch name. */
  branch: string;
  /** Whether the plan gave the branch up. */
  deferred: boolean;
}

/**
 * What the PR index knows about a branch.
 *
 * @param rows - the index's rows; empty where there is no index.
 * @param branch - the branch to look up by head.
 * @returns whether a merged row exists, and the newest number for the head.
 */
export const knownPrFor = (rows: readonly PrIndexRow[], branch: string): KnownPr => {
  const own = rows.filter((row) => row.head === branch);
  const indexMerged = own.some((row) => row.state.toUpperCase() === 'MERGED' && !row.draft);
  const number = own.reduce<number | null>(
    (newest, row) => (newest === null || row.number > newest ? row.number : newest),
    null,
  );
  return { indexMerged, number };
};

/**
 * Chooses the reading that answers *did this branch land*.
 *
 * @param listAnswered - whether the merged listing answered whole.
 * @param known - what the PR index knows about the branch.
 * @returns the source to read.
 */
export const landedSource = (listAnswered: boolean, known: KnownPr): LandedSource => {
  if (listAnswered) return 'listing';
  if (known.indexMerged) return 'index';
  return known.number === null ? 'none' : 'number';
};

/**
 * Reads a lookup by number as a landing answer.
 *
 * @param view - what the lookup returned.
 * @returns `landed` where the host reports the PR merged, by its state or its
 *   merge time; `not-landed` where it answered otherwise or holds no such PR;
 *   `unknown` where it did not answer.
 */
export const viewLanded = (view: ViewReading): LandedAnswer => {
  if (view === 'unanswered') return 'unknown';
  if (view === null) return 'not-landed';
  return view.state === 'MERGED' || view.mergedAt !== null ? 'landed' : 'not-landed';
};

/**
 * The branches whose landing decides whether a plan's queue moves.
 *
 * These are the unsettled branches of the plan's first slice that is not
 * complete, and only where that slice is `eligible`. A later slice waits on
 * this one, and an unapproved or empty slice moves on no landing.
 *
 * @param phase - the plan's phase, as the parser emits it.
 * @param slices - the plan's slices, in plan order.
 * @param settled - whether a branch is already claimed or known merged.
 * @returns the branches to ask about, in plan order; empty where none decide.
 */
export const blockingBranches = (
  phase: string,
  slices: readonly (readonly SliceLine[])[],
  settled: (branch: string) => boolean,
): readonly string[] => {
  const open = slices.map((lines) =>
    lines.filter((line) => !line.deferred && !settled(line.branch)).map((line) => line.branch),
  );
  const verdicts = sliceVerdicts(
    slices.map((lines, index) => ({ outstanding: open[index].length, phase, branches: lines.length })),
  );
  const first = verdicts.findIndex((verdict) => verdict !== 'complete');
  return first !== -1 && verdicts[first] === 'eligible' ? open[first] : [];
};
