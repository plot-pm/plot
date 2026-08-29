import { z } from 'zod';

/** What the host says a PR's state is. Not trustworthy alone. */
export const PrStateSchema = z.enum(['OPEN', 'MERGED', 'CLOSED']);
export type PrState = z.infer<typeof PrStateSchema>;

/**
 * Whether the PR merges cleanly.
 *
 * `unknown` is not `clean`: Bitbucket cannot answer it at all, and every
 * payload written before the field existed reports the same.
 */
export const MergeabilitySchema = z.enum(['mergeable', 'conflicting', 'unknown']);
export type Mergeability = z.infer<typeof MergeabilitySchema>;

/**
 * The Build, summarized onto the PR.
 *
 * `none` and `unknown` are different: no run exists against nobody could ask.
 */
export const ChecksSchema = z.enum(['green', 'pending', 'failing', 'none', 'unknown']);
export type Checks = z.infer<typeof ChecksSchema>;

/** The review verdict; informational only, and `''` when there is none. */
export const ReviewVerdictSchema = z.enum(['APPROVED', 'CHANGES_REQUESTED', 'REVIEW_REQUIRED', '']);
export type ReviewVerdict = z.infer<typeof ReviewVerdictSchema>;

/**
 * A branch's bid to land, and afterwards the evidence that it did.
 *
 * Identity: a natural key — the `repo` and `number` pair, which fails by the
 * source lying. State: foreign, so askability is carried apart from the answer.
 */
export interface Pr {
  /** The number, unique within `repo`. */
  number: number;
  /** `owner/repo`, or `''` where the PR is in this repo. */
  repo: string;
  /** The branch this PR belongs to. */
  head: string;
  /** What the host says; see `prHasLanded` for why this is not enough. */
  state: PrState;
  /** When it merged, ISO-8601, or null — the truth about landing. */
  mergedAt: string | null;
  /** The merge commit sha; `''` for anything unmerged. */
  mergeCommit: string;
  /** Whether it is still a draft rather than asking for review. */
  draft: boolean;
  /** Whether it merges cleanly — a separate question from `checks`. */
  mergeable: Mergeability;
  /** The review verdict; informational only. */
  review: ReviewVerdict;
  /** The build, summarized. */
  checks: Checks;
  /** Which checks are failing — names only; nothing interprets them. */
  failingChecks: readonly string[];
  /** The host's URL, verbatim; `''` renders as plain text. */
  url: string;
}

/**
 * Whether this PR landed.
 *
 * Reads `mergedAt` and never `state`: a merged PR reports `CLOSED` on the
 * host's REST surface while GraphQL reports `MERGED`, so the state word answers
 * a different question from the one being asked. Ancestry is no better — a
 * squash-merge leaves the branch permanently ahead of the default branch.
 *
 * @param pr - the PR to test.
 * @returns true when the host recorded a merge time.
 */
export const prHasLanded = (pr: Pr): boolean => pr.mergedAt !== null;

/**
 * Whether any of a branch's PRs landed.
 *
 * Asks across every PR rather than the newest: one branch here carries ten, and
 * reading only the latest reported three branches unlanded whose work was on
 * the default branch, each masked by a duplicate the fleet opened itself.
 *
 * @param prs - every PR known for one branch.
 * @returns true when at least one of them merged.
 */
export const branchHasLanded = (prs: readonly Pr[]): boolean => prs.some(prHasLanded);

/**
 * Whether a PR is open and still asking to land.
 *
 * @param pr - the PR to test.
 * @returns true when it has not merged and the host has not closed it.
 */
export const prIsOpen = (pr: Pr): boolean => !prHasLanded(pr) && pr.state === 'OPEN';

/**
 * Whether an empty check rollup is explained by the PR not merging cleanly.
 *
 * The host starts no workflow for a PR that does not merge cleanly, so a
 * conflicting PR reports `checks: 'none'` — indistinguishable from a bot PR
 * whose run is waiting for a human to approve it. `mergeable` is what tells
 * them apart, which is why it is asked separately.
 *
 * @param pr - the PR to test.
 * @returns true when there are no checks because the PR conflicts.
 */
export const checksAreEmptyBecauseConflicting = (pr: Pr): boolean =>
  pr.checks === 'none' && pr.mergeable === 'conflicting';
