import { describe, expect, it } from 'vitest';
import { lanesForReader } from '../src/rules/lanes-for-reader.js';
import type { TicketLaneGroups, TicketLaneRow } from '../src/rules/ticket-lanes.js';
import { isMine, type Reader } from '../src/rules/ownership.js';
import { parsePersonDirectory } from '../src/entities/person.js';

const directory = parsePersonDirectory('jwloka = Jan Wloka; eins78 = Max Albrecht');
const reader: Reader = { hostUser: 'jwloka', directory };

const ticket = (id: string, owner: string | null, sourceKind: TicketLaneRow['sourceKind'] = null): TicketLaneRow => ({
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
  sourceKind,
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
    expect([...actual.storyLanes, actual.tickets!.open].some((l) => l.hiddenByOwner)).toBe(false);
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
    expect(actual.storyLanes.map((l) => l.hiddenByOwner)).toEqual([false, true, false]);
    expect(actual.tickets?.open.hiddenByOwner).toBe(false);
    expect(actual.tickets?.['in-progress'].hiddenByOwner).toBe(false);
    expect(actual.tickets?.done.hiddenByOwner).toBe(false);
  });

  it('reports a non-empty lane the filter emptied entirely', () => {
    const tickets: TicketLaneGroups = { open: [ticket('5', 'eins78')], 'in-progress': [], done: [], moreCount: 0 };
    const actual = lanesForReader(STORIES, tickets, reader, true);
    expect(actual.tickets?.open).toEqual({ rows: [], hiddenByOwner: true });
  });

  it('carries moreCount through and a missing ticket reading through', () => {
    expect(lanesForReader(STORIES, TICKETS, reader, true).tickets?.moreCount).toBe(4);
    expect(lanesForReader(STORIES, null, reader, true).tickets).toBeNull();
  });

  describe('a host-login estate agrees with the strict ownership rule', () => {
    // `ownedFromTicket` (packages/board/src/app/lib/agent-rows/mine-filter.ts)
    // is Delivery's own path to the same question, matching an assignee list
    // against the reader through `ownership`'s `ticket` arm directly. A
    // host-login row carries only one assignee by the time it reaches this
    // rule, so reproducing that arm here — rather than importing a UI package
    // from the domain — proves the two paths read a host-login row alike
    // without crossing the layering rule.
    const deliveryTicketIsMine = (owner: string | null) =>
      isMine({ kind: 'ticket', assignees: owner === null ? [] : [owner], source: { service: '', match: 'host-login' } }, reader);

    it('agrees that the reader\'s own host-login spelling is theirs', () => {
      const tickets: TicketLaneGroups = { open: [ticket('9', 'jwloka', 'host-login')], 'in-progress': [], done: [], moreCount: 0 };
      const discoveryKeptIt = lanesForReader(STORIES, tickets, reader, true).tickets?.open.rows.map((r) => r.id).includes('9');
      expect(discoveryKeptIt).toBe(deliveryTicketIsMine('jwloka'));
      expect(discoveryKeptIt).toBe(true);
    });

    it('agrees that an undeclared host-login spelling is somebody else\'s', () => {
      // Unlike the lenient `resolvedOwner` arm (tested above for
      // tracker-account sources), a host-login spelling the directory never
      // declared is still compared exactly against the reader's login — an
      // undeclared mismatch reads as `theirs`, not `unknown`.
      const tickets: TicketLaneGroups = { open: [ticket('9', 'someone-else', 'host-login')], 'in-progress': [], done: [], moreCount: 0 };
      const discoveryKeptIt = lanesForReader(STORIES, tickets, reader, true).tickets?.open.rows.map((r) => r.id).includes('9');
      expect(discoveryKeptIt).toBe(deliveryTicketIsMine('someone-else'));
      expect(discoveryKeptIt).toBe(false);
    });

    it('agrees that no assignee reads as unknown, so it stays', () => {
      const tickets: TicketLaneGroups = { open: [ticket('9', null, 'host-login')], 'in-progress': [], done: [], moreCount: 0 };
      const discoveryKeptIt = lanesForReader(STORIES, tickets, reader, true).tickets?.open.rows.map((r) => r.id).includes('9');
      expect(discoveryKeptIt).toBe(deliveryTicketIsMine(null));
      expect(discoveryKeptIt).toBe(true);
    });
  });
});
