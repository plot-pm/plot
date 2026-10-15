import { resolvePerson, type PersonDirectory } from '../entities/person.js';
import type { TicketSource } from './ownership.js';
import { doneTickets, ticketLane, type TicketLane } from './ticket-lane.js';

/** One ticket as the Discovery tab's lane groups carry it. */
export interface TicketLaneRow {
  readonly id: string;
  readonly title: string;
  readonly url: string;
  readonly createdAt: string | null;
  readonly body: null;
  readonly status: string;
  readonly statusCategory: string;
  readonly closedAt: string | null;
  /** The tracker's own word for the kind of work, lowercased; `null` where it stated none. */
  readonly type: string | null;
  /**
   * The first assignee, resolved to a handle where the `People` directory
   * declares its spelling; the raw, unresolved spelling otherwise verbatim.
   * `null` where nobody is assigned. Nothing on the row says which case
   * applies — a reader comparing this field must treat it as free text, not
   * as an already-resolved identity.
   */
  readonly owner: string | null;
}

/** The Discovery tab's ticket lanes. */
export interface TicketLaneGroups {
  readonly open: TicketLaneRow[];
  readonly 'in-progress': TicketLaneRow[];
  readonly done: TicketLaneRow[];
  /** How many further Done rows exist beyond `done`. */
  readonly moreCount: number;
}

/** The fields of one issue-index row that `ticketLanes` reads. */
export interface TicketSourceRow {
  readonly number: string;
  readonly title: string;
  readonly url: string;
  readonly createdAt?: string | null;
  readonly status?: string | null;
  readonly statusCategory?: string | null;
  readonly closedAt?: string | null;
  readonly type?: string | null;
  readonly assignees?: readonly string[] | null;
}

/** What `ticketLanes` needs beside the rows. */
export interface TicketLanesReading {
  /** Whether the tracker states a status category rather than deriving one. */
  readonly categoryStated: boolean;
  /** The issue numbers a plan names, or `null` where the plans could not be read. */
  readonly named: ReadonlySet<string> | null;
  /** The lanes the last successful pass produced, or `null` where none exists. */
  readonly kept: TicketLaneGroups | null;
  /** How the source writes assignees; absent or `null` where unknown, which reads an assignee as written. */
  readonly source?: TicketSource | null;
  /** The declared `People` spellings; absent where none is declared. */
  readonly directory?: PersonDirectory;
}

/** The Discovery tab's ticket lanes and whether they are the kept ones. */
export interface TicketLanesResult {
  /** The lanes to draw, or `null` where the plans could not be read and no earlier lanes exist. */
  readonly lanes: TicketLaneGroups | null;
  /** True where `lanes` is `reading.kept` because the plans could not be read. */
  readonly plansUnreadable: boolean;
}

/**
 * The owner a ticket card names: the first assignee, resolved through the
 * directory. A Jira account resolves through its `jira:<account>` spelling and
 * shows as written where that spelling is undeclared.
 *
 * @param assignees - the row's assignees, as the tracker spells them.
 * @param reading - the source and directory the lanes were read with.
 * @returns the handle, or `null` where nobody is assigned.
 */
const ownerOf = (
  assignees: readonly string[] | null | undefined,
  reading: Pick<TicketLanesReading, 'source' | 'directory'>,
): string | null => {
  const first = (assignees ?? []).map((a) => a.trim()).find((a) => a !== '');
  if (first === undefined) return null;
  const directory = reading.directory ?? {};
  const spelling = reading.source?.match === 'tracker-account' ? `${reading.source.prefix}${first}` : first;
  const person = resolvePerson(spelling, directory);
  return directory[spelling.toLowerCase()] === undefined ? first : person.handle;
};

const rowOf = (reading: Pick<TicketLanesReading, 'source' | 'directory'>) => (row: TicketSourceRow): TicketLaneRow => ({
  id: row.number,
  title: row.title,
  url: row.url,
  createdAt: row.createdAt ?? null,
  body: null,
  status: row.status ?? '',
  statusCategory: row.statusCategory ?? '',
  closedAt: row.closedAt ?? null,
  type: row.type === undefined || row.type === null || row.type.trim() === '' ? null : row.type.trim().toLowerCase(),
  owner: ownerOf(row.assignees, reading),
});

const laneOf = (
  row: TicketLaneRow,
  reading: { categoryStated: boolean; named: ReadonlySet<string> },
  toggle: boolean,
  now: number,
): TicketLane => {
  const lane = ticketLane(
    { ...row, type: row.type ?? undefined, assignees: [] },
    { categoryStated: reading.categoryStated, namedByPlan: reading.named.has(row.id) },
    now,
  );
  return lane === 'hidden' && toggle ? 'done' : lane;
};

/**
 * Groups tracker rows into the Discovery tab's ticket lanes.
 *
 * `rows` and `closedRows` are laned by `ticketLane`. With `toggle` on, a ticket
 * that lane `hidden` (closed more than 14 days ago, or stated Done with no
 * `closedAt`) goes to Done, the Done cap lifts, and `toggleRows` — every closed
 * ticket the toggle read — replaces `closedRows`, which it contains. With
 * `toggle` off, `toggleRows` is ignored. A number present in `rows` is not read
 * again from a closed list.
 *
 * Where `reading.named` is `null` the plans could not be read, and the answer
 * is `reading.kept` with `plansUnreadable` true; no row is laned.
 *
 * @param rows - the open rows of the issue index.
 * @param closedRows - the closed rows of the issue index's 14-day window.
 * @param toggleRows - every closed row the toggle read, or `null` where it has read none.
 * @param reading - the category reading, the plan-named numbers, and the kept lanes.
 * @param toggle - whether the Show archived toggle is on.
 * @param now - the current time in epoch milliseconds.
 * @returns the lanes, with the count the Done cap hides, and whether they are the kept ones.
 */
export const ticketLanes = (
  rows: readonly TicketSourceRow[],
  closedRows: readonly TicketSourceRow[],
  toggleRows: readonly TicketSourceRow[] | null,
  reading: TicketLanesReading,
  toggle: boolean,
  now: number,
): TicketLanesResult => {
  const { named } = reading;
  if (named === null) return { lanes: reading.kept, plansUnreadable: true };
  const closed = toggle && toggleRows !== null ? toggleRows : closedRows;
  const seen = new Set<string>();
  const laned = [...rows, ...closed]
    .filter((row) => !seen.has(row.number) && seen.add(row.number))
    .map(rowOf(reading))
    .map((row) => ({ row, lane: laneOf(row, { categoryStated: reading.categoryStated, named }, toggle, now) }));
  const inLane = (lane: TicketLane): TicketLaneRow[] => laned.filter((t) => t.lane === lane).map((t) => t.row);
  const done = doneTickets(inLane('done'), toggle);
  return {
    lanes: { open: inLane('open'), 'in-progress': inLane('in-progress'), done: [...done.rows], moreCount: done.moreCount },
    plansUnreadable: false,
  };
};
