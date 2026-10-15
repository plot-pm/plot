import { describe, expect, it } from 'vitest';
import { lanesForReader } from '../src/rules/lanes-for-reader.js';
import type { TicketLaneGroups, TicketLaneRow } from '../src/rules/ticket-lanes.js';
import type { Reader } from '../src/rules/ownership.js';
import { parsePersonDirectory } from '../src/entities/person.js';

const directory = parsePersonDirectory('jwloka = Jan Wloka; eins78 = Max Albrecht');
const reader: Reader = { hostUser: 'jwloka', directory };

const ticket = (id: string, owner: string | null): TicketLaneRow => ({
  id,
  title: `Ticket ${id}`,
  url: `https://github.com/plot-pm/plot/issues/${id}`,
  createdAt: null,
  body: null,
  status: 'Open',
  statusCategory: 'To Do',
  closedAt: null,
  type: null,
  owner,
});

const story = (slug: string, author?: string) => ({ slug, author });

const TICKETS: TicketLaneGroups = {
  open: [ticket('1', 'jwloka'), ticket('2', 'eins78')],
  'in-progress': [ticket('3', null)],
  done: [],
  moreCount: 4,
};
const STORIES = [
  { lane: 'Draft', stories: [story('a', 'jwloka'), story('b', 'eins78')] },
  { lane: 'Active', stories: [story('c', 'eins78')] },
  { lane: 'Done', stories: [] },
];

describe('lanesForReader', () => {
  it('returns every row and hides no lane when the filter is off', () => {
    const actual = lanesForReader(STORIES, TICKETS, reader, false);
    expect(actual.storyLanes.map((l) => l.rows.length)).toEqual([2, 1, 0]);
    expect(actual.tickets?.open.rows.map((r) => r.id)).toEqual(['1', '2']);
    expect([...actual.storyLanes, actual.tickets!.open].some((l) => l.hiddenByTopic)).toBe(false);
  });

  it('keeps only the reader\'s stories when the filter is on', () => {
    const actual = lanesForReader(STORIES, TICKETS, reader, true);
    expect(actual.storyLanes.map((l) => l.rows.map((s) => s.slug))).toEqual([['a'], [], []]);
  });

  it('keeps only the reader\'s tickets when the filter is on', () => {
    const actual = lanesForReader(STORIES, TICKETS, reader, true);
    expect(actual.tickets?.open.rows.map((r) => r.id)).toEqual(['1']);
  });

  it('keeps a ticket with no resolved owner, as unknown', () => {
    const tickets: TicketLaneGroups = { open: [ticket('9', null)], 'in-progress': [], done: [], moreCount: 0 };
    const actual = lanesForReader(STORIES, tickets, reader, true);
    expect(actual.tickets?.open.rows.map((r) => r.id)).toEqual(['9']);
  });

  it('keeps a ticket whose owner is an undeclared tracker-account spelling, as unknown', () => {
    // `jira-acct-99` names nobody in `directory` — `ownerOf` falls back to this
    // raw, unresolved spelling rather than a handle. Reading it as a host-login
    // mismatch would wrongly call it `theirs` and hide it.
    const tickets: TicketLaneGroups = { open: [ticket('9', 'jira-acct-99')], 'in-progress': [], done: [], moreCount: 0 };
    const actual = lanesForReader(STORIES, tickets, reader, true);
    expect(actual.tickets?.open.rows.map((r) => r.id)).toEqual(['9']);
  });

  it('keeps the reader\'s own ticket even where their tracker spelling is undeclared', () => {
    // Nothing in `directory` declares a spelling for `jwloka` as a tracker
    // account, so an undeclared-but-actually-mine spelling must not hide the
    // reader's own ticket either.
    const tickets: TicketLaneGroups = { open: [ticket('9', 'jira-acct-mine')], 'in-progress': [], done: [], moreCount: 0 };
    const actual = lanesForReader(STORIES, tickets, reader, true);
    expect(actual.tickets?.open.rows.map((r) => r.id)).toEqual(['9']);
  });

  it('keeps a story with no author, as unknown', () => {
    const stories = [{ lane: 'Draft', stories: [story('z')] }];
    const actual = lanesForReader(stories, null, reader, true);
    expect(actual.storyLanes[0].rows.map((s) => s.slug)).toEqual(['z']);
  });

  it('flags a lane the filter emptied and not a lane that was empty before', () => {
    const actual = lanesForReader(STORIES, TICKETS, reader, true);
    expect(actual.storyLanes.map((l) => l.hiddenByTopic)).toEqual([false, true, false]);
    expect(actual.tickets?.open.hiddenByTopic).toBe(false);
    expect(actual.tickets?.['in-progress'].hiddenByTopic).toBe(false);
    expect(actual.tickets?.done.hiddenByTopic).toBe(false);
  });

  it('reports a non-empty lane the filter emptied entirely', () => {
    const tickets: TicketLaneGroups = { open: [ticket('5', 'eins78')], 'in-progress': [], done: [], moreCount: 0 };
    const actual = lanesForReader(STORIES, tickets, reader, true);
    expect(actual.tickets?.open).toEqual({ rows: [], hiddenByTopic: true });
  });

  it('carries moreCount through and a missing ticket reading through', () => {
    expect(lanesForReader(STORIES, TICKETS, reader, true).tickets?.moreCount).toBe(4);
    expect(lanesForReader(STORIES, null, reader, true).tickets).toBeNull();
  });
});
