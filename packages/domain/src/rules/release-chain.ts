/**
 * Which merge commit on the default branch carries a plan's PR when that PR's
 * own merge commit is not in the clone and the PR merged into a non-default
 * branch — the follow #2215 adds beside #2201's direct resolve.
 *
 * The caller asks this only after the direct path failed: the plan's merge
 * commit is absent from the clone, so `git tag --contains` cannot place it.
 * The walk then follows the destination branch's own merged PR onward, one
 * host call per hop, until a hop merges into the default branch.
 *
 * THE CALLER RUNS THE I/O; THIS DECIDES EACH STEP. {@link releaseChainStep}
 * reads the trace so far and answers the next branch to ask about, the
 * resolved merge commit, or a refusal. It reads values and awaits nothing.
 *
 * @concept release-chain
 */

/** How many hops a walk may ask about before it is refused rather than followed further. */
export const MAX_RELEASE_CHAIN_DEPTH = 5;

/** Whether one commit contains another: `unknown` where git could not tell. */
export type ReleaseChainContainment = 'yes' | 'no' | 'unknown';

/** One merged PR whose head is the branch a hop asked about. */
export interface ReleaseChainCandidate {
  /** The PR's number. */
  readonly number: number;
  /** The branch the PR merged into. */
  readonly base: string;
  /** The PR's merge commit sha. */
  readonly mergeCommit: string;
  /** When the PR merged, ISO-8601, or `''` where the host did not say. */
  readonly mergedAt: string;
  /**
   * Whether `mergeCommit` contains the commit the previous step reached;
   * `unknown` where either commit is absent from the clone.
   */
  readonly contains: ReleaseChainContainment;
}

/** What asking the host about one branch returned. */
export type ReleaseChainHop =
  | {
      /** The host answered; an empty list means no PR with this head merged. */
      readonly answered: true;
      readonly candidates: readonly ReleaseChainCandidate[];
    }
  | {
      /** The host could not be asked. */
      readonly answered: false;
    };

/** What the caller read before asking. */
export interface ReleaseChainReading {
  /** The default branch; a hop whose PR merged into it ends the walk. */
  readonly defaultBranch: string;
  /** The plan's PR's merge commit — the first commit a hop must carry. */
  readonly planCommit: string;
  /** The branch the plan's PR merged into — the first branch to ask about. */
  readonly destination: string;
  /** The hops asked so far, in walk order. */
  readonly hops: readonly ReleaseChainHop[];
}

/**
 * Why a walk stopped without reaching the default branch: `dead-end` where no
 * merged PR qualifies, `cycle` where the walk reaches a branch it already
 * asked about, `too-deep` where it needs more than
 * {@link MAX_RELEASE_CHAIN_DEPTH} hops, `ambiguous` where several PRs qualify
 * and nothing orders them, and `host-failed` where the host could not be asked.
 */
export type ReleaseChainRefusal = 'dead-end' | 'cycle' | 'too-deep' | 'ambiguous' | 'host-failed';

/** The answer for the trace so far. */
export type ReleaseChainStep =
  | {
      /** Ask the host about `branch`, and test each candidate against `previous`. */
      readonly outcome: 'ask';
      readonly branch: string;
      /** The commit each candidate's merge commit must contain. */
      readonly previous: string;
    }
  | {
      readonly outcome: 'resolved';
      /** The merge commit on the default branch. */
      readonly mergeCommit: string;
    }
  | {
      readonly outcome: 'refused';
      readonly reason: ReleaseChainRefusal;
      /** The branch the walk could not get past. */
      readonly branch: string;
      /** How many candidates qualified, for `ambiguous`; `0` otherwise. */
      readonly candidates: number;
    };

/** The commit and merge time a walk step reached. */
export interface ReleaseChainPrevious {
  /** The commit a candidate must contain. */
  readonly commit: string;
  /** When that commit merged, ISO-8601, or `''` where unknown. */
  readonly mergedAt: string;
}

const timeOf = (iso: string): number => (iso === '' ? Number.NaN : Date.parse(iso));

const earliest = (candidates: readonly ReleaseChainCandidate[]): ReleaseChainCandidate | undefined =>
  [...candidates].sort((a, b) => timeOf(a.mergedAt) - timeOf(b.mergedAt))[0];

/**
 * Picks the merged PR that carried the previous commit onward.
 *
 * A candidate whose merge commit contains the previous commit wins, the
 * earliest-merged where several do. A candidate that does not contain it never
 * qualifies. Where containment is unknown, a candidate qualifies by merging at
 * or after the previous merge, and the earliest wins. With no previous merge
 * time, one candidate of unknown containment qualifies and several are
 * ambiguous.
 *
 * @param candidates - the branch's merged PRs.
 * @param previous - the commit and merge time the previous step reached.
 * @returns the picked candidate, `'none'` where none qualifies, or
 *   `{ ambiguous }` with the count where several qualify and nothing orders them.
 */
export const pickReleaseHop = (
  candidates: readonly ReleaseChainCandidate[],
  previous: ReleaseChainPrevious,
): ReleaseChainCandidate | 'none' | { readonly ambiguous: number } => {
  const proven = candidates.filter((c) => c.contains === 'yes');
  if (proven.length > 0) return earliest(proven) ?? 'none';
  const open = candidates.filter((c) => c.contains === 'unknown');
  const after = timeOf(previous.mergedAt);
  if (Number.isNaN(after)) {
    if (open.length > 1) return { ambiguous: open.length };
    return open[0] ?? 'none';
  }
  return earliest(open.filter((c) => timeOf(c.mergedAt) >= after)) ?? 'none';
};

/**
 * Answers the next step of a release-chain walk.
 *
 * **`ask`** where the trace holds no answer yet for the branch the walk reached.
 * **`resolved`** at the first picked PR that merged into the default branch.
 * **`refused`** naming the branch and the {@link ReleaseChainRefusal}.
 *
 * @param reading - the default branch, the plan's merge commit and destination, and the hops so far.
 * @returns the next step.
 */
export const releaseChainStep = (reading: ReleaseChainReading): ReleaseChainStep => {
  const visited = new Set<string>();
  let branch = reading.destination;
  let previous: ReleaseChainPrevious = { commit: reading.planCommit, mergedAt: '' };
  for (let depth = 0; ; depth += 1) {
    const at = branch;
    const refuse = (reason: ReleaseChainRefusal, candidates = 0): ReleaseChainStep => ({
      outcome: 'refused',
      reason,
      branch: at,
      candidates,
    });
    if (visited.has(at)) return refuse('cycle');
    visited.add(at);
    const hop = reading.hops[depth];
    if (hop === undefined) {
      return depth >= MAX_RELEASE_CHAIN_DEPTH ? refuse('too-deep') : { outcome: 'ask', branch: at, previous: previous.commit };
    }
    if (!hop.answered) return refuse('host-failed');
    const picked = pickReleaseHop(hop.candidates, previous);
    if (picked === 'none') return refuse('dead-end');
    if ('ambiguous' in picked) return refuse('ambiguous', picked.ambiguous);
    if (picked.base === reading.defaultBranch) return { outcome: 'resolved', mergeCommit: picked.mergeCommit };
    previous = { commit: picked.mergeCommit, mergedAt: picked.mergedAt };
    branch = picked.base;
  }
};
