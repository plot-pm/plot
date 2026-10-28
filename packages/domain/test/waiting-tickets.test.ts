import { describe, it, expect } from 'vitest';
import { waitingTickets, hiddenSentence, shownSentence } from '../src/rules/waiting-tickets.js';
import type { IssueIndexRow } from '../src/entities/issue-index.js';
import type { Reader, TicketSource } from '../src/rules/ownership.js';
import type { TicketPlan } from '../src/rules/ticket-phase.js';

const GITHUB: TicketSource = { service: 'github', match: 'host-login' };
const JIRA: TicketSource = { service: 'jira', match: 'tracker-account', prefix: 'jira:' };

const row = (number: string, overrides: Partial<IssueIndexRow> = {}): IssueIndexRow => ({
  number,
  title: `Ticket ${number}`,
  url: `https://example.test/${number}`,
  createdAt: '2026-01-01T00:00:00.000Z',
  ...overrides,
});

const plans = (entries: Record<string, TicketPlan[]>): Map<string, TicketPlan[]> => new Map(Object.entries(entries));

const unassigned = (n: number): IssueIndexRow[] =>
  Array.from({ length: n }, (_, i) => row(`${i}`, { assignees: [] }));

describe('waitingTickets, the default (a matched GitHub reader)', () => {
  const reader: Reader = { hostUser: 'jwloka' };

  it('answers 0 tickets, shown 0 and hidden 127 over 127 unplanned rows with 0 assigned', () => {
    const rows = unassigned(127);
    const result = waitingTickets(rows, undefined, reader, GITHUB, true);
    expect(result.tickets).toHaveLength(0);
    expect(result.shown).toBe(0);
    expect(result.hidden).toBe(127);
    expect(result.notice).toBeNull();
  });

  it('a row with no createdAt gets a null ageMinutes and sorts as oldest', () => {
    const rows = [row('undated', { assignees: ['jwloka'], createdAt: undefined }), row('dated', { assignees: ['jwloka'] })];
    const result = waitingTickets(rows, undefined, reader, GITHUB, true);
    expect(result.tickets.find((t) => t.number === 'undated')?.ageMinutes).toBeNull();
    expect(result.tickets.map((t) => t.number)).toEqual(['dated', 'undated']);
  });

  it('a row with an unparseable createdAt gets a null ageMinutes and sorts as oldest', () => {
    const rows = [row('bad-date', { assignees: ['jwloka'], createdAt: 'not-a-date' }), row('dated', { assignees: ['jwloka'] })];
    const result = waitingTickets(rows, undefined, reader, GITHUB, true);
    expect(result.tickets.find((t) => t.number === 'bad-date')?.ageMinutes).toBeNull();
    expect(result.tickets.map((t) => t.number)).toEqual(['dated', 'bad-date']);
  });

  it('keeps an assigned row older than the 50 newest in tickets', () => {
    const rows = [
      ...unassigned(60),
      row('old-mine', { assignees: ['jwloka'], createdAt: '2020-01-01T00:00:00.000Z' }),
    ];
    const result = waitingTickets(rows, undefined, reader, GITHUB, true);
    expect(result.shown).toBe(1);
    expect(result.tickets.some((t) => t.number === 'old-mine')).toBe(true);
  });

  it('a matched Jira reader over 1001 open rows with complete:false, own ticket only in inbox, answers the union with that ticket', () => {
    const jiraReader: Reader = { hostUser: 'jwloka', directory: { 'jira:jan.wloka@quatico.com': 'jwloka' } };
    const rows = unassigned(1000);
    const inboxRow = row('inbox-1', { assignees: ['jan.wloka@quatico.com'] });
    const result = waitingTickets(rows, [inboxRow], jiraReader, JIRA, false);
    expect(result.shown).toBe(1);
    expect(result.complete).toBe(false);
    expect(result.tickets.some((t) => t.number === 'inbox-1')).toBe(true);
  });

  it('a matched Jira reader whose own ticket is in both inbox and rows counts it once', () => {
    const jiraReader: Reader = { hostUser: 'jwloka', directory: { 'jira:jan.wloka@quatico.com': 'jwloka' } };
    const mineRow = row('both', { assignees: ['jan.wloka@quatico.com'] });
    const rows = [mineRow, ...unassigned(4)];
    const result = waitingTickets(rows, [mineRow], jiraReader, JIRA, true);
    expect(result.shown).toBe(1);
  });
});

