import { isMineStrict, ownership, ownedTicket, type OwnedRow, type Reader } from './ownership.js';
import type { MineMode } from './mine-mode.js';
import { ownerOf, type TicketLaneGroups, type TicketLaneRow } from './ticket-lanes.js';

/** A story row, as `lanesForReader` needs it to read ownership. */
export interface ReaderStory {
  readonly slug: string;
  readonly author?: string;
}

/**
 * One lane's rows after the ownership filter, and whether that filter emptied
 * it.
 *
 * A distinct type from {@link import('./lanes-for-topic.js').FilteredLane}
 * rather than a reuse of it: that type's `hiddenByTopic` names ITS pass's
 * reason, and borrowing the name here for the ownership pass's reason is what
 * used to force a reader of both passes' output to guess which one a given
 * `hiddenByTopic` meant.
 */
export interface OwnerFilteredLane<T> {
  readonly rows: T[];
  /** True where the lane held rows before the ownership filter and holds none after it. */
  readonly hiddenByOwner: boolean;
  /** How many of the lane's rows the ownership filter hid. */
  readonly hiddenCount: number;
  /** How many of the lane's rows have no known owner, counted before the filter; `0` in `all` mode. */
  readonly unknownCount: number;
}

/** One story lane after the ownership filter. */
export interface OwnerFilteredStoryLane<S, L extends string = string> extends OwnerFilteredLane<S> {
  readonly lane: L;
}

/** The ticket lanes after the ownership filter. `moreCount` is carried through unchanged. */
export interface OwnerFilteredTicketLanes {
  readonly open: OwnerFilteredLane<TicketLaneRow>;
  readonly 'in-progress': OwnerFilteredLane<TicketLaneRow>;
  readonly done: OwnerFilteredLane<TicketLaneRow>;
  readonly moreCount: number;
}

/** Both lane kinds after the ownership filter. */
export interface LanesForReader<S, L extends string = string> {
  readonly storyLanes: OwnerFilteredStoryLane<S, L>[];
  readonly tickets: OwnerFilteredTicketLanes | null;
  /** How many rows the filter hides, over every story and ticket lane. */
  readonly hiddenCount: number;
  /** How many rows have no known owner, over every story and ticket lane; `0` in `all` mode. */
  readonly unknownCount: number;
}

/**
 * Keeps the rows the reader owns under the effective mode.
 *
 * `all` keeps every row untouched. `mine-and-unknown` drops a row only where
 * {@link ownership} answers `theirs` — a row whose owner cannot be determined
 * stays. `mine` keeps only a row {@link isMineStrict} answers true for.
 * `hiddenByOwner` answers false where the lane was already empty before
 * filtering, the same discipline {@link import('./lanes-for-topic.js').filterLane}
 * applies for its own reason — a lane empty because nothing in it has an
 * owner must never read as hidden-by-filter.
 *
 * @param rows - one lane's rows.
 * @param ownedOf - reads what a row carries that names an owner.
 * @param reader - who is reading.
 * @param mode - the effective «Mine» mode; `all` keeps every row untouched.
 * @returns the kept rows in their original order, whether the filter emptied a non-empty lane, how many rows it hid, and how many have no known owner.
 */
const filterByReader = <T>(
  rows: readonly T[],
  ownedOf: (row: T) => OwnedRow,
  reader: Reader,
  mode: MineMode,
): OwnerFilteredLane<T> => {
  if (mode === 'all') return { rows: [...rows], hiddenByOwner: false, hiddenCount: 0, unknownCount: 0 };
  const owns = mode === 'mine' ? isMineStrict : (row: OwnedRow, who: Reader) => ownership(row, who) !== 'theirs';
  const kept = rows.filter((row) => owns(ownedOf(row), reader));
  const unknownCount = rows.filter((row) => ownership(ownedOf(row), reader) === 'unknown').length;
  return { rows: kept, hiddenByOwner: rows.length > 0 && kept.length === 0, hiddenCount: rows.length - kept.length, unknownCount };
};

/**
 * A ticket lane row, as the ownership rule reads it: its full assignee list
 * and source, through {@link ownedTicket} — the mapping the Delivery tickets
 * use, so both tabs answer alike for the same ticket.
 */
const ownedFromTicketLaneRow = (row: Pick<TicketLaneRow, 'assignees' | 'source'>): OwnedRow =>
  ownedTicket(row.assignees, row.source);

/**
 * A kept ticket row, labeled with the reader's own handle where `ownerOf`
 * resolves the reader among its assignees.
 *
 * `ticketLanes` builds `row.owner` with no reader in scope, so a reader who
 * is any assignee but the first still reads another handle until this
 * relabels it — the label is a domain property, decided here rather than in
 * the component that renders it.
 */
const labeledForReader = (row: TicketLaneRow, reader: Reader): TicketLaneRow => ({
  ...row,
  owner: ownerOf(row.assignees, { source: row.source, directory: reader.directory }, reader),
});

/**
 * A story row, as the ownership rule reads it.
 *
 * Not exported: this is `lanesForReader`'s own mapping to `{ kind: 'story', author }`,
 * used nowhere else.
 */
const ownedFromStory = (story: Pick<ReaderStory, 'author'>): OwnedRow => ({ kind: 'story', author: story.author });

/**
 * Narrows the story and ticket lanes to the reader's own work.
 *
 * Mirrors {@link import('./lanes-for-topic.js').lanesForTopic}'s shape:
 * `storyLaneGroups` and `tickets` in, a parallel {@link LanesForReader} shape
 * out, each lane's kept rows plus whether the filter emptied it. Runs AHEAD of
 * `lanesForTopic`, so the topic cloud's counts reflect only the reader's rows
 * when the filter is on.
 *
 * A ticket row carries its own assignee list and source, so there is no
 * ticket-source parameter here, unlike `ticketsForReader` elsewhere.
 *
 * @param storyLaneGroups - the story lane groups.
 * @param tickets - the ticket lane groups, or `null` where none were read.
 * @param reader - who is reading.
 * @param mode - the effective «Mine» mode; `all` keeps every row untouched.
 * @returns both lane kinds, each lane carrying its kept rows, `hiddenByOwner`, `hiddenCount` and `unknownCount`, and the two counts summed over every lane.
 */
export const lanesForReader = <S extends ReaderStory, L extends string>(
  storyLaneGroups: readonly { readonly lane: L; readonly stories: readonly S[] }[],
  tickets: TicketLaneGroups | null,
  reader: Reader,
  mode: MineMode,
): LanesForReader<S, L> => {
  const ticketLane = (rows: readonly TicketLaneRow[]) => {
    const filtered = filterByReader(rows, ownedFromTicketLaneRow, reader, mode);
    return { ...filtered, rows: filtered.rows.map((row) => labeledForReader(row, reader)) };
  };
  const storyLanes = storyLaneGroups.map((group) => ({
    lane: group.lane,
    ...filterByReader(group.stories, ownedFromStory, reader, mode),
  }));
  const ticketLanes = tickets
    ? {
        open: ticketLane(tickets.open),
        'in-progress': ticketLane(tickets['in-progress']),
        done: ticketLane(tickets.done),
        moreCount: tickets.moreCount,
      }
    : null;
  const lanes = [...storyLanes, ...(ticketLanes ? [ticketLanes.open, ticketLanes['in-progress'], ticketLanes.done] : [])];
  return {
    storyLanes,
    tickets: ticketLanes,
    hiddenCount: lanes.reduce((sum, lane) => sum + lane.hiddenCount, 0),
    unknownCount: lanes.reduce((sum, lane) => sum + lane.unknownCount, 0),
  };
};
