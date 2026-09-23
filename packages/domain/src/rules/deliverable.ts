import type { FleetReading } from '../entities/fleet.js';

/**
 * The join key this rule needs from a plan — its file path, and nothing else.
 *
 * Structurally typed, so a caller holding a richer plan record passes it
 * unchanged and no cast is needed.
 */
export interface PlanFile {
  /** The plan's path as the parser emitted it; joined on its basename. */
  file: string;
}

/**
 * The last path segment of `file`, ignoring any trailing slashes.
 *
 * Equivalent to `path.basename` on POSIX inputs. Reimplemented because the
 * domain package may import no Node built-in.
 *
 * @param file A POSIX path, absolute or relative.
 * @returns The final segment, or `''` when `file` is empty or only slashes.
 */
const basename = (file: string): string => {
  let end = file.length;
  while (end > 0 && file[end - 1] === '/') end--;
  if (end === 0) return '';
  return file.slice(file.lastIndexOf('/', end - 1) + 1, end);
};

/**
 * What a pulse can say about whether a plan's work has landed.
 *
 * `unknown` and `not-merged` are distinct on purpose: the first means nothing
 * was measured and a caller must wait, the second means the work is measurably
 * outstanding. A caller that collapses them reports absence as a negative.
 */
export type Landed = 'merged' | 'not-merged' | 'unknown';

/**
 * Whether every one of a plan's non-deferred branches has landed.
 *
 * A measurement, not a decision: it asserts only that the code is in, and
 * writes nothing. Merge state is read from the pulse — the scan's resolution
 * against `origin/<main>` — never from the plan file, which carries no merge
 * record. Each slice is judged by its own `verdict`; the branches beneath it
 * are walked only to count what landed. Deferred branches are exempt, matching
 * the scan's rule that a shelved branch is not outstanding work.
 *
 * @param meta The plan, by file path. Matched against the pulse on basename,
 *   because the pulse names plans by their bare filename.
 * @param pulse The scan's report, or `null` when none has been read.
 * @param complete Whether the scan finished. Passed separately because a
 *   partial pulse cannot carry it: the flag sits on the cache entry beside the
 *   pulse, not inside it.
 * @returns `'unknown'` when nothing was measured — no pulse, or an unfinished
 *   scan whose `plans` array holds only what arrived before the timeout.
 *   `'not-merged'` when a finished scan does not name the plan, when any slice
 *   names no branch at all, when any non-deferred slice is not `complete`, or
 *   when the plan has no non-deferred branch at all. `'merged'` when every
 *   non-deferred slice is complete over at least one branch.
 */
export const allSlicesMerged = (
  meta: PlanFile,
  pulse: FleetReading | null,
  complete: boolean,
): Landed => {
  // Asked before the lookup: on a partial pulse an absent plan is one the scan
  // has not reached, which the lookup alone cannot tell from a real absence.
  if (!pulse || !complete) return 'unknown';
  const plan = pulse.plans.find((p) => p.file === basename(meta.file));
  if (!plan) return 'not-merged';
  let merged = 0;
  // WORK GIVEN UP, counted apart from work that landed.
  //
  // A deferred branch means the work is NOT DONE HERE — built elsewhere,
  // folded into another branch, or abandoned. The annotation does not say
  // which, and this rule does not ask: all three mean nothing is coming on
  // that branch, which is what makes the plan finishable.
  //
  // It is counted rather than ignored because `merged` alone cannot separate
  // *a plan whose work was given up* from *a plan nobody built* — both reach
  // the end with `merged === 0`, and the second is what the final guard is
  // for. Measured 2026-09-22 on this estate: ten plans carry only deferred
  // slices and four of them reached `Released`, every one delivered by
  // `plot-deliver.sh`, which has always read the annotation this way.
  let deferred = 0;
  for (const slice of plan.slices) {
    const branches = slice.branches.filter((b) => b.state !== 'deferred');
    // A SLICE NAMING NO BRANCH IS NOT LANDED WORK, and it is refused here
    // rather than skipped. `continue` and `eligible`'s `complete` were the two
    // answers this shape had, and they disagreed: one plan could not be
    // delivered on a prose heading while the other reported the heading
    // finished. `sliceVerdict` now says `empty` for it, and the same word is
    // what this rule tests — so the two read one fact and reach one answer.
    //
    // Deferred branches are still exempt. A slice holding only deferred
    // branches names work somebody gave up, which is a decision; a slice
    // holding none names no work at all, which is a malformed plan.
    if (slice.branches.length === 0) return 'not-merged';
    deferred += slice.branches.length - branches.length;
    if (branches.length === 0) continue;
    if (slice.verdict !== 'complete') return 'not-merged';
    merged += branches.length;
  }
  // A PLAN THAT NAMES NO WORK IS NOT DELIVERABLE, which is the only case this
  // guard now refuses: `merged + deferred` is zero exactly when every slice
  // named no branch at all. A plan whose branches were all given up names
  // work and has an answer about it.
  return merged + deferred > 0 ? 'merged' : 'not-merged';
};
