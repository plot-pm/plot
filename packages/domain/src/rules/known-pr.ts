import type { Pr } from '../entities/pr.js';
import type { PrIndex, PrIndexRow } from '../entities/pr-index.js';
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
 * - `index` — the PR index holds a merged row for the branch. A merged PR
 *   cannot revert, so the row is an answer whatever the listing says.
 * - `listing` — the merged listing answered whole, and its rows decide.
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
 * Whether an index row records a merged, non-draft PR.
 *
 * @param row - one row of the PR index.
 * @returns true where the row's state is `MERGED`, in either case, and the PR
 *   is not a draft.
 */
const isMergedRow = (row: PrIndexRow): boolean => row.state.toUpperCase() === 'MERGED' && !row.draft;

/**
 * Every head the PR index holds a merged, non-draft row for.
 *
 * The merged listing answers one page of the host's newest merged PRs, so a
 * branch merged further back is missing from a listing that answered whole.
 * A merged row is a terminal answer and settles the branch. Any other row, and
 * a missing row, settles nothing.
 *
 * @param rows - the index's rows; empty where there is no index.
 * @returns the heads with a merged row.
 */
export const indexMergedHeads = (rows: readonly PrIndexRow[]): ReadonlySet<string> =>
  new Set(rows.filter(isMergedRow).map((row) => row.head));

/**
 * How much overlap a merged-set delta asks for, beyond the stored watermark.
 *
 * `updated:>` is exclusive on both hosts, so a PR updated in the same second
 * as the watermark would otherwise be missed until the next full read. One
 * {@link MERGED_DELTA_OVERLAP_MS} covers that same-second case plus one
 * refresh interval of host-side ordering skew, at the cost of re-reading at
 * most a minute's worth of merges — comfortably under a 500-row page.
 */
export const MERGED_DELTA_OVERLAP_MS = 60_000;

/** What a merged-set read may ask the host for. */
export type MergedSetWindow = { kind: 'delta'; since: string } | { kind: 'full' };

/**
 * Decides whether a merged-set read may narrow against the PR index, or must
 * ask the host for everything.
 *
 * **A SIBLING OF {@link import('./pr-index.js').prWindowFor}, NOT A CALL TO
 * IT, AND THE DIVERGENCE IS DELIBERATE.** Both answer *full or delta against
 * the stored watermark*, and both refuse on a missing store, a missing or
 * empty watermark, and `complete: false`. They diverge on the fourth
 * question: `prWindowFor` asks *is the daily full read due BY AGE*, stretched
 * by a failure grace, because a refresh's own cadence is a 24-hour clock this
 * caller does not run. This rule asks nothing about age at all — a current,
 * complete, watermarked store answers `delta` regardless of how long ago it
 * was last whole, because a merged-set read costs nothing by staying narrow
 * forever; the daily full read that would notice a deleted PR is
 * `prWindowFor`'s job, not this one's. So this rule takes no `now` either —
 * every question it answers is about the STORE, never about this machine's
 * clock. Sharing the refusal ladder and adding an age clock neither needs
 * would hide a THIRD function inside one that reads two unrelated settings;
 * two short rules, each naming its own question, is the one this corpus does
 * not drift out of sync by accident.
 *
 * @param held - the store as it was read, or null where there was none.
 * @returns `full` where the store cannot be narrowed against; `delta` with
 *   the host's own watermark minus {@link MERGED_DELTA_OVERLAP_MS}, rendered
 *   in the host's stamp format, otherwise.
 */
export const mergedSetWindowFor = (held: PrIndex | null): MergedSetWindow => {
  const full: MergedSetWindow = { kind: 'full' };
  if (held === null) return full;
  if (held.watermark === null || held.watermark === '') return full;
  if (!held.complete) return full;
  const watermarkMs = Date.parse(held.watermark);
  if (Number.isNaN(watermarkMs)) return full;
  return { kind: 'delta', since: new Date(watermarkMs - MERGED_DELTA_OVERLAP_MS).toISOString().replace(/\.\d{3}Z$/, 'Z') };
};

/**
 * What the PR index knows about a branch.
 *
 * @param rows - the index's rows; empty where there is no index.
 * @param branch - the branch to look up by head.
 * @returns whether a merged row exists, and the newest number for the head.
 */
export const knownPrFor = (rows: readonly PrIndexRow[], branch: string): KnownPr => {
  const own = rows.filter((row) => row.head === branch);
  const indexMerged = own.some(isMergedRow);
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
  if (known.indexMerged) return 'index';
  if (listAnswered) return 'listing';
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
