import { REVIEW_ISSUE_LABEL } from './review-issue.js';

/** The label a revert ticket carries; the one every ticket Plot writes carries. */
export const REVERT_TICKET_LABEL = REVIEW_ISSUE_LABEL;

/** The marker a revert ticket's record keeps in `heads`, so one revert writes one comment. */
export const revertTicketHead = (revertPr: number): string => `revert-${revertPr}`;

/**
 * The ticket's title.
 *
 * @param revertedPr - the PR whose merge was reverted.
 * @returns the title.
 */
export const revertTicketTitle = (revertedPr: number): string => `plot-repair: PR #${revertedPr} was reverted from the default branch`;

/**
 * The plan a branch belongs to, read from its name.
 *
 * @param branch - the reverted PR's head branch, such as `feature/the-slug`.
 * @returns the part after the first `/`, or `''` where the branch has none.
 */
export const planSlugOfBranch = (branch: string): string => {
  const slash = branch.indexOf('/');
  return slash === -1 ? '' : branch.slice(slash + 1);
};

/** What the ticket names. */
export interface RevertTicketFacts {
  revertedPr: number;
  revertedBranch: string;
  revertPr: number;
  firstRedSha: string;
}

/**
 * The ticket's body: the reverted PR, its plan, the revert PR and the red commit.
 *
 * @param facts - what the ticket names.
 * @returns the body.
 */
export const revertTicketBody = (facts: RevertTicketFacts): string => {
  const plan = planSlugOfBranch(facts.revertedBranch);
  return [
    `PR #${facts.revertedPr} turned the default branch red at ${facts.firstRedSha}. PR #${facts.revertPr} reverted it and merged.`,
    '',
    `Reverted PR: #${facts.revertedPr}`,
    `Branch: ${facts.revertedBranch}`,
    `Plan: ${plan === '' ? 'not derivable from the branch name' : plan}`,
    `Revert PR: #${facts.revertPr}`,
    '',
    'The change is not delivered. Fix it on a new branch and open a new PR.',
  ].join('\n');
};
