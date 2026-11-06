import type { Issue } from '../entities/issue.js';
import { reviewVerdict, type ReviewCounts } from './review-verdict.js';

/** The label on the finding tickets and revert tickets that fleetd opens. */
export const REVIEW_ISSUE_LABEL = 'ai-generated';

const TITLE_PREFIX = 'plot-review: ';

/**
 * The title of the follow-up issue for a PR.
 *
 * The one place the title format is written; {@link findOpenReviewIssue} reads
 * the suffix this produces. The title names no counts: later heads add comments
 * to the issue and never edit its title, so counts would describe only the
 * first head.
 *
 * @param pr - the PR number.
 * @returns `plot-review: findings on PR #<pr>`.
 */
export const reviewIssueTitle = (pr: number): string => `${TITLE_PREFIX}findings on PR #${pr}`;

/**
 * The open follow-up issue of one PR, among issues that carry the review label.
 *
 * A title matches when it starts with `plot-review: ` and ends with
 * ` on PR #<pr>`, so `PR #1` does not match `PR #12`. The caller passes open
 * issues carrying {@link REVIEW_ISSUE_LABEL}; this function reads titles only.
 *
 * @param issues - the open issues carrying the review label.
 * @param pr - the PR number.
 * @returns the first match in the given order, or null.
 */
export const findOpenReviewIssue = (issues: readonly Issue[], pr: number): Issue | null =>
  issues.find((issue) => issue.title.startsWith(TITLE_PREFIX) && issue.title.endsWith(` on PR #${pr}`)) ?? null;

/** What a recorded verdict says about one finding. */
export type FindingState = 'fixed' | 'not-reproduced' | 'wont-fix' | 'still-true';

/** What {@link reviewTicketSettled} answers about one review finding ticket. */
export type TicketSettlement = 'settled' | 'open' | 'unjudged';

/** The marker of the stay-open comment on a review finding ticket. */
export const TICKET_TRIAGE_MARKER = '<!-- plot:ticket-triage -->';

const FINDING_STATES: readonly FindingState[] = ['fixed', 'not-reproduced', 'wont-fix', 'still-true'];

/** One recorded verdict, read: the default-branch commit and one state per finding. */
export interface TicketVerdict {
  /** The default-branch commit the verdict was judged at. */
  defaultCommit: string;
  /** One entry per finding line, in file order. */
  findings: readonly { title: string; state: FindingState }[];
}

/**
 * Reads a ticket verdict file: a `Default: <commit>` line, then one
 * `- <finding title>: fixed | not-reproduced | wont-fix | still-true` line per
 * finding. Blank lines are ignored.
 *
 * @param text - the verdict file's contents.
 * @returns the verdict, or null where there is no `Default:` commit or any
 *   other line is unreadable.
 */
export const readTicketVerdict = (text: string): TicketVerdict | null => {
  let defaultCommit = '';
  const findings: { title: string; state: FindingState }[] = [];
  for (const line of text.split(/\r?\n/)) {
    if (line.trim() === '') continue;
    const commit = /^Default:\s*(\S+)\s*$/.exec(line)?.[1];
    if (commit !== undefined) {
      if (defaultCommit !== '') return null;
      defaultCommit = commit;
      continue;
    }
    const finding = /^- (.+): (\S+)\s*$/.exec(line);
    const state = FINDING_STATES.find((s) => s === finding?.[2]);
    if (finding === null || state === undefined) return null;
    findings.push({ title: finding[1]!, state });
  }
  return defaultCommit === '' ? null : { defaultCommit, findings };
};

/**
 * Whether a review finding ticket's findings are settled, judged from a
 * recorded verdict only.
 *
 * The signature takes the ticket's body and the verdict file's text and
 * nothing else: no merge, PR, or index state can reach it, so a merge cannot
 * change the answer. `unjudged` means nobody has recorded a complete look;
 * `open` means a complete look found a finding `still-true`.
 *
 * @param ticket - the ticket; its body carries the `Findings: HIGH a, MEDIUM b, LOW c` line.
 * @param verdictText - the verdict file's contents, or null where none exists.
 * @returns `settled` where the verdict has one line per finding the ticket
 *   counts and every line reads `fixed`, `not-reproduced` or `wont-fix`; `open`
 *   where that count holds and a line reads `still-true`; `unjudged` where the
 *   verdict is missing, unreadable, or its count differs from the ticket's.
 */
export const reviewTicketSettled = (ticket: Pick<Issue, 'body'>, verdictText: string | null): TicketSettlement => {
  if (verdictText === null) return 'unjudged';
  const total = ticketTotal(ticket.body);
  const verdict = readTicketVerdict(verdictText);
  if (total === null || verdict === null || verdict.findings.length !== total) return 'unjudged';
  return verdict.findings.some((f) => f.state === 'still-true') ? 'open' : 'settled';
};

/** The ticket's finding total, or null where its body states no `Findings:` line or an out-of-range count. */
const ticketTotal = (body: string | null): number | null => {
  const parsed = reviewVerdict(body ?? '');
  return parsed.read === 'counted' ? parsed.counts.high + parsed.counts.medium + parsed.counts.low : null;
};

/**
 * The stay-open comment for an `open` ticket: the marker, the commit judged,
 * and the findings still true.
 *
 * @param verdict - the verdict that gave `open`.
 * @returns the comment body; identical input gives identical text.
 */
export const ticketStayOpenComment = (verdict: TicketVerdict): string =>
  [
    TICKET_TRIAGE_MARKER,
    `This ticket stays open. Judged at default-branch commit ${verdict.defaultCommit}, these findings are still true:`,
    ...verdict.findings.filter((f) => f.state === 'still-true').map((f) => `- ${f.title}`),
  ].join('\n');
