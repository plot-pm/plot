/**
 * Which tag shipped a plan's PR when its merge commit sits on a non-default
 * branch deleted after its own merge — the follow #2215 adds beside #2201's
 * direct resolve.
 *
 * A PR MAY MERGE INTO A BRANCH THAT IS NOT THE DEFAULT ONE, and that branch
 * may itself be merged onward and deleted. The merge commit the first PR
 * names then sits on a ref no clone holds — not because the PR's OWN source
 * branch was deleted (#2201's case, resolved directly with no walk), but
 * because its DESTINATION was. The release is still knowable by following the
 * destination branch's own merged PR, repeating until the trail reaches the
 * default branch or runs out.
 *
 * THE SHELL COLLECTS THE TRACE; THIS CLASSIFIES IT. Each hop needs one host
 * call (`plot-host.sh pr-merge-dest <branch>`), so the walk's I/O stays in
 * `plot-reconcile-scan.sh` and only the decision — resolved, dead end, or
 * cycle/too-deep — is asked of this pure function, per `docs/shell-and-domain.md`'s
 * rule for a lookup run once per operator command.
 *
 * @concept release-chain
 */

/** One step of the walk: a branch the trail reached, and what naming its merged PR found. */
export type ReleaseChainHop =
  | {
      /** The branch this hop asked about. */
      readonly branch: string;
      /** A merged PR was found with this head. */
      readonly found: true;
      /** That PR's number. */
      readonly number: string;
      /** That PR's destination branch. */
      readonly base: string;
      /** That PR's merge commit sha. */
      readonly mergeCommit: string;
    }
  | {
      readonly branch: string;
      /** No merged PR was found with this head — the trail ends here. */
      readonly found: false;
    };

/** What the caller read before asking: the default branch, and the walk's trace in order. */
export interface ReleaseChainReading {
  /** The default branch; a hop whose `base` equals this ends the walk successfully. */
  readonly defaultBranch: string;
  /**
   * The hops asked, in walk order — the first hop's `branch` is the plan's PR's
   * own (deleted) destination, and each later hop's `branch` is the previous
   * hop's `base`.
   */
  readonly hops: readonly ReleaseChainHop[];
}

/** How many hops a walk may take before it is refused rather than followed further. */
export const MAX_RELEASE_CHAIN_DEPTH = 5;

/** The chain's outcome: resolved to a merge commit on the default branch, or refused naming why. */
export type ReleaseChainResult =
  | { readonly outcome: 'resolved'; readonly mergeCommit: string }
  | {
      readonly outcome: 'refused';
      readonly reason: 'dead-end' | 'cycle' | 'too-deep';
      /** The branch the walk could not get past. */
      readonly branch: string;
    };

/**
 * Classifies a release chain's walk trace.
 *
 * **RESOLVED** at the first hop whose `base` is the default branch — its
 * `mergeCommit` is the commit `git tag --contains` can be asked about.
 *
 * **`dead-end`** at the first hop with no merged PR: the branch was deleted
 * with nothing naming where its work went on to.
 *
 * **`cycle`** where a hop's branch repeats one already walked — two merged
 * branches naming each other as destination, which `git tag --contains` could
 * not break out of either.
 *
 * **`too-deep`** where the trace exceeds {@link MAX_RELEASE_CHAIN_DEPTH} hops
 * with neither of the above — a long chain the walk declines to keep
 * following rather than one judged unresolvable.
 *
 * @param reading - the default branch and the walk's hops, in order.
 * @returns the resolved merge commit, or a refusal naming the branch and why.
 */
export const releaseChain = (reading: ReleaseChainReading): ReleaseChainResult => {
  const visited = new Set<string>();
  for (const [index, hop] of reading.hops.entries()) {
    if (visited.has(hop.branch)) {
      return { outcome: 'refused', reason: 'cycle', branch: hop.branch };
    }
    visited.add(hop.branch);
    if (index >= MAX_RELEASE_CHAIN_DEPTH) {
      return { outcome: 'refused', reason: 'too-deep', branch: hop.branch };
    }
    if (!hop.found) {
      return { outcome: 'refused', reason: 'dead-end', branch: hop.branch };
    }
    if (hop.base === reading.defaultBranch) {
      return { outcome: 'resolved', mergeCommit: hop.mergeCommit };
    }
  }
  // An empty trace, or one whose last hop neither resolved nor refused — the
  // shell stopped collecting without reaching either, which this treats as the
  // walk going nowhere rather than guessing a verdict it was not given.
  const last = reading.hops[reading.hops.length - 1];
  return { outcome: 'refused', reason: 'too-deep', branch: last?.branch ?? '' };
};
