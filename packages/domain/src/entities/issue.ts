import { z } from 'zod';

/**
 * Whether the tracker could be asked, and what came of asking.
 *
 * Carried once per fetch beside the collection, never on an individual Issue —
 * which, by existing, has already been answered for.
 */
export const IssueAnswerSchema = z.enum(['answered', 'unsupported', 'failed']);
export type IssueAnswer = z.infer<typeof IssueAnswerSchema>;

/**
 * A ticket in a tracker Plot reads and never writes.
 *
 * Identity: a natural key — an opaque string, which fails by the source lying.
 * State: derived, so it goes stale and is re-run.
 *
 * Carries only facts the tracker stated. Tracker state — status, assignee,
 * labels, priority — is deliberately absent: Plot never writes to the tracker,
 * so a mirrored field is wrong between refreshes and wrong forever after an
 * outage.
 */
export interface Issue {
  /** The tracker's own identifier — opaque; equality only, no ordering or arithmetic. */
  id: string;
  /** The title; may be empty, never absent. */
  title: string;
  /** The tracker's address, verbatim; `''` means no address, never composed. */
  url: string;
  /** When the tracker says it was created, ISO-8601; null when it gave none. */
  createdAt: string | null;
  /** The description; null means not fetched, `''` means fetched and empty. */
  body: string | null;
}

/**
 * One fetch of a tracker: what it answered, and whether it could be asked.
 */
export interface IssueFetch {
  /** Whether the tracker could be asked, and what came of asking. */
  answer: IssueAnswer;
  /** The issues returned; empty when the tracker was not asked or answered none. */
  issues: readonly Issue[];
}

/**
 * Whether two identities name the same issue.
 *
 * Equality only: GitHub yields `226` and Jira yields `PROJ-123`, and only one
 * is a number by accident of the host. Comparing them as numbers is what makes
 * a tracker's filter silently always-false.
 *
 * @param one - an issue id.
 * @param other - the id to compare against.
 * @returns true when the identities are the same string.
 */
export const sameIssue = (one: string, other: string): boolean => one === other;

/**
 * Whether an issue's description has been fetched.
 *
 * The list operation omits bodies entirely and only a click fetches one, so an
 * issue with no description must stay distinguishable from one nobody opened.
 *
 * @param issue - the issue to test.
 * @returns true when a body was fetched, including an empty one.
 */
export const bodyWasFetched = (issue: Issue): boolean => issue.body !== null;

/**
 * Whether a fetch's result may be rendered as a list at all.
 *
 * `unsupported` renders no section rather than an empty list: an empty inbox
 * would claim an empty tracker.
 *
 * @param fetch - the fetch to test.
 * @returns true only when the tracker replied.
 */
export const isRenderable = (fetch: IssueFetch): boolean => fetch.answer === 'answered';

/**
 * Whether a fetch's issues are the last good list rather than a current one.
 *
 * @param fetch - the fetch to test.
 * @returns true when the tracker was asked and did not come back.
 */
export const isStale = (fetch: IssueFetch): boolean => fetch.answer === 'failed';