describe('waitingTickets, type and owner', () => {
  it('resolves an assignee through the directory to a handle', () => {
    const reader: Reader = { hostUser: 'jwloka', directory: { jwloka: 'jan' } };
    const rows = [row('1', { assignees: ['jwloka'], type: 'Bug' })];
    const result = waitingTickets(rows, undefined, reader, GITHUB, true);
    expect(result.tickets[0].owner).toBe('jan');
    expect(result.tickets[0].type).toBe('bug');
  });

  it('shows an undeclared assignee as written', () => {
    const reader: Reader = {};
    const rows = [row('1', { assignees: ['someone-undeclared'] })];
    const result = waitingTickets(rows, undefined, reader, GITHUB, true);
    expect(result.tickets[0].owner).toBe('someone-undeclared');
  });

  it('carries no owner and no type for an unassigned, typeless ticket', () => {
    const reader: Reader = {};
    const rows = [row('1', { assignees: [] })];
    const result = waitingTickets(rows, undefined, reader, null, true);
    expect(result.tickets[0].owner).toBeNull();
    expect(result.tickets[0].type).toBeNull();
  });
});

describe('hiddenSentence and shownSentence', () => {
  it('127 open tickets are not assigned to you, for complete true and no split', () => {
    expect(hiddenSentence(127, true, 0, 0)).toBe('127 open tickets are not assigned to you');
  });

  it('at least 997 ..., for hidden 997, complete false and no split', () => {
    expect(hiddenSentence(997, false, 0, 0)).toBe('at least 997 open tickets are not assigned to you');
  });

  it('names both counts when both are nonzero', () => {
    expect(hiddenSentence(4, true, 1, 3)).toBe('4 open tickets are not assigned to you — 1 unassigned, 3 assigned to someone else');
  });

  it('names only unassigned when assignedToOthers is zero', () => {
    expect(hiddenSentence(1, true, 1, 0)).toBe('1 open tickets are not assigned to you — 1 unassigned');
  });

  it('names only assignedToOthers when unassigned is zero', () => {
    expect(hiddenSentence(3, true, 0, 3)).toBe('3 open tickets are not assigned to you — 3 assigned to someone else');
  });

  it('keeps the at-least prefix alongside the split', () => {
    expect(hiddenSentence(4, false, 1, 3)).toBe('at least 4 open tickets are not assigned to you — 1 unassigned, 3 assigned to someone else');
  });

  it('Showing 50 of 127 open tickets., for complete true', () => {
    expect(shownSentence(50, 127, true)).toBe('Showing 50 of 127 open tickets.');
  });

  it('the at least form, for complete false', () => {
    expect(shownSentence(50, 127, false)).toBe('Showing 50 of at least 127 open tickets.');
  });
});

