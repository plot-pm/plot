import type { TicketRecord } from '../entities/ticket-record.js';
import type { ReviewCounts } from './review-verdict.js';

/** The commit-status context the review writes its verdict under. */
export const REVIEW_STATUS_CONTEXT = 'plot/review';

/** The longest commit-status description the host accepts, in characters. */
const DESCRIPTION_CAP = 140;

/**
 * One PR's ticket record read down to what the arms need, for one head.
 *
 * `pending` holds. `opened` carries the tracker's id and whether this head's
 * findings are already on the ticket.
 */
export type TicketReading =
  | { read: 'unread' }
  | { read: 'record'; ticket: 'none' }
  | { read: 'record'; ticket: 'pending' }
  | { read: 'record'; ticket: 'opened'; id: string; coversHead: boolean };

/**
 * Reads a decoded ticket record for one head.
 *
 * @param record - the decoded record, or `'none'`/`'unreadable'`.
 * @param head - the head SHA being asked about.
 * @returns `unread` for an unreadable record, otherwise the record's state.
 */
export const ticketReading = (record: TicketRecord | 'none' | 'unreadable', head: string): TicketReading => {
  if (record === 'unreadable') return { read: 'unread' };
  if (record === 'none') return { read: 'record', ticket: 'none' };
  if (record.ticket === 'pending') return { read: 'record', ticket: 'pending' };
  return { read: 'record', ticket: 'opened', id: record.id, coversHead: record.heads.includes(head) };
};

/**
 * The `plot/review` state a review's counts earn once a ticket may carry a HIGH.
 *
 * A HIGH is accepted only when the ticket is confirmed AND covers this head
 * AND the PR's fixer budget is spent; either alone is not enough.
 *
 * @param counts - the verdict's severity counts.
 * @param ticket - the ticket record read for this head.
 * @param exhausted - whether the PR's fixer attempts are spent.
 * @returns the state and a description within the host's 140-character cap.
 */
export const reviewStatus = (
  counts: ReviewCounts,
  ticket: TicketReading,
  exhausted: boolean,
): { state: 'success' | 'failure'; description: string } => {
  if (counts.high === 0) return { state: 'success', description: 'no HIGH findings' };
  const base = `${counts.high} HIGH finding${counts.high === 1 ? '' : 's'}`;
  if (exhausted && ticket.read === 'record' && ticket.ticket === 'opened' && ticket.coversHead) {
    return { state: 'success', description: `${base}; ticketed ${ticket.id}`.slice(0, DESCRIPTION_CAP) };
  }
  return { state: 'failure', description: base };
};

/**
 * The body of a ticket's first issue or of a later head's comment: the same
 * shape as a review's findings comment, so a reader sees the count and the PR
 * without opening it.
 *
 * @param sha - the reviewed head.
 * @param prUrl - the PR's URL.
 * @param counts - the verdict's counts.
 * @param verdictText - the reviewer's verdict text.
 * @returns the body.
 */
export const ticketFindingsBody = (sha: string, prUrl: string, counts: ReviewCounts, verdictText: string): string =>
  [
    `The reviewer found HIGH ${counts.high}, MEDIUM ${counts.medium}, LOW ${counts.low} on ${prUrl} at ${sha}.`,
    '',
    verdictText.trim(),
  ].join('\n');
