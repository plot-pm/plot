import type { IssueAnswer } from '../entities/issue.js';

/** How many rows of the Tickets section show before the fold. */
export const TICKETS_SHOWN = 5;

/** The DOM id the section's anchor carries; plans 1 and 2's `triage` links point at it. */
export const TICKETS_ANCHOR = 'tickets';

/** Why the control of the section's *Plan it ›* refuses; `null` where it acts. */
export type PlanItReason = 'tracker-unsupported' | 'tracker-failed' | 'unavailable';

/** What the Tickets section reads and the reader chose. */
export interface TicketsSectionInput<T> {
  /** Whether the tracker answered; `null` where nobody asked. */
  answer: IssueAnswer | null;
  /** The open, unplanned tickets assigned to the reader, newest first. */
  assigned: readonly T[];
  /** The open, unplanned tickets of nobody or of someone else, newest first. */
  others: readonly T[];
  /** The count of unassigned tickets as the waiting read reports it; `null` where it carries none. */
  unassigned: number | null;
  /** Whether *show all* is open. */
  showAll: boolean;
  /** Whether the fold is open. */
  foldOpen: boolean;
}

export interface TicketsSection<T> {
  /** `rows` where the tracker answered; otherwise the absent reading, which carries no count. */
  state: 'rows' | 'failed' | 'unsupported' | 'unasked';
  /** The header text before the *show all* control; `null` for an absent reading. */
  header: string | null;
  /** Whether the *show all* control shows: the read carries unassigned tickets or others to open. */
  showAllControl: boolean;
  /** The rows to render now, in order: the reader's, then the others where *show all* is open. */
  rows: readonly T[];
  /** The rows the fold holds back, and the label of its control; `null` where nothing folds. */
  folded: number;
  foldLabel: string | null;
}

/**
 * Decides what the Tickets section shows.
 *
 * The header reads `<n> assigned to you with no plan · <n> more unassigned`,
 * with `<n> more unassigned` the waiting read's own count and absent where the
 * read carries none. Where the tracker did not answer, the section names the
 * absence and carries no count: an absent reading is not `0`. The reader's rows
 * come first; *show all* appends the others. The first `TICKETS_SHOWN` rows
 * show and the rest fold behind `… n more · show`.
 *
 * @param input - the tickets, the count and the two toggles.
 * @returns the state, header, visible rows and fold.
 */
export const ticketsSection = <T>(input: TicketsSectionInput<T>): TicketsSection<T> => {
  if (input.answer !== 'answered') {
    const state = input.answer === null ? 'unasked' : input.answer;
    return { state, header: null, showAllControl: false, rows: [], folded: 0, foldLabel: null };
  }
  const unassignedPart = input.unassigned === null ? '' : ` · ${input.unassigned} more unassigned`;
  const header = `${input.assigned.length} assigned to you with no plan${unassignedPart}`;
  const all = input.showAll ? [...input.assigned, ...input.others] : [...input.assigned];
  const rows = input.foldOpen ? all : all.slice(0, TICKETS_SHOWN);
  const folded = all.length - Math.min(all.length, TICKETS_SHOWN);
  return {
    state: 'rows',
    header,
    showAllControl: input.others.length > 0 || (input.unassigned ?? 0) > 0,
    rows,
    folded,
    foldLabel: folded === 0 ? null : `… ${folded} more · ${input.foldOpen ? 'hide' : 'show'}`,
  };
};

/**
 * Why *Plan it ›* refuses for a ticket, or `null` where it acts.
 *
 * @param answer - whether the tracker could be asked; `null` before the first read.
 * @param available - whether this board will spawn the `idea` controller.
 */
export const planItReason = (answer: IssueAnswer | null, available: boolean): PlanItReason | null => {
  if (answer === 'unsupported') return 'tracker-unsupported';
  if (answer === 'failed') return 'tracker-failed';
  return available ? null : 'unavailable';
};
