import type { Containment } from '../ports/refs.js';

/** One entry of a tree listing, as `Refs.listBlobs` answers it. */
export interface BranchPlanBlob {
  readonly path: string;
  readonly sha: string;
  readonly mode: string;
}

/** One prefixed branch, its containment in the default branch, and its plan directory's listing. */
export interface BranchPlanTree {
  readonly branch: string;
  /** Whether the default branch contains the branch's tip. */
  readonly merged: Containment;
  /** The branch's plan-directory listing; `null` where it was not listed, which only a merged branch may be. */
  readonly blobs: readonly BranchPlanBlob[] | null;
}

/** One plan file a branch carries and the default branch does not. */
export interface BranchPlanRef {
  readonly branch: string;
  readonly path: string;
  readonly sha: string;
}

/**
 * Whether a listing entry is a plan file: a regular blob ending in `.md`, never
 * the symlink an index directory holds.
 *
 * @param blob - one listing entry.
 * @returns true for a plan file.
 */
export const isPlanBlob = (blob: BranchPlanBlob): boolean =>
  (blob.mode === '100644' || blob.mode === '100755') && blob.path.endsWith('.md');

/**
 * Selects the plan files on prefixed branches that the default branch does
 * not hold: the Draft plans.
 *
 * A branch the default branch contains is skipped. A path the default branch
 * (or the state ref) holds is skipped. A path two branches carry is taken from
 * the first branch in `branches` order.
 *
 * @param branches - the prefixed branches, in listing order.
 * @param onDefault - the plan paths the default branch holds.
 * @returns the selected files, in branch order and listing order.
 */
export const branchPlanSet = (
  branches: readonly BranchPlanTree[],
  onDefault: ReadonlySet<string>,
): BranchPlanRef[] => {
  const seen = new Set<string>();
  const picked: BranchPlanRef[] = [];
  for (const { branch, merged, blobs } of branches) {
    if (merged === 'yes' || blobs === null) continue;
    for (const blob of blobs) {
      if (!isPlanBlob(blob) || onDefault.has(blob.path) || seen.has(blob.path)) continue;
      seen.add(blob.path);
      picked.push({ branch, path: blob.path, sha: blob.sha });
    }
  }
  return picked;
};
