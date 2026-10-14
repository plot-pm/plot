import type { TicketLaneGroups, TicketLaneRow } from './ticket-lanes.js';

/** What a selected topic names: the stories and tickets it was found in. */
export interface TopicSelection {
  readonly storySlugs: readonly string[];
  readonly ticketKeys: readonly string[];
}

/** One lane's rows after the selection, and whether the selection emptied it. */
export interface FilteredLane<T> {
  readonly rows: T[];
  /** True where the lane held rows before the selection and holds none after it. */
  readonly hiddenByTopic: boolean;
}

/** One story lane after the selection. */
export interface FilteredStoryLane<S, L extends string = string> extends FilteredLane<S> {
  readonly lane: L;
}

/** The ticket lanes after the selection. `moreCount` is carried through unchanged. */
export interface FilteredTicketLanes {
  readonly open: FilteredLane<TicketLaneRow>;
  readonly 'in-progress': FilteredLane<TicketLaneRow>;
  readonly done: FilteredLane<TicketLaneRow>;
  readonly moreCount: number;
}

/** Both lane kinds after the selection. */
export interface LanesForTopic<S, L extends string = string> {
  readonly storyLanes: FilteredStoryLane<S, L>[];
  readonly tickets: FilteredTicketLanes | null;
}

/**
 * Keeps the rows whose key the selection names.
 *
 * @param rows - one lane's rows.
 * @param keyOf - the row's key, in the same vocabulary as `keys`.
 * @param keys - the keys the selected topic names.
 * @returns the kept rows in their original order, and whether the selection emptied a non-empty lane.
 */
export const filterLane = <T>(
  rows: readonly T[],
  keyOf: (row: T) => string,
  keys: readonly string[],
): FilteredLane<T> => {
  const named = new Set(keys);
  const kept = rows.filter((row) => named.has(keyOf(row)));
  return { rows: kept, hiddenByTopic: rows.length > 0 && kept.length === 0 };
};

const unfiltered = <T>(rows: readonly T[]): FilteredLane<T> => ({ rows: [...rows], hiddenByTopic: false });

/**
 * Narrows the story and ticket lanes by the selected topic.
 *
 * A story matches on `slug` against `storySlugs`; a ticket matches on `id`
 * against `ticketKeys`. With no selection every row is kept and no lane is
 * reported hidden.
 *
 * @param storyLanes - the story lane groups.
 * @param tickets - the ticket lane groups, or `null` where none were read.
 * @param topic - the selected topic's names, or `null` for no selection.
 * @returns both lane kinds, each lane carrying its kept rows and `hiddenByTopic`.
 */
export const lanesForTopic = <S extends { readonly slug: string }, L extends string>(
  storyLanes: readonly { readonly lane: L; readonly stories: readonly S[] }[],
  tickets: TicketLaneGroups | null,
  topic: TopicSelection | null,
): LanesForTopic<S, L> => {
  const lane = <T>(rows: readonly T[], keyOf: (row: T) => string, keys: (t: TopicSelection) => readonly string[]) =>
    topic ? filterLane(rows, keyOf, keys(topic)) : unfiltered(rows);
  const ticketLane = (rows: readonly TicketLaneRow[]) => lane(rows, (r) => r.id, (t) => t.ticketKeys);
  return {
    storyLanes: storyLanes.map((group) => ({
      lane: group.lane,
      ...lane(group.stories, (s) => s.slug, (t) => t.storySlugs),
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