describe('waitingTickets, the unmatched reader', () => {
  it('a GitHub reader with no host login over 127 rows answers 50 tickets, shown 127 and the no-login notice', () => {
    const reader: Reader = {};
    const rows = unassigned(127).map((_, i) => row(`${i}`, { assignees: ['somebody'] }));
    const result = waitingTickets(rows, undefined, reader, GITHUB, true);
    expect(result.tickets).toHaveLength(50);
    expect(result.shown).toBe(127);
    expect(result.notice).toContain('no host login');
    expect(result.notice).toContain('127');
  });

  it('a GitHub reader with no People entry is matched by login', () => {
    const reader: Reader = { hostUser: 'jwloka' };
    const rows = [row('1', { assignees: ['jwloka'] }), row('2', { assignees: ['someoneelse'] })];
    const result = waitingTickets(rows, undefined, reader, GITHUB, true);
    expect(result.shown).toBe(1);
    expect(result.notice).toBeNull();
  });

  it('a null source answers every row and its notice', () => {
    const reader: Reader = { hostUser: 'jwloka' };
    const rows = unassigned(10);
    const result = waitingTickets(rows, undefined, reader, null, true);
    expect(result.shown).toBe(10);
    expect(result.notice).not.toBeNull();
  });

  it('an unmatched Jira reader answers the inbox rows with no notice and no count', () => {
    const reader: Reader = { hostUser: 'jwloka' };
    const rows = unassigned(5);
    const inbox = [row('i1'), row('i2')];
    const result = waitingTickets(rows, inbox, reader, JIRA, true);
    expect(result.shown).toBe(2);
    expect(result.notice).toBeNull();
  });

  it('a Jira source with no ticket projects, whose inbox read is unaskable, answers the open rows as the reader\'s own and no notice', () => {
    // With no `Ticket prefixes` the Jira open read is person-scoped
    // (`assignee = currentUser()`), so `rows` holds exactly the reader's tickets.
    const reader: Reader = { hostUser: 'jwloka', directory: { 'jira:jan.wloka@quatico.com': 'jwloka' } };
    const rows = [row('J-1', { assignees: ['jan.wloka@quatico.com'] }), row('J-2', { assignees: ['jan.wloka@quatico.com'] })];
    const result = waitingTickets(rows, undefined, reader, JIRA, true, new Map(), 'unaskable');
    expect(result.shown).toBe(2);
    expect(result.tickets.map((t) => t.number).sort()).toEqual(['J-1', 'J-2']);
    expect(result.notice).toBeNull();
  });

  it('a Jira source with no ticket projects and no People spelling answers the open rows when the inbox read is unaskable', () => {
    const reader: Reader = { hostUser: 'jwloka' };
    const rows = [row('J-1', { assignees: ['5b10ac8d82e05b22cc7d4ef5'] }), row('J-2', { assignees: ['5b10ac8d82e05b22cc7d4ef5'] })];
    const result = waitingTickets(rows, undefined, reader, JIRA, true, new Map(), 'unaskable');
    expect(result.shown).toBe(2);
    expect(result.notice).toBeNull();
  });

  it('an inbox read that failed with no kept rows answers 0 tickets and says the inbox could not be read', () => {
    const reader: Reader = { hostUser: 'jwloka', directory: { 'jira:jan.wloka@quatico.com': 'jwloka' } };
    const rows = [row('o1', { assignees: ['a-colleague@quatico.com'] }), ...unassigned(4)];
    const result = waitingTickets(rows, undefined, reader, JIRA, true, new Map(), 'failed');
    expect(result.shown).toBe(0);
    expect(result.notice).toBe('The inbox could not be read — showing none of your tickets rather than the project\'s.');
  });

  it('an index written before the inbox answer was stored answers the open rows, as an unaskable read does', () => {
    const reader: Reader = { hostUser: 'jwloka' };
    const rows = [row('J-1', { assignees: ['jan.wloka@quatico.com'] })];
    const result = waitingTickets(rows, undefined, reader, JIRA, true, new Map(), undefined);
    expect(result.shown).toBe(1);
  });

  it('a Jira reader with no declared spelling and an inbox that was not read answers 0 tickets and no spelling notice', () => {
    // Catches fixing only the matched/unmatched arm: `declaresAnyAccountSpelling`
    // is false here, and `rows`' first assignee is a colleague — the project
    // rows must never stand in for an inbox that was never read.
    const reader: Reader = { hostUser: 'jwloka' };
    const rows = unassigned(5).map((r, i) => ({ ...r, assignees: [i === 0 ? 'a-colleague' : ''] }));
    const result = waitingTickets(rows, undefined, reader, JIRA, true, new Map(), 'not-read');
    expect(result.shown).toBe(0);
    expect(result.notice).not.toBeNull();
    expect(result.notice).not.toContain('add `');
  });

  it('a Jira reader who declares jira:<email> over inbox rows whose assignee is an accountId answers the inbox rows and a notice naming the accountId', () => {
    const reader: Reader = { hostUser: 'jwloka', directory: { 'jira:jan.wloka@quatico.com': 'jwloka' } };
    const inbox = [row('i1', { assignees: ['5b10ac8d82e05b22cc7d4ef5'] })];
    const rows = unassigned(5);
    const result = waitingTickets(rows, inbox, reader, JIRA, true);
    expect(result.shown).toBe(1);
    expect(result.notice).toContain('5b10ac8d82e05b22cc7d4ef5');
    expect(result.notice).toContain('jira:jan.wloka@quatico.com');
  });

  it('the same Jira reader with an inbox that was not read answers 0 tickets and no spelling notice, never the project rows', () => {
    // The `markus.ruepp` banner, reproduced: an absent inbox must never let a
    // project-wide row's first assignee stand in for the reader's own ticket.
    const reader: Reader = { hostUser: 'jwloka', directory: { 'jira:jan.wloka@quatico.com': 'jwloka' } };
    const rows = [row('o1', { assignees: ['5b10ac8d82e05b22cc7d4ef5'] }), ...unassigned(4)];
    const result = waitingTickets(rows, undefined, reader, JIRA, true, new Map(), 'not-read');
    expect(result.shown).toBe(0);
    expect(result.notice).not.toContain('5b10ac8d82e05b22cc7d4ef5');
    expect(result.notice).not.toBeNull();
  });

  it('a GitHub reader whose login is shaped like an email answers every row and the no-login notice', () => {
    const reader: Reader = { hostUser: 'jan.wloka@quatico.com' };
    const rows = unassigned(3).map((_, i) => row(`${i}`, { assignees: ['jwloka'] }));
    const result = waitingTickets(rows, undefined, reader, GITHUB, true);
    expect(result.shown).toBe(3);
    expect(result.notice).toContain('no host login');
  });

  it('a Jira reader with no host login over an inbox with a blank assignee answers no notice', () => {
    const reader: Reader = { directory: { 'jira:jan.wloka@quatico.com': 'jwloka' } };
    const inbox = [row('i1', { assignees: ['  '] })];
    const rows = unassigned(5);
    const result = waitingTickets(rows, inbox, reader, JIRA, true);
    expect(result.shown).toBe(1);
    expect(result.notice).toBeNull();
  });

  it('a Jira reader matched through one of several assignees, the rest undeclared, answers the matched ticket', () => {
    const reader: Reader = { hostUser: 'jwloka', directory: { 'jira:jan.wloka@quatico.com': 'jwloka' } };
    const inbox = [row('i1', { assignees: ['somebody-undeclared', 'jan.wloka@quatico.com'] })];
    const rows = unassigned(5);
    const result = waitingTickets(rows, inbox, reader, JIRA, true);
    expect(result.shown).toBe(1);
    expect(result.notice).toBeNull();
  });

  it('a Jira reader whose own prefix-spelling resolves to somebody else leaves the candidate unmatched with no notice', () => {
    // The spelling People would suggest is already declared for `eins78` —
    // the notice must not offer to reassign it to this reader.
    const reader: Reader = {
      hostUser: 'jwloka',
      directory: { 'jira:jan.wloka@quatico.com': 'jwloka', 'jira:other@quatico.com': 'eins78' },
    };
    const inbox = [row('i1', { assignees: ['other@quatico.com'] })];
    const rows = unassigned(5);
    const result = waitingTickets(rows, inbox, reader, JIRA, true);
    expect(result.shown).toBe(1);
    expect(result.notice).toBeNull();
  });

  it('a candidate row with no assignees field at all is treated as unassigned', () => {
    const reader: Reader = { hostUser: 'jwloka', directory: { 'jira:jan.wloka@quatico.com': 'jwloka' } };
    const inbox = [row('i1', { assignees: undefined })];
    const rows = unassigned(5);
    const result = waitingTickets(rows, inbox, reader, JIRA, true);
    expect(result.shown).toBe(1);
    expect(result.notice).toBeNull();
  });

  it('a Jira reader with no host login over a candidate assigned to someone else leaves it unmatched with no notice', () => {
    // The candidate's spelling is already declared, for `eins78` — the notice
    // must not offer it to a reader with no resolvable identity either.
    const reader: Reader = { directory: { 'jira:other@quatico.com': 'eins78' } };
    const inbox = [row('i1', { assignees: ['other@quatico.com'] })];
    const rows = unassigned(5);
    const result = waitingTickets(rows, inbox, reader, JIRA, true);
    expect(result.shown).toBe(1);
    expect(result.notice).toBeNull();
  });

  it('a matched Jira reader whose inbox was not read answers 0 tickets rather than the open rows', () => {
    // Even a reader who WOULD match if the inbox had been read gets nothing
    // from `rows` while the inbox is absent — `rows` never stands in for it.
    const reader: Reader = { hostUser: 'jwloka', directory: { 'jira:jan.wloka@quatico.com': 'jwloka' } };
    const rows = [row('mine', { assignees: ['jan.wloka@quatico.com'] }), ...unassigned(4)];
    const result = waitingTickets(rows, undefined, reader, JIRA, true, new Map(), 'not-read');
    expect(result.shown).toBe(0);
    expect(result.tickets.some((t) => t.number === 'mine')).toBe(false);
    expect(result.notice).not.toBeNull();
  });

  it('an unmatched Jira reader with an answered-empty inbox answers 0 tickets and no notice, distinct from an absent one', () => {
    // `inbox: []` is an answer, not a missing read — it must give 0 tickets
    // and no notice, never collapsed with `undefined` via `?? []`.
    const reader: Reader = { hostUser: 'jwloka', directory: { 'jira:jan.wloka@quatico.com': 'jwloka' } };
    const rows = [row('someone-else', { assignees: ['a-colleague@quatico.com'] }), ...unassigned(4)];
    const result = waitingTickets(rows, [], reader, JIRA, true);
    expect(result.shown).toBe(0);
    expect(result.notice).toBeNull();
  });

  it('a non-empty inbox with no match never suggests a spelling People declares for another person', () => {
    // The `markus.ruepp` banner: the inbox's first assignee is already
    // declared for a colleague, so the notice must not offer to reassign it.
    const reader: Reader = { hostUser: 'jwloka', directory: { 'jira:jan.wloka@quatico.com': 'jwloka', 'jira:markus.ruepp@quatico.com': 'mruepp' } };
    const inbox = [row('i1', { assignees: ['markus.ruepp@quatico.com'] })];
    const rows = unassigned(5);
    const result = waitingTickets(rows, inbox, reader, JIRA, true);
    expect(result.shown).toBe(1);
    expect(result.notice).toBeNull();
  });

  it('a reader with a declared spelling under a different assignee string names that declared spelling in the notice', () => {
    // The reader already has a `jira:` spelling of their own — just not the
    // one the tracker used for this assignee — so the notice names it
    // instead of the "declares no spelling" wording.
    const reader: Reader = { hostUser: 'jwloka', directory: { 'jira:jan.wloka@quatico.com': 'jwloka' } };
    const inbox = [row('i1', { assignees: ['j.wloka@quatico.com'] })];
    const rows = unassigned(5);
    const result = waitingTickets(rows, inbox, reader, JIRA, true);
    expect(result.shown).toBe(1);
    expect(result.notice).toBe(
      'The tracker names your tickets\' assignee `j.wloka@quatico.com`; `People` declares `jira:jan.wloka@quatico.com` for jwloka — add `jira:j.wloka@quatico.com` to match.',
    );
  });

  it('a reader with no declared spelling of their own, on a source where someone else has one, gets the "declares no spelling" wording', () => {
    // `declaresAnyAccountSpelling` only asks whether the PREFIX is declared
    // for anyone — a reader with no entry of their own still reaches the
    // notice, and it must say "declares no spelling", not name a colleague's.
    const reader: Reader = { hostUser: 'jwloka', directory: { 'jira:markus.ruepp@quatico.com': 'mruepp' } };
    const inbox = [row('i1', { assignees: ['someone.new@quatico.com'] })];
    const rows = unassigned(5);
    const result = waitingTickets(rows, inbox, reader, JIRA, true);
    expect(result.shown).toBe(1);
    expect(result.notice).toBe(
      'The tracker names your tickets\' assignee `someone.new@quatico.com`, and `People` declares no `jira:` spelling for jwloka — add `jira:someone.new@quatico.com` to match.',
    );
  });
});

