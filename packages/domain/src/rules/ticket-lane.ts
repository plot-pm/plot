import type { Issue } from '../entities/issue.js';
import type { TicketPlan } from './ticket-phase.js';

/** Where a ticket renders on the Discovery tab; `hidden` until the archived toggle is on. */
export type TicketLane = 'open' | 'in-progress' | 'done' | 'hidden';

/**
 * What else `ticketLane` needs beside the issue itself.
 *
 * Both fields answer questions no `Issue` carries on its own: whether its
 * `statusCategory` is trustworthy, and which plans already claim it.
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
   * The plans naming this ticket, from `planMetasAtDefault`. `null` when the
   * plans could not be read — distinct from `[]`, and it wins over every
   * other reading.
   */
  plans: readonly TicketPlan[] | null;
}

/** How long a closed ticket stays visible in Done before the archived toggle is required. */
const DONE_WINDOW_MS = 14 * 24 * 60 * 60 * 1000;

/**
 * The lane a plan's state places an open, uncategorized ticket in, by
 * {@link ticketPhase}'s own order — draft/design are not yet building, approved
 * is building, delivered is done. `released`, `rejected` and `superseded` are
 * absent on purpose: none of them is a live claim on the ticket, so a plan in
 * one of those states is not a candidate for the "least advanced plan wins"
 * choice below, the same way `ticketPhase`'s own `PLACED` table skips them.
 */
const LANE_BY_STATE: Readonly<Record<string, { lane: TicketLane; rank: number }>> = {
  draft: { lane: 'open', rank: 0 },
  design: { lane: 'open', rank: 1 },
  approved: { lane: 'in-progress', rank: 2 },
  delivered: { lane: 'done', rank: 3 },
};

/**
 * The lane an open, uncategorized ticket's named plans place it in.
 *
 * The LEAST ADVANCED placed plan decides, by {@link LANE_BY_STATE}'s rank —
 * mirroring `ticketPhase`'s own "least advanced plan wins" order rather than
 * inventing a second one. A plan in `released`, `rejected` or `superseded`
 * does not place (no live claim), so an issue named ONLY by such plans reads
 * exactly as an issue no live plan names: `open`.
 */
const laneByPlans = (plans: readonly TicketPlan[]): TicketLane => {
  let best: { lane: TicketLane; rank: number } | null = null;
  for (const plan of plans) {
    const placed = LANE_BY_STATE[plan.state];
    if (placed === undefined) continue;
    if (best === null || placed.rank < best.rank) best = placed;
  }
  return best?.lane ?? 'open';
};

/**
 * Which lane a ticket renders in.
 *
 * `reading.plans === null` is not read here: the caller shows "plans could
 * not be read" for the whole group and keeps its last good lanes, which is a
 * decision about the GROUP rather than one ticket, so it is made above this
 * function rather than inside it.
 *
 * @param issue - the ticket, as the tracker answered it.
 * @param reading - whether its category is trustworthy, and which plans name it.
 * @param now - the current time in epoch milliseconds.
 * @returns the lane the ticket renders in.
 */
export const ticketLane = (issue: Issue, reading: TicketLaneReading, now: number): TicketLane => {
  const category = reading.categoryStated ? issue.statusCategory : '';

  if (category === 'Done') return doneOrHidden(issue.closedAt, now);
  if (category === 'In Progress') return 'in-progress';
  if (category === 'To Do') return 'open';

  if (issue.closedAt !== null) return doneOrHidden(issue.closedAt, now);
  return laneByPlans(reading.plans ?? []);
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
