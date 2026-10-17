import { isMine, type OwnedRow, type Reader } from './ownership.js';
import type { TicketLaneGroups, TicketLaneRow } from './ticket-lanes.js';

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
}

/**
 * Keeps the rows the reader owns, or whose owner cannot be determined.
 *
 * A row the reader does NOT own is dropped; `hiddenByOwner` answers false
 * where the lane was already empty before filtering, the same discipline
 * {@link import('./lanes-for-topic.js').filterLane} applies for its own
 * reason — a lane empty because nothing in it has an owner must never read as
 * hidden-by-filter.
 *
 * @param rows - one lane's rows.
 * @param ownedOf - reads what a row carries that names an owner.
 * @param reader - who is reading.
 * @param on - whether the filter is active; off keeps every row untouched.
 * @returns the kept rows in their original order, and whether the filter emptied a non-empty lane.
 */
const filterByReader = <T>(
  rows: readonly T[],
  ownedOf: (row: T) => OwnedRow,
  reader: Reader,
  on: boolean,
): OwnerFilteredLane<T> => {
  if (!on) return { rows: [...rows], hiddenByOwner: false };
  const kept = rows.filter((row) => isMine(ownedOf(row), reader));
  return { rows: kept, hiddenByOwner: rows.length > 0 && kept.length === 0 };
};

/**
 * A ticket lane row, mapped to the ownership rule's `ticket` or
 * `resolvedOwner` arm, by `sourceKind`.
 *
 * `host-login` matches `owner` the way {@link import('./ownership.js').ticketOwnership}
 * matches a PR author — exact, no declared spelling required — because a
 * row's one `owner` carries the same assignee `ticketsForReader` elsewhere
 * reads from a full list; a single-element list reproduces that rule's
 * per-assignee loop for the one name a Discovery row keeps.
 *
 * `tracker-account` and `null` keep the `resolvedOwner` arm: `owner` is
 * resolved to a handle ONLY where the directory declares its spelling —
 * `ticketLanes`'s `ownerOf` falls back to the raw, unresolved assignee
 * spelling otherwise. Comparing that raw spelling directly against the
 * reader's login would call any mismatch `theirs` — hiding a ticket whose
 * tracker-account spelling the directory never declared, which can be the
 * reader's own. `resolvedOwner` instead matches it as free text, the way a
 * plan or story author is matched: `theirs` only where the directory
 * declares the spelling for somebody else, `unknown` otherwise.
 */
const ownedFromTicketLaneRow = (row: Pick<TicketLaneRow, 'owner' | 'sourceKind'>): OwnedRow =>
  row.sourceKind === 'host-login'
    ? { kind: 'ticket', assignees: row.owner === null ? [] : [row.owner], source: { service: '', match: 'host-login' } }
    : { kind: 'resolvedOwner', owner: row.owner };

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
 * There is no ticket-source parameter here, unlike `ticketsForReader`
 * elsewhere: the raw assignee list a `TicketSourceShape` would disambiguate
 * never reaches this row shape, only the single `owner` string `ticketLanes`
 * derives from it and the `sourceKind` it was derived under.
 * {@link ownedFromTicketLaneRow} reads `sourceKind` to tell a host-login
 * `owner` — matched exactly, the way `ticketsForReader` matches it — from a
 * tracker-account or undetermined one, read as free text instead.
 *
 * @param storyLaneGroups - the story lane groups.
 * @param tickets - the ticket lane groups, or `null` where none were read.
 * @param reader - who is reading.
 * @param on - whether the "Only my work" filter is active.
 * @returns both lane kinds, each lane carrying its kept rows and `hiddenByOwner`.
 */
export const lanesForReader = <S extends ReaderStory, L extends string>(
  storyLaneGroups: readonly { readonly lane: L; readonly stories: readonly S[] }[],
  tickets: TicketLaneGroups | null,
  reader: Reader,
  on: boolean,
): LanesForReader<S, L> => {
  const ticketLane = (rows: readonly TicketLaneRow[]) => filterByReader(rows, ownedFromTicketLaneRow, reader, on);
  return {
    storyLanes: storyLaneGroups.map((group) => ({
      lane: group.lane,
      ...filterByReader(group.stories, ownedFromStory, reader, on),
    })),
    tickets: tickets
      ? {
          open: ticketLane(tickets.open),
          'in-progress': ticketLane(tickets['in-progress']),
          done: ticketLane(tickets.done),
          moreCount: tickets.moreCount,
        }
      : null,
  };
};
