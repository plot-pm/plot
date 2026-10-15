import { describe, expect, it } from 'vitest';
import { discoveryGroups, parseDiscoveryShow, topicCountFor } from '../src/rules/discovery-groups.js';
import { lanesForTopic } from '../src/rules/lanes-for-topic.js';
import type { TicketLaneGroups, TicketLaneRow } from '../src/rules/ticket-lanes.js';

const ticket = (id: string): TicketLaneRow => ({
  id,
  title: `Ticket ${id}`,
  url: `https://github.com/plot-pm/plot/issues/${id}`,
  createdAt: null,
  body: null,
  status: 'Open',
  statusCategory: 'To Do',
  closedAt: null,
  type: null,
  owner: null,
});
const many = (prefix: string, n: number) => Array.from({ length: n }, (_, i) => `${prefix}${i}`);

const TICKETS: TicketLaneGroups = {
  open: [ticket('1'), ticket('2')],
  'in-progress': [ticket('3')],
  done: many('d', 8).map(ticket),
  moreCount: 0,
};
const STORIES = [
  { lane: 'Draft', stories: [{ slug: 'a' }, { slug: 'b' }] },
  { lane: 'Done', stories: many('s', 7).map((slug) => ({ slug })) },
];

describe('parseDiscoveryShow', () => {
  it('reads the two words and nothing else as a choice', () => {
    expect(parseDiscoveryShow('tickets')).toBe('tickets');
    expect(parseDiscoveryShow('stories')).toBe('stories');
    for (const other of [null, '', 'all', 'both', 'Tickets', 'STORIES']) expect(parseDiscoveryShow(other)).toBe('both');
  });
});

describe('discoveryGroups', () => {
  const groups = (show: string | null, topic: Parameters<typeof lanesForTopic>[2] = null) => {
    const f = lanesForTopic(STORIES, TICKETS, topic);
    return discoveryGroups(show, f.storyLanes, f.tickets);
  };

  it('shows both groups for an absent or unknown value', () => {
    for (const v of [null, '', 'all', 'Tickets']) {
      const g = groups(v);
      expect([g.show, g.tickets.shows, g.stories.shows]).toEqual(['both', true, true]);
    }
  });

  it('shows one group alone', () => {
    expect(groups('tickets')).toMatchObject({ tickets: { shows: true }, stories: { shows: false } });
    expect(groups('stories')).toMatchObject({ tickets: { shows: false }, stories: { shows: true } });
  });

  it('counts every row of a group, the Done rows past the first five included', () => {
    const g = groups(null);
    expect(g.tickets).toMatchObject({ count: 11, heading: 'Tickets (11)' });
    expect(g.stories).toMatchObject({ count: 9, heading: 'Stories (9)' });
  });

  it('counts after the topic selection, not before it', () => {
    const g = groups(null, { storySlugs: ['a', 's0'], ticketKeys: ['1'] });
    expect(g.tickets.heading).toBe('Tickets (1)');
    expect(g.stories.heading).toBe('Stories (2)');
  });

  it('gives an unread ticket group a heading with no count, not a zero', () => {
    const f = lanesForTopic(STORIES, null, null);
    const g = discoveryGroups(null, f.storyLanes, f.tickets);
    expect(g.tickets).toEqual({ shows: true, heading: 'Tickets', count: null });
  });

  it('keeps a group that holds no rows shown, with a zero count', () => {
    const g = discoveryGroups(null, [{ rows: [] }], null);
    expect(g.stories).toEqual({ shows: true, heading: 'Stories (0)', count: 0 });
  });
});

describe('topicCountFor', () => {
  const topic = { count: 5, storySlugs: ['a', 'b'], ticketKeys: ['1', '2', '3'] };
  it('counts only the groups on screen', () => {
    const at = (show: string) => topicCountFor(topic, discoveryGroups(show, [], null));
    expect(at('both')).toBe(5);
    expect(at('tickets')).toBe(3);
    expect(at('stories')).toBe(2);
  });
});
