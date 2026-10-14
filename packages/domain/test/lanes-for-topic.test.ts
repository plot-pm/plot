import { describe, expect, it } from 'vitest';
import { filterLane, lanesForTopic } from '../src/rules/lanes-for-topic.js';
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
});

const story = (slug: string) => ({ slug });

const TICKETS: TicketLaneGroups = {
  open: [ticket('1'), ticket('2')],
  'in-progress': [ticket('3')],
  done: [],
  moreCount: 4,
};
const STORIES = [
  { lane: 'Draft', stories: [story('a'), story('b')] },
  { lane: 'Active', stories: [story('c')] },
  { lane: 'Done', stories: [] },
];

describe('filterLane', () => {
  it('keeps the named rows in order', () => {
    const actual = filterLane(['x', 'y', 'z'], (r) => r, ['z', 'x']);
    expect(actual).toEqual({ rows: ['x', 'z'], hiddenByTopic: false });
  });

  it('reports a non-empty lane the selection emptied', () => {
    expect(filterLane(['x'], (r) => r, ['q'])).toEqual({ rows: [], hiddenByTopic: true });
  });

  it('does not report a lane that was already empty', () => {
    expect(filterLane([], (r: string) => r, ['q'])).toEqual({ rows: [], hiddenByTopic: false });
  });
});

describe('lanesForTopic', () => {
  it('returns every row and hides no lane with no selection', () => {
    const actual = lanesForTopic(STORIES, TICKETS, null);
    expect(actual.storyLanes.map((l) => l.rows.length)).toEqual([2, 1, 0]);
    expect(actual.tickets?.open.rows.map((r) => r.id)).toEqual(['1', '2']);
    expect(actual.tickets?.done).toEqual({ rows: [], hiddenByTopic: false });
    expect([...actual.storyLanes, actual.tickets!.open].some((l) => l.hiddenByTopic)).toBe(false);
  });

  it('narrows stories by slug and tickets by id in the same call', () => {
    const actual = lanesForTopic(STORIES, TICKETS, { storySlugs: ['b'], ticketKeys: ['2'] });
    expect(actual.storyLanes.map((l) => l.rows.map((s) => s.slug))).toEqual([['b'], [], []]);
    expect(actual.tickets?.open.rows.map((r) => r.id)).toEqual(['2']);
  });

  it('excludes a ticket the topic does not name from a lane it shares with one it does', () => {
    const actual = lanesForTopic(STORIES, TICKETS, { storySlugs: [], ticketKeys: ['1'] });
    expect(actual.tickets?.open.rows.map((r) => r.id)).toEqual(['1']);
  });

  it('flags a lane the topic emptied and not a lane that was empty before', () => {
    const actual = lanesForTopic(STORIES, TICKETS, { storySlugs: ['a'], ticketKeys: [] });
    expect(actual.storyLanes.map((l) => l.hiddenByTopic)).toEqual([false, true, false]);
    expect(actual.tickets?.open.hiddenByTopic).toBe(true);
    expect(actual.tickets?.['in-progress'].hiddenByTopic).toBe(true);
    expect(actual.tickets?.done.hiddenByTopic).toBe(false);
  });

  it('carries moreCount and a missing ticket reading through', () => {
    expect(lanesForTopic(STORIES, TICKETS, { storySlugs: [], ticketKeys: [] }).tickets?.moreCount).toBe(4);
    expect(lanesForTopic(STORIES, null, { storySlugs: [], ticketKeys: [] }).tickets).toBeNull();
  });
});
