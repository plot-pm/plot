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
 *   `'not-merged'` when a finished scan does not name the plan, when any
 *   non-deferred slice is not `complete`, or when the plan has no non-deferred
 *   branch at all. `'merged'` when every non-deferred slice is complete over at
 *   least one branch.
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
  for (const slice of plan.slices) {
    const branches = slice.branches.filter((b) => b.state !== 'deferred');
    if (branches.length === 0) continue;
    if (slice.verdict !== 'complete') return 'not-merged';
    merged += branches.length;
  }
  // Every slice complete over no branches at all is a plan nobody built.
  return merged > 0 ? 'merged' : 'not-merged';
};
