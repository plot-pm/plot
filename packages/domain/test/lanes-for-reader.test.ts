import { describe, expect, it } from 'vitest';
import { lanesForReader } from '../src/rules/lanes-for-reader.js';
import type { TicketLaneGroups, TicketLaneRow } from '../src/rules/ticket-lanes.js';
import { isMine, ownedTicket, type Reader, type TicketSource } from '../src/rules/ownership.js';
import { parsePersonDirectory } from '../src/entities/person.js';

const directory = parsePersonDirectory('jwloka = Jan Wloka; eins78 = Max Albrecht');
const reader: Reader = { hostUser: 'jwloka', directory };

const github: TicketSource = { service: 'github', match: 'host-login' };
const jira: TicketSource = { service: 'jira', match: 'tracker-account', prefix: 'jira:' };

const ticket = (id: string, assignees: string[], source: TicketSource | null = github): TicketLaneRow => ({
  id,
  title: `Ticket ${id}`,
  url: `https://github.com/plot-pm/plot/issues/${id}`,
  createdAt: null,
  body: null,
  status: 'Open',
  statusCategory: 'To Do',
  closedAt: null,
  type: null,
  owner: assignees[0] ?? null,
  assignees,
  source,
});

const story = (slug: string, author?: string) => ({ slug, author });

const TICKETS: TicketLaneGroups = {
  open: [ticket('1', ['jwloka']), ticket('2', ['eins78'])],
  'in-progress': [ticket('3', [])],
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

  it('keeps an unassigned ticket, as unknown', () => {
    const tickets: TicketLaneGroups = { open: [ticket('9', [])], 'in-progress': [], done: [], moreCount: 0 };
    const actual = lanesForReader(STORIES, tickets, reader, true);
    expect(actual.tickets?.open.rows.map((r) => r.id)).toEqual(['9']);
  });

  it('keeps a ticket whose assignee is an undeclared tracker-account spelling, as unknown', () => {
    // `jira:jira-acct-99` names nobody in `directory`, so the tracker-account
    // rule cannot place it and must not call it `theirs`.
    const tickets: TicketLaneGroups = { open: [ticket('9', ['jira-acct-99'], jira)], 'in-progress': [], done: [], moreCount: 0 };
    const actual = lanesForReader(STORIES, tickets, reader, true);
    expect(actual.tickets?.open.rows.map((r) => r.id)).toEqual(['9']);
  });

  it('keeps the reader\'s own ticket even where their tracker spelling is undeclared', () => {
    // Nothing in `directory` declares a spelling for `jwloka` as a tracker
    // account, so an undeclared-but-actually-mine spelling must not hide the
    // reader's own ticket either.
    const tickets: TicketLaneGroups = { open: [ticket('9', ['jira-acct-mine'], jira)], 'in-progress': [], done: [], moreCount: 0 };
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
    const tickets: TicketLaneGroups = { open: [ticket('5', ['eins78'])], 'in-progress': [], done: [], moreCount: 0 };
    const actual = lanesForReader(STORIES, tickets, reader, true);
    expect(actual.tickets?.open).toEqual({ rows: [], hiddenByOwner: true });
  });

  it('carries moreCount through and a missing ticket reading through', () => {
    expect(lanesForReader(STORIES, TICKETS, reader, true).tickets?.moreCount).toBe(4);
    expect(lanesForReader(STORIES, null, reader, true).tickets).toBeNull();
  });

  describe('Discovery agrees with Delivery\'s ticket rule', () => {
    // Delivery's `ownedFromTicket` (packages/board/src/app/lib/agent-rows/mine-filter.ts)
    // returns `ownedTicket(row.assignees, source)`; these cases ask that same
    // function, and `packages/board/test/unit/mine-filter.test.ts` asks the
    // board's own `ownedFromTicket` against `lanesForReader`.
    const undeclared: Reader = { hostUser: 'jwloka', directory: {} };
    const keeps = (row: TicketLaneRow, who: Reader): boolean =>
      lanesForReader(STORIES, { open: [row], 'in-progress': [], done: [], moreCount: 0 }, who, true)
        .tickets!.open.rows.some((r) => r.id === row.id);
    const deliveryKeeps = (row: TicketLaneRow, who: Reader): boolean => isMine(ownedTicket(row.assignees, row.source), who);

    const cases: Array<[string, TicketLaneRow, Reader, boolean]> = [
      ['the reader as the only host-login assignee', ticket('9', ['jwloka']), reader, true],
      ['an undeclared host-login assignee who is not the reader', ticket('9', ['someone-else']), reader, false],
      ['no assignee', ticket('9', []), reader, true],
      ['the reader as the SECOND host-login assignee, neither declared', ticket('9', ['alice', 'jwloka']), undeclared, true],
      ['the reader as the second assignee, the first declared for somebody else', ticket('9', ['eins78', 'jwloka']), reader, true],
      ['two host-login assignees, neither the reader', ticket('9', ['alice', 'bob']), undeclared, false],
      ['a null source', ticket('9', ['eins78'], null), reader, true],
    ];

    it.each(cases)('answers alike for %s', (_name, row, who, expected) => {
      expect(keeps(row, who)).toBe(deliveryKeeps(row, who));
      expect(keeps(row, who)).toBe(expected);
    });

    it('keeps a tracker-account ticket whose second assignee is the reader\'s declared spelling', () => {
      const jiraReader: Reader = { hostUser: 'jwloka', directory: parsePersonDirectory('jwloka = jira:jan.wloka@quatico.com') };
      const row = ticket('9', ['undeclared-account', 'jan.wloka@quatico.com'], jira);
      expect(keeps(row, jiraReader)).toBe(deliveryKeeps(row, jiraReader));
      expect(keeps(row, jiraReader)).toBe(true);
    });

    it('keeps a tracker-account ticket whose reader is the second of two declared assignees', () => {
      const jiraReader: Reader = {
        hostUser: 'jwloka',
        directory: parsePersonDirectory('mruepp = jira:margit.ruepp@quatico.com; jwloka = jira:jan.wloka@quatico.com'),
      };
      const row = ticket('9', ['margit.ruepp@quatico.com', 'jan.wloka@quatico.com'], jira);
      expect(keeps(row, jiraReader)).toBe(deliveryKeeps(row, jiraReader));
      expect(keeps(row, jiraReader)).toBe(true);
    });
  });

  it('labels a kept ticket\'s owner as the reader where the reader is the second assignee', () => {
    const row = ticket('9', ['eins78', 'jwloka']);
    const tickets: TicketLaneGroups = { open: [row], 'in-progress': [], done: [], moreCount: 0 };
    const actual = lanesForReader(STORIES, tickets, reader, true);
    expect(actual.tickets?.open.rows[0]?.owner).toBe('jwloka');
  });
});
