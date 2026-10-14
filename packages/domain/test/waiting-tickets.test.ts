import { describe, it, expect } from 'vitest';
import { waitingTickets, hiddenSentence, shownSentence } from '../src/rules/waiting-tickets.js';
import type { IssueIndexRow } from '../src/entities/issue-index.js';
import type { Reader, TicketSource } from '../src/rules/ownership.js';

const GITHUB: TicketSource = { service: 'github', match: 'host-login' };
const JIRA: TicketSource = { service: 'jira', match: 'tracker-account', prefix: 'jira:' };

const row = (number: string, overrides: Partial<IssueIndexRow> = {}): IssueIndexRow => ({
  number,
  title: `Ticket ${number}`,
  url: `https://example.test/${number}`,
  createdAt: '2026-01-01T00:00:00.000Z',
  ...overrides,
});

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
});

describe('hiddenSentence and shownSentence', () => {
  it('127 open tickets are not assigned to you, for complete true', () => {
    expect(hiddenSentence(127, true)).toBe('127 open tickets are not assigned to you');
  });

  it('at least 997 ..., for hidden 997 and complete false', () => {
    expect(hiddenSentence(997, false)).toBe('at least 997 open tickets are not assigned to you');
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

  it('an unmatched Jira reader with no inbox answers the open rows', () => {
    const reader: Reader = { hostUser: 'jwloka' };
    const rows = unassigned(5);
    const result = waitingTickets(rows, undefined, reader, JIRA, true);
    expect(result.shown).toBe(5);
    expect(result.notice).toBeNull();
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

  it('the same Jira reader with no inbox answers the open rows and the same notice', () => {
    const reader: Reader = { hostUser: 'jwloka', directory: { 'jira:jan.wloka@quatico.com': 'jwloka' } };
    const rows = [row('o1', { assignees: ['5b10ac8d82e05b22cc7d4ef5'] }), ...unassigned(4)];
    const result = waitingTickets(rows, undefined, reader, JIRA, true);
    expect(result.shown).toBe(5);
    expect(result.notice).toContain('5b10ac8d82e05b22cc7d4ef5');
  });
});
