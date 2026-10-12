/** One branch of a slice, as the plan parser reports it. */
export interface SpikeBranch {
  /** The branch name. */
  branch: string;
  /** Whether the branch line carries `<!-- spike -->`; absent where the parser did not report it. */
  spike?: boolean;
}

/** One slice of a plan, as the plan parser reports it. */
export interface SpikeSlice {
  /** The slice's heading; absent for a plan with no sub-headings. */
  name?: string;
  /** The slice's branches, in document order. */
  branches: readonly SpikeBranch[];
}

/** The slice a plan names as its spike. */
export interface Spike {
  /** The annotated branch. */
  branch: string;
  /** Zero-based position of its slice in the plan. */
  slice: number;
}

/**
 * The spike a plan names, or nothing where no branch or more than one branch
 * carries the annotation.
 *
 * Answers from slice data already parsed: it reads the `spike` flag each branch
 * carries and never re-reads a branch line. A plan with more than one annotated
 * branch has no spike. `undefined` means the plan named no spike, named more
 * than one, or the parser reported no flag; it never stands for `false`.
 *
 * @param slices - the plan's slices in document order.
 * @returns the one annotated branch with its slice position, or undefined.
 */
export const spikeOf = (slices: readonly SpikeSlice[]): Spike | undefined => {
  const found = slices.flatMap(({ branches }, slice) =>
    branches.filter((b) => b.spike === true).map((b) => ({ branch: b.branch, slice })));
  return found.length === 1 ? found[0] : undefined;
};
