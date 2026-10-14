import type { Issue } from '../entities/issue.js';

/** Where a ticket renders on the Discovery tab; `hidden` until the archived toggle is on. */
export type TicketLane = 'open' | 'in-progress' | 'done' | 'hidden';

/**
 * What else `ticketLane` needs beside the issue itself.
 *
 * Both fields answer questions no `Issue` carries on its own: whether its
 * `statusCategory` is trustworthy, and whether a plan already claims it.
 */
export interface TicketLaneReading {
  /**
   * Whether `issue.statusCategory` came from a tracker whose vocabulary
   * `ticketLane` may trust — true only for Jira. GitHub and Bitbucket derive a
   * category from the state a list was asked for, and that derived value must
   * be ignored rather than read as a stated one.
   */
  categoryStated: boolean;
  /**
   * Whether a plan names this ticket, from `referencedIssues`. `null` when the
   * plans directory could not be read — distinct from `false`, and it wins
   * over every other reading.
   */
  namedByPlan: boolean | null;
}

/** How long a closed ticket stays visible in Done before the archived toggle is required. */
const DONE_WINDOW_MS = 14 * 24 * 60 * 60 * 1000;

/**
 * Which lane a ticket renders in.
 *
 * `reading.namedByPlan === null` is not read here: the caller shows "plans
 * could not be read" for the whole group and keeps its last good lanes, which
 * is a decision about the GROUP rather than one ticket, so it is made above
 * this function rather than inside it.
 *
 * @param issue - the ticket, as the tracker answered it.
 * @param reading - whether its category is trustworthy, and whether a plan names it.
 * @param now - the current time in epoch milliseconds.
 * @returns the lane the ticket renders in.
 */
export const ticketLane = (issue: Issue, reading: TicketLaneReading, now: number): TicketLane => {
  const category = reading.categoryStated ? issue.statusCategory : '';

  if (category === 'Done') return doneOrHidden(issue.closedAt, now);
  if (category === 'In Progress') return 'in-progress';
  if (category === 'To Do') return 'open';

  if (issue.closedAt !== null) return doneOrHidden(issue.closedAt, now);
  return reading.namedByPlan === true ? 'in-progress' : 'open';
};

const doneOrHidden = (closedAt: string | null, now: number): TicketLane => {
  if (closedAt === null) return 'hidden';
  const closed = Date.parse(closedAt);
  if (Number.isNaN(closed)) return 'hidden';
  return now - closed <= DONE_WINDOW_MS ? 'done' : 'hidden';
};

/** How many Done rows render inline before the rest fold behind a count. */
export const DONE_LANE_LIMIT = 20;

/** One ticket as `doneTickets` orders and counts it. */
export interface DoneTicketRow {
  readonly closedAt: string | null;
}

/** The Done lane's rows: the newest `DONE_LANE_LIMIT`, and how many more there are. */
export interface DoneTickets<T> {
  /** The rows to render, newest `closedAt` first; a null `closedAt` sorts last. */
  readonly rows: readonly T[];
  /** How many further rows exist beyond `rows`. */
  readonly moreCount: number;
}

/**
 * Orders the Done lane and caps it at {@link DONE_LANE_LIMIT}.
 *
 * Newest `closedAt` first; a `null` `closedAt` (a hidden ticket the toggle just
 * revealed) sorts after every dated row rather than first or by input order —
 * a ticket with no close date did not just close.
 *
 * @param rows - the Done lane's rows, unordered.
 * @param expanded - whether the cap is lifted: every row is returned, ordered, and `moreCount` is 0.
 * @returns the top {@link DONE_LANE_LIMIT} rows and the count of the rest.
 */
export const doneTickets = <T extends DoneTicketRow>(rows: readonly T[], expanded = false): DoneTickets<T> => {
  const sorted = [...rows].sort((a, b) => {
    if (a.closedAt === null && b.closedAt === null) return 0;
    if (a.closedAt === null) return 1;
    if (b.closedAt === null) return -1;
    return Date.parse(b.closedAt) - Date.parse(a.closedAt);
  });
  if (expanded) return { rows: sorted, moreCount: 0 };
  return { rows: sorted.slice(0, DONE_LANE_LIMIT), moreCount: Math.max(0, sorted.length - DONE_LANE_LIMIT) };
};
