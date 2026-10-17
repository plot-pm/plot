import { declaresSpelling, resolvePerson, type PersonDirectory } from '../entities/person.js';
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
   * The name the card shows: an assignee resolved to a handle where the
   * `People` directory declares its spelling, the first assignee's raw
   * spelling otherwise. `null` where nobody is assigned. Display only —
   * ownership reads `assignees` and `source`.
   */
  readonly owner: string | null;
  /** Every assignee, as the tracker spells them; `[]` where nobody is assigned. */
  readonly assignees: string[];
  /** How the source writes `assignees`; `null` where it could not be determined. */
  readonly source: TicketSource | null;
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
 * The type a ticket row names: the tracker's own word, trimmed and lowercased.
 *
 * @param type - the row's type, as the tracker spells it.
 * @returns the lowercased word, or `null` where the tracker stated none or only whitespace.
 */
export const typeOf = (type: string | null | undefined): string | null =>
  type === undefined || type === null || type.trim() === '' ? null : type.trim().toLowerCase();

/**
 * The owner a ticket card names: the assignee the directory resolves, where
 * one does, otherwise the first assignee as written. A Jira account resolves
 * through its `jira:<account>` spelling.
 *
 * Several assignees can be unequally known: one a raw tracker login the
 * directory never declared, another a spelling it does. Taking index 0
 * regardless would name the undeclared one and read as unresolved even where
 * a later assignee is the reader's own declared spelling — so every assignee
 * is checked for a declared spelling before falling back to the first.
 *
 * @param assignees - the row's assignees, as the tracker spells them.
 * @param reading - the source and directory the lanes were read with.
 * @returns the resolved handle, the first assignee as written where none resolves, or `null` where nobody is assigned.
 */
export const ownerOf = (
  assignees: readonly string[] | null | undefined,
  reading: Pick<TicketLanesReading, 'source' | 'directory'>,
): string | null => {
  const named = (assignees ?? []).map((a) => a.trim()).filter((a) => a !== '');
  if (named.length === 0) return null;
  const directory = reading.directory ?? {};
  const spellingOf = (assignee: string): string =>
    reading.source?.match === 'tracker-account' ? `${reading.source.prefix}${assignee}` : assignee;
  const resolved = named.find((assignee) => declaresSpelling(spellingOf(assignee), directory));
  return resolved === undefined ? named[0] : resolvePerson(spellingOf(resolved), directory).handle;
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
  type: typeOf(row.type),
  owner: ownerOf(row.assignees, reading),
  assignees: [...(row.assignees ?? [])],
  source: reading.source ?? null,
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
