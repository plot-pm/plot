/**
 * One branch a heading names, carrying what the chain rule reads.
 *
 * Structurally typed so a caller holding a richer branch record — the
 * parser's `deferred`, `claimed`, `builds` — passes it unchanged.
 */
export interface ChainedBranchLine {
  /** The branch name. */
  branch: string;
  /**
   * Every branch this one waits on, as the plan's `waits:` annotation names
   * them. Absent or empty means the branch waits on nothing.
   */
  waits_on?: readonly string[];
}

/**
 * Whether a heading's branches form one `waits:` chain, each branch waiting
 * for the branch immediately before it in the heading.
 *
 * A heading of one branch is a chain of one and never counts as uncut: the
 * question only arises once a heading holds more than one branch line.
 *
 * ORDER IS THE LINE ORDER, not a graph search over `waits_on`. A branch at
 * line N chains only onto the branch at line N-1 by name; a branch that waits
 * on an earlier-but-not-immediately-preceding line, or on nothing, breaks the
 * chain at that point. This matches the chained heading on this estate at the
 * time of writing — `manifest-retry-and-race-findings`'s `### Start and
 * stop` — where the plan always lists a branch after what it waits on, and
 * keeps the rule a line-by-line check rather than a dependency-graph one.
 *
 * A `waits:` target naming a branch under a DIFFERENT heading does not chain
 * the two lines under this one: the heading itself is what a slice should
 * hold one of, so a branch whose only prerequisite lives elsewhere still
 * leaves this heading's lines unlinked to each other.
 *
 * @param branches - the heading's branch lines, in plan order.
 * @returns whether every branch but the first waits on exactly the branch
 *   immediately before it.
 */
export const isChainedHeading = (branches: readonly ChainedBranchLine[]): boolean => {
  if (branches.length <= 1) return true;
  for (let i = 1; i < branches.length; i++) {
    const waits = branches[i]!.waits_on ?? [];
    if (!waits.includes(branches[i - 1]!.branch)) return false;
  }
  return true;
};
