import { doneTickets, ticketLane } from '@plot-pm/domain';

/** One ticket as the Discovery tab's lane groups carry it. */
export interface TicketRow {
  readonly id: string;
  readonly title: string;
  readonly url: string;
  readonly createdAt: string | null;
  readonly body: null;
  readonly status: string;
  readonly statusCategory: string;
  readonly closedAt: string | null;
}

/** The Discovery tab's ticket lanes. */
export interface TicketLaneGroups {
  readonly open: TicketRow[];
  readonly 'in-progress': TicketRow[];
  readonly done: readonly TicketRow[];
  readonly moreCount: number;
}

/** The issue-index fields `groupTicketLanes` reads from one row. */
export interface TicketSourceRow {
  readonly number: string;
  readonly title: string;
  readonly url: string;
  readonly createdAt?: string | null;
  readonly status?: string | null;
  readonly statusCategory?: string | null;
  readonly closedAt?: string | null;
}

/**
 * Groups open and closed tracker rows into the Discovery tab's ticket lanes.
 *
 * Both `open` and `closed` are always laned: the Done lane shows the tickets
 * closed in the last 14 days, capped at 20, whatever `archived` says. `archived`
 * only lifts that window and cap, so the Done lane holds every closed row read.
 *
 * @param open - the open rows of the issue index.
 * @param closed - the closed rows of the issue index.
 * @param named - the issue numbers a plan names.
 * @param categoryStated - whether the tracker states a status category.
 * @param archived - whether the Show archived toggle is on.
 * @param now - the current time in epoch milliseconds.
 * @returns the rows grouped by lane, with the count the Done cap hides.
 */
export const groupTicketLanes = (
  open: readonly TicketSourceRow[],
  closed: readonly TicketSourceRow[],
  named: ReadonlySet<string>,
  categoryStated: boolean,
  archived: boolean,
  now: number,
): TicketLaneGroups => {
  const laned = [...open, ...closed].map((row): { row: TicketRow; lane: ReturnType<typeof ticketLane> } => {
    const closedAt = row.closedAt ?? null;
    const issue = {
      id: row.number, title: row.title, url: row.url,
      createdAt: row.createdAt ?? null, body: null,
      status: row.status ?? '', statusCategory: row.statusCategory ?? '',
      closedAt,
    };
    const lane = ticketLane(issue, { categoryStated, namedByPlan: named.has(row.number) }, now);
    return { row: { ...issue, closedAt }, lane };
  });
  const rowsOf = (lane: string) => laned.filter((t) => t.lane === lane).map((t) => t.row);
  const doneRows = rowsOf('done');
  const { rows: done, moreCount } = archived
    ? { rows: doneRows, moreCount: 0 }
    : doneTickets(doneRows);
  return { open: rowsOf('open'), 'in-progress': rowsOf('in-progress'), done, moreCount };
};