describe('waitingTickets, planned tickets', () => {
  const reader: Reader = { hostUser: 'jwloka' };
  it('shows the plan phase as status on a planned ticket and the tracker state on an unplanned one', () => {
    const rows = [
      row('1', { assignees: ['jwloka'], status: 'open' }),
      row('2', { assignees: ['jwloka'], status: 'open' }),
    ];
    const result = waitingTickets(rows, undefined, reader, GITHUB, true, plans({ '2': [{ state: 'approved', total: 6, merged: 3 }] }));
    expect(result.tickets.map((t) => [t.number, t.status])).toEqual([['1', 'open'], ['2', 'in progress 3/6']]);
  });

  it('keeps a planned ticket in the list rather than dropping it', () => {
    const rows = [row('7', { assignees: ['jwloka'], status: 'open' })];
    const result = waitingTickets(rows, undefined, reader, GITHUB, true, plans({ '7': [{ state: 'delivered', total: 1, merged: 1 }] }));
    expect(result.tickets).toHaveLength(1);
    expect(result.tickets[0].status).toBe('delivered');
  });

  it('sorts unplanned rows ahead of planned rows even when a planned row is newer', () => {
    const rows = [
      row('planned-new', { assignees: ['jwloka'], createdAt: '2026-03-01T00:00:00.000Z' }),
      row('plain-old', { assignees: ['jwloka'], createdAt: '2026-01-01T00:00:00.000Z' }),
      row('plain-new', { assignees: ['jwloka'], createdAt: '2026-02-01T00:00:00.000Z' }),
      row('planned-old', { assignees: ['jwloka'], createdAt: '2026-01-15T00:00:00.000Z' }),
    ];
    const planned = [{ state: 'draft', total: 0, merged: null }];
    const result = waitingTickets(rows, undefined, reader, GITHUB, true, plans({ 'planned-new': planned, 'planned-old': planned }));
    expect(result.tickets.map((t) => t.number)).toEqual(['plain-new', 'plain-old', 'planned-new', 'planned-old']);
  });

  it('keeps the tracker state on a planned Jira ticket and still sorts it with the planned rows', () => {
    const jiraReader: Reader = { hostUser: 'jwloka', directory: { 'jira:jan.wloka@quatico.com': 'jwloka' } };
    const rows = [
      row('JIRA-1', { assignees: ['jan.wloka@quatico.com'], status: 'In Progress', createdAt: '2026-03-01T00:00:00.000Z' }),
      row('JIRA-2', { assignees: ['jan.wloka@quatico.com'], status: 'To Do', createdAt: '2026-01-01T00:00:00.000Z' }),
    ];
    const inbox = [...rows];
    const result = waitingTickets(rows, inbox, jiraReader, JIRA, true, plans({ 'JIRA-1': [{ state: 'approved', total: 2, merged: 1 }] }));
    expect(result.tickets.map((t) => [t.number, t.status])).toEqual([['JIRA-2', 'To Do'], ['JIRA-1', 'In Progress']]);
  });

  it('leaves a row named only by released plans out of tickets, shown and hidden', () => {
    const rows = [
      row('1', { assignees: ['jwloka'], status: 'open' }),
      row('2', { assignees: ['jwloka'], status: 'closed' }),
    ];
    const result = waitingTickets(rows, undefined, reader, GITHUB, true, plans({ '2': [{ state: 'released', total: 1, merged: 1 }] }));
    expect(result.tickets.map((t) => t.number)).toEqual(['1']);
    expect(result.shown).toBe(1);
    expect(result.hidden).toBe(0);
  });

  it('still shows a row named by one released and one unfinished plan, labelled in progress', () => {
    const rows = [row('3', { assignees: ['jwloka'], status: 'open' })];
    const result = waitingTickets(
      rows,
      undefined,
      reader,
      GITHUB,
      true,
      plans({ '3': [{ state: 'released', total: 1, merged: 1 }, { state: 'approved', total: 2, merged: 0 }] }),
    );
    expect(result.tickets).toHaveLength(1);
    expect(result.tickets[0].status).toBe('in progress 0/2');
    expect(result.shown).toBe(1);
    expect(result.hidden).toBe(0);
  });

  it('leaves a row named only by a rejected plan out of tickets, shown and hidden', () => {
    const rows = [
      row('1', { assignees: ['jwloka'], status: 'open' }),
      row('2', { assignees: ['jwloka'], status: 'closed' }),
    ];
    const result = waitingTickets(rows, undefined, reader, GITHUB, true, plans({ '2': [{ state: 'rejected', total: 1, merged: null }] }));
    expect(result.tickets.map((t) => t.number)).toEqual(['1']);
    expect(result.shown).toBe(1);
    expect(result.hidden).toBe(0);
  });

  it('leaves a row named by one superseded and one released plan out of tickets, shown and hidden', () => {
    const rows = [
      row('1', { assignees: ['jwloka'], status: 'open' }),
      row('2', { assignees: ['jwloka'], status: 'open' }),
    ];
    const result = waitingTickets(
      rows,
      undefined,
      reader,
      GITHUB,
      true,
      plans({ '2': [{ state: 'superseded', total: 1, merged: null }, { state: 'released', total: 1, merged: 1 }] }),
    );
    expect(result.tickets.map((t) => t.number)).toEqual(['1']);
    expect(result.shown).toBe(1);
    expect(result.hidden).toBe(0);
  });

  it('counts in hidden only the unfinished rows not assigned to the reader', () => {
    const rows = [
      row('mine', { assignees: ['jwloka'] }),
      row('theirs-open', { assignees: ['someone-else'] }),
      row('theirs-released', { assignees: ['someone-else'] }),
      row('theirs-rejected', { assignees: ['someone-else'] }),
    ];
    const result = waitingTickets(
      rows,
      undefined,
      reader,
      GITHUB,
      true,
      plans({
        'theirs-released': [{ state: 'released', total: 1, merged: 1 }],
        'theirs-rejected': [{ state: 'rejected', total: 1, merged: null }],
      }),
    );
    expect(result.tickets.map((t) => t.number)).toEqual(['mine']);
    expect(result.shown).toBe(1);
    expect(result.hidden).toBe(1);
  });

  it('splits hidden into unassigned and assignedToOthers, summing back to hidden', () => {
    const rows = [
      row('mine', { assignees: ['jwloka'] }),
      row('no-owner-1', { assignees: [] }),
      row('no-owner-2', { assignees: undefined }),
      row('theirs-1', { assignees: ['someone-else'] }),
      row('theirs-2', { assignees: ['another-one'] }),
    ];
    const result = waitingTickets(rows, undefined, reader, GITHUB, true);
    expect(result.hidden).toBe(4);
    expect(result.unassigned).toBe(2);
    expect(result.assignedToOthers).toBe(2);
    expect(result.unassigned + result.assignedToOthers).toBe(result.hidden);
  });

  it('counts a hidden row with assignees: [] toward unassigned', () => {
    const rows = [row('mine', { assignees: ['jwloka'] }), row('empty-assignees', { assignees: [] })];
    const result = waitingTickets(rows, undefined, reader, GITHUB, true);
    expect(result.unassigned).toBe(1);
    expect(result.assignedToOthers).toBe(0);
  });

  it('counts a hidden row with assignees: undefined toward unassigned', () => {
    const rows = [row('mine', { assignees: ['jwloka'] }), row('no-assignees-field', { assignees: undefined })];
    const result = waitingTickets(rows, undefined, reader, GITHUB, true);
    expect(result.unassigned).toBe(1);
    expect(result.assignedToOthers).toBe(0);
  });

  it('counts a hidden row with a non-empty assignees toward assignedToOthers', () => {
    const rows = [row('mine', { assignees: ['jwloka'] }), row('someone-elses', { assignees: ['someone-else'] })];
    const result = waitingTickets(rows, undefined, reader, GITHUB, true);
    expect(result.assignedToOthers).toBe(1);
    expect(result.unassigned).toBe(0);
  });

  it('leaves a finished hidden row out of unassigned and assignedToOthers, same as hidden', () => {
    const rows = [
      row('mine', { assignees: ['jwloka'] }),
      row('theirs-released', { assignees: ['someone-else'] }),
      row('unowned-released', { assignees: [] }),
    ];
    const result = waitingTickets(
      rows,
      undefined,
      reader,
      GITHUB,
      true,
      plans({
        'theirs-released': [{ state: 'released', total: 1, merged: 1 }],
        'unowned-released': [{ state: 'released', total: 1, merged: 1 }],
      }),
    );
    expect(result.hidden).toBe(0);
    expect(result.unassigned).toBe(0);
    expect(result.assignedToOthers).toBe(0);
  });

  it('does not sort a row named only by a superseded plan into the unplanned bucket ahead of a genuinely unplanned row', () => {
    const rows = [
      row('unplanned', { assignees: ['jwloka'], status: 'open', createdAt: '2026-01-01T00:00:00.000Z' }),
      row('superseded-only', { assignees: ['jwloka'], status: 'open', createdAt: '2026-02-01T00:00:00.000Z' }),
      row('approved', { assignees: ['jwloka'], status: 'open', createdAt: '2026-03-01T00:00:00.000Z' }),
    ];
    const result = waitingTickets(
      rows,
      undefined,
      reader,
      GITHUB,
      true,
      plans({
        'superseded-only': [{ state: 'superseded', total: 1, merged: null }],
        approved: [{ state: 'approved', total: 2, merged: 1 }],
      }),
    );
    expect(result.tickets.map((t) => t.number)).toEqual(['unplanned', 'approved']);
    expect(result.shown).toBe(2);
    expect(result.hidden).toBe(0);
  });
});

describe('waitingTickets, host-login and tracker-account readers agree on planned-ness', () => {
  it('leaves a row named only by a rejected plan out of shown and hidden for both a host-login and a tracker-account reader', () => {
    const rejectedOnly = plans({ shared: [{ state: 'rejected', total: 1, merged: null }] });

    const hostReader: Reader = { hostUser: 'jwloka' };
    const hostRows = [row('shared', { assignees: ['jwloka'], status: 'open' })];
    const hostResult = waitingTickets(hostRows, undefined, hostReader, GITHUB, true, rejectedOnly);

    const jiraReader: Reader = { hostUser: 'jwloka', directory: { 'jira:jan.wloka@quatico.com': 'jwloka' } };
    const inboxRow = row('shared', { assignees: ['jan.wloka@quatico.com'], status: 'In Progress' });
    const jiraResult = waitingTickets([inboxRow], [inboxRow], jiraReader, JIRA, true, rejectedOnly);

    expect(hostResult.shown).toBe(0);
    expect(hostResult.hidden).toBe(0);
    expect(hostResult.tickets).toHaveLength(0);

    expect(jiraResult.shown).toBe(0);
    expect(jiraResult.hidden).toBe(0);
    expect(jiraResult.tickets).toHaveLength(0);
  });
});
