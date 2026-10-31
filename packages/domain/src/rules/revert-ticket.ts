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

/** What the ticket names. */
export interface RevertTicketFacts {
  revertedPr: number;
  /** The reverted PR's head branch; undefined where the host did not list it. */
  revertedBranch: string | undefined;
  /** The plan file whose slices name the branch; `''` where none does; undefined where the plans were not read. */
  plan: string | undefined;
  revertPr: number;
  firstRedSha: string;
}

/**
 * The ticket's `Plan:` value.
 *
 * @param facts - what the ticket names.
 * @returns the plan file, or a sentence that says why there is none.
 */
export const revertTicketPlan = (facts: Pick<RevertTicketFacts, 'revertedBranch' | 'plan'>): string => {
  if (facts.revertedBranch === undefined) return 'not derivable: the branch of the reverted PR was not read';
  if (facts.plan === undefined) return 'not derivable: the plans were not read';
  if (facts.plan === '') return `not derivable: no plan's slices name ${facts.revertedBranch}`;
  return facts.plan;
};

/**
 * The ticket's body: the reverted PR, its plan, the revert PR and the red commit.
 *
 * @param facts - what the ticket names.
 * @returns the body.
 */
export const revertTicketBody = (facts: RevertTicketFacts): string =>
  [
    `PR #${facts.revertedPr} turned the default branch red at ${facts.firstRedSha}. PR #${facts.revertPr} reverted it and merged.`,
    '',
    `Reverted PR: #${facts.revertedPr}`,
    `Branch: ${facts.revertedBranch ?? 'not read'}`,
    `Plan: ${revertTicketPlan(facts)}`,
    `Revert PR: #${facts.revertPr}`,
    '',
    'The change is not delivered. Fix it on a new branch and open a new PR.',
  ].join('\n');
