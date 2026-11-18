import type { IssueAnswer } from '../entities/issue.js';
import type { YouGroup } from './delivery-placement.js';
import { YOU_GROUP_MARKERS } from './delivery-placement.js';
import type { Ownership } from './ownership.js';
import { TICKETS_ANCHOR } from './tickets-section.js';
import type { PhaseEntry, PhaseMap } from './workflow-phases.js';

/** The DOM id a delivery group's heading carries. */
export const deliveryGroupAnchor = (key: string): string => `delivery-group-${key}`;

/** One count of the You header: its number, its words and where it links. */
export interface YouHeaderCount {
  key: string;
  /** The count; `null` where the reading behind it is absent, which is not `0`. */
  count: number | null;
  text: string;
  /** The DOM id the count scrolls to; `null` where nothing renders for it. */
  anchor: string | null;
}

/** The three phases the strip names, by what each holds. */
export type StripRole = 'story' | 'design' | 'approved';

/** One phase of the strip. */
export interface PhaseStripEntry {
  role: StripRole;
  /** The phase's name from the phase map; `null` where the map names no phase for the role. */
  name: string | null;
  /** The count; `null` where the reading behind it is absent. */
  count: number | null;
  /** `<name> <count>`, the count alone where the map names no phase, and `<name> —` where the count is absent. */
  text: string;
  anchor: string | null;
}

export interface YouHeader {
  counts: YouHeaderCount[];
  strip: PhaseStripEntry[];
  /** The strip as one line, entries joined by `─▶`. */
  stripLine: string;
}

/** A story the strip may count: its status, how many plans name it, and whose it is. */
export interface StripStory {
  status: string;
  plans: number;
  ownership: Ownership;
}

/** A plan the strip may count: the phase name its card sits in, whose it is, and the item it links to. */
export interface StripPlan {
  phase: string;
  ownership: Ownership;
  /** The DOM id of the plan's item on the tab; `null` where none renders. */
  anchor: string | null;
}

export interface YouHeaderInput {
  /** The You groups and the rows each holds, in layout order. */
  groups: readonly { key: string; count: number }[];
  /** The tickets the placement rule gave the Tickets section. */
  tickets: readonly { ownership: Ownership }[];
  /** Whether the tracker answered; `null` where nobody asked. */
  ticketAnswer: IssueAnswer | null;
  map: PhaseMap;
  /** The live stories, not Done or Archived. */
  stories: readonly StripStory[];
  plans: readonly StripPlan[];
}

const GROUP_WORDS: Record<YouGroup, string> = {
  'blocks-delivery': 'block delivery',
  'input-to-the-fleet': 'inputs the fleet waits for',
  unblock: `to ${YOU_GROUP_MARKERS.unblock.words}`,
};

const isYouGroup = (key: string): key is YouGroup => Object.prototype.hasOwnProperty.call(GROUP_WORDS, key);

const theirs = (ownership: Ownership): boolean => ownership === 'theirs';

const holder = (map: PhaseMap, role: StripRole): PhaseEntry | undefined =>
  map.find((entry) =>
    role === 'story' ? entry.story.length > 0
      : role === 'design' ? entry.plan.includes('draft') || entry.plan.includes('design')
        : entry.plan.includes('approved'));

const entryText = (name: string | null, count: number | null): string =>
  name === null ? (count === null ? '—' : String(count)) : `${name} ${count === null ? '—' : count}`;

/**
 * The You header: one count per You group, the reader's tickets to triage, and the phase strip.
 *
 * A group count links to `deliveryGroupAnchor` where the group has rows, and nowhere otherwise.
 * The ticket count is `null` while the tracker has not answered, and links to `TICKETS_ANCHOR`
 * where the Tickets section renders, which includes the absent reading.
 * The strip names its three phases from `map`: the phase holding a story status, the phase holding
 * `plan:draft` or `plan:design`, and the phase holding `plan:approved`. A role the map gives no phase
 * keeps its count with no name. Every count leaves out an item whose ownership is `'theirs'`.
 * The story phase counts the tickets with no plan and the live stories no plan names.
 *
 * @param input - the group counts, tickets, phase map, stories and plans.
 * @returns the counts, the strip and the strip as a line.
 */
export const youHeader = (input: YouHeaderInput): YouHeader => {
  const answered = input.ticketAnswer === 'answered';
  const tickets = answered ? input.tickets.filter((t) => !theirs(t.ownership)).length : null;

  const counts: YouHeaderCount[] = input.groups.filter((g) => isYouGroup(g.key)).map((g) => ({
    key: g.key,
    count: g.count,
    text: `${g.count} ${GROUP_WORDS[g.key as YouGroup]}`,
    anchor: g.count > 0 ? deliveryGroupAnchor(g.key) : null,
  }));
  counts.push({
    key: 'tickets',
    count: tickets,
    text: tickets === null ? 'tickets to triage: not read' : `${tickets} tickets to triage`,
    anchor: tickets === null || tickets > 0 ? TICKETS_ANCHOR : null,
  });

  const storyEntry = holder(input.map, 'story');
  const stories = input.stories.filter((s) =>
    !theirs(s.ownership) && s.plans === 0 && (storyEntry === undefined || (storyEntry.story as readonly string[]).includes(s.status))).length;
  const storyCount = tickets === null ? null : tickets + stories;

  const planSlot = (role: StripRole): PhaseStripEntry => {
    const entry = holder(input.map, role);
    const mine = entry === undefined ? [] : input.plans.filter((p) => p.phase === entry.name && !theirs(p.ownership));
    const name = entry?.name ?? null;
    return {
      role, name, count: mine.length, text: entryText(name, mine.length),
      anchor: mine.find((p) => p.anchor !== null)?.anchor ?? null,
    };
  };
  const storyName = storyEntry?.name ?? null;
  const strip: PhaseStripEntry[] = [
    {
      role: 'story', name: storyName, count: storyCount, text: entryText(storyName, storyCount),
      anchor: tickets !== null && tickets > 0 ? TICKETS_ANCHOR : null,
    },
    planSlot('design'),
    planSlot('approved'),
  ];
  return { counts, strip, stripLine: strip.map((e) => e.text).join(' ─▶ ') };
};
