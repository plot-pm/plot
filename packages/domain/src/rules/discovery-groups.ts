import type { FilteredTicketLanes } from './lanes-for-topic.js';

/** Which Discovery lane groups the reader asked to see. */
export type DiscoveryShow = 'tickets' | 'stories' | 'both';

/** One Discovery lane group: whether it shows, its heading and its row count. */
export interface DiscoveryGroup {
  readonly shows: boolean;
  /** The heading text: `Tickets (3)`, or `Tickets` alone where `count` is null. */
  readonly heading: string;
  /** Every row the group holds after the topic selection, or null where the group was not read. */
  readonly count: number | null;
}

/** Both Discovery lane groups. */
export interface DiscoveryGroups {
  readonly show: DiscoveryShow;
  readonly tickets: DiscoveryGroup;
  readonly stories: DiscoveryGroup;
}

/**
 * Reads the `show` query value.
 *
 * @param value - the raw `?show=` value, or null where the parameter is absent.
 * @returns `tickets` or `stories` for exactly those two lowercase words; `both` for everything else.
 */
export const parseDiscoveryShow = (value: string | null): DiscoveryShow =>
  value === 'tickets' || value === 'stories' ? value : 'both';

const group = (shows: boolean, label: string, count: number | null): DiscoveryGroup => ({
  shows,
  heading: count === null ? label : `${label} (${count})`,
  count,
});

/**
 * Decides what the Discovery tab shows: which groups, under which heading, with which count.
 *
 * A count covers every row of its group after the topic selection, including
 * the Done rows behind *Show all done*. A group that was not read
 * (`tickets: null`) has a null count and a heading without one.
 *
 * @param show - the raw `?show=` value, or null.
 * @param storyLanes - the story lanes as `lanesForTopic` returns them.
 * @param tickets - the ticket lanes as `lanesForTopic` returns them, or null where none were read.
 * @returns visibility, heading text and count for each group.
 */
export const discoveryGroups = (
  show: string | null,
  storyLanes: readonly { readonly rows: readonly unknown[] }[],
  tickets: FilteredTicketLanes | null,
): DiscoveryGroups => {
  const chosen = parseDiscoveryShow(show);
  const ticketCount = tickets ? tickets.open.rows.length + tickets['in-progress'].rows.length + tickets.done.rows.length : null;
  const storyCount = storyLanes.reduce((sum, lane) => sum + lane.rows.length, 0);
  return {
    show: chosen,
    tickets: group(chosen !== 'stories', 'Tickets', ticketCount),
    stories: group(chosen !== 'tickets', 'Stories', storyCount),
  };
};

/**
 * The count a tag-cloud chip shows while only some groups are on screen.
 *
 * @param topic - the chip's topic: its total `count` and the keys it names per group.
 * @param groups - the result of `discoveryGroups`.
 * @returns the topic's total with both groups on screen, else the keys of the group that shows.
 */
export const topicCountFor = (
  topic: { readonly count: number; readonly storySlugs: readonly string[]; readonly ticketKeys: readonly string[] },
  groups: DiscoveryGroups,
): number => {
  if (groups.show === 'tickets') return topic.ticketKeys.length;
  if (groups.show === 'stories') return topic.storySlugs.length;
  return topic.count;
};
